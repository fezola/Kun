import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useCanvasViewportStore } from '../../../design/canvas/canvas-viewport-store'
import { useCanvasUiScale } from '../../../design/canvas/canvas-ui-scale'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import { useImageAnnotationStore } from '../../../design/canvas/image-annotation-store'
import { useCanvasUndoStore } from '../../../design/canvas/canvas-undo-store'
import { createSelectTool } from '../../../design/canvas/tools/select-tool'
import { createRectTool } from '../../../design/canvas/tools/rect-tool'
import { createEllipseTool } from '../../../design/canvas/tools/ellipse-tool'
import { createTextTool } from '../../../design/canvas/tools/text-tool'
import { createFrameTool } from '../../../design/canvas/tools/frame-tool'
import { createHandTool } from '../../../design/canvas/tools/hand-tool'
import { createScreenTool } from '../../../design/canvas/tools/screen-tool'
import { createArrowTool, createLineTool } from '../../../design/canvas/tools/linear-tool'
import { createDrawTool } from '../../../design/canvas/tools/draw-tool'
import type { CanvasToolHandler } from '../../../design/canvas/tools/tool-types'
import type { CanvasDocument, CanvasTool, Rect, ViewBox } from '../../../design/canvas/canvas-types'
import { createEmptyDocument, shapeBounds } from '../../../design/canvas/canvas-types'
import { loadCanvasDocument, persistCanvasDocument } from '../../../design/canvas/canvas-persistence'
import { loadDesignSystem, persistDesignSystem } from '../../../design/canvas/design-system-persistence'
import { useDesignSystemStore } from '../../../design/canvas/design-system-store'
import { createEmptyDesignSystem } from '../../../design/canvas/design-system-types'
import { syncHtmlArtifactsToBoardDocument, syncHtmlFrameNodesToArtifacts } from '../../../design/design-board'
import {
  getCanvasDocumentContentBounds
} from '../../../design/canvas/canvas-placement'
import type { DesignArtifact } from '../../../design/design-types'
import type { DesignHtmlElementContext } from '../../../design/design-composer-context'
import { useDesignWorkspaceStore } from '../../../design/design-workspace-store'
import type { DesignRuntimeQualityPayload } from '../../../design/design-html-quality'
import { CanvasWorkspaceContext } from '../../../design/canvas/canvas-workspace-context'
import {
  handleCanvasKeyDown,
  handleCanvasKeyUp,
  setCanvasPasteWorkspaceRoot
} from '../../../design/canvas/canvas-shortcuts'
import { hitTest } from '../../../design/canvas/canvas-hit-test'
import { hasPrototypePlayback } from '../../../design/prototype-player'
import { ShapeDispatcher } from './shapes/ShapeDispatcher'
import { CanvasGrid } from './CanvasGrid'
import { CanvasToolbar } from './CanvasToolbar'
import { CanvasZoomBar } from './CanvasZoomBar'
import { CanvasMinimap } from './CanvasMinimap'
import { SelectionOverlay } from './SelectionOverlay'
import { PrototypeFlowOverlay } from './PrototypeFlowOverlay'
import { PrototypePlayerOverlay } from './PrototypePlayerOverlay'
import { AlignmentToolbar } from './AlignmentToolbar'
import { HtmlFrameOverlay } from './HtmlFrameOverlay'
import { SidebarTitlebarToggleButton } from '../../sidebar/SidebarPrimitives'

const CANVAS_VIEWPORT_STORAGE_PREFIX = 'kun.design.canvasViewport'

function canvasViewportStorageKey(workspaceRoot: string, artifactId: string, baseDir?: string): string {
  return [
    CANVAS_VIEWPORT_STORAGE_PREFIX,
    encodeURIComponent(workspaceRoot),
    encodeURIComponent(baseDir ?? ''),
    encodeURIComponent(artifactId)
  ].join(':')
}

function isViewBox(value: unknown): value is ViewBox {
  if (!value || typeof value !== 'object') return false
  const box = value as Partial<ViewBox>
  return (
    typeof box.x === 'number' &&
    typeof box.y === 'number' &&
    typeof box.width === 'number' &&
    typeof box.height === 'number' &&
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height) &&
    box.width > 0 &&
    box.height > 0
  )
}

function readStoredCanvasViewport(key: string): ViewBox | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return isViewBox(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeStoredCanvasViewport(key: string, vbox: ViewBox): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(key, JSON.stringify(vbox))
  } catch {
    // Ignore private-mode/quota failures; view persistence is best-effort.
  }
}

