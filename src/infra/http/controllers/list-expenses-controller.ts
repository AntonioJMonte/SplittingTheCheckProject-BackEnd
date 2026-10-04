import Decimal from 'decimal.js'
import { FastifyRequest, FastifyReply } from 'fastify'
import type z from 'zod'
import { makeListExpensesUseCase } from '../../factories/make-list-expenses-use-case'
import { ExpenseView } from '../../../application/repositories/expense-repository'
import type { groupIdParam } from '../schemas/group.schema'
import type { listExpensesQuery } from '../schemas/expense.schema'

type ListExpensesParams = z.infer<typeof groupIdParam>
type ListExpensesQuery = z.infer<typeof listExpensesQuery>

export async function listExpenses(
    request: FastifyRequest<{ Params: ListExpensesParams; Querystring: ListExpensesQuery }>,
    reply: FastifyReply,
) {
    const { groupId } = request.params
    const query = request.query

    const view = query.view === 'all' || query.view === undefined
        ? undefined
        : query.view as ExpenseView

    const useCase = makeListExpensesUseCase()
    const { expenses, total } = await useCase.execute({
        groupId,
        requestUserId: request.user.sub,
        filters: {
            view,
            category: query.category,
            startDate: query.startDate ? new Date(query.startDate) : undefined,
            endDate: query.endDate ? new Date(query.endDate) : undefined,
            minAmount: query.minAmount !== undefined ? new Decimal(query.minAmount) : undefined,
            maxAmount: query.maxAmount !== undefined ? new Decimal(query.maxAmount) : undefined,
            page: query.page,
            limit: query.limit,
        },
    })

    return reply.status(200).send({
        expenses: expenses.map(e => ({
            id: e.id,
            groupId: e.groupId,
            payerId: e.payerId,
            description: e.description,
            amount: e.amount.toString(),
            splitMethod: e.splitMethod,
            occurredAt: e.occurredAt,
            category: e.category,
            shares: e.shares.map(s => ({
                id: s.id,
                memberId: s.memberId,
                amount: s.amount.toString(),
            })),
            version: e.version,
        })),
        total,
    })
}
