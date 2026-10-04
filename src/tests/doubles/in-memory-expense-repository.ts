import Decimal from 'decimal.js'
import {
    ExpenseRepository,
    ExpenseRevisionRecord,
    FindManyByGroupParams,
    FindManyByGroupResult,
} from '../../application/repositories/expense-repository'
import { Expense } from '../../domain/entities/expense'
import { Settlement } from '../../domain/entities/settlement'
import { Money } from '../../domain/value-objects/money'
import { SplitMethodType } from '../../domain/value-objects/split-method'
import { ExpenseCategory } from '../../domain/value-objects/expense-category'

export class InMemoryExpenseRepository implements ExpenseRepository {
    public items: Expense[] = []
    // Espelha o soft delete do Prisma (D-72): a despesa continua no array, mas some das leituras.
    public deleted: Map<string, { deletedBy: string }> = new Map()
    // D-80: snapshots do estado anterior, na ordem em que as edições aconteceram.
    public revisions: Array<Record<string, unknown>> = []
    /** userId → memberId mapping; populate in tests to enable share-based view filters */
    public memberIdByUserId: Map<string, string> = new Map()
    /** settlements used by the 'pending' view filter */
    public settlementItems: Settlement[] = []

    async create(data: Expense): Promise<void> {
        this.items.push(data)
    }

    async findById(id: string): Promise<Expense | null> {
        return this.items.find(e => e.id === id && !this.deleted.has(e.id)) ?? null
    }

    async findByGroupId(groupId: string): Promise<Expense[]> {
        return this.items.filter(e => e.groupId === groupId && !this.deleted.has(e.id))
    }

    async findManyByGroup(params: FindManyByGroupParams): Promise<FindManyByGroupResult> {
        const page = params.page ?? 1
        const limit = params.limit ?? 20
        const memberId = this.memberIdByUserId.get(params.userId)

        let results = this.items.filter(e => e.groupId === params.groupId && !this.deleted.has(e.id))

        if (params.category !== undefined) {
            results = results.filter(e => e.category === params.category)
        }

        if (params.startDate !== undefined) {
            results = results.filter(e => e.occurredAt >= params.startDate!)
        }

        if (params.endDate !== undefined) {
            results = results.filter(e => e.occurredAt <= params.endDate!)
        }

        if (params.minAmount !== undefined) {
            results = results.filter(e =>
                new Decimal(e.amount.toDecimal()).gte(params.minAmount!),
            )
        }

        if (params.maxAmount !== undefined) {
            results = results.filter(e =>
                new Decimal(e.amount.toDecimal()).lte(params.maxAmount!),
            )
        }

        if (params.view === 'paid') {
            results = results.filter(e => e.payerId === params.userId)
        } else if (params.view === 'involved' && memberId) {
            results = results.filter(e => e.shares.some(s => s.memberId === memberId))
        } else if (params.view === 'pending' && memberId) {
            const hasConfirmedSettlement = this.settlementItems.some(
                s =>
                    s.groupId === params.groupId &&
                    s.status === 'CONFIRMED' &&
                    s.fromMemberId === memberId,
            )
            results = results.filter(
                e =>
                    e.payerId !== params.userId &&
                    e.shares.some(s => s.memberId === memberId) &&
                    !hasConfirmedSettlement,
            )
        }

        results = results.sort(
            (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime(),
        )

        const total = results.length
        const expenses = results.slice((page - 1) * limit, page * limit)

        return { expenses, total }
    }

    // Espelha o CAS + revisão do Prisma (D-80/D-82): em conflito nada é gravado, nem a revisão.
    async updateWithRevision(data: Expense, previous: Expense, editedByUserId: string): Promise<boolean> {
        const index = this.items.findIndex(e => e.id === data.id && !this.deleted.has(e.id))
        if (index === -1) return false
        if (this.items[index].version !== previous.version) return false

        this.revisions.push({
            expenseId: previous.id,
            version: previous.version,
            description: previous.description,
            amount: previous.amount.toString(),
            splitMethod: previous.splitMethod,
            category: previous.category,
            occurredAt: previous.occurredAt,
            shares: previous.shares.map(share => ({
                memberId: share.memberId,
                amount: share.amount.toString(),
            })),
            editedBy: editedByUserId,
            editedAt: new Date(),
        })

        this.items[index] = new Expense(
            data.id,
            data.groupId,
            data.payerId,
            data.description,
            data.amount,
            data.shares,
            data.splitMethod,
            data.occurredAt,
            data.category,
            previous.version + 1,
        )
        return true
    }

    async updateCategory(id: string, category: ExpenseCategory, expectedDescription: string): Promise<boolean> {
        const index = this.items.findIndex(e => e.id === id && e.description === expectedDescription && !this.deleted.has(e.id))
        if (index === -1) return false

        this.items[index] = this.items[index].withCategory(category)
        return true
    }

    async findRevisions(expenseId: string): Promise<ExpenseRevisionRecord[]> {
        return this.revisions
            .filter(r => r.expenseId === expenseId)
            .sort((a, b) => (b.version as number) - (a.version as number))
            .map(r => ({
                version: r.version as number,
                description: r.description as string,
                amount: new Money(r.amount as string),
                splitMethod: r.splitMethod as SplitMethodType,
                category: r.category as ExpenseCategory | undefined,
                occurredAt: r.occurredAt as Date,
                shares: (r.shares as Array<{ memberId: string; amount: string }>).map(s => ({
                    memberId: s.memberId,
                    amount: new Money(s.amount),
                })),
                editedByUserId: r.editedBy as string,
                editedAt: r.editedAt as Date,
            }))
    }

    async softDelete(id: string, deletedByUserId: string): Promise<void> {
        if (this.items.some(e => e.id === id)) {
            this.deleted.set(id, { deletedBy: deletedByUserId })
        }
    }
}
