import { describe, it, expect, afterEach, vi } from 'vitest'

vi.mock('../../infra/http/services/dependency-health', () => ({
    checkDependencies: async () => ({ database: 'up' as const, redis: 'up' as const }),
}))

// O app lê TRUST_PROXY_HOPS ao ser importado; cada teste sobe uma instância nova com o valor que quer.
// O rate limit chaveia por request.ip, então o IP resolvido aqui é o que ele conta.
let closeCurrent: (() => Promise<unknown>) | undefined

async function clientIp(hops: string, forwardedFor?: string): Promise<string> {
    vi.resetModules()
    process.env.TRUST_PROXY_HOPS = hops
    const { app } = await import('../../infra/http/app')
    app.get('/__client-ip', async request => ({ ip: request.ip }))
    await app.ready()
    closeCurrent = () => app.close()

    const res = await app.inject({
        method: 'GET',
        url: '/__client-ip',
        remoteAddress: '10.0.0.1',
        headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
    })
    return res.json().ip
}

afterEach(async () => {
    await closeCurrent?.()
    closeCurrent = undefined
    delete process.env.TRUST_PROXY_HOPS
})

describe('IP do cliente atrás do ingress da plataforma (D-108)', () => {
    it('com 0 saltos, usa o endereço da conexão e ignora o X-Forwarded-For', async () => {
        expect(await clientIp('0', '203.0.113.7')).toBe('10.0.0.1')
    })

    it('com 1 salto, usa o IP mais à direita, que o ingress acrescentou', async () => {
        expect(await clientIp('1', '203.0.113.7')).toBe('203.0.113.7')
    })

    it('com 1 salto, ignora o IP que o próprio cliente forjou à esquerda', async () => {
        expect(await clientIp('1', '198.51.100.99, 203.0.113.7')).toBe('203.0.113.7')
    })

    it('com 1 salto e sem X-Forwarded-For, fica com o endereço da conexão', async () => {
        expect(await clientIp('1')).toBe('10.0.0.1')
    })

    it('com 2 saltos, pula também o proxy intermediário', async () => {
        expect(await clientIp('2', '203.0.113.7, 192.0.2.10')).toBe('203.0.113.7')
    })
})
