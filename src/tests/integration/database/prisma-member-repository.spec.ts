import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '../../../infra/database/prisma/prismaClient'
import { PrismaMemberRepository } from '../../../infra/database/prisma/prismaMemberRepository'
import { Member } from '../../../domain/entities/member'
import { INTEGRATION_SCHEMA } from '../setup/integration-database-url'
import { resetDatabase } from '../setup/reset-database'

describe('PrismaMemberRepository (Postgres real)', () => {
    const repository = new PrismaMemberRepository()
    let groupId: string
    let ownerUserId: string
    let bobUserId: string
    let carlaUserId: string

    beforeAll(() => {
        expect(process.env.DATABASE_URL).toContain(`schema=${INTEGRATION_SCHEMA}`)
    })

    beforeEach(async () => {
        await resetDatabase()
        const [alice, bob, carla] = await Promise.all(['alice', 'bob', 'carla'].map(name =>
            prisma.user.create({ data: { name, email: `${name}@test.com`, passwordHash: 'hash' } }),
        ))
        const group = await prisma.group.create({ data: { name: 'República' } })
        await prisma.member.create({
            data: { userId: alice.id, groupId: group.id, role: 'OWNER', joinedAt: new Date('2026-01-01T00:00:00Z') },
        })
        groupId = group.id
        ownerUserId = alice.id
        bobUserId = bob.id
        carlaUserId = carla.id
    })

    afterAll(async () => {
        await prisma.$disconnect()
    })

    async function addBob() {
        const member = Member.create({ userId: bobUserId, groupId })
        await repository.addMemberToGroup(member)
        return member
    }

    it('should add a member and find it by id and by user and group', async () => {
        const member = await addBob()

        expect(await repository.findById(member.id)).toMatchObject({ id: member.id, userId: bobUserId, role: 'MEMBER' })
        expect((await repository.findByUserAndGroup(bobUserId, groupId))?.id).toBe(member.id)
        expect(await repository.findByUserAndGroup(carlaUserId, groupId)).toBeNull()
    })

    it('should soft delete: the member leaves the active reads but stays reachable by id (D-72, D-79)', async () => {
        const member = await addBob()

        await repository.removeMemberGroup(member.id, ownerUserId)

        expect(await repository.findByUserAndGroup(bobUserId, groupId)).toBeNull()
        expect((await repository.findByGroupId(groupId)).map(m => m.userId)).toEqual([ownerUserId])
        expect((await repository.findById(member.id))?.id).toBe(member.id)
        const row = await prisma.member.findUniqueOrThrow({ where: { id: member.id } })
        expect(row.deletedAt).toBeInstanceOf(Date)
        expect(row.deletedBy).toBe(ownerUserId)
    })

    it('should find only removed members through findRemovedByUserAndGroup', async () => {
        const member = await addBob()

        expect(await repository.findRemovedByUserAndGroup(bobUserId, groupId)).toBeNull()
        await repository.removeMemberGroup(member.id, ownerUserId)
        expect((await repository.findRemovedByUserAndGroup(bobUserId, groupId))?.id).toBe(member.id)
        expect(await repository.findRemovedByUserAndGroup(carlaUserId, groupId)).toBeNull()
    })

    it('should block a second row for the same user and group, which is why re-adding reactivates (D-78)', async () => {
        const member = await addBob()
        await repository.removeMemberGroup(member.id, ownerUserId)

        await expect(repository.addMemberToGroup(Member.create({ userId: bobUserId, groupId }))).rejects.toThrow()

        await repository.reactivate(member.id)
        const reactivated = await repository.findByUserAndGroup(bobUserId, groupId)
        expect(reactivated?.id).toBe(member.id)
        const row = await prisma.member.findUniqueOrThrow({ where: { id: member.id } })
        expect(row).toMatchObject({ deletedAt: null, deletedBy: null })
    })

    it('should update the role', async () => {
        const member = await addBob()

        await repository.updateRole(member.id, 'OWNER')

        expect((await repository.findById(member.id))?.role).toBe('OWNER')
    })

    it('should list active members with name and email, oldest first', async () => {
        const bob = await prisma.member.create({
            data: { userId: bobUserId, groupId, joinedAt: new Date('2026-03-01T00:00:00Z') },
        })
        await prisma.member.create({
            data: { userId: carlaUserId, groupId, joinedAt: new Date('2026-02-01T00:00:00Z') },
        })
        await repository.removeMemberGroup(bob.id, ownerUserId)

        const members = await repository.findByGroupIdWithUser(groupId)

        expect(members.map(m => [m.name, m.email, m.role, m.userId])).toEqual([
            ['alice', 'alice@test.com', 'OWNER', ownerUserId],
            ['carla', 'carla@test.com', 'MEMBER', carlaUserId],
        ])
    })
})
