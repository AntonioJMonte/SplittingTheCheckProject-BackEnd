import type { Logger } from 'pino'

const DEFAULT_TIMEOUT_MS = 10_000

interface ShutdownOptions {
    close: () => Promise<unknown>
    logger: Pick<Logger, 'info' | 'warn' | 'error'>
    exit: (code: number) => void
    timeoutMs?: number
}

/**
 * Handler de SIGTERM/SIGINT. Só chama o close do app: a ordem vem dos hooks do Fastify (preClose dos sockets,
 * server.close, onClose de pub/sub, Prisma e cache). Um segundo sinal é ignorado, e um fechamento que trave sai
 * com 1 depois do prazo, antes do SIGKILL da plataforma.
 */
export function createShutdownHandler({ close, logger, exit, timeoutMs = DEFAULT_TIMEOUT_MS }: ShutdownOptions) {
    let closing = false

    return (signal: NodeJS.Signals): void => {
        if (closing) {
            logger.warn({ signal }, 'Encerramento: sinal repetido ignorado')
            return
        }
        closing = true
        logger.info({ signal }, 'Encerramento: sinal recebido, fechando o app')

        const deadline = setTimeout(() => {
            logger.error({ timeoutMs }, 'Encerramento: passou do prazo, saindo à força')
            exit(1)
        }, timeoutMs)
        // O prazo não pode, sozinho, manter o processo vivo.
        deadline.unref()

        close().then(
            () => {
                clearTimeout(deadline)
                logger.info('Encerramento: concluído')
                exit(0)
            },
            (err: unknown) => {
                clearTimeout(deadline)
                logger.error({ err }, 'Encerramento: falhou')
                exit(1)
            },
        )
    }
}
