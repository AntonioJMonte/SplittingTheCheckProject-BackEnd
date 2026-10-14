import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import fastify from 'fastify'
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod'
import { app } from '../../infra/http/app'
import { userRoutes } from '../../infra/http/routes/userRoutes'
import { authRateLimit } from '../../infra/http/rate-limit'
import { User } from '../../domain/entities/user'
import { Group } from '../../domain/entities/group'
import { Member } from '../../domain/entities/member'
import { Expense } from '../../domain/entities/expense'
import { Settlement } from '../../domain/entities/settlement'
import { Money } from '../../domain/value-objects/money'

// Os repositórios Prisma viram os dublês em memória (um por tipo, compartilhado entre as
// factories), e os testes semeiam o estado direto neles: o que se exercita aqui é o caminho
// rota → controller → use case → resposta das rotas criadas para o frontend (D-88…D-93).
const repos = vi.hoisted(() => ({}) as Record<string, any>)

vi.mock('../../infra/database/prisma/prismaUserRepository', async () => {
    const { InMemoryUserRepository } = await import('../doubles/in-memory-user-repository')
    repos.users = new InMemoryUserRepository()
    return { PrismaUserRepository: function () { return repos.users } }
})
vi.mock('../../infra/database/prisma/prismaGroupRepository', async () => {
    const { InMemoryGroupRepository } = await import('../doubles/in-memory-group-repository')
    repos.groups = new InMemoryGroupRepository()
    return { PrismaGroupRepository: function () { return repos.groups } }
})
vi.mock('../../infra/database/prisma/prismaMemberRepository', async () => {
    const { InMemoryMemberRepository } = await import('../doubles/in-memory-member-repository')
    repos.members = new InMemoryMemberRepository()
    return { PrismaMemberRepository: function () { return repos.members } }
})
vi.mock('../../infra/database/prisma/prismaExpenseRepository', async () => {
    const { InMemoryExpenseRepository } = await import('../doubles/in-memory-expense-repository')
    repos.expenses = new InMemoryExpenseRepository()
    return { PrismaExpenseRepository: function () { return repos.expenses } }
})
vi.mock('../../infra/database/prisma/prismaSettlementRepository', async () => {
    const { InMemorySettlementRepository } = await import('../doubles/in-memory-settlement-repository')
    repos.settlements = new InMemorySettlementRepository()
    return { PrismaSettlementRepository: function () { return repos.settlements } }
})
const balancesCache = vi.hoisted(() => ({ invalidate: vi.fn(async () => {}) }))
vi.mock('../../infra/cache/group-balances-cache', () => ({
    getGroupBalancesCache: async () => null,
    setGroupBalancesCache: async () => {},
    invalidateGroupBalancesCache: balancesCache.invalidate,
}))
vi.mock('../../infra/cache/llm-category-cache', () => ({
    buildCategoryCacheKey: () => null,
    getCategoryCache: async () => null,
    setCategoryCache: async () => {},
}))

let ana: User
let bruno: User
let carla: User
let group: Group
let anaMember: Member
let brunoMember: Member

function bearer(user: User) {
    return { Authorization: `Bearer ${app.jwt.sign({ sub: user.id })}` }
}

function makeExpense(description = 'Jantar') {
    return Expense.create({
        groupId: group.id,
        payerId: ana.id,
        description,
        amount: new Money('90.00'),
        shareInputs: [{ memberId: anaMember.id, amount: new Money('45.00') }, { memberId: brunoMember.id, amount: new Money('45.00') }],
        splitMethod: 'FIXED',
    })
}

beforeAll(async () => {
    await app.ready()
})

