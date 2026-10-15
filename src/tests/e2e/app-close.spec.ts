import { describe, it, expect, vi, beforeEach } from 'vitest'

const deps = vi.hoisted(() => ({
    disconnectPrisma: vi.fn(async () => {}),
    closeCache: vi.fn(async () => {}),
}))

vi.mock('../../infra/database/prisma/prismaClient', () => ({ prisma: { $disconnect: deps.disconnectPrisma } }))
vi.mock('../../infra/redis/redis-client', () => ({
    getRedisClient: vi.fn(),
    createRedisClient: vi.fn(),
    closeRedisClient: deps.closeCache,
}))

// Fechar é definitivo: cada teste sobe uma instância nova do app.
async function freshApp() {
    vi.resetModules()
    const { app } = await import('../../infra/http/app')
    await app.ready()
    return app
}

describe('Fechamento das dependências do app', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('desconecta o Prisma e fecha o client Redis de cache quando o app fecha', async () => {
        const app = await freshApp()

        await app.close()

        expect(deps.disconnectPrisma).toHaveBeenCalledOnce()
        expect(deps.closeCache).toHaveBeenCalledOnce()
    })

    it('fecha o cache mesmo se o Prisma falhar, sem quebrar o fechamento', async () => {
        deps.disconnectPrisma.mockRejectedValueOnce(new Error('conexão perdida'))
        const app = await freshApp()

        await expect(app.close()).resolves.toBeUndefined()
        expect(deps.closeCache).toHaveBeenCalledOnce()
    })
})
