import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { app } from '../../infra/http/app'

const stores = vi.hoisted(() => ({
    users: [] as any[],
    groups: [] as any[],
    members: [] as any[],
    expenses: [] as any[],
    expenseRevisions: [] as any[],
    forceUpdateConflict: false,
    settlements: [] as any[],
}))

vi.mock('../../infra/database/prisma/prismaUserRepository', () => ({
    PrismaUserRepository: class {
        async create(user: any) { stores.users.push(user) }
        async findByEmail(email: string) { return stores.users.find((u: any) => u.email.value === email) ?? null }
        async findById(id: string) { return stores.users.find((u: any) => u.id === id) ?? null }
        async updatePixKey(userId: string, pixKey: string | null) {
            const item = stores.users.find((u: any) => u.id === userId)
            if (item) (item as any).pixKey = pixKey ?? undefined
        }
    },
}))

vi.mock('../../infra/database/prisma/prismaGroupRepository', () => ({
    PrismaGroupRepository: class {
        async create(group: any) {
            stores.groups.push(group)
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
        async updateRole() {}
    },
}))

vi.mock('../../infra/database/prisma/prismaExpenseRepository', () => ({
    PrismaExpenseRepository: class {
        async create(expense: any) { stores.expenses.push(expense) }
        async findById(id: string) { return stores.expenses.find((e: any) => e.id === id && !e.deletedBy) ?? null }
        async findByGroupId(groupId: string) { return stores.expenses.filter((e: any) => e.groupId === groupId && !e.deletedBy) }
        async findManyByGroup(params: any) {
            const page = params.page ?? 1
            const limit = params.limit ?? 20
            let results = stores.expenses.filter((e: any) => e.groupId === params.groupId && !e.deletedBy)
            results = results.sort((a: any, b: any) => b.occurredAt.getTime() - a.occurredAt.getTime())
            const total = results.length
            const expenses = results.slice((page - 1) * limit, page * limit)
            return { expenses, total }
        }
        async updateWithRevision(expense: any, previous: any, editedByUserId: string) {
            // Espelha o CAS + revisão do Prisma (D-80/D-82).
            if (stores.forceUpdateConflict) return false
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
        async updateCategory(id: string, category: any, expectedDescription: string) {
            const idx = stores.expenses.findIndex((e: any) => e.id === id && e.description === expectedDescription && !e.deletedBy)
            if (idx === -1) return false
            stores.expenses[idx] = stores.expenses[idx].withCategory(category)
            return true
        }
        async softDelete(id: string, deletedByUserId: string) {
            // Espelha o soft delete do Prisma (D-72): a despesa fica, marcada com quem removeu.
            const item = stores.expenses.find((e: any) => e.id === id)
            if (item) item.deletedBy = deletedByUserId
        }
    },
}))

vi.mock('../../infra/cache/llm-category-cache', () => ({
    getCategoryCache: async () => null,
    setCategoryCache: async () => {},
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

async function setupGroupWithMember() {
    const { accessToken, userId } = await registerAndAuth('Alice', 'alice@example.com')

    const createGroupRes = await app.inject({
        method: 'POST',
        url: '/groups',
        headers: { Authorization: `Bearer ${accessToken}` },
        payload: { name: 'Viagem', currency: 'BRL' },
    })
    const groupId = createGroupRes.json().group.id

    const membersRes = await app.inject({
        method: 'GET',
        url: `/groups/${groupId}/members`,
        headers: { Authorization: `Bearer ${accessToken}` },
    })
    const memberId = membersRes.json().members[0].id

    return { accessToken, userId, groupId, memberId }
}

describe('Expenses e2e', () => {
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

    it('POST /groups/:groupId/expenses → 201 creates expense with equal split', async () => {
        const { accessToken, userId, groupId, memberId } = await setupGroupWithMember()

        const res = await app.inject({
            method: 'POST',
            url: `/groups/${groupId}/expenses`,
            headers: { Authorization: `Bearer ${accessToken}` },
            payload: {
                description: 'Jantar',
                amount: 120.00,
                payerId: userId,
                splitMethod: 'EQUAL',
                shares: [{ memberId }],
            },
        })

        expect(res.statusCode).toBe(201)
        const body = res.json()
        expect(body.expense.description).toBe('Jantar')
        expect(body.expense.amount).toBe('120.00')
        expect(body.expense.shares).toHaveLength(1)
    })

    it('POST /groups/:groupId/expenses → 401 without authentication token', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/groups/00000000-0000-0000-0000-000000000000/expenses',
            payload: { description: 'Test', amount: 50, payerId: '00000000-0000-0000-0000-000000000000', splitMethod: 'EQUAL', shares: [{ memberId: '00000000-0000-0000-0000-000000000000' }] },
        })

        expect(res.statusCode).toBe(401)
    })

    it('GET /groups/:groupId/expenses → 200 returns list of expenses', async () => {
        const { accessToken, userId, groupId, memberId } = await setupGroupWithMember()

        await app.inject({
            method: 'POST',
            url: `/groups/${groupId}/expenses`,
            headers: { Authorization: `Bearer ${accessToken}` },
            payload: { description: 'Almoço', amount: 80, payerId: userId, splitMethod: 'EQUAL', shares: [{ memberId }] },
        })

        const res = await app.inject({
            method: 'GET',
            url: `/groups/${groupId}/expenses`,
            headers: { Authorization: `Bearer ${accessToken}` },
        })

        expect(res.statusCode).toBe(200)
        const body = res.json()
        expect(body.expenses).toHaveLength(1)
        expect(body.expenses[0].description).toBe('Almoço')
        expect(body.total).toBe(1)
    })

    it('PATCH /expenses/:expenseId → 200 updates expense description', async () => {
        const { accessToken, userId, groupId, memberId } = await setupGroupWithMember()

        const createRes = await app.inject({
            method: 'POST',
            url: `/groups/${groupId}/expenses`,
            headers: { Authorization: `Bearer ${accessToken}` },
            payload: { description: 'Descrição Original', amount: 50, payerId: userId, splitMethod: 'EQUAL', shares: [{ memberId }] },
        })
        const expenseId = createRes.json().expense.id

        const res = await app.inject({
            method: 'PATCH',
            url: `/expenses/${expenseId}`,
            headers: { Authorization: `Bearer ${accessToken}` },
            payload: { description: 'Descrição Atualizada', version: 0 },
        })

        expect(res.statusCode).toBe(200)
        expect(res.json().expense.description).toBe('Descrição Atualizada')
    })

    it('DELETE /expenses/:expenseId → 204 deletes the expense', async () => {
        const { accessToken, userId, groupId, memberId } = await setupGroupWithMember()

        const createRes = await app.inject({
            method: 'POST',
            url: `/groups/${groupId}/expenses`,
            headers: { Authorization: `Bearer ${accessToken}` },
            payload: { description: 'Para deletar', amount: 30, payerId: userId, splitMethod: 'EQUAL', shares: [{ memberId }] },
        })
        const expenseId = createRes.json().expense.id

        const res = await app.inject({
            method: 'DELETE',
            url: `/expenses/${expenseId}`,
            headers: { Authorization: `Bearer ${accessToken}` },
        })

        expect(res.statusCode).toBe(204)
        // D-72: o registro permanece para auditoria, marcado com quem apagou.
        expect(stores.expenses).toHaveLength(1)
        expect(stores.expenses[0].deletedBy).toBe(userId)

        const listRes = await app.inject({
            method: 'GET',
            url: `/groups/${groupId}/expenses`,
            headers: { Authorization: `Bearer ${accessToken}` },
        })
        expect(listRes.json().expenses).toHaveLength(0)
    })

    it('PATCH /expenses/:expenseId -> 409 quando o CAS recusa a escrita (D-82)', async () => {
        const { accessToken, userId, groupId, memberId } = await setupGroupWithMember()

        const createRes = await app.inject({
            method: 'POST',
            url: `/groups/${groupId}/expenses`,
            headers: { Authorization: `Bearer ${accessToken}` },
            payload: { description: 'Original', amount: 30, payerId: userId, splitMethod: 'EQUAL', shares: [{ memberId }] },
        })
        const expenseId = createRes.json().expense.id

        // O use case relê a despesa antes de gravar, então a versão nunca chega velha por aqui.
        // O que este teste cobre é o outro lado: quando o CAS recusa — o que acontece com duas
        // requisições concorrentes —, o erro precisa virar 409 na resposta HTTP.
        stores.forceUpdateConflict = true

        const res = await app.inject({
            method: 'PATCH',
            url: `/expenses/${expenseId}`,
            headers: { Authorization: `Bearer ${accessToken}` },
            payload: { description: 'Perde a corrida', version: 0 },
        })

        stores.forceUpdateConflict = false

        expect(res.statusCode).toBe(409)
        expect(res.json().message).toContain('alterada por outra operação')
        // A despesa não foi tocada e nenhuma revisão falsa foi registrada.
        expect(stores.expenses[0].description).toBe('Original')
        expect(stores.expenseRevisions).toHaveLength(0)
    })

    describe('categorization', () => {
        async function createExpense(accessToken: string, groupId: string, userId: string, memberId: string, extra: Record<string, unknown>) {
            const res = await app.inject({
                method: 'POST',
                url: `/groups/${groupId}/expenses`,
                headers: { Authorization: `Bearer ${accessToken}` },
                payload: { amount: 45, payerId: userId, splitMethod: 'EQUAL', shares: [{ memberId }], ...extra },
            })
            return res
        }

        it('POST /groups/:groupId/expenses → 201 with the category resolved by rules in the response', async () => {
            const { accessToken, userId, groupId, memberId } = await setupGroupWithMember()

            const res = await createExpense(accessToken, groupId, userId, memberId, { description: 'Uber para o aeroporto' })

            expect(res.statusCode).toBe(201)
            expect(res.json().expense.category).toBe('Transporte')
        })

        it('POST /groups/:groupId/expenses → 400 when category is outside the closed list', async () => {
            const { accessToken, userId, groupId, memberId } = await setupGroupWithMember()

            const res = await createExpense(accessToken, groupId, userId, memberId, { description: 'Pizza', category: 'Comida' })

            expect(res.statusCode).toBe(400)
            expect(stores.expenses).toHaveLength(0)
        })

        it('POST /groups/:groupId/expenses → 201 immediately, then categorizes in background ("Outros" without API key)', async () => {
            const { accessToken, userId, groupId, memberId } = await setupGroupWithMember()

            const res = await createExpense(accessToken, groupId, userId, memberId, { description: 'Rateio diverso' })

            expect(res.statusCode).toBe(201)
            expect(res.json().expense.category).toBeUndefined()
            await vi.waitFor(() => expect(stores.expenses[0].category).toBe('Outros'))
        })

        it('PATCH /expenses/:expenseId → 200 sets the category chosen by the user', async () => {
            const { accessToken, userId, groupId, memberId } = await setupGroupWithMember()
            const createRes = await createExpense(accessToken, groupId, userId, memberId, { description: 'Pizza' })

            const res = await app.inject({
                method: 'PATCH',
                url: `/expenses/${createRes.json().expense.id}`,
                headers: { Authorization: `Bearer ${accessToken}` },
                payload: { category: 'Lazer', version: 0 },
            })

            expect(res.statusCode).toBe(200)
            expect(res.json().expense.category).toBe('Lazer')
        })

        it('POST /expenses/:expenseId/categorize → 200 overwrites the category for a group member', async () => {
            const { accessToken, userId, groupId, memberId } = await setupGroupWithMember()
            const createRes = await createExpense(accessToken, groupId, userId, memberId, { description: 'Netflix', category: 'Lazer' })

            const res = await app.inject({
                method: 'POST',
                url: `/expenses/${createRes.json().expense.id}/categorize`,
                headers: { Authorization: `Bearer ${accessToken}` },
            })

            expect(res.statusCode).toBe(200)
            expect(res.json().expense.category).toBe('Assinaturas')
            expect(stores.expenses[0].category).toBe('Assinaturas')
        })

        it('POST /expenses/:expenseId/categorize → 403 when requester is not a member of the expense group', async () => {
            const { accessToken, userId, groupId, memberId } = await setupGroupWithMember()
            const createRes = await createExpense(accessToken, groupId, userId, memberId, { description: 'Netflix' })
            const { accessToken: outsiderToken } = await registerAndAuth('Mallory', 'mallory@example.com')

            const res = await app.inject({
                method: 'POST',
                url: `/expenses/${createRes.json().expense.id}/categorize`,
                headers: { Authorization: `Bearer ${outsiderToken}` },
            })

            expect(res.statusCode).toBe(403)
        })

        it('POST /expenses/:expenseId/categorize → 404 when the expense does not exist', async () => {
            const { accessToken } = await setupGroupWithMember()

            const res = await app.inject({
                method: 'POST',
                url: '/expenses/00000000-0000-0000-0000-000000000000/categorize',
                headers: { Authorization: `Bearer ${accessToken}` },
            })

            expect(res.statusCode).toBe(404)
        })

        it('POST /expenses/:expenseId/categorize → 401 without authentication token', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/expenses/00000000-0000-0000-0000-000000000000/categorize',
            })

            expect(res.statusCode).toBe(401)
        })
    })

    it('POST /groups/:groupId/expenses → 201 splitting an amount that does not divide evenly', async () => {
        const { accessToken, userId, groupId } = await setupGroupWithMember()

        await registerAndAuth('Bob', 'bob@example.com')
        await registerAndAuth('Carol', 'carol@example.com')
        for (const email of ['bob@example.com', 'carol@example.com']) {
            await app.inject({
                method: 'POST',
                url: `/groups/${groupId}/members`,
                headers: { Authorization: `Bearer ${accessToken}` },
                payload: { email },
            })
        }

        const membersRes = await app.inject({
            method: 'GET',
            url: `/groups/${groupId}/members`,
            headers: { Authorization: `Bearer ${accessToken}` },
        })
        const memberIds = membersRes.json().members.map((m: { id: string }) => m.id)
        expect(memberIds).toHaveLength(3)

        const res = await app.inject({
            method: 'POST',
            url: `/groups/${groupId}/expenses`,
            headers: { Authorization: `Bearer ${accessToken}` },
            payload: {
                description: 'Conta do bar',
                amount: 100,
                payerId: userId,
                splitMethod: 'EQUAL',
                shares: memberIds.map((id: string) => ({ memberId: id })),
            },
        })

        expect(res.statusCode).toBe(201)
        const shares = res.json().expense.shares as Array<{ amount: string }>
        expect(shares.map(s => s.amount).sort()).toEqual(['33.33', '33.33', '33.34'])

        const total = shares.reduce((acc, s) => acc + Number(s.amount), 0)
        expect(total).toBeCloseTo(100, 10)
    })
})
