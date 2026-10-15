import { FastifyRequest, FastifyReply } from 'fastify'

// Liveness não olha dependências: reiniciar o contêiner não conserta Postgres nem Redis fora do ar.
export async function healthLive(_request: FastifyRequest, reply: FastifyReply) {
    return reply.status(200).send({ status: 'ok' })
}
