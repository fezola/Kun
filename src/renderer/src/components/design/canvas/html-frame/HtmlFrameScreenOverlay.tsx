import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Brush, Check, Monitor, PenLine } from 'lucide-react'
import type { CanvasShape } from '../../../../design/canvas/canvas-types'
import type { DesignHtmlElementContext } from '../../../../design/design-composer-context'
import { inferDesignArtifactFoundationRole } from '../../../../design/design-types'
import { useDesignWorkspaceStore } from '../../../../design/design-workspace-store'
import { useChatStore } from '../../../../store/chat-store'
import {
  buildDesignRuntimeQualityAuditScript,
  getDesignRuntimeQualityFindings,
  normalizeRuntimeQualityFindings,
  setDesignRuntimeQualityFindings,
  type DesignHtmlQualityFinding,
  type DesignRuntimeQualityPayload
} from '../../../../design/design-html-quality'
import { useDesignHtmlPreview } from '../../DesignHtmlPreviewHost'
import { HtmlFrameAiCursorOverlay, type HtmlFrameAiCursor } from './HtmlFrameAiCursorOverlay'
import { HtmlFramePlaceholder } from './HtmlFramePlaceholder'
import { HtmlFrameQualityControl } from './HtmlFrameQualityControl'
import {
  AI_CURSOR_TTL_MS,
  AI_SECTION_QUERY,
  htmlFrameDrawingActive,
  htmlFrameOverlayPointerEvents,
  htmlFramePreviewAsyncEpochMatches,
  htmlFrameShouldClearElementContextOnEditingChange,
  htmlFrameShouldCropVisualHeight,
  htmlFrameShouldPromotePreviewToReady,
  htmlFrameVisualCanvasHeight,
  htmlFrameWebviewPartition,
  shouldAutoResizeHtmlFrame,
  type HtmlFramePreviewAsyncEpoch
} from './html-frame-helpers'
import { useHtmlFrameAutoSize } from './use-html-frame-auto-size'
type ScreenOverlayProps = {
  shape: CanvasShape
  workspaceRoot: string
  screenX: number
  screenY: number
  screenWidth: number
  screenHeight: number
  zoom: number
  active: boolean
  interactive: boolean
  panning: boolean
  /** Element-pick ("修改") mode is on for this frame: clicking selects text/elements. */
  editing: boolean
  onDoubleClick: (shapeId: string) => void
  onToggleModify: (shapeId: string) => void
  onUseElementAsContext?: (context: DesignHtmlElementContext | null, promptSeed?: string) => void
  onRuntimeQualityFindings?: (payload: DesignRuntimeQualityPayload) => void
  onRequestQualityRepair?: (payload: DesignRuntimeQualityPayload) => void
}
function ScreenOverlayInner({
  shape,
  workspaceRoot,
  screenX,
  screenY,
  screenWidth,
  screenHeight,
  zoom,
  active,
  interactive,
  panning,
  editing,
  onDoubleClick,
  onToggleModify,
  onUseElementAsContext,
  onRuntimeQualityFindings,
  onRequestQualityRepair
}: ScreenOverlayProps): ReactElement {
  const [localPreviewError, setLocalPreviewError] = useState('')
  const [selectedElementRect, setSelectedElementRect] = useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)
  const [aiCursor, setAiCursor] = useState<HtmlFrameAiCursor | null>(null)
  const aiFadeTimerRef = useRef<number>(0)
  const firstRevisionRef = useRef<number | null>(null)
  const aiCursorFileUrlRef = useRef('')
  const qualitySignatureRef = useRef('')
  const latestEditingRef = useRef(editing)
  const onUseElementAsContextRef = useRef(onUseElementAsContext)
  const previewAsyncEpochRef = useRef<HtmlFramePreviewAsyncEpoch | null>(null)
  const [qualityChecked, setQualityChecked] = useState(false)
  const [qualityFindings, setQualityFindings] = useState<DesignHtmlQualityFinding[]>([])
  const [qualityDetailsOpen, setQualityDetailsOpen] = useState(false)
  const artifact = useDesignWorkspaceStore((s) =>
    s.artifacts.find((a) => a.id === shape.htmlArtifactId)
  )
  const artifactKind = artifact?.kind
  const artifactRelativePath = artifact?.relativePath
  const parallelState = useDesignWorkspaceStore((s) =>
    shape.htmlArtifactId ? s.parallelPageStates[shape.htmlArtifactId] : undefined
  )
  const pagesRun = useDesignWorkspaceStore((s) => s.pagesRun)
  const setFileError = useDesignWorkspaceStore((s) => s.setFileError)
  const setArtifactPreviewStatus = useDesignWorkspaceStore((s) => s.setArtifactPreviewStatus)
  // A design turn is in flight: the agent is still streaming HTML into the file.
  // Keep the frame in its transparent "generating" surface until the turn settles
  // so a half-written page never shows the opaque white frame band beneath it.
  const chatBusy = useChatStore((s) => s.busy)
  const canvasWidth = Math.max(1, shape.width)
  const canvasHeight = Math.max(1, shape.height)
  const foundationRole = artifact ? inferDesignArtifactFoundationRole(artifact) : undefined
  const drawingActive = htmlFrameDrawingActive({
    foundationRole,
    previewStatus: artifact?.previewStatus,
    parallelStatus: parallelState?.status,
    pagesRunPhase: pagesRun?.phase,
    pagesRunStep: pagesRun?.step,
    chatBusy
  })
  const autoResizeEnabled = shouldAutoResizeHtmlFrame({
    sizeMode: artifact?.node?.sizeMode,
    role: foundationRole,
    previewStatus: artifact?.previewStatus,
    parallelStatus: parallelState?.status
  })
  const reportPreviewError = useCallback((message: string): void => {
    setLocalPreviewError(message)
    setFileError(message)
    if (artifact?.id) setArtifactPreviewStatus(artifact.id, 'error')
  }, [artifact?.id, setArtifactPreviewStatus, setFileError])
  const clearPreviewError = useCallback((): void => setLocalPreviewError(''), [])
  const {
    state: preview,
    webview,
    webviewMountNonce,
    executeScript,
    renderWebview
  } = useDesignHtmlPreview({
    workspaceRoot,
    relativePath: artifactKind === 'html' ? artifactRelativePath : undefined,
    enabled: Boolean(workspaceRoot && artifactKind === 'html' && artifactRelativePath),
    partition: htmlFrameWebviewPartition(shape.id),
    zoom,
    onError: reportPreviewError,
    onRevision: clearPreviewError
  })
  const previewAsyncEpoch = useMemo<HtmlFramePreviewAsyncEpoch | null>(() => {
    if (!artifact?.id || artifactKind !== 'html' || !artifactRelativePath || !preview.webviewUrl) return null
    if (preview.relativePath !== artifactRelativePath) return null
    return {
      shapeId: shape.id,
      artifactId: artifact.id,
      artifactRelativePath,
      previewWebviewUrl: preview.webviewUrl,
      previewRevision: preview.revision,
      webviewMountNonce
    }
  }, [
    artifact?.id,
    artifactKind,
    artifactRelativePath,
    preview.relativePath,
    preview.revision,
    preview.webviewUrl,
    shape.id,
    webviewMountNonce
  ])
  const { measuredContentSize } = useHtmlFrameAutoSize({
    shape,
    artifact,
    artifactKind,
    foundationRole,
    autoResizeEnabled,
    previewWebviewUrl: preview.webviewUrl,
    previewRevision: preview.revision,
    webview,
    webviewMountNonce,
    executeScript
  })
  useEffect(() => {
    onUseElementAsContextRef.current = onUseElementAsContext
  }, [onUseElementAsContext])
  useEffect(() => {
    previewAsyncEpochRef.current = previewAsyncEpoch
  }, [previewAsyncEpoch])
  const previewError = localPreviewError || preview.error
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onDoubleClick(shape.id)
    },
    [shape.id, onDoubleClick]
  )
  const selectElementAt = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (!editing || interactive || !artifact) return
      event.preventDefault()
      event.stopPropagation()
      const rect = event.currentTarget.getBoundingClientRect()
      const x = rect.width > 0 ? ((event.clientX - rect.left) / rect.width) * canvasWidth : 0
      const y = rect.height > 0 ? ((event.clientY - rect.top) / rect.height) * canvasHeight : 0
      const selectionQuery = executeScript(`(() => {
        try {
          const x = ${JSON.stringify(x)}
          const y = ${JSON.stringify(y)}
          const escapeCss = (value) => {
            if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value)
            return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&')
          }
          const selectorFor = (element) => {
            if (!element || element.nodeType !== Node.ELEMENT_NODE) return ''
            if (element.id) return '#' + escapeCss(element.id)
            const parts = []
            let current = element
            while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
              const tag = current.tagName.toLowerCase()
              if (tag === 'body') {
                parts.unshift('body')
                break
              }
              let index = 1
              let sibling = current.previousElementSibling
              while (sibling) {
                if (sibling.tagName === current.tagName) index += 1
                sibling = sibling.previousElementSibling
              }
              parts.unshift(tag + ':nth-of-type(' + index + ')')
              current = current.parentElement
            }
            return parts.join(' > ')
          }
          const element = document.elementFromPoint(x, y)
          if (!element || element === document.documentElement || element === document.body) {
            return { ok: false, message: 'No editable element at this point.' }
          }
          const bounds = element.getBoundingClientRect()
          return {
            ok: true,
            selector: selectorFor(element),
            tagName: element.tagName,
            text: (element.innerText || element.textContent || '').trim().slice(0, 500),
            html: element.outerHTML.slice(0, 1400),
            rect: {
              left: Math.round(bounds.left),
              top: Math.round(bounds.top),
              width: Math.round(bounds.width),
              height: Math.round(bounds.height)
            }
          }
        } catch (error) {
          return {
            ok: false,
            message: error instanceof Error ? error.message : String(error)
          }
        }
        })()`)
      if (!selectionQuery) return
      void selectionQuery
        .then((value) => {
          if (!value || typeof value !== 'object') return
          const result = value as {
            ok?: unknown
            message?: unknown
            selector?: unknown
            tagName?: unknown
            text?: unknown
            html?: unknown
            rect?: unknown
          }
          if (!result.ok) {
            if (typeof result.message === 'string') setLocalPreviewError(result.message)
            setSelectedElementRect(null)
            onUseElementAsContext?.(null)
            return
          }
          const resultRect = result.rect as { left?: unknown; top?: unknown; width?: unknown; height?: unknown } | undefined
          if (
            typeof result.selector !== 'string' ||
            typeof result.tagName !== 'string' ||
            typeof result.text !== 'string' ||
            typeof result.html !== 'string' ||
            !resultRect ||
            typeof resultRect.left !== 'number' ||
            typeof resultRect.top !== 'number' ||
            typeof resultRect.width !== 'number' ||
            typeof resultRect.height !== 'number'
          ) {
            return
          }
          setLocalPreviewError('')
          setSelectedElementRect({
            left: resultRect.left,
            top: resultRect.top,
            width: resultRect.width,
            height: resultRect.height
          })
          onUseElementAsContext?.({
            artifactId: artifact.id,
            artifactTitle: artifact.title,
            artifactRelativePath: artifact.relativePath,
            selector: result.selector,
            tagName: result.tagName,
            text: result.text,
            html: result.html
          })
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          setLocalPreviewError(message)
          setFileError(message)
        })
    },
    [canvasHeight, canvasWidth, editing, artifact, interactive, onUseElementAsContext, executeScript, setFileError]
  )
  useEffect(() => {
    setLocalPreviewError('')
    setSelectedElementRect(null)
  }, [artifact?.id, artifact?.relativePath, shape.id])
  useEffect(() => {
    qualitySignatureRef.current = ''
    setQualityChecked(false)
    setQualityFindings(getDesignRuntimeQualityFindings(artifact?.relativePath))
    setQualityDetailsOpen(false)
  }, [artifact?.id, artifact?.relativePath, shape.id])
  useEffect(() => {
    if (!active || interactive) setQualityDetailsOpen(false)
  }, [active, interactive])
  // Leaving 修改 mode drops the picked element + its AI context so the rail clears.
  // A non-editing frame mounting must not clear another frame's active element
  // context, so only clear on an actual editing -> not-editing transition.
  useEffect(() => {
    const wasEditing = latestEditingRef.current
    latestEditingRef.current = editing
    if (!htmlFrameShouldClearElementContextOnEditingChange({ wasEditing, editing })) return
    setSelectedElementRect(null)
    onUseElementAsContextRef.current?.(null)
  }, [editing])
  useEffect(
    () => () => {
      if (latestEditingRef.current) onUseElementAsContextRef.current?.(null)
    },
    []
  )
  const queryAiCursor = useCallback(() => {
    const epoch = previewAsyncEpochRef.current
    if (!epoch) return
    const query = executeScript(AI_SECTION_QUERY)
    if (!query) return
    void query
      .then((value) => {
        if (!htmlFramePreviewAsyncEpochMatches(epoch, previewAsyncEpochRef.current)) return
        if (!value || typeof value !== 'object') return
        const v = value as Record<string, unknown>
        if (
          typeof v.left !== 'number' ||
          typeof v.top !== 'number' ||
          typeof v.width !== 'number' ||
          typeof v.height !== 'number'
        ) {
          return
        }
        setAiCursor({
          label: typeof v.label === 'string' ? v.label : '',
          left: v.left,
          top: v.top,
          width: v.width,
          height: v.height
        })
        if (aiFadeTimerRef.current) window.clearTimeout(aiFadeTimerRef.current)
        aiFadeTimerRef.current = window.setTimeout(() => setAiCursor(null), AI_CURSOR_TTL_MS)
      })
      .catch(() => undefined)
  }, [executeScript])

  // Live "AI is drawing here" cursor. The watcher bumps `revision` once when the
  // watch is established (the file just loaded — baseline, no cursor); every later
  // bump means the agent wrote more, so query the newest tagged section and move
  // the cursor onto it. A static design never bumps past the baseline → no cursor.
  useEffect(() => {
    if (!preview.fileUrl) {
      aiCursorFileUrlRef.current = ''
      firstRevisionRef.current = null
      setAiCursor(null)
      return
    }
    if (aiCursorFileUrlRef.current !== preview.fileUrl) {
      aiCursorFileUrlRef.current = preview.fileUrl
      firstRevisionRef.current = preview.revision
      setAiCursor(null)
      return
    }
    if (firstRevisionRef.current === null) {
      firstRevisionRef.current = preview.revision
      return
    }
    if (preview.revision <= firstRevisionRef.current) return
    const timer = window.setTimeout(queryAiCursor, 450)
    return () => window.clearTimeout(timer)
  }, [preview.revision, preview.fileUrl, queryAiCursor])

  useEffect(
    () => () => {
      if (aiFadeTimerRef.current) window.clearTimeout(aiFadeTimerRef.current)
    },
    []
  )

  // Promote a pending preview to "ready" only once the turn has settled: the file
  // holds a complete standalone HTML document and the agent is no longer streaming.
  // This keeps the transparent generating surface up for the whole write so the
  // canvas updates live without an opaque white frame appearing mid-stream.
  useEffect(() => {
    if (!artifact?.id) return
    if (!htmlFrameShouldPromotePreviewToReady({
      previewStatus: artifact.previewStatus,
      previewRenderState: preview.renderState,
      drawingActive,
      artifactRelativePath,
      previewRelativePath: preview.relativePath
    })) {
      return
    }
    setArtifactPreviewStatus(artifact.id, 'ready')
  }, [
    artifact?.id,
    artifact?.previewStatus,
    artifactRelativePath,
    preview.relativePath,
    preview.renderState,
    drawingActive,
    setArtifactPreviewStatus
  ])

  useEffect(() => {
    if (!preview.webviewUrl || artifactKind !== 'html' || !artifact?.id || !artifactRelativePath) return
    const wv = webview
    if (!wv) return
    let cancelled = false
    let timer = 0
    const queueAudit = (): void => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (cancelled) return
        const epoch = previewAsyncEpochRef.current
        if (!epoch) return
        const audit = executeScript(buildDesignRuntimeQualityAuditScript())
        if (!audit) return
        void audit
          .then((value) => {
            if (cancelled) return
            if (!htmlFramePreviewAsyncEpochMatches(epoch, previewAsyncEpochRef.current)) return
            const findings = normalizeRuntimeQualityFindings(value)
            setQualityChecked(true)
            setQualityFindings(findings)
            setDesignRuntimeQualityFindings(artifactRelativePath, findings)
            const signature = JSON.stringify(findings.map((finding) => [
              finding.code,
              finding.severity,
              finding.message
            ]))
            if (signature === qualitySignatureRef.current) return
            qualitySignatureRef.current = signature
            onRuntimeQualityFindings?.({
              artifactId: artifact.id,
              artifactRelativePath,
              shapeId: shape.id,
              findings
            })
          })
          .catch(() => undefined)
      }, 750)
    }
    wv.addEventListener('dom-ready', queueAudit)
    wv.addEventListener('did-finish-load', queueAudit)
    queueAudit()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      wv.removeEventListener('dom-ready', queueAudit)
      wv.removeEventListener('did-finish-load', queueAudit)
    }
  }, [
    artifact?.id,
    artifactKind,
    artifactRelativePath,
    onRuntimeQualityFindings,
    shape.id,
    executeScript,
    webview,
    webviewMountNonce,
    preview.webviewUrl,
    preview.revision
  ])

  if (screenWidth < 20 || screenHeight < 20) return <></>

  const drawingLabel = parallelState?.status === 'queued' ? 'AI 排队中…' : 'AI 正在绘制…'
  const failedMessage = parallelState?.status === 'failed'
    ? parallelState.error || '生成失败'
    : ''
  const frameRadius = Math.min(7, Math.max(3, screenWidth * 0.012))
  const chromeOffset = Math.min(28, Math.max(18, screenWidth * 0.045))
  const showChrome = screenWidth > 92 && screenHeight > 42
  const placeholderPreview = !preview.hasRenderableContent && preview.renderState !== 'renderable'
  const transparentGeneratingSurface = placeholderPreview || drawingActive
  const visualCanvasHeight = htmlFrameVisualCanvasHeight(
    canvasHeight,
    measuredContentSize?.height ?? null,
    htmlFrameShouldCropVisualHeight({ transparentGeneratingSurface, autoResizeEnabled })
  )
  const visualScreenHeight = (visualCanvasHeight / canvasHeight) * screenHeight
  return (
    <div
      className="absolute overflow-visible"
      style={{
        left: screenX,
        top: screenY,
        width: screenWidth,
        height: visualScreenHeight,
        pointerEvents: htmlFrameOverlayPointerEvents({ panning, interactive, editing }),
        borderRadius: frameRadius
      }}
      onDoubleClick={handleDoubleClick}
    >
      {showChrome ? (
        <div
          className="pointer-events-none absolute left-0 right-0 z-20 flex items-center justify-between gap-2 text-[#7b8493] dark:text-[#9aa3b2]"
          style={{
            top: -chromeOffset,
            height: chromeOffset - 4,
            fontSize: Math.min(12, Math.max(10, screenWidth * 0.018))
          }}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <Monitor className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
            <span className="min-w-0 truncate font-medium">{shape.name}</span>
          </div>
          {active && !interactive && !drawingActive && !failedMessage ? (
            <div className="pointer-events-auto flex shrink-0 items-center gap-1.5">
              <HtmlFrameQualityControl
                available={Boolean(preview.webviewUrl && screenWidth > 220)}
                open={qualityDetailsOpen}
                onOpenChange={setQualityDetailsOpen}
                screenWidth={screenWidth}
                artifactId={artifact?.id}
                artifactRelativePath={artifactRelativePath}
                shapeId={shape.id}
                qualityChecked={qualityChecked}
                qualityFindings={qualityFindings}
                onRequestQualityRepair={onRequestQualityRepair}
              />
              {preview.webviewUrl && screenWidth > 170 ? (
                <>
                  {editing ? (
                    <span className="rounded-full border border-accent/30 bg-white/88 px-2 py-1 text-[10.5px] font-medium text-accent shadow-sm backdrop-blur-md dark:bg-ds-card/88">
                      点击文字进行修改
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleModify(shape.id)
                    }}
                    title={editing ? '完成修改' : '修改内容'}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-semibold shadow-[0_10px_30px_rgba(20,47,95,0.12)] backdrop-blur-md transition ${
                      editing
                        ? 'border-accent bg-accent text-white hover:opacity-90'
                        : 'border-ds-border bg-white/90 text-ds-ink hover:bg-white dark:bg-ds-card/88'
                    }`}
                  >
                    {editing ? (
                      <Check className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                    ) : (
                      <PenLine className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" />
                    )}
                    {editing ? '完成' : '修改'}
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        className={`relative h-full w-full overflow-hidden border ${
          transparentGeneratingSurface
            ? active
              ? 'border-dashed border-[#6557ff] bg-transparent shadow-none'
              : 'border-dashed border-ds-border/70 bg-transparent shadow-none dark:border-white/20'
            : `bg-white shadow-[0_12px_30px_rgba(15,23,42,0.10)] dark:bg-[#101214] ${
                active
                  ? 'border-[#6557ff] shadow-[0_0_0_1px_rgba(101,87,255,0.45),0_16px_38px_rgba(15,23,42,0.14)]'
                  : 'border-black/10 dark:border-white/12'
              }`
        }`}
        style={{ borderRadius: frameRadius }}
      >
        <div
          className="absolute left-0 top-0 overflow-hidden"
          style={{
            width: screenWidth,
            height: visualScreenHeight
          }}
        >
          {preview.webviewUrl ? (
            renderWebview({
              className: 'block border-0',
              style: {
                width: screenWidth,
                height: visualScreenHeight,
                pointerEvents: interactive ? 'auto' : 'none'
              }
            })
          ) : (
            <HtmlFramePlaceholder
              transparentGeneratingSurface={transparentGeneratingSurface}
              drawingActive={drawingActive}
              placeholderPreview={placeholderPreview}
              previewError={previewError}
              failedMessage={failedMessage}
              hasArtifact={Boolean(artifact)}
              drawingLabel={drawingLabel}
              screenWidth={screenWidth}
            />
          )}
          {preview.webviewUrl && drawingActive && !aiCursor ? (
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute right-3 top-3 flex max-w-[70%] items-center gap-1.5 rounded-full border border-accent/30 bg-white/88 px-2.5 py-1.5 text-[11px] font-semibold text-accent shadow-[0_10px_30px_rgba(20,47,95,0.14)] backdrop-blur-md">
                <Brush className="h-3.5 w-3.5 animate-pulse" strokeWidth={1.8} aria-hidden="true" />
                <span className="min-w-0 truncate">{drawingLabel}</span>
              </div>
            </div>
          ) : null}
          {preview.webviewUrl && failedMessage ? (
            <div className="pointer-events-none absolute inset-x-3 top-3 rounded-md border border-red-300/70 bg-white/92 px-2.5 py-1.5 text-[11px] font-semibold text-red-600 shadow-sm">
              {failedMessage}
            </div>
          ) : null}
          {preview.webviewUrl && editing && !interactive ? (
            <div
              className="absolute inset-0 cursor-crosshair"
              title="点击元素进行修改"
              onPointerDown={selectElementAt}
            />
          ) : null}
          {selectedElementRect && editing && !interactive ? (
            <div
              className="pointer-events-none absolute border border-accent bg-accent/10 shadow-[0_0_0_1px_rgba(255,255,255,0.75)]"
              style={{
                left: selectedElementRect.left * zoom,
                top: selectedElementRect.top * zoom,
                width: selectedElementRect.width * zoom,
                height: selectedElementRect.height * zoom
              }}
            />
          ) : null}
          <HtmlFrameAiCursorOverlay
            cursor={aiCursor}
            zoom={zoom}
            screenWidth={screenWidth}
            visualScreenHeight={visualScreenHeight}
          />
        </div>
      </div>
    </div>
  )
}

export const ScreenOverlay = memo(ScreenOverlayInner)
