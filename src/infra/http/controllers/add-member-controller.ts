import { FastifyRequest, FastifyReply } from 'fastify'
import type z from 'zod'
import { makeAddMemberUseCase } from '../../factories/make-add-member-use-case'
import type { groupIdParam } from '../schemas/group.schema'
import type { addMemberBody } from '../schemas/member.schema'
import { invalidateGroupBalancesCache } from '../../cache/group-balances-cache'
import { io } from '../../websocket/io'
import { emitMemberAdded } from '../../websocket/handlers/member-events'

type AddMemberParams = z.infer<typeof groupIdParam>
type AddMemberBody = z.infer<typeof addMemberBody>

export async function addMember(
    request: FastifyRequest<{ Params: AddMemberParams; Body: AddMemberBody }>,
    reply: FastifyReply,
) {
    const { groupId } = request.params

    const useCase = makeAddMemberUseCase()
    const { newMember } = await useCase.execute({
        groupId,
        requestedByUserId: request.user.sub,
        invitee: request.body,
    })

    const memberPayload = {
        id: newMember.id,
        userId: newMember.userId,
        groupId: newMember.groupId,
        role: newMember.role,
        joinedAt: newMember.joinedAt,
    }
    await invalidateGroupBalancesCache(groupId)

    if (io) {
        emitMemberAdded(io, groupId, memberPayload).catch(() => {})
    }

    return reply.status(201).send({ member: memberPayload })
}
