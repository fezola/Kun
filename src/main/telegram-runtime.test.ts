import { describe, expect, it, vi } from 'vitest'
import {
  createTelegramRuntime,
  parseAllowedChatIds,
  verifyTelegramBotToken
} from './telegram-runtime'

vi.mock('electron', () => ({ net: {} }))

describe('Telegram transport adapter', () => {
  it('normalizes the private-chat allowlist without retaining invalid or duplicate ids', () => {
    expect([...parseAllowedChatIds('123, 456 123, -1, nope, 0')]).toEqual([123, 456])
    expect(parseAllowedChatIds('')).toEqual(new Set())
  })

  it('rejects malformed bot tokens before any network request', async () => {
    await expect(verifyTelegramBotToken('not-a-token')).resolves.toEqual({
      ok: false,
      code: 'invalid_format',
      message: 'Invalid token format. Expected "<numeric-id>:<35+ chars>".'
    })
  })

  it('reports disconnected text and file delivery without invoking another channel', async () => {
    const logError = vi.fn()
    const onInbound = vi.fn()
    const runtime = createTelegramRuntime({ store: {} as never, logError, onInbound })

    await expect(runtime.sendMessage('missing', '123', 'hello')).resolves.toEqual({
      ok: false,
      message: 'Telegram channel is not connected.'
    })
    await expect(runtime.sendFile('missing', '123', '/tmp/report.txt')).resolves.toEqual({
      ok: false,
      message: 'Telegram channel is not connected.'
    })
    expect(onInbound).not.toHaveBeenCalled()
    expect(logError).not.toHaveBeenCalled()
  })
})
