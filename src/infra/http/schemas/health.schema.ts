import z from 'zod'

const dependencyStatus = z.enum(['up', 'down'])

const readinessBody = z.object({
    status: z.enum(['ok', 'degraded']),
    checks: z.object({
        database: dependencyStatus,
        redis: dependencyStatus,
    }),
})

export const liveRouteSchema = {
    summary: 'Verificar se o processo está vivo',
    description: 'Responde 200 sem consultar dependências: só confirma que o processo atende HTTP. É o probe de liveness do Container Apps, porque reiniciar o contêiner não conserta um Postgres ou um Redis fora do ar.',
    tags: ['Health'],
    response: {
        200: z.object({ status: z.literal('ok') }).describe('Processo no ar'),
    },
}

export const readyRouteSchema = {
    summary: 'Verificar se a API está pronta',
    description: 'Checa a conexão com Postgres e Redis e responde 503 se alguma dependência estiver fora. Não exige autenticação; é o healthcheck do Docker Compose e os probes de readiness e startup do Container Apps.',
    tags: ['Health'],
    response: {
        200: readinessBody.describe('API e dependências no ar'),
        503: readinessBody.describe('Alguma dependência está fora'),
    },
}
