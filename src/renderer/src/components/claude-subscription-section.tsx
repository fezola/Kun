import { useEffect, useState, type ReactElement } from 'react'
import { AlertCircle, CheckCircle2, Copy, Loader2, LogIn } from 'lucide-react'
import type { ModelProviderProfileV1 } from '@shared/app-settings-types'
import { SecretInput } from './settings-controls'

type Translate = (key: string) => string

const SETUP_TOKEN_COMMAND = 'claude setup-token'

function loginErrorText(message: string, t: Translate): string {
  if (message === 'claude-cli-not-found') return t('claudeSubLoginFailedCli')
  if (message === 'timeout') return t('claudeSubLoginFailedTimeout')
  return message ? `${t('claudeSubLoginFailedGeneric')}: ${message}` : t('claudeSubLoginFailedGeneric')
}

/**
 * Subscription-login UI for the `agent-sdk` (Claude Pro/Max) provider. Replaces
 * the bare "API Key" box: detects an existing Claude Code login, can run
 * `claude setup-token` to capture a token, and falls back to manual paste. The
 * resulting token is stored in the provider's `apiKey` (empty => host CLI login).
 */
export function ClaudeSubscriptionSection({
  provider,
  onTokenChange,
  t
}: {
  provider: ModelProviderProfileV1
  onTokenChange: (token: string) => void
  t: Translate
}): ReactElement {
  const [status, setStatus] = useState<'checking' | 'logged-in' | 'logged-out'>('checking')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [showToken, setShowToken] = useState(false)
  const [copied, setCopied] = useState(false)

  const refreshStatus = async (): Promise<void> => {
    setStatus('checking')
    try {
      const res = await window.kunGui.claudeSubscriptionStatus()
      setStatus(res.loggedIn ? 'logged-in' : 'logged-out')
    } catch {
      setStatus('logged-out')
    }
  }
  useEffect(() => {
    void refreshStatus()
  }, [])

  const runLogin = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const res = await window.kunGui.claudeSubscriptionLogin()
      if (res.ok) {
        onTokenChange(res.token)
        setStatus('logged-in')
        setMessage({ kind: 'ok', text: t('claudeSubLoginSuccess') })
      } else {
        setMessage({ kind: 'err', text: loginErrorText(res.message, t) })
      }
    } catch (err) {
      setMessage({ kind: 'err', text: loginErrorText(err instanceof Error ? err.message : '', t) })
    } finally {
      setBusy(false)
    }
  }

  const copyCommand = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(SETUP_TOKEN_COMMAND)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore clipboard failures
    }
  }

  const hasToken = provider.apiKey.trim().length > 0

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-lg border border-ds-border bg-ds-main/30 px-3 py-2 text-[12px] leading-5 text-ds-muted">
        {t('claudeSubTosNote')}
      </p>

      <div className="flex items-center gap-2 text-[13px]">
        {status === 'checking' ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-ds-muted" strokeWidth={1.9} />
            <span className="text-ds-muted">{t('claudeSubStatusChecking')}</span>
          </>
        ) : status === 'logged-in' ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" strokeWidth={1.9} />
            <span className="text-ds-ink">{t('claudeSubStatusLoggedIn')}</span>
          </>
        ) : (
          <>
            <AlertCircle className="h-3.5 w-3.5 text-amber-500" strokeWidth={1.9} />
            <span className="text-ds-muted">{t('claudeSubStatusLoggedOut')}</span>
          </>
        )}
        <button
          type="button"
          onClick={() => void refreshStatus()}
          className="ml-auto text-[12px] text-ds-muted underline-offset-2 hover:text-ds-ink hover:underline"
        >
          {t('claudeSubRecheck')}
        </button>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => void runLogin()}
        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-accent/50 bg-ds-main/45 px-3 text-[13px] font-medium text-ds-ink transition hover:bg-ds-main/70 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.9} />
        ) : (
          <LogIn className="h-4 w-4" strokeWidth={1.9} />
        )}
        {busy ? t('claudeSubLoginBusy') : t('claudeSubLoginButton')}
      </button>

      {message ? (
        <p
          className={`text-[12px] leading-5 ${
            message.kind === 'ok'
              ? 'text-emerald-600 dark:text-emerald-300'
              : 'text-amber-600 dark:text-amber-300'
          }`}
        >
          {message.text}
        </p>
      ) : null}

      <div className="flex items-center gap-2 rounded-lg border border-ds-border bg-ds-card px-3 py-2">
        <code className="flex-1 truncate font-mono text-[12px] text-ds-ink">{SETUP_TOKEN_COMMAND}</code>
        <button
          type="button"
          onClick={() => void copyCommand()}
          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-ds-muted transition hover:text-ds-ink"
        >
          <Copy className="h-3 w-3" strokeWidth={1.9} />
          {copied ? t('claudeSubCommandCopied') : t('claudeSubCommandCopy')}
        </button>
      </div>

      <label className="flex flex-col gap-1 text-[13px] font-medium text-ds-ink">
        {t('claudeSubManualLabel')}
        <SecretInput
          value={provider.apiKey}
          onChange={(value) => onTokenChange(value)}
          visible={showToken}
          onToggleVisibility={() => setShowToken((value) => !value)}
          placeholder={t('claudeSubManualPlaceholder')}
          autoComplete="off"
          showLabel={t('showSecret')}
          hideLabel={t('hideSecret')}
        />
      </label>
      <p className="text-[12px] leading-5 text-ds-muted">
        {hasToken ? t('claudeSubTokenSetHint') : t('claudeSubEmptyHint')}
      </p>
    </div>
  )
}
