import type { IncomingMessage, ServerResponse } from 'node:http'
import type { FastifyInstance, RawServerDefault } from 'fastify'
import type { Logger } from 'pino'
import { Server as SocketServer } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import { PrismaMemberRepository } from '../database/prisma/prismaMemberRepository'
import { env } from '../env'
import { closeRedisConnection, createRedisClient } from '../redis/redis-client'
import { wsAuthMiddleware } from './auth-middleware'
import { setIo } from './io'

type HttpApp = FastifyInstance<RawServerDefault, IncomingMessage, ServerResponse, Logger>

// Quem cria, fecha: o servidor de sockets e os clients de pub/sub nascem aqui e se fecham pelos hooks do app.
// Precisa ser chamado antes do app.ready(), que é quando o Fastify para de aceitar hooks.
export function createSocketServer(app: HttpApp): SocketServer {
    const ioServer = new SocketServer(app.server, {
        // D-60: mesma allowlist do HTTP. Sem `credentials` porque o handshake autentica
        // pelo token em `socket.handshake.auth`, nunca por cookie.
        cors: { origin: env.CORS_ORIGIN },
    })

    const pubClient = createRedisClient()
    const subClient = createRedisClient()
    ioServer.adapter(createAdapter(pubClient, subClient))

    ioServer.use(wsAuthMiddleware)

    ioServer.on('connection', (socket) => {
        socket.on('join_group', async (groupId: unknown) => {
            if (typeof groupId !== 'string' || !groupId) {
                socket.emit('error', { code: 'INVALID_INPUT', message: 'groupId inválido.' })
                return
            }

            const memberRepo = new PrismaMemberRepository()
            const member = await memberRepo.findByUserAndGroup(socket.data.userId, groupId)

            if (!member) {
                socket.emit('error', { code: 'FORBIDDEN', message: 'Você não é membro deste grupo.' })
                return
            }

            socket.join(groupId)
            socket.emit('joined_group', { groupId })
        })
    })

    // Antes do server.close(): uma conexão WebSocket aberta impediria o servidor HTTP de terminar de fechar.
    // `local` de propósito: com o adapter Redis, disconnectSockets sem ele derrubaria os sockets de todas as
    // instâncias.
    app.addHook('preClose', async () => {
        ioServer.local.disconnectSockets(true)
        app.log.info('Encerramento: sockets locais desconectados')
    })

    app.addHook('onClose', async () => {
        await Promise.allSettled([closeRedisConnection(pubClient), closeRedisConnection(subClient)])
        app.log.info('Encerramento: clients Redis de pub/sub fechados')
    })

    setIo(ioServer)
    return ioServer
}