beforeEach(() => {
    balancesCache.invalidate.mockClear()
    repos.users.items = []
    repos.groups.items = []
    repos.members.items = []
    repos.members.removed.clear()
    repos.expenses.items = []
    repos.expenses.revisions = []
    repos.expenses.deleted.clear()
    repos.settlements.items = []

    ana = User.create({ name: 'Ana', email: 'ana@example.com', passwordHash: 'hash', phone: '(11) 98765-4321' })
    bruno = User.create({ name: 'Bruno', email: 'bruno@example.com', passwordHash: 'hash' })
    carla = User.create({ name: 'Carla', email: 'carla@example.com', passwordHash: 'hash' })
    repos.users.items.push(ana, bruno, carla)

    const created = Group.create({ name: 'Viagem', creatorUserId: ana.id })
    anaMember = created.members[0]
    brunoMember = Member.create({ userId: bruno.id, groupId: created.id })
    group = new Group(created.id, created.name, created.currency, [anaMember, brunoMember])
    repos.groups.items.push(group)
    repos.members.items.push(anaMember, brunoMember)
})

afterAll(async () => {
    await app.close()
})

describe('GET /users/me (D-88)', () => {
    it('devolve o perfil de quem está logado, com telefone em E.164 e sem o hash da senha', async () => {
        await repos.users.updatePixKey(ana.id, 'ana@pix.com')

        const res = await app.inject({ method: 'GET', url: '/users/me', headers: bearer(ana) })

        expect(res.statusCode).toBe(200)
        expect(res.json()).toEqual({
            user: { id: ana.id, name: 'Ana', email: 'ana@example.com', phone: '+5511987654321', pixKey: 'ana@pix.com' },
        })
        expect(res.body).not.toContain('passwordHash')
    })

    it('devolve null para telefone e chave Pix não cadastrados', async () => {
        const res = await app.inject({ method: 'GET', url: '/users/me', headers: bearer(bruno) })

        expect(res.json().user).toMatchObject({ phone: null, pixKey: null })
    })

    it('responde 401 sem token e 404 para um token de usuário que não existe mais', async () => {
        expect((await app.inject({ method: 'GET', url: '/users/me' })).statusCode).toBe(401)

        const ghost = User.create({ name: 'Fantasma', email: 'ghost@example.com', passwordHash: 'hash' })
        expect((await app.inject({ method: 'GET', url: '/users/me', headers: bearer(ghost) })).statusCode).toBe(404)
    })
})

describe('GET /groups/:groupId/settlements (D-89)', () => {
    function seedSettlement(status: 'PENDING' | 'CONFIRMED', createdAt: string, amount = '33.33') {
        const settlement = new Settlement(
            crypto.randomUUID(), group.id, brunoMember.id, anaMember.id, new Money(amount), status,
            status === 'CONFIRMED' ? new Date('2026-09-20T00:00:00Z') : undefined, undefined, 0, new Date(createdAt),
        )
        repos.settlements.items.push(settlement)
        return settlement
    }

    it('lista os acertos do grupo, mais recentes primeiro, com as datas que a tela precisa', async () => {
        const older = seedSettlement('CONFIRMED', '2026-09-10T00:00:00Z', '10.00')
        const newer = seedSettlement('PENDING', '2026-09-25T00:00:00Z')

        const res = await app.inject({ method: 'GET', url: `/groups/${group.id}/settlements`, headers: bearer(ana) })

        expect(res.statusCode).toBe(200)
        const { settlements } = res.json()
        expect(settlements.map((s: { id: string }) => s.id)).toEqual([newer.id, older.id])
        expect(settlements[0]).toEqual({
            id: newer.id, fromMemberId: brunoMember.id, toMemberId: anaMember.id, amount: '33.33', status: 'PENDING',
            pixCopyPaste: null, createdAt: '2026-09-25T00:00:00.000Z', confirmedAt: null,
        })
        expect(settlements[1].confirmedAt).toBe('2026-09-20T00:00:00.000Z')
    })

    it('filtra por status: o credor acha o que falta reconhecer mesmo tendo perdido o evento', async () => {
        seedSettlement('CONFIRMED', '2026-09-10T00:00:00Z')
        const pending = seedSettlement('PENDING', '2026-09-25T00:00:00Z')

        const res = await app.inject({ method: 'GET', url: `/groups/${group.id}/settlements?status=PENDING`, headers: bearer(ana) })

        expect(res.json().settlements.map((s: { id: string }) => s.id)).toEqual([pending.id])
    })

    it('nega a quem não é membro e recusa status desconhecido', async () => {
        const outsider = await app.inject({ method: 'GET', url: `/groups/${group.id}/settlements`, headers: bearer(carla) })
        const badStatus = await app.inject({ method: 'GET', url: `/groups/${group.id}/settlements?status=PAGO`, headers: bearer(ana) })

        expect(outsider.statusCode).toBe(403)
        expect(badStatus.statusCode).toBe(400)
        expect(badStatus.json().issues[0].path).toBe('status')
    })
})

