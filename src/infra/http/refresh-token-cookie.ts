import type { CookieSerializeOptions } from '@fastify/cookie'

// D-110 (substitui a D-59): o front chama a API pelo rewrite /api/* da Vercel, no mesmo site, então este cookie é
// first-party em qualquer ambiente, e Lax recupera a defesa contra CSRF que o None abria mão. O Socket.IO não usa
// o cookie: autentica pelo token no handshake (D-60). As mesmas opções valem na limpeza, no logout.
export const refreshTokenCookieOptions: CookieSerializeOptions = {
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
}
