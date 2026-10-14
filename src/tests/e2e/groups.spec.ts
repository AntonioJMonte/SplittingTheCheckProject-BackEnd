import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { app } from '../../infra/http/app'

const stores = vi.hoisted(() => ({
    users: [] as any[],
    groups: [] as any[],
    members: [] as any[],
    expenses: [] as any[],
    expenseRevisions: [] as any[],
    settlements: [] as any[],
}))

vi.mock('../../infra/database/prisma/prismaUserRepository', () => ({
    PrismaUserRepository: class {
        async create(user: any) { stores.users.push(user) }
        async findByEmail(email: string) { return stores.users.find((u: any) => u.email.value === email) ?? null }
        async findByPhone(phone: string) { return stores.users.find((u: any) => u.phone?.value === phone) ?? null }
        async findById(id: string) { return stores.users.find((u: any) => u.id === id) ?? null }
        async updatePixKey(userId: string, pixKey: string | null) {
            const item = stores.users.find((u: any) => u.id === userId)
            if (item) (item as any).pixKey = pixKey ?? undefined
        }
        async updatePhone(userId: string, phone: string | null) {
            const index = stores.users.findIndex((u: any) => u.id === userId)
            if (index !== -1) stores.users[index] = stores.users[index].withPhone(phone)
        }
    },
}))

vi.mock('../../infra/database/prisma/prismaGroupRepository', () => ({
    PrismaGroupRepository: class {
        async create(group: any) {
            stores.groups.push(group)
            // Replicates Prisma cascade: persist initial members (e.g. owner) alongside the group
            for (const member of group.members) {
                if (!stores.members.find((m: any) => m.id === member.id)) {
                    stores.members.push(member)
                }
            }
        }
        async findById(id: string) { return stores.groups.find((g: any) => g.id === id) ?? null }
        async findByUserId(userId: string) {
            return stores.groups.filter((g: any) => g.members.some((m: any) => m.userId === userId))
        }
        async update(group: any) {
            const idx = stores.groups.findIndex((g: any) => g.id === group.id)
            if (idx !== -1) stores.groups[idx] = group
        }
        async delete(id: string) {
            const idx = stores.groups.findIndex((g: any) => g.id === id)
            if (idx !== -1) stores.groups.splice(idx, 1)
        }
    },
}))

vi.mock('../../infra/database/prisma/prismaMemberRepository', () => ({
    PrismaMemberRepository: class {
        async addMemberToGroup(member: any) { stores.members.push(member) }
        async findById(id: string) { return stores.members.find((m: any) => m.id === id) ?? null }
        async findByUserAndGroup(userId: string, groupId: string) {
            return stores.members.find((m: any) => m.userId === userId && m.groupId === groupId && !m.deletedBy) ?? null
        }
        async findByGroupId(groupId: string) { return stores.members.filter((m: any) => m.groupId === groupId && !m.deletedBy) }
        async findByGroupIdWithUser(groupId: string) {
            return stores.members
                .filter((m: any) => m.groupId === groupId && !m.deletedBy)
                .map((m: any) => {
                    const user = stores.users.find((u: any) => u.id === m.userId)
                    return { id: m.id, userId: m.userId, role: m.role, joinedAt: m.joinedAt, name: user?.name ?? 'Unknown', email: user?.email?.value ?? '' }
                })
        }
        async removeMemberGroup(memberId: string, removedByUserId: string) {
            const item = stores.members.find((m: any) => m.id === memberId)
            if (item) item.deletedBy = removedByUserId
        }
        async findRemovedByUserAndGroup(userId: string, groupId: string) {
            return stores.members.find((m: any) => m.userId === userId && m.groupId === groupId && m.deletedBy) ?? null
        }
        async reactivate(memberId: string) {
            const item = stores.members.find((m: any) => m.id === memberId)
            if (item) delete item.deletedBy
        }
        async updateRole(memberId: string, role: string) {
            const item = stores.members.find((m: any) => m.id === memberId)
            if (item) (item as any).role = role
        }
    },
}))