describe('Erros de validação com detalhe por campo (D-90)', () => {
    it('aponta cada campo inválido, em português', async () => {
        const res = await app.inject({ method: 'POST', url: '/groups', headers: bearer(ana), payload: { currency: 'BRL' } })

        expect(res.statusCode).toBe(400)
        expect(res.json()).toEqual({
            message: 'Dados inválidos.',
            issues: [{ path: 'name', message: 'Tipo inválido: esperado string, recebido undefined' }],
        })
    })

    it('usa o caminho pontuado para campos aninhados', async () => {
        const expense = makeExpense()
        repos.expenses.items.push(expense)

        const res = await app.inject({
            method: 'PATCH', url: `/expenses/${expense.id}`, headers: bearer(ana),
            payload: { version: 0, shares: [{ memberId: 'nao-e-uuid', amount: 90 }] },
        })

        expect(res.statusCode).toBe(400)
        expect(res.json().issues).toEqual([{ path: 'shares.0.memberId', message: 'UUID inválido' }])
    })

    it('aponta o parâmetro de rota inválido', async () => {
        const res = await app.inject({ method: 'GET', url: '/groups/nao-e-uuid/settlements', headers: bearer(ana) })

        expect(res.json()).toEqual({ message: 'Dados inválidos.', issues: [{ path: 'groupId', message: 'UUID inválido' }] })
    })
})

describe('Rate limit do /refresh (D-91)', () => {
    it('tira o /refresh do limite de autenticação e mantém /auth e /register nele', async () => {
        const rateLimitByRoute = new Map<string, unknown>()
        const instance = fastify()
        instance.setValidatorCompiler(validatorCompiler)
        instance.setSerializerCompiler(serializerCompiler)
        instance.addHook('onRoute', route => {
            rateLimitByRoute.set(`${route.method} ${route.url}`, (route.config as { rateLimit?: unknown } | undefined)?.rateLimit)
        })
        await instance.register(userRoutes)
        await instance.ready()

        expect(rateLimitByRoute.get('POST /refresh')).toBeUndefined()
        expect(rateLimitByRoute.get('POST /auth')).toBe(authRateLimit)
        expect(rateLimitByRoute.get('POST /register')).toBe(authRateLimit)

        await instance.close()
    })
})

describe('version no PATCH de despesa (D-92)', () => {
    it('expõe a versão na listagem', async () => {
        repos.expenses.items.push(makeExpense())

        const res = await app.inject({ method: 'GET', url: `/groups/${group.id}/expenses`, headers: bearer(ana) })

        expect(res.json().expenses[0].version).toBe(0)
    })

    it('aplica a edição com a versão lida e devolve a versão nova para a próxima edição', async () => {
        const expense = makeExpense()
        repos.expenses.items.push(expense)

        const first = await app.inject({
            method: 'PATCH', url: `/expenses/${expense.id}`, headers: bearer(ana),
            payload: { description: 'Jantar e sobremesa', category: 'Alimentação', version: 0 },
        })
        const second = await app.inject({
            method: 'PATCH', url: `/expenses/${expense.id}`, headers: bearer(ana),
            payload: { description: 'Jantar, sobremesa e café', category: 'Alimentação', version: first.json().expense.version },
        })

        expect(first.statusCode).toBe(200)
        expect(first.json().expense.version).toBe(1)
        expect(second.statusCode).toBe(200)
        expect(second.json().expense.version).toBe(2)
    })

    it('responde 409 a quem editou uma tela desatualizada, sem gravar nada', async () => {
        const expense = makeExpense()
        repos.expenses.items.push(expense)
        await app.inject({
            method: 'PATCH', url: `/expenses/${expense.id}`, headers: bearer(ana),
            payload: { description: 'Edição de outra aba', category: 'Alimentação', version: 0 },
        })

        const stale = await app.inject({
            method: 'PATCH', url: `/expenses/${expense.id}`, headers: bearer(ana),
            payload: { description: 'Tela velha', category: 'Lazer', version: 0 },
        })

        expect(stale.statusCode).toBe(409)
        expect((await repos.expenses.findById(expense.id)).description).toBe('Edição de outra aba')
        expect(repos.expenses.revisions).toHaveLength(1)
    })

    it('exige a versão no corpo', async () => {
        const expense = makeExpense()
        repos.expenses.items.push(expense)

        const res = await app.inject({
            method: 'PATCH', url: `/expenses/${expense.id}`, headers: bearer(ana), payload: { description: 'Sem versão' },
        })

        expect(res.statusCode).toBe(400)
        expect(res.json().issues.map((i: { path: string }) => i.path)).toEqual(['version'])
    })
})

