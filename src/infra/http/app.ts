import fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyCookie from '@fastify/cookie'
import fastifyCors from '@fastify/cors'
import fastifyHelmet from '@fastify/helmet'
import fastifyRateLimit from '@fastify/rate-limit'
import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'
import { serializerCompiler, validatorCompiler, jsonSchemaTransform } from '@fastify/type-provider-zod'
import { z, ZodError } from 'zod'
import { DomainError } from '../../shared/errors/domain-error'
import { DomainPermissionError } from '../../shared/errors/domain-permission-error'
import { env } from '../env'
import { logger } from '../logger/logger'
import { globalRateLimitOptions } from './rate-limit'
import {
  VALIDATION_ERROR_MESSAGE,
  isSchemaValidationError,
  issuesFromSchemaValidation,
  issuesFromZodError,
} from './validation-error'
import { userRoutes } from './routes/userRoutes'
import { groupRoutes } from './routes/groupRoutes'
import { expenseRoutes } from './routes/expenseRoutes'
import { settlementRoutes } from './routes/settlementRoutes'
import { healthRoutes } from './routes/healthRoutes'

// D-90: mensagens de validação em português, como as demais mensagens de erro da API. Vale para
// todo schema avaliado depois desta linha.
z.config(z.locales.pt())

// D-108: confia nos N vizinhos mais próximos e pega o IP logo antes deles, o mais à direita que o cliente não
// escreve. Nunca `true`, que usaria o primeiro valor do X-Forwarded-For, forjável pelo cliente. Função e não
// número porque o Fastify 5.12 ignora `trustProxy` numérico; o efeito é o que o número fazia antes.
const trustedHops = env.TRUST_PROXY_HOPS

export const app = fastify({
  loggerInstance: logger,
  trustProxy: trustedHops > 0 ? (_address: string, hop: number) => hop < trustedHops : false,
})

app.setValidatorCompiler(validatorCompiler)
app.setSerializerCompiler(serializerCompiler)

// @fastify/type-provider-zod passes ZodError as `errors`; the default Fastify formatter
// tries to access `.schemaPath` (an AJV concept) on Zod issues and throws. Override it
// to produce a plain Error with statusCode 400 so the error handler can handle it.
app.setSchemaErrorFormatter((errors, dataVar) => {
  const err = new Error(`Request ${dataVar} validation failed`) as Error & { statusCode: number; validation: unknown }
  err.statusCode = 400
  err.validation = errors
  return err
})

// D-58: registrado antes das rotas para que o preflight seja respondido em todas elas.
// `credentials` é obrigatório porque o refresh token trafega em cookie httpOnly; como o
// navegador recusa `*` junto de credenciais, a origem vem da allowlist de CORS_ORIGIN.
app.register(fastifyCors, {
  origin: env.CORS_ORIGIN,
  credentials: true,
})

// D-70: o Swagger entrega o mapa completo da API, com exemplos, sem exigir autenticação.
// Fora de produção é ferramenta de trabalho; em produção seria reconhecimento de graça.
const swaggerEnabled = env.NODE_ENV !== 'production'

// D-66: a API responde JSON, então o CSP pode ser restrito. A exceção existe só onde o
// Swagger UI roda, e ele não acompanha o deploy de produção.
app.register(fastifyHelmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      ...(swaggerEnabled
        ? {
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'validator.swagger.io'],
          }
        : {}),
    },
  },
})

// D-67: registrado antes das rotas para que o `config.rateLimit` de cada uma seja reconhecido.
app.register(fastifyRateLimit, globalRateLimitOptions)

if (swaggerEnabled) {
  app.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Plataforma de Rachamento de Contas',
        description:
          'API REST para grupos compartilharem despesas e calcularem automaticamente ' +
          'quem deve a quem, com algoritmo de minimização de transações.',
        version: '1.0.0',
      },
      servers: [{ url: `http://localhost:${env.PORT}`, description: 'Servidor local' }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Access token JWT obtido em POST /auth',
          },
        },
      },
      tags: [
        { name: 'Auth', description: 'Registro, login e renovação de token' },
        { name: 'Users', description: 'Perfil e configurações do usuário' },
        { name: 'Groups', description: 'Gerenciamento de grupos e membros' },
        { name: 'Expenses', description: 'Lançamento e consulta de despesas' },
        { name: 'Settlements', description: 'Cálculo e confirmação de acertos' },
        { name: 'Health', description: 'Disponibilidade da API e das dependências' },
      ],
    },
    transform: jsonSchemaTransform,
  })

  app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
    staticCSP: true,
  })
}

app.register(fastifyJwt, {
  secret: env.JWT_SECRET,
  cookie: {
    cookieName: 'refreshToken',
    signed: false,
  },
  sign: {
    expiresIn: env.JWT_EXPIRES_IN,
  },
})

app.register(fastifyCookie)

app.register(userRoutes)
app.register(groupRoutes)
app.register(expenseRoutes)
app.register(settlementRoutes)
app.register(healthRoutes)

app.setErrorHandler((error, request, reply) => {
  if (error instanceof ZodError) {
    return reply.status(400).send({ message: VALIDATION_ERROR_MESSAGE, issues: issuesFromZodError(error) })
  }

  if (isSchemaValidationError(error)) {
    return reply.status(400).send({ message: VALIDATION_ERROR_MESSAGE, issues: issuesFromSchemaValidation(error.validation) })
  }

  // D-74: antes do DomainError genérico, senão a negação de permissão sairia como 400.
  if (error instanceof DomainPermissionError) {
    return reply.status(403).send({ message: error.message })
  }

  if (error instanceof DomainError) {
    return reply.status(400).send({ message: error.message })
  }

  const err = error as { statusCode?: number; message?: string }
  if (err.statusCode && err.statusCode < 500) {
    return reply.status(err.statusCode).send({ message: err.message })
  }

  // Sem guarda de NODE_ENV: 500 em produção precisa aparecer no log. O reqId do pino liga
  // o stack trace à request que o causou.
  request.log.error({ err: error }, 'Erro não tratado')

  return reply.status(500).send({ message: 'Internal server error.' })
})