vi.mock('../../infra/database/prisma/prismaExpenseRepository', () => ({
    PrismaExpenseRepository: class {
        async create(expense: any) { stores.expenses.push(expense) }
        async findById(id: string) { return stores.expenses.find((e: any) => e.id === id && !e.deletedBy) ?? null }
        async findByGroupId(groupId: string) { return stores.expenses.filter((e: any) => e.groupId === groupId && !e.deletedBy) }
        async findManyByGroup(params: any) {
            const expenses = stores.expenses.filter((e: any) => e.groupId === params.groupId)
            return { expenses, total: expenses.length }
        }
        async updateWithRevision(expense: any, previous: any, editedByUserId: string) {
            // Espelha o CAS + revisão do Prisma (D-80/D-82).
            const idx = stores.expenses.findIndex((e: any) => e.id === expense.id && !e.deletedBy)
            if (idx === -1) return false
            if ((stores.expenses[idx].version ?? 0) !== (previous.version ?? 0)) return false

            stores.expenseRevisions.push({
                expenseId: previous.id,
                version: previous.version ?? 0,
                description: previous.description,
                amount: previous.amount.toString(),
                editedBy: editedByUserId,
            })

            const gravada = Object.create(Object.getPrototypeOf(expense))
            Object.assign(gravada, expense, { version: (previous.version ?? 0) + 1 })
            stores.expenses[idx] = gravada
            return true
        }
        async softDelete(id: string, deletedByUserId: string) {
            // Espelha o soft delete do Prisma (D-72): a despesa fica, marcada com quem removeu.
            const item = stores.expenses.find((e: any) => e.id === id)
            if (item) item.deletedBy = deletedByUserId
        }
    },
}))

vi.mock('../../infra/database/prisma/prismaSettlementRepository', () => ({
    PrismaSettlementRepository: class {
        async create(s: any) { stores.settlements.push(s); return true }
        async findById(id: string) { return stores.settlements.find((s: any) => s.id === id) ?? null }
        async findPendingBetweenMembers(from: string, to: string) {
            return stores.settlements.find((s: any) => s.fromMemberId === from && s.toMemberId === to && s.status === 'PENDING') ?? null
        }
        async findConfirmedByGroup(groupId: string) {
            return stores.settlements.filter((s: any) => s.groupId === groupId && s.status === 'CONFIRMED')
        }
        async findConfirmedByMemberAndGroup(memberId: string, groupId: string) {
            return stores.settlements.filter((s: any) => s.groupId === groupId && (s.fromMemberId === memberId || s.toMemberId === memberId) && s.status === 'CONFIRMED')
        }
        async updateStatus() { return true }
        async cancelPendingByGroupId() {}
    },
}))

function decodeToken(token: string): { sub: string } {
    const [, payload] = token.split('.')
    return JSON.parse(Buffer.from(payload, 'base64url').toString())
}

async function registerAndAuth(name: string, email: string, password = 'password123') {
    await app.inject({ method: 'POST', url: '/register', payload: { name, email, password } })
    const authRes = await app.inject({ method: 'POST', url: '/auth', payload: { email, password } })
    const { accessToken } = authRes.json()
    const { sub: userId } = decodeToken(accessToken)
    return { accessToken, userId }
}

