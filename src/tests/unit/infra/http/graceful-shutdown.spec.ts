import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createShutdownHandler } from '../../../../infra/http/graceful-shutdown'

function setup(close: () => Promise<unknown>) {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const exit = vi.fn()
    const shutdown = createShutdownHandler({ close, logger, exit, timeoutMs: 10_000 })
    return { shutdown, logger, exit }
}

describe('createShutdownHandler', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('fecha o app uma vez e sai com 0', async () => {
        const close = vi.fn(async () => {})
        const { shutdown, logger, exit } = setup(close)

        shutdown('SIGTERM')
        await vi.advanceTimersByTimeAsync(0)

        expect(close).toHaveBeenCalledOnce()
        expect(logger.info).toHaveBeenCalledWith({ signal: 'SIGTERM' }, expect.any(String))
        expect(exit).toHaveBeenCalledExactlyOnceWith(0)
    })

    it('ignora um segundo sinal enquanto ainda está fechando', async () => {
        let finish!: () => void
        const close = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
        const { shutdown, logger, exit } = setup(close)

        shutdown('SIGTERM')
        shutdown('SIGINT')
        finish()
        await vi.advanceTimersByTimeAsync(0)

        expect(close).toHaveBeenCalledOnce()
        expect(logger.warn).toHaveBeenCalledWith({ signal: 'SIGINT' }, expect.any(String))
        expect(exit).toHaveBeenCalledExactlyOnceWith(0)
    })

    it('sai com 1 quando o fechamento falha', async () => {
        const failure = new Error('redis caiu')
        const { shutdown, logger, exit } = setup(async () => {
            throw failure
        })

        shutdown('SIGTERM')
        await vi.advanceTimersByTimeAsync(0)

        expect(logger.error).toHaveBeenCalledWith({ err: failure }, expect.any(String))
        expect(exit).toHaveBeenCalledExactlyOnceWith(1)
    })

    it('sai com 1 depois de 10 s se o fechamento travar, antes do SIGKILL da plataforma', async () => {
        const { shutdown, exit } = setup(() => new Promise(() => {}))

        shutdown('SIGTERM')
        await vi.advanceTimersByTimeAsync(9_999)
        expect(exit).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(1)
        expect(exit).toHaveBeenCalledExactlyOnceWith(1)
    })

    it('não força a saída depois de um fechamento bem-sucedido', async () => {
        const { shutdown, exit } = setup(async () => {})

        shutdown('SIGTERM')
        await vi.advanceTimersByTimeAsync(10_000)

        expect(exit).toHaveBeenCalledExactlyOnceWith(0)
    })
})
