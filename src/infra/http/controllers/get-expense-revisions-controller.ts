import { FastifyRequest, FastifyReply } from 'fastify'
import type z from 'zod'
import type { expenseIdParam } from '../schemas/expense.schema'
import { makeGetExpenseRevisionsUseCase } from '../../factories/make-get-expense-revisions-use-case'

type GetExpenseRevisionsParams = z.infer<typeof expenseIdParam>

export async function getExpenseRevisions(request: FastifyRequest<{ Params: GetExpenseRevisionsParams }>, reply: FastifyReply) {
    const useCase = makeGetExpenseRevisionsUseCase()
    const { revisions } = await useCase.execute({
        expenseId: request.params.expenseId,
        requestUserId: request.user.sub,
    })

    return reply.status(200).send({
        revisions: revisions.map(r => ({
            version: r.version,
            description: r.description,
            amount: r.amount.toString(),
            splitMethod: r.splitMethod,
            category: r.category,
            occurredAt: r.occurredAt,
            shares: r.shares.map(s => ({ memberId: s.memberId, amount: s.amount.toString() })),
            editedBy: { userId: r.editedByUserId, name: r.editorName },
            editedAt: r.editedAt,
        })),
    })
}
