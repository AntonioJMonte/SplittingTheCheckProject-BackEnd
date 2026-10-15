import { app } from './infra/http/app'
import { createShutdownHandler } from './infra/http/graceful-shutdown'
import { env } from './infra/env'
import { logger } from './infra/logger/logger'
import { createSocketServer } from './infra/websocket/socket-server'

async function start() {
  if (!env.ANTHROPIC_API_KEY) {
    logger.warn('ANTHROPIC_API_KEY ausente: a categorização usará apenas regras e cache, com fallback "Outros"')
  }

  try {
    // Antes do ready: os hooks de fechamento do Socket.IO só podem ser registrados enquanto o app não subiu.
    createSocketServer(app)
    await app.ready()
    app.server.once('close', () => logger.info('Encerramento: servidor HTTP fechado'))
    await app.listen({ port: env.PORT, host: '0.0.0.0' })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

const shutdown = createShutdownHandler({ close: () => app.close(), logger, exit: code => process.exit(code) })
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

start()
