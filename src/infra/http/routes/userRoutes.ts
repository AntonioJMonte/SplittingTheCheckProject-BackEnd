import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from '@fastify/type-provider-zod'
import { registerUser } from '../controllers/register-user-controller'
import { authUser } from '../controllers/auth-user-controller'
import { refreshToken } from '../controllers/refresh-token-controller'
import { logoutUser } from '../controllers/auth-logout-user-controller'
import { getUserProfile } from '../controllers/get-user-profile-controller'
import { updatePixKey } from '../controllers/update-pix-key-controller'
import { updatePhone } from '../controllers/update-phone-controller'
import { verifyJwt } from '../middlewares/verify-jwt'
import { authRateLimit } from '../rate-limit'
import { registerRouteSchema, authRouteSchema, refreshTokenRouteSchema, logoutRouteSchema } from '../schemas/auth.schema'
import { getUserProfileRouteSchema, updatePixKeyRouteSchema, updatePhoneRouteSchema } from '../schemas/user.schema'

export async function userRoutes(fastify: FastifyInstance) {
    const app = fastify.withTypeProvider<ZodTypeProvider>()

    app.post('/register', { schema: registerRouteSchema, config: { rateLimit: authRateLimit } }, registerUser)
    app.post('/auth', { schema: authRouteSchema, config: { rateLimit: authRateLimit } }, authUser)
    // D-91: fora do limite de autenticação. Ele existe contra tentativa e erro de senha, e o
    // refresh recebe um JWT assinado, não uma senha. Uma SPA chama esta rota a cada reload.
    app.post('/refresh', { schema: refreshTokenRouteSchema }, refreshToken)

    // Sem verifyJwt de propósito (D-38): o logout age sobre o cookie de refresh, então precisa
    // funcionar mesmo com o access token já expirado — exigir JWT deixaria o usuário sem como sair.
    app.post('/logout', { schema: logoutRouteSchema }, logoutUser)

    app.get('/users/me', { schema: getUserProfileRouteSchema, preValidation: [verifyJwt] }, getUserProfile)
    app.patch('/users/pix-key', { schema: updatePixKeyRouteSchema, preValidation: [verifyJwt] }, updatePixKey)
    app.patch('/users/phone', { schema: updatePhoneRouteSchema, preValidation: [verifyJwt] }, updatePhone)
}
