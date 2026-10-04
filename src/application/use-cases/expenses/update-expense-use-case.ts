import { ExpenseRepository } from '../../repositories/expense-repository'
import { MemberRepository } from '../../repositories/member-repository'
import { GroupRepository } from '../../repositories/group-repository'
import { SettlementRepository } from '../../repositories/settlement-repository'
import { ExpenseCategorizer } from '../../services/expense-categorizer'
import { Expense } from '../../../domain/entities/expense'
import { Money } from '../../../domain/value-objects/money'
import { SplitMethodType } from '../../../domain/value-objects/split-method'
import { ExpenseCategory } from '../../../domain/value-objects/expense-category'
import { ExpenseNotFoundError } from '../../../shared/errors/expense-not-found-error'
import { ExpenseConcurrentModificationError } from '../../../shared/errors/expense-concurrent-modification-error'
import { NotGroupMemberError } from '../../../shared/errors/not-group-member-error'
import { UnauthorizedError } from '../../../shared/errors/unauthorized-error'
import { MemberNotInGroupError } from '../../../shared/errors/member-not-in-group-error'

interface ShareInput {
    memberId: string
    amount: string
}

interface UpdateExpenseUseCaseRequest {
    expenseId: string
    requestUserId: string
    /** D-92: a versão que o cliente leu. Diferente da atual = ele editou uma tela desatualizada. */
    version: number
    description?: string
    amount?: string
    splitMethod?: SplitMethodType
    shares?: ShareInput[]
    category?: ExpenseCategory
}

interface UpdateExpenseUseCaseResponse {
    expense: Expense
    pendingCategorization: boolean
}

export class UpdateExpenseUseCase {

    constructor(
        private expenseRepository: ExpenseRepository,
        private memberRepository: MemberRepository,
        private groupRepository: GroupRepository,
        private settlementRepository: SettlementRepository,
        private expenseCategorizer: ExpenseCategorizer,
    ) {}

    async execute({
        expenseId,
        requestUserId,
        version,
        description,
        amount,
        splitMethod,
        shares,
        category,
    }: UpdateExpenseUseCaseRequest): Promise<UpdateExpenseUseCaseResponse> {
        const expense = await this.expenseRepository.findById(expenseId)
        if (!expense) {
            throw new ExpenseNotFoundError()
        }

        const requestingMember = await this.memberRepository.findByUserAndGroup(requestUserId, expense.groupId)
        if (!requestingMember) {
            throw new NotGroupMemberError()
        }

        const isPayer = expense.payerId === requestUserId
        const isOwner = requestingMember.isOwner()
        if (!isPayer && !isOwner) {
            throw new UnauthorizedError()
        }

        // D-92: depois das checagens de permissão, para quem não pode editar receber 403, não 409.
        if (version !== expense.version) {
            throw new ExpenseConcurrentModificationError()
        }

        if (shares !== undefined) {
            const group = await this.groupRepository.findById(expense.groupId)
            const groupMemberIds = new Set(group!.members.map(m => m.id))
            for (const share of shares) {
                if (!groupMemberIds.has(share.memberId)) {
                    throw new MemberNotInGroupError(share.memberId)
                }
            }
        }

        let updatedExpense = expense.update({
            description,
            amount: amount !== undefined ? new Money(amount) : undefined,
            splitMethod,
            shareInputs: shares?.map(s => ({ memberId: s.memberId, amount: new Money(s.amount) })),
        })

        let pendingCategorization = false
        if (category !== undefined) {
            updatedExpense = updatedExpense.withCategory(category)
        } else if (updatedExpense.description !== expense.description) {
            const quickCategory = await this.expenseCategorizer.tryQuickCategorize(updatedExpense.description)
            updatedExpense = updatedExpense.withCategory(quickCategory ?? undefined)
            pendingCategorization = quickCategory === null
        }

        // D-82/D-80: a gravação só vale se a versão lida ainda for a atual, e leva junto o
        // snapshot do estado anterior. Em conflito nada é escrito — nem a revisão.
        const written = await this.expenseRepository.updateWithRevision(updatedExpense, expense, requestUserId)
        if (!written) {
            throw new ExpenseConcurrentModificationError()
        }

        await this.settlementRepository.cancelPendingByGroupId(expense.groupId)

        return { expense: updatedExpense.withVersion(expense.version + 1), pendingCategorization }
    }
}
