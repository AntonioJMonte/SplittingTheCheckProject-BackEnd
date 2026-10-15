import { describe, it, expect } from 'vitest'
import { isExactOrigin } from '../../../../infra/env/cors-origins'

describe('isExactOrigin', () => {
    it.each(['http://localhost:5173', 'https://splittr.vercel.app', 'https://api.example.com:8443'])(
        'aceita a origem exata %s',
        origin => {
            expect(isExactOrigin(origin)).toBe(true)
        },
    )

    it.each([
        'https://splittr.vercel.app/',
        'https://splittr.vercel.app/login',
        'https://Splittr.vercel.app',
        'https://splittr.vercel.app:443',
        'https://splittr .vercel.app',
        'splittr.vercel.app',
        'https://*.vercel.app',
        '*',
        '',
    ])('recusa %j, que nunca casaria com o header Origin do navegador', origin => {
        expect(isExactOrigin(origin)).toBe(false)
    })
})
