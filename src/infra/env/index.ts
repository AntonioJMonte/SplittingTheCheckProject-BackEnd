import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Allowlist de origens do navegador, separadas por vírgula. O cookie de refresh obriga
  // `credentials: true` no CORS, e com credenciais o navegador recusa `*` — por isso lista
  // explícita. Uma lista que resolve para vazio é erro de configuração, não "CORS desligado".
  CORS_ORIGIN: z
    .string()
    .default('http://localhost:5173')
    .transform(value => value.split(',').map(origin => origin.trim()).filter(Boolean))
    .refine(origins => origins.length > 0, {
      message: 'precisa listar ao menos uma origem (separadas por vírgula)',
    }),
  ANTHROPIC_API_KEY: z.string().optional().transform(value => value || undefined),
  // D-108: quantos proxies ficam entre o cliente e a API (1 no ingress do Azure Container Apps, que acrescenta o
  // IP do cliente ao X-Forwarded-For). O IP resolvido é o que o rate limit conta; 0 desliga.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  process.stderr.write(`Invalid environment variables:\n${JSON.stringify(parsed.error.flatten().fieldErrors, null, 2)}\n`)
  process.exit(1)
}

export const env = parsed.data
