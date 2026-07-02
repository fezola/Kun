import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useCanvasViewportStore } from '../../../design/canvas/canvas-viewport-store'
import { useCanvasUiScale } from '../../../design/canvas/canvas-ui-scale'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import { useImageAnnotationStore } from '../../../design/canvas/image-annotation-store'
import { useCanvasUndoStore } from '../../../design/canvas/canvas-undo-store'
import { createHandTool } from '../../../design/canvas/tools/hand-tool'
import type { CanvasToolHandler } from '../../../design/canvas/tools/tool-types'
import type { CanvasDocument, Rect } from '../../../design/canvas/canvas-types'
import { createEmptyDocument } from '../../../design/canvas/canvas-types'
import { canvasDocumentKey, loadCanvasDocument, persistCanvasDocument } from '../../../design/canvas/canvas-persistence'
import { loadDesignSystem, persistDesignSystem } from '../../../design/canvas/design-system-persistence'
import { useDesignSystemStore } from '../../../design/canvas/design-system-store'
import { createEmptyDesignSystem } from '../../../design/canvas/design-system-types'
import {
  buildHtmlArtifactSyncKey,
  syncHtmlArtifactsToBoardDocument,
  syncHtmlFrameNodesToArtifacts
} from '../../../design/design-board'
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
import { hasPrototypePlayback, resolvePreferredPrototypeArtifactId } from '../../../design/prototype-player'
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
import {
  boundsForShapeIds,
  canvasViewportStorageKey,
  createCanvasTool,
  readStoredCanvasViewport,
  shouldHandleCanvasKeyboardEvent,
  shouldOpenImageAnnotation,
  shouldRenderCanvasMinimap,
  shouldRenderDesignArtifactOverlays,
  shouldSyncCanvasHtmlFrames,
  shouldToggleHtmlFrameInteractiveOnDoubleClick,
  writeStoredCanvasViewport,
  resolveCanvasDesignSystemBaseDir
} from './canvas-viewport/helpers'

export {
  resolveCanvasDesignSystemBaseDir,
  shouldHandleCanvasKeyboardEvent,
  shouldOpenImageAnnotation,
  shouldRenderCanvasMinimap,
  shouldRenderDesignArtifactOverlays,
  shouldSyncCanvasHtmlFrames,
  shouldToggleHtmlFrameInteractiveOnDoubleClick
} from './canvas-viewport/helpers'

