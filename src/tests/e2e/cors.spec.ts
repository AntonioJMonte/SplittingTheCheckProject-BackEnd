import { describe, it, expect, afterAll, vi } from 'vitest'
import { app } from '../../infra/http/app'

vi.mock('../../infra/http/services/dependency-health', () => ({
    checkDependencies: async () => ({ database: 'up' as const, redis: 'up' as const }),
}))

// CORS_ORIGIN não é definido em vitest.config.ts, então vale o default do schema.
const ALLOWED = 'http://localhost:5173'
const DENIED = 'https://evil.example.com'

describe('CORS (D-58)', () => {
    afterAll(async () => {
        await app.close()
    })

    it('responde ao preflight de uma origem da allowlist liberando método e credenciais', async () => {
        const res = await app.inject({
            method: 'OPTIONS',
            url: '/auth',
            headers: {
                origin: ALLOWED,
                'access-control-request-method': 'POST',
                'access-control-request-headers': 'content-type',
            },
        })

        expect(res.statusCode).toBe(204)
        expect(res.headers['access-control-allow-origin']).toBe(ALLOWED)
        expect(res.headers['access-control-allow-credentials']).toBe('true')
        expect(res.headers['access-control-allow-methods']).toContain('POST')
    })

    it('devolve o header de origem em uma requisição simples da allowlist', async () => {
        const res = await app.inject({ method: 'GET', url: '/health/live', headers: { origin: ALLOWED } })

        expect(res.statusCode).toBe(200)
        expect(res.headers['access-control-allow-origin']).toBe(ALLOWED)
        expect(res.headers['access-control-allow-credentials']).toBe('true')
    })

    it('não libera origem fora da allowlist — nem no preflight, nem na requisição simples', async () => {
        const preflight = await app.inject({
            method: 'OPTIONS',
            url: '/auth',
            headers: { origin: DENIED, 'access-control-request-method': 'POST' },
        })

        expect(preflight.headers['access-control-allow-origin']).toBeUndefined()

        const simple = await app.inject({ method: 'GET', url: '/health/live', headers: { origin: DENIED } })

        // Sem o header o navegador bloqueia a leitura da resposta, mesmo com status 200.
        expect(simple.statusCode).toBe(200)
        expect(simple.headers['access-control-allow-origin']).toBeUndefined()
    })

    it('não reflete a origem quando ela não é a exata da allowlist', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/health/live',
            headers: { origin: 'http://localhost:5174' },
        })

        expect(res.headers['access-control-allow-origin']).toBeUndefined()
    })
})
