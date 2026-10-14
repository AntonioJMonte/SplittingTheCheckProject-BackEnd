import { FastifyRequest, FastifyReply } from 'fastify'
import type z from 'zod'
import type { settlementIdParam } from '../schemas/settlement.schema'
import { makeAcknowledgeSettlementUseCase } from '../../factories/make-acknowledge-settlement-use-case'
import { invalidateGroupBalancesCache } from '../../cache/group-balances-cache'
import { io } from '../../websocket/io'
import { emitSettlementConfirmed } from '../../websocket/handlers/settlement-events'

type AcknowledgeSettlementParams = z.infer<typeof settlementIdParam>

export async function acknowledgeSettlement(request: FastifyRequest<{ Params: AcknowledgeSettlementParams }>, reply: FastifyReply) {
    const { settlementId } = request.params

    const useCase = makeAcknowledgeSettlementUseCase()
    const { settlement } = await useCase.execute({
        settlementId,
        requestUserId: request.user.sub,
    })
    await invalidateGroupBalancesCache(settlement.groupId)

    if (io) {
        emitSettlementConfirmed(io, settlement.groupId, {
            id: settlement.id,
            fromMemberId: settlement.fromMemberId,
            toMemberId: settlement.toMemberId,
            amount: settlement.amount.toFixed(2),
            status: settlement.status,
        }).catch(() => {})
    }

    return reply.status(200).send({
        settlement: {
            id: settlement.id,
            fromMemberId: settlement.fromMemberId,
            toMemberId: settlement.toMemberId,
            amount: settlement.amount.toFixed(2),
            status: settlement.status,
            confirmedAt: settlement.confirmedAt,
        },
    })
}
