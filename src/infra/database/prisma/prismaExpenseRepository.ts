import { Prisma } from '@prisma/client'
import { prisma } from './prismaClient'
import {
    ExpenseRepository,
    ExpenseRevisionRecord,
    FindManyByGroupParams,
    FindManyByGroupResult,
} from '../../../application/repositories/expense-repository'
import { Expense } from '../../../domain/entities/expense'
import { ExpenseShare } from '../../../domain/entities/expense-share'
import { Money } from '../../../domain/value-objects/money'
import { SplitMethodType } from '../../../domain/value-objects/split-method'
import { ExpenseCategory, isExpenseCategory } from '../../../domain/value-objects/expense-category'

// Rows written before the closed category list may hold free text; those read as uncategorized.
function toCategory(value: string | null): ExpenseCategory | undefined {
    return value !== null && isExpenseCategory(value) ? value : undefined
}

function toExpense(row: {
    id: string
    groupId: string
    payerId: string
    description: string
    amount: { toString(): string }
    splitMethod: string
    occurredAt: Date
    category: string | null
    shares: Array<{ id: string; expenseId: string; memberId: string; amount: { toString(): string } }>
    version?: number
}): Expense {
    return new Expense(
        row.id,
        row.groupId,
        row.payerId,
        row.description,
        new Money(row.amount.toString()),
        row.shares.map(s =>
            new ExpenseShare(s.id, s.expenseId, s.memberId, new Money(s.amount.toString())),
        ),
        row.splitMethod as SplitMethodType,
        row.occurredAt,
        toCategory(row.category),
        row.version ?? 0,
    )
}

// D-72: uma despesa excluída permanece na tabela, então toda leitura precisa deste filtro.
const ACTIVE = { deletedAt: null }

function buildWhereClause(params: FindManyByGroupParams): Prisma.ExpenseWhereInput {
    const where: Prisma.ExpenseWhereInput = { groupId: params.groupId, ...ACTIVE }

    if (params.category !== undefined) {
        where.category = params.category
    }

    if (params.startDate !== undefined || params.endDate !== undefined) {
        where.occurredAt = {
            gte: params.startDate,
            lte: params.endDate,
        }
    }

    if (params.minAmount !== undefined || params.maxAmount !== undefined) {
        where.amount = {
            gte: params.minAmount?.toString(),
            lte: params.maxAmount?.toString(),
        }
    }

    if (params.view === 'involved') {
        where.shares = { some: { member: { userId: params.userId } } }
    } else if (params.view === 'paid') {
        where.payerId = params.userId
    } else if (params.view === 'pending') {
        where.payerId = { not: params.userId }
        where.shares = { some: { member: { userId: params.userId } } }
        where.group = {
            settlements: {
                none: {
                    status: 'CONFIRMED',
                    fromMember: { userId: params.userId },
                },
            },
        }
    }

    return where
}

export class PrismaExpenseRepository implements ExpenseRepository {

    async create(data: Expense): Promise<void> {
        await prisma.$transaction(async tx => {
            await tx.expense.create({
                data: {
                    id: data.id,
                    groupId: data.groupId,
                    payerId: data.payerId,
                    description: data.description,
                    amount: data.amount.toString(),
                    splitMethod: data.splitMethod,
                    occurredAt: data.occurredAt,
                    category: data.category,
                },
            })
            for (const share of data.shares) {
                await tx.expenseShare.create({
                    data: {
                        id: share.id,
                        expenseId: share.expenseId,
                        memberId: share.memberId,
                        amount: share.amount.toString(),
                    },
                })
            }
        })
    }

    async findById(id: string): Promise<Expense | null> {
        const row = await prisma.expense.findFirst({
            where: { id, ...ACTIVE },
            include: { shares: true },
        })
        if (!row) return null
        return toExpense(row)
    }

    async findByGroupId(groupId: string): Promise<Expense[]> {
        const rows = await prisma.expense.findMany({
            where: { groupId, ...ACTIVE },
            include: { shares: true },
        })
        return rows.map(toExpense)
    }

    async findManyByGroup(params: FindManyByGroupParams): Promise<FindManyByGroupResult> {
        const page = params.page ?? 1
        const limit = params.limit ?? 20
        const skip = (page - 1) * limit
        const where = buildWhereClause(params)

        const [rows, total] = await Promise.all([
            prisma.expense.findMany({
                where,
                include: { shares: true },
                orderBy: { occurredAt: 'desc' },
                skip,
                take: limit,
            }),
            prisma.expense.count({ where }),
        ])

        return { expenses: rows.map(toExpense), total }
    }

    async updateWithRevision(data: Expense, previous: Expense, editedByUserId: string): Promise<boolean> {
        return prisma.$transaction(async tx => {
            // D-82: CAS. `updateMany` com a versão lida no filtro devolve count 0 quando outra
            // operação já gravou, e aí nada mais nesta transação acontece.
            const { count } = await tx.expense.updateMany({
                where: { id: data.id, version: previous.version, deletedAt: null },
                data: {
                    description: data.description,
                    amount: data.amount.toString(),
                    splitMethod: data.splitMethod,
                    category: data.category ?? null,
                    version: { increment: 1 },
                },
            })

            if (count !== 1) return false

            // D-80/D-81: snapshot completo do estado ANTERIOR, gravado na mesma transação para
            // não existir edição sem revisão correspondente.
            await tx.expenseRevision.create({
                data: {
                    expenseId: previous.id,
                    version: previous.version,
                    description: previous.description,
                    amount: previous.amount.toString(),
                    splitMethod: previous.splitMethod,
                    category: previous.category ?? null,
                    occurredAt: previous.occurredAt,
                    shares: previous.shares.map(share => ({
                        memberId: share.memberId,
                        amount: share.amount.toString(),
                    })),
                    editedBy: editedByUserId,
                },
            })

            await tx.expenseShare.deleteMany({ where: { expenseId: data.id } })
            for (const share of data.shares) {
                await tx.expenseShare.create({
                    data: {
                        id: share.id,
                        expenseId: share.expenseId,
                        memberId: share.memberId,
                        amount: share.amount.toString(),
                    },
                })
            }

            return true
        })
    }

    async updateCategory(id: string, category: ExpenseCategory, expectedDescription: string): Promise<boolean> {
        const { count } = await prisma.expense.updateMany({
            where: { id, description: expectedDescription, ...ACTIVE },
            data: { category },
        })
        return count === 1
    }

    async findRevisions(expenseId: string): Promise<ExpenseRevisionRecord[]> {
        const rows = await prisma.expenseRevision.findMany({
            where: { expenseId },
            orderBy: { version: 'desc' },
        })

        return rows.map(row => ({
            version: row.version,
            description: row.description,
            amount: new Money(row.amount.toString()),
            splitMethod: row.splitMethod as SplitMethodType,
            category: toCategory(row.category),
            occurredAt: row.occurredAt,
            // Gravado pelo próprio updateWithRevision como [{ memberId, amount }], com amount em texto.
            shares: (row.shares as Array<{ memberId: string; amount: string }>).map(share => ({
                memberId: share.memberId,
                amount: new Money(share.amount),
            })),
            editedByUserId: row.editedBy,
            editedAt: row.editedAt,
        }))
    }

    async softDelete(id: string, deletedByUserId: string): Promise<void> {
        await prisma.expense.update({
            where: { id },
            data: { deletedAt: new Date(), deletedBy: deletedByUserId },
        })
    }
}
