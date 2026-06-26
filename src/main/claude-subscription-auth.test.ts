import { EventEmitter } from 'node:events'
import { describe, expect, test } from 'vitest'
import { runClaudeSetupToken } from './claude-subscription-auth'

function fakeChild(): EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: () => void
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: () => void
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => {}
  return child
}

describe('runClaudeSetupToken', () => {
  test('captures the OAuth token printed across stdout chunks', async () => {
    const child = fakeChild()
    const promise = runClaudeSetupToken({ spawnFn: (() => child) as never })
    child.stdout.emit('data', Buffer.from('Visit https://claude.ai/... then\n'))
    child.stdout.emit('data', Buffer.from('Your token: sk-ant-oat01-AbC123_xyz-DEF\n'))
    expect(await promise).toEqual({ ok: true, token: 'sk-ant-oat01-AbC123_xyz-DEF' })
  })

  test('reports a friendly message when the CLI is missing', async () => {
    const child = fakeChild()
    const promise = runClaudeSetupToken({ spawnFn: (() => child) as never })
    const err = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })
    child.emit('error', err)
    expect(await promise).toEqual({ ok: false, message: 'claude-cli-not-found' })
  })

  test('fails when the process exits without a token', async () => {
    const child = fakeChild()
    const promise = runClaudeSetupToken({ spawnFn: (() => child) as never })
    child.stderr.emit('data', Buffer.from('authorization cancelled'))
    child.emit('exit', 1)
    const result = await promise
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('authorization cancelled')
  })

  test('only settles once (exit after a successful capture is ignored)', async () => {
    const child = fakeChild()
    const promise = runClaudeSetupToken({ spawnFn: (() => child) as never })
    child.stdout.emit('data', Buffer.from('sk-ant-oat01-TOKEN'))
    child.emit('exit', 0)
    expect(await promise).toEqual({ ok: true, token: 'sk-ant-oat01-TOKEN' })
  })
})