describe('GET /expenses/:expenseId/revisions (D-93)', () => {
    async function editAs(user: User, expense: Expense, description: string, version: number) {
        const res = await app.inject({
            method: 'PATCH', url: `/expenses/${expense.id}`, headers: bearer(user),
            payload: { description, category: 'Alimentação', version },
        })
        expect(res.statusCode).toBe(200)
    }

    it('devolve o estado anterior de cada edição, do mais recente ao mais antigo, com quem editou', async () => {
        const expense = makeExpense('Jantar')
        repos.expenses.items.push(expense)
        await editAs(ana, expense, 'Jantar com vinho', 0)
        await editAs(ana, expense, 'Jantar com vinho e sobremesa', 1)

        const res = await app.inject({ method: 'GET', url: `/expenses/${expense.id}/revisions`, headers: bearer(bruno) })

        expect(res.statusCode).toBe(200)
        const { revisions } = res.json()
        expect(revisions.map((r: { version: number; description: string }) => [r.version, r.description])).toEqual([
            [1, 'Jantar com vinho'],
            [0, 'Jantar'],
        ])
        expect(revisions[1]).toMatchObject({
            amount: '90.00',
            splitMethod: 'FIXED',
            shares: [{ memberId: anaMember.id, amount: '45.00' }, { memberId: brunoMember.id, amount: '45.00' }],
            editedBy: { userId: ana.id, name: 'Ana' },
        })
        expect(typeof revisions[1].editedAt).toBe('string')
    })

    it('mantém o nome de quem editou mesmo depois que essa pessoa saiu do grupo', async () => {
        const expense = makeExpense()
        repos.expenses.items.push(expense)
        await editAs(ana, expense, 'Editada pela dona', 0)
        await repos.members.removeMemberGroup(anaMember.id, ana.id)

        const res = await app.inject({ method: 'GET', url: `/expenses/${expense.id}/revisions`, headers: bearer(bruno) })

        expect(res.json().revisions[0].editedBy).toEqual({ userId: ana.id, name: 'Ana' })
    })

    it('nega a quem não é do grupo e responde 404 para despesa excluída', async () => {
        const expense = makeExpense()
        repos.expenses.items.push(expense)

        const outsider = await app.inject({ method: 'GET', url: `/expenses/${expense.id}/revisions`, headers: bearer(carla) })
        await repos.expenses.softDelete(expense.id, ana.id)
        const deleted = await app.inject({ method: 'GET', url: `/expenses/${expense.id}/revisions`, headers: bearer(ana) })

        expect(outsider.statusCode).toBe(403)
        expect(deleted.statusCode).toBe(404)
    })
})

