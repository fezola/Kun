/**
 * Claude Pro/Max subscription login helpers for the GUI.
 *
 * The compliant path does NOT do an in-app browser OAuth (Anthropic forbids
 * third-party apps offering claude.ai login). Instead the official Claude Code
 * CLI performs the OAuth: we either detect an existing CLI login or shell out to
 * `claude setup-token` (which opens the user's browser) and capture the printed
 * `CLAUDE_CODE_OAUTH_TOKEN`. The token (or an empty value + existing CLI login)
 * is then handed to the embedded Agent SDK runtime.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  ClaudeSubscriptionLoginResult,
  ClaudeSubscriptionStatus
} from '../shared/kun-gui-api'

// `claude setup-token` prints a long-lived OAuth token; capture the first match.
const OAUTH_TOKEN_PATTERN = /sk-ant-oat[\w-]+/

export function claudeSubscriptionStatus(): ClaudeSubscriptionStatus {
  return { loggedIn: existsSync(join(homedir(), '.claude', '.credentials.json')) }
}

/**
 * Run `claude setup-token`, opening the user's browser for OAuth, and resolve
 * with the captured token. Defensive: a missing CLI, timeout, or non-zero exit
 * all resolve to `{ ok:false }` so the UI can fall back to manual paste.
 * `spawnFn` is injectable for tests.
 */
export function runClaudeSetupToken(
  options: { spawnFn?: typeof spawn; timeoutMs?: number } = {}
): Promise<ClaudeSubscriptionLoginResult> {
  const spawnFn = options.spawnFn ?? spawn
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let child: ChildProcess | undefined
    let buffer = ''

    const done = (result: ClaudeSubscriptionLoginResult): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      try {
        child?.kill()
      } catch {
        // ignore
      }
      resolve(result)
    }

    const captureToken = (): boolean => {
      const match = buffer.match(OAUTH_TOKEN_PATTERN)
      if (match) {
        done({ ok: true, token: match[0] })
        return true
      }
      return false
    }

    try {
      child = spawnFn('claude', ['setup-token'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
        env: process.env
      })
    } catch (err) {
      done({ ok: false, message: err instanceof Error ? err.message : 'failed to start claude' })
      return
    }

    timer = setTimeout(() => done({ ok: false, message: 'timeout' }), timeoutMs)

    const onChunk = (chunk: Buffer): void => {
      buffer += chunk.toString()
      captureToken()
    }
    child.stdout?.on('data', onChunk)
    child.stderr?.on('data', onChunk)
    child.on('error', (err: NodeJS.ErrnoException) => {
      done({
        ok: false,
        message: err.code === 'ENOENT' ? 'claude-cli-not-found' : err.message
      })
    })
    child.on('exit', (code) => {
      if (captureToken()) return
      done({ ok: false, message: buffer.trim().slice(-300) || `claude setup-token exited (code ${code})` })
    })
  })
}
