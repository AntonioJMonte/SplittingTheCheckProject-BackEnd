import { FastifyRequest, FastifyReply } from 'fastify'
import type z from 'zod'
import { makeLeaveGroupUseCase } from '../../factories/make-leave-group-use-case'
import type { groupIdParam } from '../schemas/group.schema'
import { invalidateGroupBalancesCache } from '../../cache/group-balances-cache'

type LeaveGroupParams = z.infer<typeof groupIdParam>

export async function leaveGroup(request: FastifyRequest<{ Params: LeaveGroupParams }>, reply: FastifyReply) {
    const { groupId } = request.params

    const useCase = makeLeaveGroupUseCase()
    await useCase.execute({ groupId, requestingUserId: request.user.sub })
    await invalidateGroupBalancesCache(groupId)

    return reply.status(204).send()
}
