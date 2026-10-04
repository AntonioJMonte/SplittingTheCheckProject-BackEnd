import { FastifyRequest, FastifyReply } from 'fastify'
import type z from 'zod'
import type { groupIdParam } from '../schemas/group.schema'
import type { listSettlementsQuery } from '../schemas/settlement.schema'
import { makeListSettlementsUseCase } from '../../factories/make-list-settlements-use-case'

type ListSettlementsParams = z.infer<typeof groupIdParam>
type ListSettlementsQuery = z.infer<typeof listSettlementsQuery>

export async function listSettlements(
    request: FastifyRequest<{ Params: ListSettlementsParams; Querystring: ListSettlementsQuery }>,
    reply: FastifyReply,
) {
    const useCase = makeListSettlementsUseCase()
    const { settlements } = await useCase.execute({
        groupId: request.params.groupId,
        requestUserId: request.user.sub,
        status: request.query.status,
    })

    return reply.status(200).send({
        settlements: settlements.map(s => ({
            id: s.id,
            fromMemberId: s.fromMemberId,
            toMemberId: s.toMemberId,
            amount: s.amount.toString(),
            status: s.status,
            pixCopyPaste: s.pixCopyPaste ?? null,
            createdAt: s.createdAt,
            confirmedAt: s.confirmedAt ?? null,
        })),
    })
}
