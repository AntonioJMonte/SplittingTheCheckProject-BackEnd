import { FastifyRequest, FastifyReply } from 'fastify'
import type z from 'zod'
import { makeGetGroupUseCase } from '../../factories/make-get-group-use-case'
import type { groupIdParam } from '../schemas/group.schema'

type GetGroupParams = z.infer<typeof groupIdParam>

export async function getGroup(request: FastifyRequest<{ Params: GetGroupParams }>, reply: FastifyReply) {
    const { groupId } = request.params

    const useCase = makeGetGroupUseCase()
    const { group, members } = await useCase.execute({
        groupId,
        requestingUserId: request.user.sub,
    })

    return reply.status(200).send({
        group: {
            id: group.id,
            name: group.name,
            currency: group.currency,
            description: group.description,
            members: members.map(member => ({
                id: member.id,
                userId: member.userId,
                role: member.role,
                joinedAt: member.joinedAt,
                name: member.name,
                email: member.email,
            })),
        },
    })
}
