import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest'
import { app } from '../../infra/http/app'

const health = vi.hoisted(() => ({
    checks: { database: 'up', redis: 'up' } as { database: 'up' | 'down'; redis: 'up' | 'down' },
    checkDependencies: vi.fn(),
}))

vi.mock('../../infra/http/services/dependency-health', () => ({
    checkDependencies: health.checkDependencies,
}))

describe('Health e2e', () => {
    beforeEach(() => {
        health.checks = { database: 'up', redis: 'up' }
        health.checkDependencies.mockReset()
        health.checkDependencies.mockImplementation(async () => health.checks)
    })

    afterAll(async () => {
        await app.close()
    })

    describe('GET /health/live (liveness)', () => {
        it('→ 200 sem autenticação e sem consultar Postgres nem Redis', async () => {
            health.checks = { database: 'down', redis: 'down' }

            const res = await app.inject({ method: 'GET', url: '/health/live' })

            expect(res.statusCode).toBe(200)
            expect(res.json()).toEqual({ status: 'ok' })
            expect(health.checkDependencies).not.toHaveBeenCalled()
        })
    })

    describe('GET /health/ready (readiness e startup)', () => {
        it('→ 200 sem autenticação quando Postgres e Redis estão no ar', async () => {
            const res = await app.inject({ method: 'GET', url: '/health/ready' })

            expect(res.statusCode).toBe(200)
            expect(res.json()).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } })
        })

        it.each([
            ['database', { database: 'down', redis: 'up' }],
            ['redis', { database: 'up', redis: 'down' }],
        ] as const)('→ 503 quando %s está fora', async (_label, checks) => {
            health.checks = { ...checks }

            const res = await app.inject({ method: 'GET', url: '/health/ready' })

            expect(res.statusCode).toBe(503)
            expect(res.json()).toEqual({ status: 'degraded', checks })
        })
    })

    it('a rota antiga /health deixa de existir', async () => {
        const res = await app.inject({ method: 'GET', url: '/health' })

        expect(res.statusCode).toBe(404)
    })
})
