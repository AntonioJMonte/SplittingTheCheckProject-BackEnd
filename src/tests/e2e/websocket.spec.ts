import { request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import fastify from 'fastify'
import { sign } from 'jsonwebtoken'
import { io as connect, Socket as ClientSocket } from 'socket.io-client'
import type { Server as SocketServer } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import { createSocketServer } from '../../infra/websocket/socket-server'
import { io as globalIo } from '../../infra/websocket/io'
import { env } from '../../infra/env'
import { logger } from '../../infra/logger/logger'
import { closeRedisConnection } from '../../infra/redis/redis-client'

const redisClients = vi.hoisted(() => [] as object[])
const memberships = vi.hoisted(() => new Set<string>())

vi.mock('../../infra/redis/redis-client', () => ({
    createRedisClient: () => {
        const client = { name: `redis-${redisClients.length}` }
        redisClients.push(client)
        return client
    },
    closeRedisConnection: vi.fn(async () => {}),
}))

// O adapter Redis vira o adapter em memória que o próprio socket.io usa por padrão: as rooms
// funcionam igual dentro de um processo, e a suíte não depende de Redis rodando.
vi.mock('@socket.io/redis-adapter', async () => {
    const { Adapter } = await import('socket.io-adapter')
    return { createAdapter: vi.fn(() => Adapter) }
})

vi.mock('../../infra/database/prisma/prismaMemberRepository', () => ({
    PrismaMemberRepository: class {
        async findByUserAndGroup(userId: string, groupId: string) {
            return memberships.has(`${userId}:${groupId}`) ? { id: 'member-1', userId, groupId } : null
        }
    },
}))

const MEMBER_ID = 'user-member'
const OUTSIDER_ID = 'user-outsider'
const GROUP_ID = 'group-1'

// Mesmo logger do app real: o createSocketServer recebe a instância Fastify para registrar os hooks de fechamento.
const createApp = () => fastify({ loggerInstance: logger })

let app: ReturnType<typeof createApp>
let appClosed = false
let ioServer: SocketServer
let url: string
const clients: ClientSocket[] = []

function tokenFor(userId: string, secret = env.JWT_SECRET) {
    return sign({ sub: userId }, secret, { expiresIn: '1m' })
}

function connectWith(auth: Record<string, unknown>) {
    const client = connect(url, { auth, transports: ['websocket'], reconnection: false, forceNew: true })
    clients.push(client)
    return client
}

function next<T>(client: ClientSocket, event: string): Promise<T> {
    return new Promise(resolve => client.once(event, resolve))
}

async function joinedAs(userId: string) {
    const client = connectWith({ token: tokenFor(userId) })
    await next(client, 'connect')
    return client
}

beforeAll(async () => {
    memberships.add(`${MEMBER_ID}:${GROUP_ID}`)
    app = createApp()
    ioServer = createSocketServer(app)
    await app.listen({ port: 0, host: '127.0.0.1' })
    url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
})

afterEach(() => {
    for (const client of clients.splice(0)) client.disconnect()
})

afterAll(async () => {
    if (!appClosed) await app.close()
})

describe('Handshake autenticado', () => {
    it('recusa conexão sem token', async () => {
        const error = await next<Error>(connectWith({}), 'connect_error')

        expect(error.message).toBe('UNAUTHORIZED')
    })

    it('recusa token assinado com outro segredo', async () => {
        const forged = tokenFor(MEMBER_ID, 'outro-segredo-com-pelo-menos-32-caracteres!!')

        const error = await next<Error>(connectWith({ token: forged }), 'connect_error')

        expect(error.message).toBe('UNAUTHORIZED')
    })

    it('distingue token expirado, para o cliente saber que deve renovar', async () => {
        const expired = sign({ sub: MEMBER_ID, exp: Math.floor(Date.now() / 1000) - 10 }, env.JWT_SECRET)

        const error = await next<Error>(connectWith({ token: expired }), 'connect_error')

        expect(error.message).toBe('TOKEN_EXPIRED')
    })
})

describe('join_group', () => {
    it('responde INVALID_INPUT quando o groupId não é um texto', async () => {
        const client = await joinedAs(MEMBER_ID)

        client.emit('join_group', 123)

        expect(await next(client, 'error')).toEqual({ code: 'INVALID_INPUT', message: 'groupId inválido.' })
    })

    it('nega FORBIDDEN a quem não é membro e não o coloca na room', async () => {
        const client = await joinedAs(OUTSIDER_ID)

        client.emit('join_group', GROUP_ID)

        expect(await next(client, 'error')).toMatchObject({ code: 'FORBIDDEN' })
        expect(await ioServer.in(GROUP_ID).fetchSockets()).toHaveLength(0)
    })

    it('coloca o membro na room, que passa a receber os eventos do grupo — e só ele', async () => {
        const member = await joinedAs(MEMBER_ID)
        const outsider = await joinedAs(OUTSIDER_ID)
        const leaked: unknown[] = []
        outsider.on('expense_created', payload => leaked.push(payload))

        member.emit('join_group', GROUP_ID)
        expect(await next(member, 'joined_group')).toEqual({ groupId: GROUP_ID })

        const received = next(member, 'expense_created')
        ioServer.to(GROUP_ID).emit('expense_created', { expenseId: 'e-1' })

        expect(await received).toEqual({ expenseId: 'e-1' })
        expect(leaked).toEqual([])
    })
})

describe('Montagem do servidor', () => {
    it('liga o adapter Redis com clientes separados de publicação e assinatura', () => {
        expect(redisClients).toHaveLength(2)
        expect(createAdapter).toHaveBeenCalledWith(redisClients[0], redisClients[1])
    })

    it('publica a instância para os handlers de evento emitirem fora do HTTP', () => {
        expect(globalIo).toBe(ioServer)
    })

    // D-60: mesma allowlist do HTTP. A checagem de origem acontece no handshake de transporte.
    it.each([
        { origin: env.CORS_ORIGIN[0], allowed: true },
        { origin: 'http://site-malicioso.example', allowed: false },
    ])('libera CORS só para origens da allowlist ($origin)', async ({ origin, allowed }) => {
        const header = await new Promise<string | undefined>((resolve, reject) => {
            request(`${url}/socket.io/?EIO=4&transport=polling`, { headers: { Origin: origin } }, res => {
                res.resume()
                resolve(res.headers['access-control-allow-origin'] as string | undefined)
            }).on('error', reject).end()
        })

        expect(header).toBe(allowed ? origin : undefined)
    })
})

// Por último: fecha o app de verdade.
describe('Encerramento pelos hooks do Fastify', () => {
    it('desconecta os sockets locais no app.close() e depois fecha os clients de pub e sub', async () => {
        const client = await joinedAs(MEMBER_ID)
        const reason = next<string>(client, 'disconnect')

        await app.close()
        appClosed = true

        expect(await reason).toBe('io server disconnect')
        expect(closeRedisConnection).toHaveBeenCalledWith(redisClients[0])
        expect(closeRedisConnection).toHaveBeenCalledWith(redisClients[1])
    })
})