function boundsForShapeIds(doc: CanvasDocument, ids: readonly string[]): Rect | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let found = false
  for (const id of ids) {
    const shape = doc.objects[id]
    if (!shape) continue
    const bounds = shapeBounds(shape)
    found = true
    minX = Math.min(minX, bounds.x)
    minY = Math.min(minY, bounds.y)
    maxX = Math.max(maxX, bounds.x + bounds.width)
    maxY = Math.max(maxY, bounds.y + bounds.height)
  }
  if (!found) return null
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
}

const toolFactories: Record<CanvasTool, () => CanvasToolHandler> = {
  select: createSelectTool,
  rect: createRectTool,
  ellipse: createEllipseTool,
  text: createTextTool,
  frame: createFrameTool,
  screen: createScreenTool,
  image: createSelectTool,
  arrow: createArrowTool,
  line: createLineTool,
  draw: createDrawTool,
  hand: createHandTool
}

type Props = {
  workspaceRoot: string
  artifactId: string
  /** Workspace subdirectory the canvas doc persists under. Defaults to `.kun-design`. */
  baseDir?: string
  leftSidebarCollapsed?: boolean
  onToggleLeftSidebar?: () => void
  onOpenAgentSettings?: () => void
  syncHtmlScreens?: boolean
  onImplementDesign?: (artifact: DesignArtifact) => void
  onUseElementAsContext?: (context: DesignHtmlElementContext | null, promptSeed?: string) => void
  onRuntimeQualityFindings?: (payload: DesignRuntimeQualityPayload) => void
  onRequestQualityRepair?: (payload: DesignRuntimeQualityPayload) => void
}

