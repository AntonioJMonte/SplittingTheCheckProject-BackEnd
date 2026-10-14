import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { app } from '../../infra/http/app'

const store = vi.hoisted(() => ({ items: [] as any[] }))
const stores = vi.hoisted(() => ({ groups: [] as any[], members: [] as any[] }))

vi.mock('../../infra/database/prisma/prismaUserRepository', async () => {
    const { makePrismaUserRepositoryMock } = await import('../helpers/make-prisma-user-repository-mock')
    return makePrismaUserRepositoryMock(store)
})

vi.mock('../../infra/database/prisma/prismaGroupRepository', () => ({
    PrismaGroupRepository: class {
        async create(group: any) {
            stores.groups.push(group)
            for (const member of group.members) {
                if (!stores.members.find((m: any) => m.id === member.id)) stores.members.push(member)
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
    },
}))

vi.mock('../../infra/database/prisma/prismaMemberRepository', () => ({
    PrismaMemberRepository: class {
        async addMemberToGroup(member: any) { stores.members.push(member) }
        async findById(id: string) { return stores.members.find((m: any) => m.id === id) ?? null }
        async findByUserAndGroup(userId: string, groupId: string) {
            return stores.members.find((m: any) => m.userId === userId && m.groupId === groupId && !m.deletedBy) ?? null
        }
        async findByGroupId(groupId: string) {
            return stores.members.filter((m: any) => m.groupId === groupId && !m.deletedBy)
        }
        async findByGroupIdWithUser(groupId: string) {
            return stores.members
                .filter((m: any) => m.groupId === groupId && !m.deletedBy)
                .map((m: any) => {
                    const user = store.items.find((u: any) => u.id === m.userId)
                    return { id: m.id, userId: m.userId, role: m.role, joinedAt: m.joinedAt, name: user?.name ?? '', email: user?.email?.value ?? '' }
                })
        }
        async findRemovedByUserAndGroup(userId: string, groupId: string) {
            return stores.members.find((m: any) => m.userId === userId && m.groupId === groupId && m.deletedBy) ?? null
        }
        async removeMemberGroup(memberId: string, removedByUserId: string) {
            const item = stores.members.find((m: any) => m.id === memberId)
            if (item) item.deletedBy = removedByUserId
        }
        async reactivate(memberId: string) {
            const item = stores.members.find((m: any) => m.id === memberId)
            if (item) delete item.deletedBy
        }
        async updateRole(memberId: string, role: string) {
            const item = stores.members.find((m: any) => m.id === memberId)
            if (item) item.role = role
        }
    },
}))

// RemoveMemberUseCase soma despesas e acertos para exigir saldo zero; sem estes dois o
// caminho estoura antes de chegar na checagem de permissão.
vi.mock('../../infra/database/prisma/prismaExpenseRepository', () => ({
    PrismaExpenseRepository: class {
        async findByGroupId() { return [] }
    },
}))

vi.mock('../../infra/database/prisma/prismaSettlementRepository', () => ({
    PrismaSettlementRepository: class {
        async findConfirmedByGroup() { return [] }
        async findConfirmedByMemberAndGroup() { return [] }
        async cancelPendingByGroupId() { return undefined }
    },
}))

async function registerAndAuth(name: string, email: string) {
    await app.inject({ method: 'POST', url: '/register', payload: { name, email, password: 'password123' } })
    const res = await app.inject({ method: 'POST', url: '/auth', payload: { email, password: 'password123' } })
    return { accessToken: res.json().accessToken }
}

// Alice cria o grupo (vira OWNER) e adiciona Bob, que fica como MEMBER comum.
async function setupGroupWithPlainMember() {
    const alice = await registerAndAuth('Alice', 'alice@example.com')
    const groupRes = await app.inject({
        method: 'POST',
        url: '/groups',
        headers: { Authorization: `Bearer ${alice.accessToken}` },
        payload: { name: 'Republica' },
    })
    const groupId = groupRes.json().group.id

    const bob = await registerAndAuth('Bob', 'bob@example.com')
    const addRes = await app.inject({
        method: 'POST',
        url: `/groups/${groupId}/members`,
        headers: { Authorization: `Bearer ${alice.accessToken}` },
        payload: { email: 'bob@example.com' },
    })

    await registerAndAuth('Carol', 'carol@example.com')

    return { alice, bob, groupId, bobMemberId: addRes.json().member.id }
}

afterAll(async () => {
    await app.close()
})

beforeEach(() => {
    store.items.splice(0)
    stores.groups.splice(0)
    stores.members.splice(0)
})

describe('Negação de permissão responde 403 (D-74)', () => {
    it('membro comum que tenta convidar recebe 403, não 400', async () => {
        const { bob, groupId } = await setupGroupWithPlainMember()

        const res = await app.inject({
            method: 'POST',
            url: `/groups/${groupId}/members`,
            headers: { Authorization: `Bearer ${bob.accessToken}` },
            payload: { email: 'carol@example.com' },
        })

        expect(res.statusCode).toBe(403)
        expect(res.json().message).toContain('Apenas o dono')
    })

    it('membro comum que tenta remover outro membro recebe 403', async () => {
        const { bob, groupId, bobMemberId } = await setupGroupWithPlainMember()

        const res = await app.inject({
            method: 'DELETE',
            url: `/groups/${groupId}/members/${bobMemberId}`,
            headers: { Authorization: `Bearer ${bob.accessToken}` },
        })

        expect(res.statusCode).toBe(403)
    })

    it('membro comum que tenta atualizar o grupo recebe 403', async () => {
        const { bob, groupId } = await setupGroupWithPlainMember()

        const res = await app.inject({
            method: 'PATCH',
            url: `/groups/${groupId}`,
            headers: { Authorization: `Bearer ${bob.accessToken}` },
            payload: { name: 'Novo nome' },
        })

        expect(res.statusCode).toBe(403)
    })
})

describe('Regras de estado continuam 400 (D-74)', () => {
    it('convidar quem já é membro é conflito de estado, não falta de permissão', async () => {
        const { alice, groupId } = await setupGroupWithPlainMember()

        const res = await app.inject({
            method: 'POST',
            url: `/groups/${groupId}/members`,
            headers: { Authorization: `Bearer ${alice.accessToken}` },
            payload: { email: 'bob@example.com' },
        })

        expect(res.statusCode).toBe(400)
        expect(res.json().message).toContain('já é membro')
    })

    it('o dono tentando sair do grupo é regra de estado, e segue 400', async () => {
        const { alice, groupId } = await setupGroupWithPlainMember()

        const res = await app.inject({
            method: 'DELETE',
            url: `/groups/${groupId}/leave`,
            headers: { Authorization: `Bearer ${alice.accessToken}` },
        })

        expect(res.statusCode).toBe(400)
    })
})