describe('Mensagens de login e cadastro em português (D-104)', () => {
    it('responde 401 em português para credenciais erradas', async () => {
        const res = await app.inject({
            method: 'POST', url: '/auth', payload: { email: 'ninguem@example.com', password: 'senha-errada' },
        })

        expect(res.statusCode).toBe(401)
        expect(res.json()).toEqual({ message: 'Email ou senha incorretos.' })
    })

    it('responde 409 em português para email já cadastrado', async () => {
        const res = await app.inject({
            method: 'POST', url: '/register', payload: { name: 'Outra Ana', email: 'ana@example.com', password: 'senha-forte-123' },
        })

        expect(res.statusCode).toBe(409)
        expect(res.json()).toEqual({ message: 'Já existe uma conta com este email.' })
    })
})

describe('userId nos membros (D-100)', () => {
    it('devolve o userId de cada membro no detalhe do grupo e na listagem de membros', async () => {
        const expected = [[anaMember.id, ana.id], [brunoMember.id, bruno.id]]

        const detail = await app.inject({ method: 'GET', url: `/groups/${group.id}`, headers: bearer(ana) })
        const list = await app.inject({ method: 'GET', url: `/groups/${group.id}/members`, headers: bearer(ana) })

        expect(detail.statusCode).toBe(200)
        expect(detail.json().group.members.map((m: { id: string; userId: string }) => [m.id, m.userId])).toEqual(expected)
        expect(list.statusCode).toBe(200)
        expect(list.json().members.map((m: { id: string; userId: string }) => [m.id, m.userId])).toEqual(expected)
    })
})

describe('Valores monetários como string (D-98)', () => {
    function expensePayload(amount: unknown) {
        return { description: 'Mercado', amount, payerId: ana.id, splitMethod: 'EQUAL', category: 'Compras', shares: [{ memberId: anaMember.id }] }
    }

    it('cria despesa com valor e partes em string, sem passar por float', async () => {
        const res = await app.inject({
            method: 'POST', url: `/groups/${group.id}/expenses`, headers: bearer(ana),
            payload: {
                description: 'Mercado', amount: '100.10', payerId: ana.id, splitMethod: 'FIXED', category: 'Compras',
                shares: [{ memberId: anaMember.id, amount: '50.05' }, { memberId: brunoMember.id, amount: '50.05' }],
            },
        })

        expect(res.statusCode).toBe(201)
        expect(res.json().expense).toMatchObject({
            amount: '100.10',
            shares: [{ memberId: anaMember.id, amount: '50.05' }, { memberId: brunoMember.id, amount: '50.05' }],
        })
    })

    it('continua aceitando number para quem já usa a API', async () => {
        const res = await app.inject({ method: 'POST', url: `/groups/${group.id}/expenses`, headers: bearer(ana), payload: expensePayload(90) })

        expect(res.statusCode).toBe(201)
        expect(res.json().expense.amount).toBe('90.00')
    })

    it('recusa string com mais de 2 casas, com vírgula, zerada ou sem número', async () => {
        for (const amount of ['10.005', '10,00', '0.00', 'abc']) {
            const res = await app.inject({ method: 'POST', url: `/groups/${group.id}/expenses`, headers: bearer(ana), payload: expensePayload(amount) })

            expect(res.statusCode, amount).toBe(400)
            expect(res.json().issues.map((i: { path: string }) => i.path), amount).toContain('amount')
        }
    })

    it('registra acerto com valor em string', async () => {
        repos.expenses.items.push(makeExpense())

        const res = await app.inject({
            method: 'POST', url: `/groups/${group.id}/settlements`, headers: bearer(bruno),
            payload: { fromMemberId: brunoMember.id, toMemberId: anaMember.id, amount: '45.00' },
        })

        expect(res.statusCode).toBe(201)
        expect(res.json().settlement).toMatchObject({ amount: '45.00', status: 'PENDING' })
    })

    it('aceita até 8 dígitos inteiros, o limite da coluna Decimal(10, 2) (D-105)', async () => {
        const res = await app.inject({ method: 'POST', url: `/groups/${group.id}/expenses`, headers: bearer(ana), payload: expensePayload('99999999.99') })

        expect(res.statusCode).toBe(201)
        expect(res.json().expense.amount).toBe('99999999.99')
    })

    it('recusa string com 9 dígitos inteiros, em vez de estourar a coluna no banco (D-105)', async () => {
        const expense = await app.inject({ method: 'POST', url: `/groups/${group.id}/expenses`, headers: bearer(ana), payload: expensePayload('123456789.00') })
        const settlement = await app.inject({
            method: 'POST', url: `/groups/${group.id}/settlements`, headers: bearer(bruno),
            payload: { fromMemberId: brunoMember.id, toMemberId: anaMember.id, amount: '123456789' },
        })

        for (const res of [expense, settlement]) {
            expect(res.statusCode).toBe(400)
            expect(res.json().issues).toContainEqual({ path: 'amount', message: 'Use no máximo 8 dígitos antes do ponto (até 99999999.99)' })
        }
    })
})

