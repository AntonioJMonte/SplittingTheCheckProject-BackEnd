import { describe, it, expect, afterAll, vi } from 'vitest'
import { app } from '../../infra/http/app'

vi.mock('../../infra/http/services/dependency-health', () => ({
    checkDependencies: async () => ({ database: 'up' as const, redis: 'up' as const }),
}))

// Um único afterAll no arquivo: fechar o app dentro de um describe derrubaria os seguintes.
afterAll(async () => {
    await app.close()
})

describe('Headers de segurança (D-66)', () => {
    it('envia os headers do helmet em uma resposta comum', async () => {
        const res = await app.inject({ method: 'GET', url: '/health/live' })

        expect(res.statusCode).toBe(200)
        expect(res.headers['x-content-type-options']).toBe('nosniff')
        expect(res.headers['x-frame-options']).toBe('SAMEORIGIN')
        expect(res.headers['strict-transport-security']).toContain('max-age=')
        expect(res.headers['x-dns-prefetch-control']).toBe('off')
    })

    it('define um CSP que proíbe enquadrar a API e carregar plugins', async () => {
        const res = await app.inject({ method: 'GET', url: '/health/live' })
        const csp = res.headers['content-security-policy'] as string

        expect(csp).toContain("default-src 'self'")
        expect(csp).toContain("frame-ancestors 'none'")
        expect(csp).toContain("object-src 'none'")
    })

    it('mantém os headers em uma resposta de erro', async () => {
        const res = await app.inject({ method: 'GET', url: '/groups' })

        expect(res.statusCode).toBe(401)
        expect(res.headers['x-content-type-options']).toBe('nosniff')
    })
})

describe('Swagger fora de produção (D-70)', () => {
    it('serve /docs e /docs/json quando NODE_ENV não é production', async () => {
        const ui = await app.inject({ method: 'GET', url: '/docs' })
        const json = await app.inject({ method: 'GET', url: '/docs/json' })

        // NODE_ENV é 'test' aqui; a ausência em produção é coberta em swagger-production.spec.ts.
        expect([200, 302]).toContain(ui.statusCode)
        expect(json.statusCode).toBe(200)
        expect(json.json().openapi).toBe('3.0.3')
    })
})
