import { createSelectTool } from '../../../../design/canvas/tools/select-tool'
import { createRectTool } from '../../../../design/canvas/tools/rect-tool'
import { createEllipseTool } from '../../../../design/canvas/tools/ellipse-tool'
import { createTextTool } from '../../../../design/canvas/tools/text-tool'
import { createFrameTool } from '../../../../design/canvas/tools/frame-tool'
import { createHandTool } from '../../../../design/canvas/tools/hand-tool'
import { createScreenTool } from '../../../../design/canvas/tools/screen-tool'
import { createAiImageTool } from '../../../../design/canvas/tools/ai-image-tool'
import { createArrowTool, createLineTool } from '../../../../design/canvas/tools/linear-tool'
import { createDrawTool } from '../../../../design/canvas/tools/draw-tool'
import type { CanvasToolHandler } from '../../../../design/canvas/tools/tool-types'
import type { CanvasDocument, CanvasTool, Rect, ViewBox } from '../../../../design/canvas/canvas-types'
import { isHtmlFrame, shapeBounds } from '../../../../design/canvas/canvas-types'

const CANVAS_VIEWPORT_STORAGE_PREFIX = 'kun.design.canvasViewport'

export function shouldRenderDesignArtifactOverlays(surface: 'design' | 'code'): boolean {
  return surface === 'design'
}

export function shouldRenderCanvasMinimap(surface: 'design' | 'code'): boolean {
  return surface === 'design'
}

export function shouldSyncCanvasHtmlFrames(
  surface: 'design' | 'code',
  syncHtmlScreens: boolean
): boolean {
  return surface === 'design' && syncHtmlScreens
}

export function shouldOpenImageAnnotation(
  surface: 'design' | 'code',
  shape: CanvasDocument['objects'][string] | undefined
): boolean {
  return (surface === 'design' || surface === 'code') && shape?.type === 'image' && Boolean(shape.imageUrl)
}

export function shouldToggleHtmlFrameInteractiveOnDoubleClick(
  surface: 'design' | 'code',
  shape: CanvasDocument['objects'][string] | undefined
): boolean {
  return shouldRenderDesignArtifactOverlays(surface) && Boolean(shape && isHtmlFrame(shape))
}

export function resolveCanvasDesignSystemBaseDir(
  baseDir: string | undefined,
  designSystemBaseDir: string | undefined
): string | undefined {
  return designSystemBaseDir ?? baseDir
}

function targetInside(root: HTMLElement | null, target: unknown): boolean {
  if (!root || !target) return false
  try {
    return root.contains(target as Node)
  } catch {
    return false
  }
}

export function shouldHandleCanvasKeyboardEvent(
  surface: 'design' | 'code',
  eventTarget: EventTarget | null,
  root: HTMLElement | null,
  activeElement?: Element | null
): boolean {
  if (surface === 'design') return true
  const active = activeElement ?? (typeof document !== 'undefined' ? document.activeElement : null)
  return targetInside(root, eventTarget) || targetInside(root, active)
}

export function canvasViewportStorageKey(workspaceRoot: string, artifactId: string, baseDir?: string): string {
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

export function readStoredCanvasViewport(key: string): ViewBox | null {
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

export function writeStoredCanvasViewport(key: string, vbox: ViewBox): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(key, JSON.stringify(vbox))
  } catch {
    // Ignore private-mode/quota failures; view persistence is best-effort.
  }
}

export function boundsForShapeIds(doc: CanvasDocument, ids: readonly string[]): Rect | null {
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

export function filterShapeIdsPresentInDocument(
  doc: CanvasDocument,
  ids: Iterable<string>
): string[] {
  return [...ids].filter((id) => Boolean(doc.objects[id]))
}

export function resolveCanvasSelectionAfterDocumentSync(
  doc: CanvasDocument,
  state: {
    selectedIds: Iterable<string>
    editingId: string | null
    hoverTargetId: string | null
  }
): {
  selectedIds: string[]
  editingId: string | null
  hoverTargetId: string | null
} {
  return {
    selectedIds: filterShapeIdsPresentInDocument(doc, state.selectedIds),
    editingId: state.editingId && doc.objects[state.editingId] ? state.editingId : null,
    hoverTargetId: state.hoverTargetId && doc.objects[state.hoverTargetId] ? state.hoverTargetId : null
  }
}

export function resolveHtmlFrameOverlayInteractionState(
  doc: CanvasDocument,
  selectedIds: ReadonlySet<string>,
  state: {
    interactiveId: string | null
    editingId: string | null
    overlayAvailable?: boolean
    mountableFrameIds?: ReadonlySet<string>
  }
): {
  interactiveId: string | null
  editingId: string | null
} {
  if (state.overlayAvailable === false) {
    return { interactiveId: null, editingId: null }
  }
  const canKeep = (id: string | null): id is string => {
    if (!id || !selectedIds.has(id)) return false
    if (state.mountableFrameIds && !state.mountableFrameIds.has(id)) return false
    const shape = doc.objects[id]
    return Boolean(shape?.visible && isHtmlFrame(shape))
  }
  return {
    interactiveId: canKeep(state.interactiveId) ? state.interactiveId : null,
    editingId: canKeep(state.editingId) ? state.editingId : null
  }
}

export function shouldResetCanvasTransientInteractionAfterDocumentSync(
  removedShapeIds: readonly string[]
): boolean {
  return removedShapeIds.length > 0
}

const toolFactories: Record<CanvasTool, () => CanvasToolHandler> = {
  select: createSelectTool,
  rect: createRectTool,
  ellipse: createEllipseTool,
  text: createTextTool,
  frame: createFrameTool,
  screen: createScreenTool,
  image: createAiImageTool,
  arrow: createArrowTool,
  line: createLineTool,
  draw: createDrawTool,
  hand: createHandTool
}

export function createCanvasTool(tool: CanvasTool, surface: 'design' | 'code'): CanvasToolHandler {
  if (tool === 'image') return createAiImageTool({ openAssistant: surface === 'design' })
  return toolFactories[tool]()
}
