import { FastifyRequest, FastifyReply } from 'fastify'
import type z from 'zod'
import { makeRemoveMemberUseCase } from '../../factories/make-remove-member-use-case'
import type { memberIdParam } from '../schemas/member.schema'
import type { groupIdParam } from '../schemas/group.schema'
import { invalidateGroupBalancesCache } from '../../cache/group-balances-cache'
import { io } from '../../websocket/io'
import { emitMemberRemoved } from '../../websocket/handlers/member-events'

type RemoveMemberParams = z.infer<typeof groupIdParam> & z.infer<typeof memberIdParam>

export async function removeMember(request: FastifyRequest<{ Params: RemoveMemberParams }>, reply: FastifyReply) {
    const { groupId, memberId } = request.params

    const useCase = makeRemoveMemberUseCase()
    await useCase.execute({
        groupId,
        requestedByUserId: request.user.sub,
        targetMemberId: memberId,
    })
    await invalidateGroupBalancesCache(groupId)

    if (io) {
        emitMemberRemoved(io, groupId, memberId).catch(() => {})
    }

    return reply.status(204).send()
}
