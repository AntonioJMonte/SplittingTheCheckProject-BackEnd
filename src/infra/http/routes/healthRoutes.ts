import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from '@fastify/type-provider-zod'
import { healthCheck } from '../controllers/health-check-controller'
import { healthLive } from '../controllers/health-live-controller'
import { liveRouteSchema, readyRouteSchema } from '../schemas/health.schema'

export async function healthRoutes(fastify: FastifyInstance) {
    const app = fastify.withTypeProvider<ZodTypeProvider>()

    app.get('/health/live', { schema: liveRouteSchema }, healthLive)
    app.get('/health/ready', { schema: readyRouteSchema }, healthCheck)
}
