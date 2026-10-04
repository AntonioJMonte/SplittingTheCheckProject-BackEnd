import Decimal from 'decimal.js'
import { Expense } from '../../domain/entities/expense'
import { Money } from '../../domain/value-objects/money'
import { SplitMethodType } from '../../domain/value-objects/split-method'
import { ExpenseCategory } from '../../domain/value-objects/expense-category'

export type ExpenseView = 'involved' | 'paid' | 'pending'

export interface FindManyByGroupParams {
    groupId: string
    userId: string
    category?: ExpenseCategory
    startDate?: Date
    endDate?: Date
    minAmount?: Decimal
    maxAmount?: Decimal
    view?: ExpenseView
    page?: number
    limit?: number
}

export interface FindManyByGroupResult {
    expenses: Expense[]
    total: number
}

/** D-93: o estado da despesa ANTES de uma edição, como o D-80 gravou. */
export interface ExpenseRevisionRecord {
    version: number
    description: string
    amount: Money
    splitMethod: SplitMethodType
    category?: ExpenseCategory
    occurredAt: Date
    shares: Array<{ memberId: string; amount: Money }>
    editedByUserId: string
    editedAt: Date
}

export interface ExpenseRepository {
    create(data: Expense): Promise<void>
    findById(id: string): Promise<Expense | null>
    findByGroupId(groupId: string): Promise<Expense[]>
    findManyByGroup(params: FindManyByGroupParams): Promise<FindManyByGroupResult>
    /**
     * D-82: grava só quando a versão armazenada ainda é a que `data.version` carrega, e
     * incrementa. Resolve para false em conflito. D-80: na mesma transação, guarda o estado
     * anterior como revisão, para a edição não sumir do histórico.
     */
    updateWithRevision(data: Expense, previous: Expense, editedByUserId: string): Promise<boolean>
    /** Writes only when the stored description still equals `expectedDescription`; resolves to whether it wrote. */
    updateCategory(id: string, category: ExpenseCategory, expectedDescription: string): Promise<boolean>
    /** D-93: revisões da despesa, da mais recente para a mais antiga. */
    findRevisions(expenseId: string): Promise<ExpenseRevisionRecord[]>
    /** D-72: exclusão lógica — a despesa some das leituras mas permanece, com quem a removeu. */
    softDelete(id: string, deletedByUserId: string): Promise<void>
}
