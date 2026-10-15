import { describe, it, expect, afterEach, vi } from 'vitest'

// O env é mockado em vez de reimportado com NODE_ENV trocado: recarregar o módulo real puxa
// `dotenv/config` de novo, e o banner que o dotenv escreve no console escapa do ciclo do teste.
async function loadOptions(nodeEnv: string) {
    vi.resetModules()
    vi.doMock('../../../../infra/env', () => ({ env: { NODE_ENV: nodeEnv } }))
    const { refreshTokenCookieOptions } = await import('../../../../infra/http/refresh-token-cookie')
    return refreshTokenCookieOptions
}

describe('refreshTokenCookieOptions (D-110)', () => {
    afterEach(() => {
        vi.doUnmock('../../../../infra/env')
        vi.resetModules()
    })

    // D-110 substitui a D-59: pelo rewrite /api/* da Vercel o front e a API ficam no mesmo site, então o cookie é
    // first-party também em produção, e Lax recupera a defesa contra CSRF que o None abria mão.
    it.each(['production', 'development', 'test'])('usa SameSite=Lax e Secure em %s', async nodeEnv => {
        const options = await loadOptions(nodeEnv)

        expect(options.sameSite).toBe('lax')
        expect(options.secure).toBe(true)
    })

    it('mantém o cookie httpOnly e no escopo da raiz em qualquer ambiente', async () => {
        const options = await loadOptions('production')

        expect(options.httpOnly).toBe(true)
        expect(options.path).toBe('/')
    })
})
