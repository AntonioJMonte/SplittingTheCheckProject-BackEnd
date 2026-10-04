import { randomUUID } from 'node:crypto'
import Decimal from 'decimal.js'
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '../../../infra/database/prisma/prismaClient'
import { PrismaExpenseRepository } from '../../../infra/database/prisma/prismaExpenseRepository'
import { Expense } from '../../../domain/entities/expense'
import { Money } from '../../../domain/value-objects/money'
import { ExpenseCategory } from '../../../domain/value-objects/expense-category'
import { INTEGRATION_SCHEMA } from '../setup/integration-database-url'
import { resetDatabase } from '../setup/reset-database'

const PARALLEL_ATTEMPTS = 5

describe('PrismaExpenseRepository (Postgres real)', () => {
    const repository = new PrismaExpenseRepository()
    let groupId: string
    const users: Record<'alice' | 'bob' | 'carla', string> = { alice: '', bob: '', carla: '' }
    const members: Record<'alice' | 'bob' | 'carla', string> = { alice: '', bob: '', carla: '' }

    beforeAll(() => {
        expect(process.env.DATABASE_URL).toContain(`schema=${INTEGRATION_SCHEMA}`)
    })

    beforeEach(async () => {
        await resetDatabase()
        const group = await prisma.group.create({ data: { name: 'Viagem' } })
        groupId = group.id
        for (const name of ['alice', 'bob', 'carla'] as const) {
            const user = await prisma.user.create({ data: { name, email: `${name}@test.com`, passwordHash: 'hash' } })
            const member = await prisma.member.create({
                data: { userId: user.id, groupId, role: name === 'alice' ? 'OWNER' : 'MEMBER' },
            })
            users[name] = user.id
            members[name] = member.id
        }
    })

    afterAll(async () => {
        await prisma.$disconnect()
    })

    function makeExpense(props: {
        payer: keyof typeof users
        description?: string
        amount: string
        shares: Array<[keyof typeof members, string]>
        occurredAt?: Date
        category?: ExpenseCategory
    }) {
        return Expense.create({
            groupId,
            payerId: users[props.payer],
            description: props.description ?? 'Despesa',
            amount: new Money(props.amount),
            shareInputs: props.shares.map(([name, amount]) => ({ memberId: members[name], amount: new Money(amount) })),
            splitMethod: 'FIXED',
            occurredAt: props.occurredAt,
            category: props.category,
        })
    }

    describe('create and read', () => {
        it('should round-trip the expense with exact decimal amounts and its shares', async () => {
            const expense = makeExpense({
                payer: 'alice', description: 'Jantar', amount: '100.00', category: 'Alimentação',
                shares: [['alice', '33.34'], ['bob', '33.33'], ['carla', '33.33']],
                occurredAt: new Date('2026-09-05T20:00:00Z'),
            })
            await repository.create(expense)

            const found = await repository.findById(expense.id)

            expect(found).toMatchObject({ description: 'Jantar', category: 'Alimentação', splitMethod: 'FIXED', version: 0 })
            expect(found?.amount.toString()).toBe('100.00')
            expect(found?.occurredAt.toISOString()).toBe('2026-09-05T20:00:00.000Z')
            expect(found?.shares.map(s => [s.memberId, s.amount.toString()]).sort()).toEqual([
                [members.alice, '33.34'], [members.bob, '33.33'], [members.carla, '33.33'],
            ].sort())
        })

        it('should not persist the expense when a share insert fails', async () => {
            const expense = Expense.create({
                groupId, payerId: users.alice, description: 'Quebrada', amount: new Money('10.00'),
                shareInputs: [{ memberId: randomUUID(), amount: new Money('10.00') }], splitMethod: 'FIXED',
            })

            await expect(repository.create(expense)).rejects.toThrow()

            expect(await prisma.expense.count()).toBe(0)
        })

        it('should read a category outside the closed list as uncategorized', async () => {
            const expense = makeExpense({ payer: 'alice', amount: '10.00', shares: [['alice', '10.00']] })
            await repository.create(expense)
            await prisma.expense.update({ where: { id: expense.id }, data: { category: 'Mercadinho' } })

            expect((await repository.findById(expense.id))?.category).toBeUndefined()
        })
    })

    describe('soft delete (D-72)', () => {
        it('should hide the expense from every read but keep the row with who deleted it', async () => {
            const kept = makeExpense({ payer: 'alice', amount: '10.00', shares: [['alice', '10.00']] })
            const deleted = makeExpense({ payer: 'alice', amount: '20.00', shares: [['bob', '20.00']] })
            await repository.create(kept)
            await repository.create(deleted)

            await repository.softDelete(deleted.id, users.alice)

            expect(await repository.findById(deleted.id)).toBeNull()
            expect((await repository.findByGroupId(groupId)).map(e => e.id)).toEqual([kept.id])
            const page = await repository.findManyByGroup({ groupId, userId: users.alice })
            expect(page.expenses.map(e => e.id)).toEqual([kept.id])
            expect(page.total).toBe(1)
            const row = await prisma.expense.findUniqueOrThrow({ where: { id: deleted.id } })
            expect(row.deletedBy).toBe(users.alice)
            expect(row.deletedAt).toBeInstanceOf(Date)
        })
    })

    describe('findManyByGroup', () => {
        let dinner: Expense
        let ride: Expense
        let market: Expense

        beforeEach(async () => {
            dinner = makeExpense({
                payer: 'alice', amount: '90.00', category: 'Alimentação', occurredAt: new Date('2026-09-05T20:00:00Z'),
                shares: [['alice', '30.00'], ['bob', '30.00'], ['carla', '30.00']],
            })
            ride = makeExpense({
                payer: 'bob', amount: '30.00', category: 'Transporte', occurredAt: new Date('2026-09-15T10:00:00Z'),
                shares: [['alice', '15.00'], ['bob', '15.00']],
            })
            market = makeExpense({
                payer: 'carla', amount: '200.00', category: 'Alimentação', occurredAt: new Date('2026-09-30T12:00:00Z'),
                shares: [['carla', '200.00']],
            })
            for (const expense of [dinner, ride, market]) await repository.create(expense)
        })

        async function idsFor(params: Partial<Parameters<PrismaExpenseRepository['findManyByGroup']>[0]>) {
            const { expenses } = await repository.findManyByGroup({ groupId, userId: users.alice, ...params })
            return expenses.map(e => e.id)
        }

        it('should order by occurrence, newest first, and paginate with the full total', async () => {
            const firstPage = await repository.findManyByGroup({ groupId, userId: users.alice, page: 1, limit: 2 })
            const secondPage = await repository.findManyByGroup({ groupId, userId: users.alice, page: 2, limit: 2 })

            expect(firstPage.expenses.map(e => e.id)).toEqual([market.id, ride.id])
            expect(secondPage.expenses.map(e => e.id)).toEqual([dinner.id])
            expect(firstPage.total).toBe(3)
            expect(secondPage.total).toBe(3)
        })

        it('should filter by category', async () => {
            expect(await idsFor({ category: 'Alimentação' })).toEqual([market.id, dinner.id])
        })

        it('should filter by an inclusive date range, open on either side', async () => {
            expect(await idsFor({ startDate: new Date('2026-09-15T10:00:00Z') })).toEqual([market.id, ride.id])
            expect(await idsFor({ endDate: new Date('2026-09-15T10:00:00Z') })).toEqual([ride.id, dinner.id])
            expect(await idsFor({
                startDate: new Date('2026-09-10T00:00:00Z'), endDate: new Date('2026-09-20T00:00:00Z'),
            })).toEqual([ride.id])
        })

        it('should filter by an inclusive amount range compared as decimals', async () => {
            expect(await idsFor({ minAmount: new Decimal('30.00'), maxAmount: new Decimal('90.00') })).toEqual([ride.id, dinner.id])
            expect(await idsFor({ minAmount: new Decimal('90.01') })).toEqual([market.id])
        })

        it('should filter what the user paid and what the user takes part in', async () => {
            expect(await idsFor({ view: 'paid' })).toEqual([dinner.id])
            expect(await idsFor({ view: 'involved' })).toEqual([ride.id, dinner.id])
        })

        it('should list as pending what someone else paid until the user confirms a settlement', async () => {
            expect(await idsFor({ view: 'pending' })).toEqual([ride.id])

            await prisma.settlement.create({
                data: { groupId, fromMemberId: members.alice, toMemberId: members.bob, amount: '15.00', status: 'CONFIRMED' },
            })

            expect(await idsFor({ view: 'pending' })).toEqual([])
        })
    })

    describe('updateWithRevision (D-80, D-82)', () => {
        let original: Expense

        beforeEach(async () => {
            original = makeExpense({
                payer: 'alice', description: 'Jantar', amount: '90.00', category: 'Alimentação',
                shares: [['alice', '30.00'], ['bob', '30.00'], ['carla', '30.00']],
            })
            await repository.create(original)
        })

        function edited(from: Expense) {
            return from.update({
                description: 'Jantar com sobremesa',
                amount: new Money('120.00'),
                shareInputs: [{ memberId: members.alice, amount: new Money('60.00') }, { memberId: members.bob, amount: new Money('60.00') }],
            })
        }

        it('should apply the edit, bump the version, replace the shares and store the previous state', async () => {
            const applied = await repository.updateWithRevision(edited(original), original, users.bob)

            expect(applied).toBe(true)
            const current = await repository.findById(original.id)
            expect(current).toMatchObject({ description: 'Jantar com sobremesa', version: 1 })
            expect(current?.amount.toString()).toBe('120.00')
            expect(current?.shares.map(s => s.memberId).sort()).toEqual([members.alice, members.bob].sort())
            expect(await prisma.expenseShare.count({ where: { expenseId: original.id } })).toBe(2)

            const revisions = await prisma.expenseRevision.findMany({ where: { expenseId: original.id } })
            expect(revisions).toHaveLength(1)
            expect(revisions[0]).toMatchObject({ version: 0, description: 'Jantar', category: 'Alimentação', editedBy: users.bob })
            expect(revisions[0].amount.toFixed(2)).toBe('90.00')
            expect(revisions[0].shares).toEqual(expect.arrayContaining([
                { memberId: members.alice, amount: '30.00' },
                { memberId: members.bob, amount: '30.00' },
                { memberId: members.carla, amount: '30.00' },
            ]))
        })

        it('should refuse an edit based on a stale version and leave everything untouched', async () => {
            await repository.updateWithRevision(edited(original), original, users.bob)

            const staleEdit = original.update({ description: 'Versão velha' })
            const applied = await repository.updateWithRevision(staleEdit, original, users.carla)

            expect(applied).toBe(false)
            expect((await repository.findById(original.id))?.description).toBe('Jantar com sobremesa')
            expect(await prisma.expenseRevision.count()).toBe(1)
        })

        it(`should apply exactly one of ${PARALLEL_ATTEMPTS} concurrent edits that read the same version`, async () => {
            const results = await Promise.all(
                Array.from({ length: PARALLEL_ATTEMPTS }, () => repository.updateWithRevision(edited(original), original, users.bob)),
            )

            expect(results.filter(Boolean)).toHaveLength(1)
            expect(await prisma.expenseRevision.count()).toBe(1)
            expect(await prisma.expenseShare.count({ where: { expenseId: original.id } })).toBe(2)
            expect((await prisma.expense.findUniqueOrThrow({ where: { id: original.id } })).version).toBe(1)
        })

        it('should refuse to edit a deleted expense', async () => {
            await repository.softDelete(original.id, users.alice)

            expect(await repository.updateWithRevision(edited(original), original, users.bob)).toBe(false)
            expect(await prisma.expenseRevision.count()).toBe(0)
        })
    })

    describe('findRevisions (D-93)', () => {
        it('should read the revisions back newest first, with exact amounts and who edited', async () => {
            const original = makeExpense({
                payer: 'alice', description: 'Jantar', amount: '90.00', category: 'Alimentação',
                shares: [['alice', '30.00'], ['bob', '30.00'], ['carla', '30.00']],
            })
            await repository.create(original)
            await repository.updateWithRevision(original.update({ description: 'Jantar com sobremesa' }), original, users.bob)
            const current = (await repository.findById(original.id))!
            await repository.updateWithRevision(current.update({ description: 'Terceira' }), current, users.carla)

            const revisions = await repository.findRevisions(original.id)

            expect(revisions.map(r => [r.version, r.description, r.editedByUserId])).toEqual([
                [1, 'Jantar com sobremesa', users.carla],
                [0, 'Jantar', users.bob],
            ])
            expect(revisions[1]).toMatchObject({ splitMethod: 'FIXED', category: 'Alimentação' })
            expect(revisions[1].amount.toString()).toBe('90.00')
            expect(revisions[1].shares.map(s => s.amount.toString())).toEqual(['30.00', '30.00', '30.00'])
            expect(revisions[0].editedAt).toBeInstanceOf(Date)
            expect(await repository.findRevisions(randomUUID())).toEqual([])
        })
    })

    describe('updateCategory', () => {
        it('should write only while the description is the one that was categorized', async () => {
            const expense = makeExpense({ payer: 'alice', description: 'Uber', amount: '10.00', shares: [['alice', '10.00']] })
            await repository.create(expense)

            expect(await repository.updateCategory(expense.id, 'Transporte', 'Uber')).toBe(true)
            expect((await repository.findById(expense.id))?.category).toBe('Transporte')

            expect(await repository.updateCategory(expense.id, 'Lazer', 'Cinema')).toBe(false)
            expect((await repository.findById(expense.id))?.category).toBe('Transporte')
        })

        it('should not categorize a deleted expense', async () => {
            const expense = makeExpense({ payer: 'alice', description: 'Uber', amount: '10.00', shares: [['alice', '10.00']] })
            await repository.create(expense)
            await repository.softDelete(expense.id, users.alice)

            expect(await repository.updateCategory(expense.id, 'Transporte', 'Uber')).toBe(false)
        })
    })
})