describe('Saldos descontam acertos confirmados e o cache acompanha (D-99)', () => {
    function seedSettlement(status: 'PENDING' | 'CONFIRMED') {
        const settlement = new Settlement(
            crypto.randomUUID(), group.id, brunoMember.id, anaMember.id, new Money('45.00'), status,
            status === 'CONFIRMED' ? new Date('2026-10-13T00:00:00Z') : undefined, undefined, 0, new Date('2026-10-12T00:00:00Z'),
        )
        repos.settlements.items.push(settlement)
        return settlement
    }

    it('zera saldo e transferência depois que o credor confirma o acerto', async () => {
        repos.expenses.items.push(makeExpense())
        seedSettlement('CONFIRMED')

        const res = await app.inject({ method: 'GET', url: `/groups/${group.id}/balances`, headers: bearer(ana) })

        expect(res.statusCode).toBe(200)
        expect(res.json()).toEqual({
            memberBalances: [
                { memberId: anaMember.id, userId: ana.id, balance: '0.00' },
                { memberId: brunoMember.id, userId: bruno.id, balance: '0.00' },
            ],
            transfers: [],
        })
    })

    it('invalida o cache ao adicionar membro', async () => {
        const res = await app.inject({ method: 'POST', url: `/groups/${group.id}/members`, headers: bearer(ana), payload: { email: 'carla@example.com' } })

        expect(res.statusCode).toBe(201)
        expect(balancesCache.invalidate).toHaveBeenCalledWith(group.id)
    })

    it('invalida o cache ao remover membro', async () => {
        const res = await app.inject({ method: 'DELETE', url: `/groups/${group.id}/members/${brunoMember.id}`, headers: bearer(ana) })

        expect(res.statusCode).toBe(204)
        expect(balancesCache.invalidate).toHaveBeenCalledWith(group.id)
    })

    it('invalida o cache quando alguém sai do grupo', async () => {
        const res = await app.inject({ method: 'DELETE', url: `/groups/${group.id}/leave`, headers: bearer(bruno) })

        expect(res.statusCode).toBe(204)
        expect(balancesCache.invalidate).toHaveBeenCalledWith(group.id)
    })

    it('invalida o cache quando o credor confirma o recebimento', async () => {
        const pending = seedSettlement('PENDING')

        const res = await app.inject({ method: 'PATCH', url: `/settlements/${pending.id}/acknowledge`, headers: bearer(ana) })

        expect(res.statusCode).toBe(200)
        expect(balancesCache.invalidate).toHaveBeenCalledWith(group.id)
    })
})

describe('Valores monetários como string no PATCH de despesa (D-98 + P-8)', () => {
    it('edita valor e partes enviados em string, sem passar por float', async () => {
        const expense = makeExpense()
        repos.expenses.items.push(expense)

        const res = await app.inject({
            method: 'PATCH', url: `/expenses/${expense.id}`, headers: bearer(ana),
            payload: {
                amount: '100.10', splitMethod: 'FIXED', version: 0,
                shares: [{ memberId: anaMember.id, amount: '50.05' }, { memberId: brunoMember.id, amount: '50.05' }],
            },
        })

        expect(res.statusCode).toBe(200)
        expect(res.json().expense).toMatchObject({
            amount: '100.10',
            shares: [{ memberId: anaMember.id, amount: '50.05' }, { memberId: brunoMember.id, amount: '50.05' }],
        })
    })
})
