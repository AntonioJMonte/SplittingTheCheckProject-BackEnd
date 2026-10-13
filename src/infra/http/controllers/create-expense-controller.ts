import { FastifyRequest, FastifyReply } from 'fastify'
import type z from 'zod'
import { SplitCalculator } from '../../../domain/services/split-calculator'
import { Money } from '../../../domain/value-objects/money'
import type { SplitMethodType } from '../../../domain/value-objects/split-method'
import { makeCreateExpenseUseCase } from '../../factories/make-create-expense-use-case'
import type { groupIdParam } from '../schemas/group.schema'
import type { createExpenseBody } from '../schemas/expense.schema'
import { io } from '../../websocket/io'
import { emitExpenseCreated } from '../../websocket/handlers/expense-events'
import { invalidateGroupBalancesCache } from '../../cache/group-balances-cache'
import { dispatchExpenseCategorization } from '../services/expense-categorization-dispatcher'

type CreateExpenseParams = z.infer<typeof groupIdParam>
type CreateExpenseBody = z.infer<typeof createExpenseBody>

// A divisão em si é regra de domínio e vive no SplitCalculator, que distribui o resto em centavos
// para a soma das partes bater com o total. Aqui só traduzimos o payload HTTP para a chamada.
function resolveShareAmounts(
    shares: Array<{ memberId: string; amount?: number | string; percentage?: number }>,
    total: number | string,
    splitMethod: SplitMethodType,
): Array<{ memberId: string; amount: string }> {
    const totalMoney = new Money(String(total))

    if (splitMethod === 'PERCENTAGE') {
        return SplitCalculator
            .byPercentage(totalMoney, shares.map(s => ({ memberId: s.memberId, percentage: s.percentage ?? 0 })))
            .map(s => ({ memberId: s.memberId, amount: s.amount.toString() }))
    }

    if (splitMethod === 'EQUAL') {
        return SplitCalculator
            .equally(totalMoney, shares.map(s => s.memberId))
            .map(s => ({ memberId: s.memberId, amount: s.amount.toString() }))
    }

    // FIXED: o cliente define cada parte; a entidade Expense rejeita se a soma não fechar.
    return shares.map(s => ({ memberId: s.memberId, amount: String(s.amount ?? 0) }))
}

export async function createExpense(
    request: FastifyRequest<{ Params: CreateExpenseParams; Body: CreateExpenseBody }>,
    reply: FastifyReply,
) {
    const { groupId } = request.params
    const body = request.body

    const shareInputs = resolveShareAmounts(body.shares, body.amount, body.splitMethod)

    const useCase = makeCreateExpenseUseCase()
    const { expense, pendingCategorization } = await useCase.execute({
        groupId,
        payerUserId: body.payerId,
        description: body.description,
        amount: String(body.amount),
        shareInputs,
        splitMethod: body.splitMethod,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
        category: body.category,
    })

    const expensePayload = {
        id: expense.id,
        groupId: expense.groupId,
        payerId: expense.payerId,
        description: expense.description,
        amount: expense.amount.toString(),
        splitMethod: expense.splitMethod,
        occurredAt: expense.occurredAt,
        category: expense.category,
        shares: expense.shares.map(s => ({
            id: s.id,
            memberId: s.memberId,
            amount: s.amount.toString(),
        })),
    }

    await invalidateGroupBalancesCache(groupId)

    if (io) {
        emitExpenseCreated(io, groupId, expensePayload).catch(() => {})
    }

    if (pendingCategorization) {
        void dispatchExpenseCategorization({ expenseId: expense.id, groupId, requestUserId: request.user.sub })
    }

    return reply.status(201).send({ expense: expensePayload })
}
