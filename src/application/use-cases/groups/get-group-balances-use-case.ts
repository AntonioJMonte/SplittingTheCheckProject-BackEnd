import Decimal from 'decimal.js'
import { GroupRepository } from '../../repositories/group-repository'
import { MemberRepository } from '../../repositories/member-repository'
import { ExpenseRepository } from '../../repositories/expense-repository'
import { SettlementRepository } from '../../repositories/settlement-repository'
import { DebtMinimizer, TransferSuggestion } from '../../../domain/services/debt-minimizer'
import { AppError } from '../../../shared/errors/app-error'
import { GroupNotFoundError } from '../../../shared/errors/group-not-found-error'

interface GetGroupBalancesUseCaseRequest {
    groupId: string
    requestingUserId: string
}

interface MemberBalanceResult {
    memberId: string
    userId: string
    balance: Decimal
}

interface GetGroupBalancesUseCaseResponse {
    memberBalances: MemberBalanceResult[]
    transfers: TransferSuggestion[]
}

export class GetGroupBalancesUseCase {

    constructor(
        private groupRepository: GroupRepository,
        private memberRepository: MemberRepository,
        private expenseRepository: ExpenseRepository,
        private settlementRepository: SettlementRepository,
    ) {}

    async execute({ groupId, requestingUserId }: GetGroupBalancesUseCaseRequest): Promise<GetGroupBalancesUseCaseResponse> {
        const group = await this.groupRepository.findById(groupId)
        if (!group) {
            throw new GroupNotFoundError()
        }

        const requestingMember = await this.memberRepository.findByUserAndGroup(requestingUserId, groupId)
        if (!requestingMember) {
            throw new AppError('Você não é membro deste grupo', 403)
        }

        const [members, expenses, confirmedSettlements] = await Promise.all([
            this.memberRepository.findByGroupId(groupId),
            this.expenseRepository.findByGroupId(groupId),
            this.settlementRepository.findConfirmedByGroup(groupId),
        ])

        const balanceMap = new Map<string, Decimal>()
        for (const member of members) {
            balanceMap.set(member.id, new Decimal(0))
        }

        for (const expense of expenses) {
            const payerMember = members.find(m => m.userId === expense.payerId)
            if (payerMember) {
                const current = balanceMap.get(payerMember.id) ?? new Decimal(0)
                balanceMap.set(payerMember.id, current.plus(expense.amount.toDecimal()))
            }

            for (const share of expense.shares) {
                const current = balanceMap.get(share.memberId) ?? new Decimal(0)
                balanceMap.set(share.memberId, current.minus(share.amount.toDecimal()))
            }
        }

        // D-99: mesma regra de ComputeSettlements e ConfirmSettlement. Quem pagou o acerto deve menos; quem recebeu
        // tem menos a receber. Acerto pendente não conta até o credor confirmar.
        for (const settlement of confirmedSettlements) {
            const amount = settlement.amount.toDecimal()
            balanceMap.set(settlement.fromMemberId, (balanceMap.get(settlement.fromMemberId) ?? new Decimal(0)).plus(amount))
            balanceMap.set(settlement.toMemberId, (balanceMap.get(settlement.toMemberId) ?? new Decimal(0)).minus(amount))
        }

        const memberBalances: MemberBalanceResult[] = members.map(m => ({
            memberId: m.id,
            userId: m.userId,
            balance: balanceMap.get(m.id) ?? new Decimal(0),
        }))

        const transfers = DebtMinimizer.minimize(
            memberBalances.map(mb => ({ memberId: mb.memberId, balance: mb.balance })),
        )

        return { memberBalances, transfers }
    }
}
