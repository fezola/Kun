import { memo, useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react'
import { AlertTriangle, ArrowLeft, ExternalLink, Play, Sparkles, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { startDesignHtmlPreviewWatch } from '../../../design/design-preview-file'
import {
  buildPrototypeNavigationCaptureScript,
  extractPrototypeNavigationHref,
  resolveInitialPrototypeArtifactId,
  resolvePrototypeNavigationTarget,
  resolvePrototypeLinks
} from '../../../design/prototype-player'
import type { DesignArtifact } from '../../../design/design-types'

type WebviewElement = HTMLElement & {
  executeJavaScript?: (code: string) => Promise<unknown>
}

type WebviewNavigateEvent = Event & {
  url?: string
  preventDefault?: () => void
}

type Props = {
  open: boolean
  workspaceRoot: string
  artifacts: readonly DesignArtifact[]
  initialArtifactId?: string | null
  onClose: () => void
  onRequestMissingScreen?: (promptSeed: string) => void
}

function PrototypePlayerOverlayInner({
  open,
  workspaceRoot,
  artifacts,
  initialArtifactId,
  onClose,
  onRequestMissingScreen
}: Props) {
  const { t } = useTranslation('common')
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const [fileUrl, setFileUrl] = useState('')
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [missingHref, setMissingHref] = useState('')
  const webviewRef = useRef<WebviewElement | null>(null)

  const currentArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === currentId && artifact.kind === 'html') ?? null,
    [artifacts, currentId]
  )
  const links = useMemo(
    () => resolvePrototypeLinks(currentArtifact, artifacts),
    [artifacts, currentArtifact]
  )

  useEffect(() => {
    if (!open) return
    setCurrentId(resolveInitialPrototypeArtifactId(artifacts, initialArtifactId))
    setHistory([])
    setMissingHref('')
  }, [artifacts, initialArtifactId, open])

  useEffect(() => {
    if (!open) return
    if (!currentId || artifacts.some((artifact) => artifact.id === currentId && artifact.kind === 'html')) return
    setCurrentId(resolveInitialPrototypeArtifactId(artifacts, initialArtifactId))
    setHistory([])
  }, [artifacts, currentId, initialArtifactId, open])

  useEffect(() => {
    let cancelled = false
    let cleanupWatch: (() => void) | null = null
    setFileUrl('')
    setRevision(0)
    setError('')

    if (!open || !workspaceRoot || !currentArtifact) return
    if (typeof window.kunGui?.authorizeWritePrototype !== 'function') {
      setError(t('designPrototypeAuthorizeMissing', 'Prototype preview is unavailable.'))
      return
    }

    void window.kunGui
      .authorizeWritePrototype({ path: currentArtifact.relativePath, workspaceRoot })
      .then((res) => {
        if (cancelled) return
        if (!res.ok) {
          setError(res.message)
          return
        }
        setFileUrl(res.fileUrl)
        cleanupWatch = startDesignHtmlPreviewWatch({
          workspaceRoot,
          path: currentArtifact.relativePath,
          onRevision: setRevision,
          onError: setError
        })
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
      cleanupWatch?.()
    }
  }, [currentArtifact, open, t, workspaceRoot])

  const goTo = useCallback(
    (artifactId: string): void => {
      if (!artifactId || artifactId === currentId) return
      setHistory((items) => (currentId ? [...items, currentId] : items))
      setMissingHref('')
      setCurrentId(artifactId)
    },
    [currentId]
  )

  const goBack = useCallback((): void => {
    setHistory((items) => {
      const previous = items[items.length - 1]
      if (previous) setCurrentId(previous)
      return items.slice(0, -1)
    })
  }, [])

  const webviewUrl = fileUrl ? `${fileUrl}${fileUrl.includes('?') ? '&' : '?'}rev=${revision}` : ''

  useEffect(() => {
    const webview = webviewRef.current
    if (!open || !webviewUrl || !fileUrl || !webview) return

    const injectNavigationCapture = (): void => {
      if (typeof webview.executeJavaScript !== 'function') return
      void webview.executeJavaScript(buildPrototypeNavigationCaptureScript(links)).catch(() => {
        /* Best-effort: explicit side-rail links still work if a guest blocks injection. */
      })
    }

    const handleNavigate: EventListener = (event): void => {
      const navigationUrl = (event as WebviewNavigateEvent).url
      if (!navigationUrl) return
      const target = resolvePrototypeNavigationTarget(navigationUrl, fileUrl, links)
      const capturedHref = extractPrototypeNavigationHref(navigationUrl)
      if (!target && !capturedHref) return
      ;(event as WebviewNavigateEvent).preventDefault?.()
      if (target) {
        goTo(target.targetArtifactId)
        return
      }
      if (capturedHref) setMissingHref(capturedHref)
    }

    webview.addEventListener('dom-ready', injectNavigationCapture)
    webview.addEventListener('did-finish-load', injectNavigationCapture)
    webview.addEventListener('will-navigate', handleNavigate)
    webview.addEventListener('did-navigate-in-page', handleNavigate)
    injectNavigationCapture()

    return () => {
      webview.removeEventListener('dom-ready', injectNavigationCapture)
      webview.removeEventListener('did-finish-load', injectNavigationCapture)
      webview.removeEventListener('will-navigate', handleNavigate)
      webview.removeEventListener('did-navigate-in-page', handleNavigate)
    }
  }, [fileUrl, goTo, links, open, webviewUrl])

  const requestMissingScreen = useCallback((): void => {
    const href = missingHref.trim()
    if (!href || !currentArtifact) return
    onRequestMissingScreen?.(
      t('designPrototypeCreateMissingPrompt', {
        current: currentArtifact.title,
        href
      })
    )
    onClose()
  }, [currentArtifact, missingHref, onClose, onRequestMissingScreen, t])

  if (!open) return null

  return (
    <div className="ds-no-drag pointer-events-auto absolute inset-0 z-[70] flex items-center justify-center bg-[#111827]/32 p-5 backdrop-blur-sm">
      <div className="flex h-[min(820px,calc(100%-2rem))] w-[min(1180px,calc(100%-2rem))] overflow-hidden rounded-[8px] border border-ds-border bg-white text-ds-ink shadow-[0_30px_90px_rgba(15,23,42,0.32)] dark:bg-ds-canvas">
        <main className="flex min-w-0 flex-1 flex-col bg-[#f6f8fb] dark:bg-[#111318]">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-ds-border bg-white/82 px-3 dark:bg-ds-card/85">
            <button
              type="button"
              onClick={goBack}
              disabled={history.length === 0}
              className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-35"
              title={t('designPrototypeBack', 'Back')}
              aria-label={t('designPrototypeBack', 'Back')}
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={1.9} />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <Play className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.9} />
                <span className="truncate text-[13px] font-semibold">
                  {currentArtifact?.title ?? t('designPrototypePlay', 'Play prototype')}
                </span>
              </div>
              {currentArtifact ? (
                <div className="truncate text-[10.5px] text-ds-faint">{currentArtifact.relativePath}</div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
              title={t('designPrototypeClose', 'Close prototype')}
              aria-label={t('designPrototypeClose', 'Close prototype')}
            >
              <X className="h-4 w-4" strokeWidth={1.9} />
            </button>
          </header>
          <div className="min-h-0 flex-1 p-4">
            <div className="relative h-full w-full overflow-hidden rounded-[8px] border border-ds-border bg-white shadow-[0_12px_40px_rgba(15,23,42,0.12)]">
              {webviewUrl ? (
                <webview
                  key={webviewUrl}
                  ref={webviewRef as Ref<WebviewElement>}
                  src={webviewUrl}
                  partition="kun-proto"
                  webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"
                  className="h-full w-full border-0"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-[13px] text-ds-faint">
                  {error || t('designCanvasLoading')}
                </div>
              )}
              {error && webviewUrl ? (
                <div className="absolute inset-x-3 top-3 rounded-[8px] border border-red-200 bg-white/92 px-3 py-2 text-[12px] text-red-600 shadow-sm backdrop-blur">
                  {error}
                </div>
              ) : null}
            </div>
          </div>
        </main>
        <aside className="flex w-[270px] shrink-0 flex-col border-l border-ds-border bg-white/90 p-3 dark:bg-ds-card/88">
          <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ds-faint">
            {t('designPrototypeNextScreens', 'Next screens')}
          </div>
          {missingHref ? (
            <div className="mb-3 rounded-[8px] border border-amber-300/70 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 shadow-sm dark:border-amber-400/30 dark:bg-amber-400/12 dark:text-amber-100">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                <span>{t('designPrototypeMissingTarget', 'Missing screen target')}</span>
              </div>
              <div className="mt-1 truncate font-mono text-[10.5px] opacity-80" title={missingHref}>
                {missingHref}
              </div>
              <button
                type="button"
                onClick={requestMissingScreen}
                disabled={!onRequestMissingScreen}
                className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-[8px] bg-amber-500 px-2 text-[11.5px] font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" strokeWidth={1.9} />
                {t('designPrototypeCreateMissingScreen', 'Create with AI')}
              </button>
            </div>
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
            {links.length > 0 ? (
              links.map((link) => (
                <button
                  key={`${link.targetArtifactId}:${link.label ?? ''}`}
                  type="button"
                  onClick={() => goTo(link.targetArtifactId)}
                  className="group flex min-h-11 w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-left text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                  title={link.href || link.targetTitle}
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.8} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ds-ink">{link.label || link.targetTitle}</span>
                    <span className="block truncate text-[10.5px] text-ds-faint">{link.targetTitle}</span>
                  </span>
                </button>
              ))
            ) : (
              <div className="rounded-[8px] bg-ds-hover/45 px-3 py-2 text-[12px] leading-5 text-ds-faint">
                {t('designPrototypeNoLinks', 'No outgoing links from this screen yet.')}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

export const PrototypePlayerOverlay = memo(PrototypePlayerOverlayInner)