describe('Groups e2e', () => {
    beforeEach(() => {
        stores.users.splice(0)
        stores.groups.splice(0)
        stores.members.splice(0)
        stores.expenses.splice(0)
        stores.expenseRevisions.splice(0)
        stores.settlements.splice(0)
    })

    afterAll(async () => {
        await app.close()
    })

    it('POST /groups → 201 creates a group and returns it', async () => {
        const { accessToken } = await registerAndAuth('Alice', 'alice@example.com')

        const res = await app.inject({
            method: 'POST',
            url: '/groups',
            headers: { Authorization: `Bearer ${accessToken}` },
            payload: { name: 'Viagem Europa', currency: 'BRL' },
        })

        expect(res.statusCode).toBe(201)
        const body = res.json()
        expect(body.group.name).toBe('Viagem Europa')
        expect(body.group.id).toBeDefined()
    })

    it('POST /groups → 401 without authentication token', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/groups',
            payload: { name: 'Test Group' },
        })

        expect(res.statusCode).toBe(401)
    })

    it('GET /groups → 200 returns list of user groups', async () => {
        const { accessToken } = await registerAndAuth('Alice', 'alice@example.com')
        await app.inject({
            method: 'POST',
            url: '/groups',
            headers: { Authorization: `Bearer ${accessToken}` },
            payload: { name: 'Churrasco dos Amigos' },
        })

        const res = await app.inject({
            method: 'GET',
            url: '/groups',
            headers: { Authorization: `Bearer ${accessToken}` },
        })

        expect(res.statusCode).toBe(200)
        const body = res.json()
        expect(body.groups).toHaveLength(1)
        expect(body.groups[0].name).toBe('Churrasco dos Amigos')
    })

    it('PATCH /groups/:groupId → 200 updates group name', async () => {
        const { accessToken } = await registerAndAuth('Alice', 'alice@example.com')
        const createRes = await app.inject({
            method: 'POST',
            url: '/groups',
            headers: { Authorization: `Bearer ${accessToken}` },
            payload: { name: 'Nome Original' },
        })
        const groupId = createRes.json().group.id

        const res = await app.inject({
            method: 'PATCH',
            url: `/groups/${groupId}`,
            headers: { Authorization: `Bearer ${accessToken}` },
            payload: { name: 'Nome Atualizado' },
        })

        expect(res.statusCode).toBe(200)
        expect(res.json().group.name).toBe('Nome Atualizado')
    })

    it('GET /groups/:groupId/members → 200 returns members with user info', async () => {
        const { accessToken } = await registerAndAuth('Alice', 'alice@example.com')
        const createRes = await app.inject({
            method: 'POST',
            url: '/groups',
            headers: { Authorization: `Bearer ${accessToken}` },
            payload: { name: 'Grupo Teste' },
        })
        const groupId = createRes.json().group.id

        const res = await app.inject({
            method: 'GET',
            url: `/groups/${groupId}/members`,
            headers: { Authorization: `Bearer ${accessToken}` },
        })

        expect(res.statusCode).toBe(200)
        const body = res.json()
        expect(body.members).toHaveLength(1)
        expect(body.members[0].role).toBe('OWNER')
        expect(body.members[0].name).toBe('Alice')
    })

    it('PATCH /groups/:groupId → 403 when requester is not a member', async () => {
        const { accessToken: aliceToken } = await registerAndAuth('Alice', 'alice@example.com')
        const { accessToken: bobToken } = await registerAndAuth('Bob', 'bob@example.com')

        const createRes = await app.inject({
            method: 'POST',
            url: '/groups',
            headers: { Authorization: `Bearer ${aliceToken}` },
            payload: { name: 'Grupo da Alice' },
        })
        const groupId = createRes.json().group.id

        const res = await app.inject({
            method: 'PATCH',
            url: `/groups/${groupId}`,
            headers: { Authorization: `Bearer ${bobToken}` },
            payload: { name: 'Tentativa do Bob' },
        })

        expect(res.statusCode).toBe(403)
    })

    it('PATCH /groups/:groupId → 404 when group does not exist', async () => {
        const { accessToken } = await registerAndAuth('Alice', 'alice@example.com')
        const nonExistentGroupId = '00000000-0000-0000-0000-000000000000'

        const res = await app.inject({
            method: 'PATCH',
            url: `/groups/${nonExistentGroupId}`,
            headers: { Authorization: `Bearer ${accessToken}` },
            payload: { name: 'Qualquer Nome' },
        })

        expect(res.statusCode).toBe(404)
    })

    it('POST /groups/:groupId/members → 201 adds a new member', async () => {
        const { accessToken: aliceToken } = await registerAndAuth('Alice', 'alice@example.com')
        const createRes = await app.inject({
            method: 'POST',
            url: '/groups',
            headers: { Authorization: `Bearer ${aliceToken}` },
            payload: { name: 'Grupo Teste' },
        })
        const groupId = createRes.json().group.id

        const { userId: bobUserId } = await registerAndAuth('Bob', 'bob@example.com')

        const res = await app.inject({
            method: 'POST',
            url: `/groups/${groupId}/members`,
            headers: { Authorization: `Bearer ${aliceToken}` },
            payload: { email: 'bob@example.com' },
        })

        expect(res.statusCode).toBe(201)
        const body = res.json()
        expect(body.member.userId).toBe(bobUserId)
        expect(body.member.role).toBe('MEMBER')
    })

    it('POST /groups/:groupId/members → 400 when user is already a member', async () => {
        const { accessToken: aliceToken } = await registerAndAuth('Alice', 'alice@example.com')
        const createRes = await app.inject({
            method: 'POST',
            url: '/groups',
            headers: { Authorization: `Bearer ${aliceToken}` },
            payload: { name: 'Grupo Teste' },
        })
        const groupId = createRes.json().group.id

        const { userId: bobUserId } = await registerAndAuth('Bob', 'bob@example.com')

        await app.inject({
            method: 'POST',
            url: `/groups/${groupId}/members`,
            headers: { Authorization: `Bearer ${aliceToken}` },
            payload: { email: 'bob@example.com' },
        })

        const res = await app.inject({
            method: 'POST',
            url: `/groups/${groupId}/members`,
            headers: { Authorization: `Bearer ${aliceToken}` },
            payload: { email: 'bob@example.com' },
        })

        expect(res.statusCode).toBe(400)
    })

    it('GET /groups/:groupId/balances → 200 returns member balances and transfers', async () => {
        const { accessToken } = await registerAndAuth('Alice', 'alice@example.com')
        const createRes = await app.inject({
            method: 'POST',
            url: '/groups',
            headers: { Authorization: `Bearer ${accessToken}` },
            payload: { name: 'Grupo Teste' },
        })
        const groupId = createRes.json().group.id

        const res = await app.inject({
            method: 'GET',
            url: `/groups/${groupId}/balances`,
            headers: { Authorization: `Bearer ${accessToken}` },
        })

        expect(res.statusCode).toBe(200)
        const body = res.json()
        expect(body.memberBalances).toHaveLength(1)
        expect(body.memberBalances[0].balance).toBe('0.00')
        expect(body.transfers).toHaveLength(0)
    })

    it('DELETE /groups/:groupId → 204 owner can delete the group', async () => {
        const { accessToken } = await registerAndAuth('Alice', 'alice@example.com')
        const createRes = await app.inject({
            method: 'POST',
            url: '/groups',
            headers: { Authorization: `Bearer ${accessToken}` },
            payload: { name: 'Grupo para Deletar' },
        })
        const groupId = createRes.json().group.id

        const res = await app.inject({
            method: 'DELETE',
            url: `/groups/${groupId}`,
            headers: { Authorization: `Bearer ${accessToken}` },
        })

        expect(res.statusCode).toBe(204)
        expect(stores.groups).toHaveLength(0)
    })

    it('DELETE /groups/:groupId → 403 when requester is not the owner', async () => {
        const { accessToken: aliceToken } = await registerAndAuth('Alice', 'alice@example.com')
        const createRes = await app.inject({
            method: 'POST',
            url: '/groups',
            headers: { Authorization: `Bearer ${aliceToken}` },
            payload: { name: 'Grupo da Alice' },
        })
        const groupId = createRes.json().group.id

        const { accessToken: bobToken, userId: bobUserId } = await registerAndAuth('Bob', 'bob@example.com')
        await app.inject({
            method: 'POST',
            url: `/groups/${groupId}/members`,
            headers: { Authorization: `Bearer ${aliceToken}` },
            payload: { email: 'bob@example.com' },
        })

        const res = await app.inject({
            method: 'DELETE',
            url: `/groups/${groupId}`,
            headers: { Authorization: `Bearer ${bobToken}` },
        })

        expect(res.statusCode).toBe(403)
    })

    it('GET /groups/:groupId → 200 returns group details with its members', async () => {
        const { accessToken } = await registerAndAuth('Alice', 'alice@example.com')
        const createRes = await app.inject({
            method: 'POST',
            url: '/groups',
            headers: { Authorization: `Bearer ${accessToken}` },
            payload: { name: 'Viagem Europa', description: 'Rateio da viagem', currency: 'EUR' },
        })
        const groupId = createRes.json().group.id

        const res = await app.inject({
            method: 'GET',
            url: `/groups/${groupId}`,
            headers: { Authorization: `Bearer ${accessToken}` },
        })

        expect(res.statusCode).toBe(200)
        const { group } = res.json()
        expect(group).toMatchObject({
            id: groupId,
            name: 'Viagem Europa',
            description: 'Rateio da viagem',
            currency: 'EUR',
        })
        expect(group.members).toHaveLength(1)
        expect(group.members[0]).toMatchObject({ role: 'OWNER', name: 'Alice', email: 'alice@example.com' })
    })

    it('GET /groups/:groupId → 200 does not return balances', async () => {
        const { accessToken } = await registerAndAuth('Alice', 'alice@example.com')
        const createRes = await app.inject({
            method: 'POST',
            url: '/groups',
            headers: { Authorization: `Bearer ${accessToken}` },
            payload: { name: 'Grupo Teste' },
        })
        const groupId = createRes.json().group.id

        const res = await app.inject({
            method: 'GET',
            url: `/groups/${groupId}`,
            headers: { Authorization: `Bearer ${accessToken}` },
        })

        const { group } = res.json()
        expect(group.memberBalances).toBeUndefined()
        expect(group.transfers).toBeUndefined()
    })

    it('GET /groups/:groupId → 403 when requester is not a member', async () => {
        const { accessToken: aliceToken } = await registerAndAuth('Alice', 'alice@example.com')
        const { accessToken: bobToken } = await registerAndAuth('Bob', 'bob@example.com')

        const createRes = await app.inject({
            method: 'POST',
            url: '/groups',
            headers: { Authorization: `Bearer ${aliceToken}` },
            payload: { name: 'Grupo da Alice' },
        })
        const groupId = createRes.json().group.id

        const res = await app.inject({
            method: 'GET',
            url: `/groups/${groupId}`,
            headers: { Authorization: `Bearer ${bobToken}` },
        })

        expect(res.statusCode).toBe(403)
    })

    it('GET /groups/:groupId → 404 when group does not exist', async () => {
        const { accessToken } = await registerAndAuth('Alice', 'alice@example.com')

        const res = await app.inject({
            method: 'GET',
            url: '/groups/3f2504e0-4f89-41d3-9a0c-0305e82c3301',
            headers: { Authorization: `Bearer ${accessToken}` },
        })

        expect(res.statusCode).toBe(404)
    })

    it('GET /groups/:groupId → 401 without authentication token', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/groups/3f2504e0-4f89-41d3-9a0c-0305e82c3301',
        })

        expect(res.statusCode).toBe(401)
    })

    it('DELETE /groups/:groupId/members/:memberId → 204 owner removes a member', async () => {
        const { accessToken: aliceToken } = await registerAndAuth('Alice', 'alice@example.com')
        const { userId: bobUserId } = await registerAndAuth('Bob', 'bob@example.com')

        const createRes = await app.inject({
            method: 'POST',
            url: '/groups',
            headers: { Authorization: `Bearer ${aliceToken}` },
            payload: { name: 'Grupo' },
        })
        const groupId = createRes.json().group.id

        const addRes = await app.inject({
            method: 'POST',
            url: `/groups/${groupId}/members`,
            headers: { Authorization: `Bearer ${aliceToken}` },
            payload: { email: 'bob@example.com' },
        })
        const bobMemberId = addRes.json().member.id

        const res = await app.inject({
            method: 'DELETE',
            url: `/groups/${groupId}/members/${bobMemberId}`,
            headers: { Authorization: `Bearer ${aliceToken}` },
        })

        expect(res.statusCode).toBe(204)
        expect(res.body).toBe('')

        const membersRes = await app.inject({
            method: 'GET',
            url: `/groups/${groupId}/members`,
            headers: { Authorization: `Bearer ${aliceToken}` },
        })
        expect(membersRes.json().members).toHaveLength(1)
    })

    it('PATCH /groups/:groupId/members/:memberId/role → 200 promotes a member to OWNER', async () => {
        const { accessToken: aliceToken } = await registerAndAuth('Alice', 'alice@example.com')
        const { userId: bobUserId } = await registerAndAuth('Bob', 'bob@example.com')

        const createRes = await app.inject({
            method: 'POST',
            url: '/groups',
            headers: { Authorization: `Bearer ${aliceToken}` },
            payload: { name: 'Grupo' },
        })
        const groupId = createRes.json().group.id

        const addRes = await app.inject({
            method: 'POST',
            url: `/groups/${groupId}/members`,
            headers: { Authorization: `Bearer ${aliceToken}` },
            payload: { email: 'bob@example.com' },
        })
        const bobMemberId = addRes.json().member.id

        const res = await app.inject({
            method: 'PATCH',
            url: `/groups/${groupId}/members/${bobMemberId}/role`,
            headers: { Authorization: `Bearer ${aliceToken}` },
            payload: { newRole: 'OWNER' },
        })

        expect(res.statusCode).toBe(200)
        expect(res.json()).toEqual({ memberId: bobMemberId, role: 'OWNER' })

        const membersRes = await app.inject({
            method: 'GET',
            url: `/groups/${groupId}/members`,
            headers: { Authorization: `Bearer ${aliceToken}` },
        })
        const bob = membersRes.json().members.find((m: { id: string }) => m.id === bobMemberId)
        expect(bob.role).toBe('OWNER')
    })

    it('PATCH /groups/:groupId/members/:memberId/role → 403 when requester is not the owner', async () => {
        const { accessToken: aliceToken } = await registerAndAuth('Alice', 'alice@example.com')
        const { accessToken: bobToken, userId: bobUserId } = await registerAndAuth('Bob', 'bob@example.com')

        const createRes = await app.inject({
            method: 'POST',
            url: '/groups',
            headers: { Authorization: `Bearer ${aliceToken}` },
            payload: { name: 'Grupo' },
        })
        const groupId = createRes.json().group.id

        const addRes = await app.inject({
            method: 'POST',
            url: `/groups/${groupId}/members`,
            headers: { Authorization: `Bearer ${aliceToken}` },
            payload: { email: 'bob@example.com' },
        })
        const bobMemberId = addRes.json().member.id

        const res = await app.inject({
            method: 'PATCH',
            url: `/groups/${groupId}/members/${bobMemberId}/role`,
            headers: { Authorization: `Bearer ${bobToken}` },
            payload: { newRole: 'OWNER' },
        })

        expect(res.statusCode).toBe(403)
    })

    it('DELETE /groups/:groupId/leave → 204 a plain member leaves the group', async () => {
        const { accessToken: aliceToken } = await registerAndAuth('Alice', 'alice@example.com')
        const { accessToken: bobToken, userId: bobUserId } = await registerAndAuth('Bob', 'bob@example.com')

        const createRes = await app.inject({
            method: 'POST',
            url: '/groups',
            headers: { Authorization: `Bearer ${aliceToken}` },
            payload: { name: 'Grupo' },
        })
        const groupId = createRes.json().group.id

        await app.inject({
            method: 'POST',
            url: `/groups/${groupId}/members`,
            headers: { Authorization: `Bearer ${aliceToken}` },
            payload: { email: 'bob@example.com' },
        })

        const res = await app.inject({
            method: 'DELETE',
            url: `/groups/${groupId}/leave`,
            headers: { Authorization: `Bearer ${bobToken}` },
        })

        expect(res.statusCode).toBe(204)

        const membersRes = await app.inject({
            method: 'GET',
            url: `/groups/${groupId}/members`,
            headers: { Authorization: `Bearer ${aliceToken}` },
        })
        expect(membersRes.json().members).toHaveLength(1)
    })
})
