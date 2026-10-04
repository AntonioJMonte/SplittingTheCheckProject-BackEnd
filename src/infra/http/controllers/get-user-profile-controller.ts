import { FastifyRequest, FastifyReply } from 'fastify'
import { makeGetUserProfileUseCase } from '../../factories/make-get-user-profile-use-case'

export async function getUserProfile(request: FastifyRequest, reply: FastifyReply) {
    const useCase = makeGetUserProfileUseCase()
    const { user } = await useCase.execute({ userId: request.user.sub })

    // Lista explícita: o passwordHash nunca pode escapar por um spread da entidade.
    return reply.status(200).send({
        user: {
            id: user.id,
            name: user.name,
            email: user.email.value,
            phone: user.phone?.value ?? null,
            pixKey: user.pixKey ?? null,
        },
    })
}
