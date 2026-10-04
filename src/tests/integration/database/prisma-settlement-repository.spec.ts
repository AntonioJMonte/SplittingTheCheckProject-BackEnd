import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '../../../infra/database/prisma/prismaClient'
import { PrismaSettlementRepository } from '../../../infra/database/prisma/prismaSettlementRepository'
import { Settlement } from '../../../domain/entities/settlement'
import { Money } from '../../../domain/value-objects/money'
import { INTEGRATION_SCHEMA } from '../setup/integration-database-url'

const PARALLEL_ATTEMPTS = 10

describe('PrismaSettlementRepository (Postgres real)', () => {
  const repository = new PrismaSettlementRepository()
  let groupId: string
  let fromMemberId: string
  let toMemberId: string

  beforeAll(() => {
    expect(process.env.DATABASE_URL).toContain(`schema=${INTEGRATION_SCHEMA}`)
  })

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "ExpenseShare", "Expense", "Settlement", "Member", "Group", "User" CASCADE',
    )

    const [alice, bob] = await Promise.all(['alice', 'bob'].map(name =>
      prisma.user.create({ data: { name, email: `${name}-${randomUUID()}@test.com`, passwordHash: 'hash' } }),
    ))
    const group = await prisma.group.create({ data: { name: 'Integração' } })
    const [from, to] = await Promise.all([
      prisma.member.create({ data: { userId: bob.id, groupId: group.id } }),
      prisma.member.create({ data: { userId: alice.id, groupId: group.id, role: 'OWNER' } }),
    ])

    groupId = group.id
    fromMemberId = from.id
    toMemberId = to.id
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  function makePending(amount = '50.00') {
    return Settlement.create({ groupId, fromMemberId, toMemberId, amount: new Money(amount) })
  }

  it(`should apply exactly one of ${PARALLEL_ATTEMPTS} concurrent status updates that read the same version`, async () => {
    const settlement = makePending()
    await repository.create(settlement)

    const results = await Promise.all(
      Array.from({ length: PARALLEL_ATTEMPTS }, () => repository.updateStatus(settlement.id, 'CONFIRMED', 0)),
    )

    expect(results.filter(Boolean)).toHaveLength(1)
    const row = await prisma.settlement.findUniqueOrThrow({ where: { id: settlement.id } })
    expect(row.status).toBe('CONFIRMED')
    expect(row.version).toBe(1)
    expect(row.pendingKey).toBeNull()
  })

  it('should reject an acknowledge based on a version read before the settlement was cancelled', async () => {
    const settlement = makePending()
    await repository.create(settlement)
    const readBeforeCancel = await repository.findById(settlement.id)

    await repository.cancelPendingByGroupId(groupId)
    const applied = await repository.updateStatus(settlement.id, 'CONFIRMED', readBeforeCancel!.version)

    expect(applied).toBe(false)
    const row = await prisma.settlement.findUniqueOrThrow({ where: { id: settlement.id } })
    expect(row.status).toBe('CANCELLED')
    expect(row.version).toBe(1)
  })

  it(`should keep a single PENDING row when ${PARALLEL_ATTEMPTS} inserts for the same pair race`, async () => {
    const results = await Promise.all(
      Array.from({ length: PARALLEL_ATTEMPTS }, () => repository.create(makePending())),
    )

    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await prisma.settlement.count({ where: { fromMemberId, toMemberId, status: 'PENDING' } })).toBe(1)
  })

  it('should free the pair for a new PENDING settlement once the previous one is confirmed', async () => {
    const first = makePending()
    await repository.create(first)
    await repository.updateStatus(first.id, 'CONFIRMED', 0)

    await expect(repository.create(makePending('20.00'))).resolves.toBe(true)
  })

  it('should allow PENDING settlements for the same members in opposite directions', async () => {
    await repository.create(makePending())
    const reverse = Settlement.create({ groupId, fromMemberId: toMemberId, toMemberId: fromMemberId, amount: new Money('10.00') })

    await expect(repository.create(reverse)).resolves.toBe(true)
  })

  it('should rethrow unique violations that are not about the pending pair', async () => {
    const settlement = makePending()
    await repository.create(settlement)
    await repository.updateStatus(settlement.id, 'CONFIRMED', 0)

    const sameId = new Settlement(settlement.id, groupId, fromMemberId, toMemberId, new Money('5.00'))
    await expect(repository.create(sameId)).rejects.toThrow()
  })

  it('should round-trip a settlement with its exact amount and Pix payload', async () => {
    const settlement = Settlement.create({ groupId, fromMemberId, toMemberId, amount: new Money('33.33'), pixCopyPaste: '000201...' })
    await repository.create(settlement)

    const found = await repository.findById(settlement.id)

    expect(found).toMatchObject({ status: 'PENDING', version: 0, pixCopyPaste: '000201...', confirmedAt: undefined })
    expect(found?.amount.toString()).toBe('33.33')
    expect(await repository.findById(randomUUID())).toBeNull()
  })

  it('should stamp confirmedAt only when confirming, not when cancelling', async () => {
    const confirmed = makePending()
    await repository.create(confirmed)
    await repository.updateStatus(confirmed.id, 'CONFIRMED', 0)
    const cancelled = Settlement.create({ groupId, fromMemberId: toMemberId, toMemberId: fromMemberId, amount: new Money('5.00') })
    await repository.create(cancelled)
    await repository.updateStatus(cancelled.id, 'CANCELLED', 0)

    expect((await repository.findById(confirmed.id))?.confirmedAt).toBeInstanceOf(Date)
    expect((await repository.findById(cancelled.id))?.confirmedAt).toBeUndefined()
  })

  it('should find the pending settlement of a pair only in its direction', async () => {
    const settlement = makePending()
    await repository.create(settlement)

    expect((await repository.findPendingBetweenMembers(fromMemberId, toMemberId))?.id).toBe(settlement.id)
    expect(await repository.findPendingBetweenMembers(toMemberId, fromMemberId)).toBeNull()

    await repository.updateStatus(settlement.id, 'CONFIRMED', 0)
    expect(await repository.findPendingBetweenMembers(fromMemberId, toMemberId)).toBeNull()
  })

  it('should list the group settlements newest first, optionally by status, keeping createdAt (D-89)', async () => {
    const older = new Settlement(randomUUID(), groupId, fromMemberId, toMemberId, new Money('10.00'), 'PENDING', undefined, undefined, 0, new Date('2026-09-01T00:00:00Z'))
    await repository.create(older)
    await repository.updateStatus(older.id, 'CONFIRMED', 0)
    const newer = new Settlement(randomUUID(), groupId, toMemberId, fromMemberId, new Money('3.00'), 'PENDING', undefined, undefined, 0, new Date('2026-09-15T00:00:00Z'))
    await repository.create(newer)

    expect((await repository.findByGroup(groupId)).map(s => s.id)).toEqual([newer.id, older.id])
    expect((await repository.findByGroup(groupId, 'PENDING')).map(s => s.id)).toEqual([newer.id])
    expect((await repository.findByGroup(groupId, 'CANCELLED'))).toEqual([])
    expect((await repository.findById(newer.id))?.createdAt.toISOString()).toBe('2026-09-15T00:00:00.000Z')
  })

  it('should list confirmed settlements of a group and of a member on either side, ignoring other groups', async () => {
    const paid = makePending('10.00')
    const received = Settlement.create({ groupId, fromMemberId: toMemberId, toMemberId: fromMemberId, amount: new Money('4.00') })
    const stillPending = makePending('1.00')
    for (const s of [paid, received]) {
      await repository.create(s)
      await repository.updateStatus(s.id, 'CONFIRMED', 0)
    }
    await repository.create(stillPending)

    const otherGroup = await prisma.group.create({ data: { name: 'Outro' } })
    const [otherFrom, otherTo] = await Promise.all((['carla', 'davi']).map(async name => {
      const user = await prisma.user.create({ data: { name, email: `${name}-${randomUUID()}@test.com`, passwordHash: 'hash' } })
      return prisma.member.create({ data: { userId: user.id, groupId: otherGroup.id } })
    }))
    await prisma.settlement.create({
      data: { groupId: otherGroup.id, fromMemberId: otherFrom.id, toMemberId: otherTo.id, amount: '7.00', status: 'CONFIRMED' },
    })

    const ofGroup = await repository.findConfirmedByGroup(groupId)
    const ofMember = await repository.findConfirmedByMemberAndGroup(fromMemberId, groupId)

    expect(ofGroup.map(s => s.id).sort()).toEqual([paid.id, received.id].sort())
    expect(ofMember.map(s => s.id).sort()).toEqual([paid.id, received.id].sort())
    expect(await repository.findConfirmedByMemberAndGroup(fromMemberId, otherGroup.id)).toEqual([])
  })
})