export function CanvasViewport({
  workspaceRoot,
  artifactId,
  baseDir,
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  onOpenAgentSettings,
  syncHtmlScreens = false,
  onUseElementAsContext,
  onRuntimeQualityFindings,
  onRequestQualityRepair
}: Props) {
  const { t } = useTranslation('common')
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const activePointerToolRef = useRef<CanvasToolHandler | null>(null)

  const document = useCanvasShapeStore((s) => s.document)
  const vbox = useCanvasViewportStore((s) => s.vbox)
  const activeTool = useCanvasViewportStore((s) => s.activeTool)
  const gridVisible = useCanvasViewportStore((s) => s.gridVisible)
  const containerWidth = useCanvasViewportStore((s) => s.containerWidth)
  const setContainerSize = useCanvasViewportStore((s) => s.setContainerSize)
  const designArtifacts = useDesignWorkspaceStore((s) => s.artifacts)

  const selectedIds = useCanvasSelectionStore((s) => s.selectedIds)
  const hoverTargetId = useCanvasSelectionStore((s) => s.hoverTargetId)
  const marqueeRect = useCanvasSelectionStore((s) => s.marqueeRect)
  const snapGuides = useCanvasSelectionStore((s) => s.activeSnapGuides)

  const [docLoaded, setDocLoaded] = useState(false)
  const [prototypePlayerOpen, setPrototypePlayerOpen] = useState(false)

  const requestCanvasCritique = useCallback((promptSeed: string): void => {
    onUseElementAsContext?.(null, promptSeed)
  }, [onUseElementAsContext])
  const requestMissingPrototypeScreen = useCallback((promptSeed: string): void => {
    onUseElementAsContext?.(null, promptSeed)
  }, [onUseElementAsContext])

  const zoom = containerWidth / vbox.width
  const uiScale = useCanvasUiScale()
  const tool = useMemo(() => toolFactories[activeTool](), [activeTool])
  const middlePanTool = useMemo(() => createHandTool(), [])
  const workspaceValue = useMemo(() => ({ workspaceRoot }), [workspaceRoot])
  const viewportStorageKey = useMemo(
    () => canvasViewportStorageKey(workspaceRoot, artifactId, baseDir),
    [artifactId, baseDir, workspaceRoot]
  )
  const selectedHtmlArtifactId = useMemo(() => {
    for (const id of selectedIds) {
      const shape = document.objects[id]
      if (shape?.htmlArtifactId) return shape.htmlArtifactId
    }
    return null
  }, [document.objects, selectedIds])
  const prototypePlayable = useMemo(
    () => hasPrototypePlayback(designArtifacts),
    [designArtifacts]
  )

  // Container resize observer
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        setContainerSize(entry.contentRect.width, entry.contentRect.height)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [setContainerSize])

  // Data flow loop: load on artifact change, persist on doc change, reset on unmount/switch
  useEffect(() => {
    if (!artifactId || !workspaceRoot) {
      setDocLoaded(false)
      return
    }

    let cancelled = false
    let viewFrame = 0
    let nodeSyncTimer: ReturnType<typeof setTimeout> | null = null
    let nodeSyncDoc: CanvasDocument | null = null
    setDocLoaded(false)

    const focusBoundsAtActualSize = (bounds: Rect | null): void => {
      if (!bounds) return
      viewFrame = requestAnimationFrame(() => {
        if (!cancelled) {
          const store = useCanvasViewportStore.getState()
          const width = Math.max(1, store.containerWidth)
          const height = Math.max(1, store.containerHeight)
          store.setVbox({
            x: bounds.x + bounds.width / 2 - width / 2,
            y: bounds.y + bounds.height / 2 - height / 2,
            width,
            height
          })
        }
      })
    }

    const queueHtmlFrameNodeSync = (doc: CanvasDocument): void => {
      nodeSyncDoc = doc
      if (nodeSyncTimer) clearTimeout(nodeSyncTimer)
      nodeSyncTimer = setTimeout(() => {
        nodeSyncTimer = null
        if (!cancelled && nodeSyncDoc) syncHtmlFrameNodesToArtifacts(nodeSyncDoc)
      }, 180)
    }

    // 1) Reset transient state for the new artifact
    useCanvasSelectionStore.getState().clearSelection()
    useCanvasSelectionStore.getState().setMarquee(null)
    useCanvasSelectionStore.getState().setHoverTarget(null)
    useCanvasViewportStore.getState().resetView()
    useCanvasUndoStore.getState().clear()

    // 2) Load from disk, fall back to empty document
    void loadCanvasDocument(workspaceRoot, artifactId, baseDir).then((loaded) => {
      if (cancelled) return
      let doc = loaded ?? createEmptyDocument()
      let addedFrameIds: string[] = []
      if (syncHtmlScreens) {
        const synced = syncHtmlArtifactsToBoardDocument(
          doc,
          useDesignWorkspaceStore.getState().artifacts
        )
        doc = synced.document
        addedFrameIds = synced.addedFrameIds
        if (synced.addedFrameIds.length > 0 || synced.updatedFrameIds.length > 0) {
          persistCanvasDocument(workspaceRoot, artifactId, doc, baseDir)
        }
      }
      useCanvasShapeStore.getState().loadDocument(doc)
      const storedView = readStoredCanvasViewport(viewportStorageKey)
      if (storedView) {
        useCanvasViewportStore.getState().setVbox(storedView)
      } else if (addedFrameIds.length > 0) {
        focusBoundsAtActualSize(boundsForShapeIds(doc, addedFrameIds))
      } else if (loaded) {
        focusBoundsAtActualSize(getCanvasDocumentContentBounds(doc))
      }
      setDocLoaded(true)
    })

    // 2b) Load the doc-level design system (tokens + components), shared across
    // this document's artifacts. Reset to empty when none on disk.
    void loadDesignSystem(workspaceRoot, baseDir).then((system) => {
      if (cancelled) return
      useDesignSystemStore.getState().loadSystem(system ?? createEmptyDesignSystem())
    })

    // 3) Subscribe to document changes and persist (debounced by persistCanvasDocument)
    const unsubscribe = useCanvasShapeStore.subscribe((state, prev) => {
      if (cancelled) return
      if (state.document === prev.document) return
      persistCanvasDocument(workspaceRoot, artifactId, state.document, baseDir)
      queueHtmlFrameNodeSync(state.document)
    })

    // 3b) Persist the design system when tokens/components change (debounced).
    const unsubscribeDesignSystem = useDesignSystemStore.subscribe((state, prev) => {
      if (cancelled) return
      if (state.system === prev.system) return
      persistDesignSystem(workspaceRoot, state.system, baseDir)
    })

    return () => {
      cancelled = true
      if (viewFrame) cancelAnimationFrame(viewFrame)
      if (nodeSyncTimer) clearTimeout(nodeSyncTimer)
      unsubscribe()
      unsubscribeDesignSystem()
    }
  }, [workspaceRoot, artifactId, baseDir, syncHtmlScreens, viewportStorageKey])

  const htmlArtifactSyncKey = useMemo(() => {
    if (!syncHtmlScreens) return ''
    return designArtifacts
      .filter((artifact) => artifact.kind === 'html')
      .map((artifact) => {
        const node = artifact.node
        return [
          artifact.id,
          artifact.title,
          node?.x ?? '',
          node?.y ?? '',
          node?.width ?? '',
          node?.height ?? ''
        ].join(':')
      })
      .join('|')
  }, [designArtifacts, syncHtmlScreens])

  useEffect(() => {
    if (!docLoaded || !syncHtmlScreens || !artifactId || !workspaceRoot) return
    const current = useCanvasShapeStore.getState().document
    const synced = syncHtmlArtifactsToBoardDocument(current, useDesignWorkspaceStore.getState().artifacts)
    if (synced.addedFrameIds.length === 0 && synced.updatedFrameIds.length === 0) return
    useCanvasShapeStore.getState().loadDocument(synced.document)
    persistCanvasDocument(workspaceRoot, artifactId, synced.document, baseDir)
    if (synced.addedFrameIds.length > 0) {
      const bounds = boundsForShapeIds(synced.document, synced.addedFrameIds)
      if (bounds) {
        const store = useCanvasViewportStore.getState()
        const width = Math.max(1, store.containerWidth)
        const height = Math.max(1, store.containerHeight)
        store.setVbox({
          x: bounds.x + bounds.width / 2 - width / 2,
          y: bounds.y + bounds.height / 2 - height / 2,
          width,
          height
        })
      }
    }
  }, [artifactId, baseDir, docLoaded, htmlArtifactSyncKey, syncHtmlScreens, workspaceRoot])

  useEffect(() => {
    if (!docLoaded || !artifactId || !workspaceRoot) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = useCanvasViewportStore.subscribe((state, prev) => {
      if (state.vbox === prev.vbox) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        writeStoredCanvasViewport(viewportStorageKey, useCanvasViewportStore.getState().vbox)
      }, 250)
    })
    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }, [artifactId, docLoaded, viewportStorageKey, workspaceRoot])

  const screenToCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current
      if (!svg) return { x: 0, y: 0 }
      const rect = svg.getBoundingClientRect()
      const sx = (clientX - rect.left) / rect.width
      const sy = (clientY - rect.top) / rect.height
      return {
        x: vbox.x + sx * vbox.width,
        y: vbox.y + sy * vbox.height
      }
    },
    [vbox]
  )

  const makePointerEvent = useCallback(
    (e: React.PointerEvent) => {
      const canvas = screenToCanvas(e.clientX, e.clientY)
      return {
        canvasX: canvas.x,
        canvasY: canvas.y,
        clientX: e.clientX,
        clientY: e.clientY,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        timeStamp: e.timeStamp
      }
    },
    [screenToCanvas]
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 && e.button !== 1) return
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      const pointerTool = e.button === 1 ? middlePanTool : tool
      activePointerToolRef.current = pointerTool
      pointerTool.onPointerDown(makePointerEvent(e))
    },
    [middlePanTool, tool, makePointerEvent]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const pointerTool = activePointerToolRef.current ?? tool
      pointerTool.onPointerMove(makePointerEvent(e))
    },
    [tool, makePointerEvent]
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const pointerTool = activePointerToolRef.current ?? tool
      pointerTool.onPointerUp(makePointerEvent(e))
      activePointerToolRef.current = null
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
    },
    [tool, makePointerEvent]
  )

  const onPointerCancel = useCallback(
    (e: React.PointerEvent) => {
      const pointerTool = activePointerToolRef.current
      pointerTool?.onPointerUp(makePointerEvent(e))
      activePointerToolRef.current = null
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
    },
    [makePointerEvent]
  )

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const canvas = screenToCanvas(e.clientX, e.clientY)
      const doc = useCanvasShapeStore.getState().document
      const hitId = hitTest(doc, canvas.x, canvas.y)
      if (!hitId) return
      const shape = doc.objects[hitId]
      if (shape?.type === 'text') {
        useCanvasSelectionStore.getState().select([hitId])
        useCanvasSelectionStore.getState().setEditing(hitId)
        return
      }
      // Double-clicking a filled image opens the annotation editor: draw markup
      // over the picture, then the agent re-edits it (image-to-image).
      if (shape?.type === 'image' && shape.imageUrl) {
        useCanvasSelectionStore.getState().select([hitId])
        useImageAnnotationStore.getState().openImageAnnotation(hitId)
      }
    },
    [screenToCanvas]
  )

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      const store = useCanvasViewportStore.getState()
      const canvas = screenToCanvas(e.clientX, e.clientY)

      if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY > 0 ? 0.9 : 1.1
        store.zoomTo(factor, canvas)
      } else {
        const scaleX = store.vbox.width / store.containerWidth
        const scaleY = store.vbox.height / store.containerHeight
        store.pan(e.deltaX * scaleX, e.deltaY * scaleY)
      }
    },
    [screenToCanvas]
  )

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const handler = (e: WheelEvent): void => e.preventDefault()
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  useEffect(() => {
    setCanvasPasteWorkspaceRoot(workspaceRoot || null)
    const onKeyDown = (e: KeyboardEvent): void => {
      handleCanvasKeyDown(e)
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      handleCanvasKeyUp(e)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      setCanvasPasteWorkspaceRoot(null)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [workspaceRoot])

  const viewBoxStr = `${vbox.x} ${vbox.y} ${vbox.width} ${vbox.height}`
  const cursor = activeTool === 'hand' ? 'grab' : tool.cursor

  const root = document?.objects?.[document?.rootId]

  return (
    <CanvasWorkspaceContext.Provider value={workspaceValue}>
      <div className="ds-no-drag relative h-full w-full overflow-hidden bg-[#f8fafc] dark:bg-[#111318]">
        <div className="pointer-events-none absolute left-3 top-3 z-40 flex min-w-0 items-start">
          <div
            className={`pointer-events-auto flex min-w-0 items-center gap-2 ${
              leftSidebarCollapsed ? 'ds-window-controls-safe-inset' : ''
            }`}
          >
            {onToggleLeftSidebar ? (
              <SidebarTitlebarToggleButton
                onClick={onToggleLeftSidebar}
                title={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
                ariaLabel={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
              />
            ) : null}
          </div>
        </div>
        <div
          className="pointer-events-none absolute right-3 top-1/2 z-40 -translate-y-1/2"
          style={{ transform: `translateY(-50%) scale(${uiScale})`, transformOrigin: 'right center' }}
        >
          <CanvasToolbar
            workspaceRoot={workspaceRoot}
            prototypePlayable={prototypePlayable}
            onOpenPrototypePlayer={() => setPrototypePlayerOpen(true)}
            onOpenAgentSettings={onOpenAgentSettings}
            onRequestCanvasCritique={requestCanvasCritique}
          />
        </div>
        <div
          className="pointer-events-none absolute bottom-4 right-4 z-40 hidden lg:block"
          style={{ transform: `scale(${uiScale})`, transformOrigin: 'bottom right' }}
        >
          <div className="pointer-events-auto">
            <CanvasZoomBar />
          </div>
        </div>
        <div
          className="pointer-events-none absolute bottom-4 left-4 z-40 hidden md:block"
          style={{ transform: `scale(${uiScale})`, transformOrigin: 'bottom left' }}
        >
          <div className="pointer-events-auto">
            <CanvasMinimap />
          </div>
        </div>
        <div
          ref={containerRef}
          className="absolute inset-0 overflow-hidden bg-[#f8fafc] dark:bg-[#111318]"
        >
          <AlignmentToolbar />
          {!docLoaded || !root ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-ds-faint">
              {t('designCanvasLoading')}
            </div>
          ) : (
            <svg
              ref={svgRef}
              className="absolute inset-0 h-full w-full"
              viewBox={viewBoxStr}
              xmlns="http://www.w3.org/2000/svg"
              style={{ cursor }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              onDoubleClick={onDoubleClick}
              onWheel={onWheel}
            >
              {gridVisible && <CanvasGrid zoom={zoom} />}

              <g id="shape-layer">
                {root.children.map((childId) => {
                  const child = document.objects[childId]
                  if (!child || !child.visible) return null
                  return (
                    <ShapeDispatcher
                      key={childId}
                      shapeId={childId}
                      objects={document.objects}
                    />
                  )
                })}
              </g>

              <g id="overlay-layer">
                <PrototypeFlowOverlay
                  artifacts={designArtifacts}
                  objects={document.objects}
                  zoom={zoom}
                />
                <SelectionOverlay
                  selectedIds={selectedIds}
                  hoverTargetId={hoverTargetId}
                  marqueeRect={marqueeRect}
                  snapGuides={snapGuides}
                  objects={document.objects}
                  zoom={zoom}
                  viewBox={vbox}
                />
              </g>
            </svg>
          )}
          <HtmlFrameOverlay
            workspaceRoot={workspaceRoot}
            onUseElementAsContext={onUseElementAsContext}
            onRuntimeQualityFindings={onRuntimeQualityFindings}
            onRequestQualityRepair={onRequestQualityRepair}
          />
        </div>
        <PrototypePlayerOverlay
          open={prototypePlayerOpen}
          workspaceRoot={workspaceRoot}
          artifacts={designArtifacts}
          initialArtifactId={selectedHtmlArtifactId}
          onClose={() => setPrototypePlayerOpen(false)}
          onRequestMissingScreen={requestMissingPrototypeScreen}
        />
      </div>
    </CanvasWorkspaceContext.Provider>
  )
}