type Props = {
  workspaceRoot: string
  artifactId: string
  /** Workspace subdirectory the canvas doc persists under. Defaults to `.kun-design`. */
  baseDir?: string
  /** Optional design-system directory. Defaults to baseDir; Code canvases use a per-thread dir. */
  designSystemBaseDir?: string
  surface?: 'design' | 'code'
  leftSidebarCollapsed?: boolean
  onToggleLeftSidebar?: () => void
  busy?: boolean
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
  designSystemBaseDir,
  surface = 'design',
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  busy = false,
  onOpenAgentSettings,
  syncHtmlScreens = false,
  onUseElementAsContext,
  onRuntimeQualityFindings,
  onRequestQualityRepair
}: Props) {
  const { t } = useTranslation('common')
  const rootRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const activePointerToolRef = useRef<CanvasToolHandler | null>(null)

  const document = useCanvasShapeStore((s) => s.document)
  const vbox = useCanvasViewportStore((s) => s.vbox)
  const activeTool = useCanvasViewportStore((s) => s.activeTool)
  const setActiveTool = useCanvasViewportStore((s) => s.setActiveTool)
  const gridVisible = useCanvasViewportStore((s) => s.gridVisible)
  const containerWidth = useCanvasViewportStore((s) => s.containerWidth)
  const setContainerSize = useCanvasViewportStore((s) => s.setContainerSize)
  const designArtifacts = useDesignWorkspaceStore((s) => s.artifacts)
  const activeArtifactId = useDesignWorkspaceStore((s) => s.activeArtifactId)
  const designTarget = useDesignWorkspaceStore((s) => s.designContext.designTarget ?? 'web')
  const pagesRun = useDesignWorkspaceStore((s) => s.pagesRun)

  const selectedIds = useCanvasSelectionStore((s) => s.selectedIds)
  const hoverTargetId = useCanvasSelectionStore((s) => s.hoverTargetId)
  const marqueeRect = useCanvasSelectionStore((s) => s.marqueeRect)
  const snapGuides = useCanvasSelectionStore((s) => s.activeSnapGuides)

  const [docLoaded, setDocLoaded] = useState(false)
  const [prototypePlayerOpen, setPrototypePlayerOpen] = useState(false)
  const [interactiveHtmlFrameId, setInteractiveHtmlFrameId] = useState<string | null>(null)
  const [editingHtmlFrameId, setEditingHtmlFrameId] = useState<string | null>(null)

  const requestCanvasCritique = useCallback((promptSeed: string): void => {
    onUseElementAsContext?.(null, promptSeed)
  }, [onUseElementAsContext])
  const requestMissingPrototypeScreen = useCallback((promptSeed: string): void => {
    onUseElementAsContext?.(null, promptSeed)
  }, [onUseElementAsContext])

  const toggleHtmlFrameInteractive = useCallback((shapeId: string): void => {
    setEditingHtmlFrameId(null)
    setInteractiveHtmlFrameId((prev) => (prev === shapeId ? null : shapeId))
  }, [])

  const toggleHtmlFrameModify = useCallback((shapeId: string): void => {
    setInteractiveHtmlFrameId(null)
    setEditingHtmlFrameId((prev) => (prev === shapeId ? null : shapeId))
  }, [])

  useEffect(() => {
    if (interactiveHtmlFrameId && !selectedIds.has(interactiveHtmlFrameId)) {
      setInteractiveHtmlFrameId(null)
    }
    if (editingHtmlFrameId && !selectedIds.has(editingHtmlFrameId)) {
      setEditingHtmlFrameId(null)
    }
  }, [editingHtmlFrameId, interactiveHtmlFrameId, selectedIds])

  const designArtifactOverlaysEnabled = shouldRenderDesignArtifactOverlays(surface)
  const minimapEnabled = shouldRenderCanvasMinimap(surface)
  const htmlFrameSyncEnabled = shouldSyncCanvasHtmlFrames(surface, syncHtmlScreens)
  const resolvedDesignSystemBaseDir = resolveCanvasDesignSystemBaseDir(baseDir, designSystemBaseDir)
  const zoom = containerWidth / vbox.width
  const uiScale = useCanvasUiScale()
  const tool = useMemo(() => createCanvasTool(activeTool, surface), [activeTool, surface])
  const middlePanTool = useMemo(() => createHandTool(), [])
  const workspaceValue = useMemo(() => ({ workspaceRoot }), [workspaceRoot])
  const viewportStorageKey = useMemo(
    () => canvasViewportStorageKey(workspaceRoot, artifactId, baseDir),
    [artifactId, baseDir, workspaceRoot]
  )
  const documentKey = useMemo(
    () => canvasDocumentKey(workspaceRoot, artifactId, baseDir),
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
  const initialPrototypeArtifactId = useMemo(
    () => resolvePreferredPrototypeArtifactId(designArtifacts, selectedHtmlArtifactId, activeArtifactId),
    [activeArtifactId, designArtifacts, selectedHtmlArtifactId]
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

  useEffect(() => {
    if (surface === 'code' && activeTool === 'screen') {
      setActiveTool('select')
    }
  }, [activeTool, setActiveTool, surface])

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
    useCanvasShapeStore.getState().loadDocument(createEmptyDocument(), documentKey)
    useCanvasViewportStore.getState().resetView()
    useCanvasUndoStore.getState().clear()

    // 2) Load from disk, fall back to empty document
    void loadCanvasDocument(workspaceRoot, artifactId, baseDir).then((loaded) => {
      if (cancelled) return
      let doc = loaded ?? createEmptyDocument()
      let addedFrameIds: string[] = []
      if (htmlFrameSyncEnabled) {
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
      useCanvasShapeStore.getState().loadDocument(doc, documentKey)
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
    void loadDesignSystem(workspaceRoot, resolvedDesignSystemBaseDir).then((system) => {
      if (cancelled) return
      useDesignSystemStore.getState().loadSystem(system ?? createEmptyDesignSystem())
    })

    // 3) Subscribe to document changes and persist (debounced by persistCanvasDocument)
    const unsubscribe = useCanvasShapeStore.subscribe((state, prev) => {
      if (cancelled) return
      if (state.document === prev.document) return
      persistCanvasDocument(workspaceRoot, artifactId, state.document, baseDir)
      if (htmlFrameSyncEnabled) queueHtmlFrameNodeSync(state.document)
    })

    // 3b) Persist the design system when tokens/components change (debounced).
    const unsubscribeDesignSystem = useDesignSystemStore.subscribe((state, prev) => {
      if (cancelled) return
      if (state.system === prev.system) return
      persistDesignSystem(workspaceRoot, state.system, resolvedDesignSystemBaseDir)
    })

    return () => {
      cancelled = true
      if (viewFrame) cancelAnimationFrame(viewFrame)
      if (nodeSyncTimer) clearTimeout(nodeSyncTimer)
      unsubscribe()
      unsubscribeDesignSystem()
    }
  }, [workspaceRoot, artifactId, baseDir, documentKey, htmlFrameSyncEnabled, resolvedDesignSystemBaseDir, viewportStorageKey])

  const htmlArtifactSyncKey = useMemo(() => {
    if (!htmlFrameSyncEnabled) return ''
    return buildHtmlArtifactSyncKey(designArtifacts, designTarget)
  }, [designArtifacts, designTarget, htmlFrameSyncEnabled])

  useEffect(() => {
    if (!docLoaded || !htmlFrameSyncEnabled || !artifactId || !workspaceRoot) return
    const current = useCanvasShapeStore.getState().document
    const synced = syncHtmlArtifactsToBoardDocument(current, useDesignWorkspaceStore.getState().artifacts)
    if (synced.addedFrameIds.length === 0 && synced.updatedFrameIds.length === 0) return
    useCanvasShapeStore.getState().loadDocument(synced.document, documentKey)
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
  }, [artifactId, baseDir, docLoaded, documentKey, htmlArtifactSyncKey, htmlFrameSyncEnabled, workspaceRoot])

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
      if (surface === 'code') rootRef.current?.focus({ preventScroll: true })
      e.currentTarget.setPointerCapture(e.pointerId)
      const pointerTool = e.button === 1 ? middlePanTool : tool
      activePointerToolRef.current = pointerTool
      pointerTool.onPointerDown(makePointerEvent(e))
    },
    [middlePanTool, tool, makePointerEvent, surface]
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
      if (shouldToggleHtmlFrameInteractiveOnDoubleClick(surface, shape)) {
        useCanvasSelectionStore.getState().select([hitId])
        toggleHtmlFrameInteractive(hitId)
        return
      }
      if (shape?.type === 'text') {
        useCanvasSelectionStore.getState().select([hitId])
        useCanvasSelectionStore.getState().setEditing(hitId)
        return
      }
      // Double-clicking a filled image opens the annotation editor: draw markup
      // over the picture, then the agent re-edits it (image-to-image).
      if (shouldOpenImageAnnotation(surface, shape)) {
        useCanvasSelectionStore.getState().select([hitId])
        useImageAnnotationStore.getState().openImageAnnotation(hitId)
      }
    },
    [screenToCanvas, surface, toggleHtmlFrameInteractive]
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
      if (!shouldHandleCanvasKeyboardEvent(surface, e.target, rootRef.current)) return
      handleCanvasKeyDown(e)
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (!shouldHandleCanvasKeyboardEvent(surface, e.target, rootRef.current)) return
      handleCanvasKeyUp(e)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      setCanvasPasteWorkspaceRoot(null)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [surface, workspaceRoot])

  const viewBoxStr = `${vbox.x} ${vbox.y} ${vbox.width} ${vbox.height}`
  const cursor = activeTool === 'hand' ? 'grab' : tool.cursor

  const root = document?.objects?.[document?.rootId]

  return (
    <CanvasWorkspaceContext.Provider value={workspaceValue}>
      <div
        ref={rootRef}
        tabIndex={surface === 'code' ? -1 : undefined}
        className="ds-no-drag relative h-full w-full overflow-hidden bg-[#f8fafc] outline-none dark:bg-[#111318]"
      >
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
            surface={surface}
            designTargetDisabled={busy || Boolean(pagesRun)}
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
        {minimapEnabled ? (
          <div
            className="pointer-events-none absolute bottom-4 left-4 z-40 hidden md:block"
            style={{ transform: `scale(${uiScale})`, transformOrigin: 'bottom left' }}
          >
            <div className="pointer-events-auto">
              <CanvasMinimap />
            </div>
          </div>
        ) : null}
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
          {designArtifactOverlaysEnabled ? (
            <HtmlFrameOverlay
              workspaceRoot={workspaceRoot}
              interactiveId={interactiveHtmlFrameId}
              editingId={editingHtmlFrameId}
              onToggleInteractive={toggleHtmlFrameInteractive}
              onToggleModify={toggleHtmlFrameModify}
              onUseElementAsContext={onUseElementAsContext}
              onRuntimeQualityFindings={onRuntimeQualityFindings}
              onRequestQualityRepair={onRequestQualityRepair}
            />
          ) : null}
          {designArtifactOverlaysEnabled && docLoaded && root ? (
            <svg
              className="pointer-events-none absolute inset-0 z-10 h-full w-full"
              viewBox={viewBoxStr}
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
              focusable="false"
            >
              <PrototypeFlowOverlay
                artifacts={designArtifacts}
                objects={document.objects}
                zoom={zoom}
              />
            </svg>
          ) : null}
        </div>
        {designArtifactOverlaysEnabled ? (
          <PrototypePlayerOverlay
            open={prototypePlayerOpen}
            workspaceRoot={workspaceRoot}
            artifacts={designArtifacts}
            initialArtifactId={initialPrototypeArtifactId}
            designTarget={designTarget}
            onClose={() => setPrototypePlayerOpen(false)}
            onRequestMissingScreen={requestMissingPrototypeScreen}
          />
        ) : null}
      </div>
    </CanvasWorkspaceContext.Provider>
  )
}
