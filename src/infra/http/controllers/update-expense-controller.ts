import Decimal from 'decimal.js'
import { FastifyRequest, FastifyReply } from 'fastify'
import type z from 'zod'
import { makeUpdateExpenseUseCase } from '../../factories/make-update-expense-use-case'
import type { expenseIdParam, updateExpenseBody } from '../schemas/expense.schema'
import { io } from '../../websocket/io'
import { emitExpenseUpdated } from '../../websocket/handlers/expense-events'
import { invalidateGroupBalancesCache } from '../../cache/group-balances-cache'
import { dispatchExpenseCategorization } from '../services/expense-categorization-dispatcher'

type UpdateExpenseParams = z.infer<typeof expenseIdParam>
type UpdateExpenseBody = z.infer<typeof updateExpenseBody>

export async function updateExpense(
    request: FastifyRequest<{ Params: UpdateExpenseParams; Body: UpdateExpenseBody }>,
    reply: FastifyReply,
) {
    const { expenseId } = request.params
    const body = request.body

    const shares = body.shares?.map(s => ({
        memberId: s.memberId,
        amount: s.amount !== undefined
            ? String(s.amount)
            : s.percentage !== undefined && body.amount !== undefined
                ? new Decimal(body.amount).times(s.percentage).dividedBy(100).toDecimalPlaces(2).toFixed(2)
                : '0',
    }))

    const useCase = makeUpdateExpenseUseCase()
    const { expense, pendingCategorization } = await useCase.execute({
        expenseId,
        requestUserId: request.user.sub,
        version: body.version,
        description: body.description,
        amount: body.amount !== undefined ? String(body.amount) : undefined,
        splitMethod: body.splitMethod,
        shares,
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
        version: expense.version,
    }

    await invalidateGroupBalancesCache(expense.groupId)

    if (io) {
        emitExpenseUpdated(io, expense.groupId, expensePayload).catch(() => {})
    }

    if (pendingCategorization) {
        void dispatchExpenseCategorization({ expenseId: expense.id, groupId: expense.groupId, requestUserId: request.user.sub })
    }

    return reply.status(200).send({ expense: expensePayload })
}
