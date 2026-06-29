import { beforeEach, describe, expect, it } from 'vitest'
import { useCanvasSelectionStore } from '../canvas-selection-store'
import { useCanvasShapeStore } from '../canvas-shape-store'
import { createEmptyDocument } from '../canvas-types'
import { useCanvasUndoStore } from '../canvas-undo-store'
import { useCanvasViewportStore } from '../canvas-viewport-store'
import { setScreenArtifactFactory } from '../screen-artifact-bridge'
import { executeOps } from '../shape-ops'
import { createDrawTool } from './draw-tool'
import { createEllipseTool } from './ellipse-tool'
import { createFrameTool } from './frame-tool'
import { createRectTool } from './rect-tool'
import { createScreenTool } from './screen-tool'
import { createTextTool } from './text-tool'
import type { CanvasPointerEvent } from './tool-types'

beforeEach(() => {
  useCanvasShapeStore.getState().loadDocument(createEmptyDocument())
  useCanvasUndoStore.getState().clear()
  useCanvasSelectionStore.getState().clearSelection()
  useCanvasSelectionStore.getState().setSnapGuides([])
  const viewport = useCanvasViewportStore.getState()
  viewport.setContainerSize(1000, 500)
  viewport.resetView()
  if (!useCanvasViewportStore.getState().gridVisible) {
    useCanvasViewportStore.getState().toggleGrid()
  }
  if (!useCanvasViewportStore.getState().snapEnabled) {
    useCanvasViewportStore.getState().toggleSnap()
  }
  setScreenArtifactFactory(() => null)
  useCanvasViewportStore.getState().setActiveTool('rect')
})

function pointer(
  x: number,
  y: number,
  patch: Partial<Pick<CanvasPointerEvent, 'shiftKey' | 'altKey' | 'metaKey' | 'ctrlKey'>> = {}
): CanvasPointerEvent {
  return {
    canvasX: x,
    canvasY: y,
    clientX: x,
    clientY: y,
    shiftKey: patch.shiftKey ?? false,
    altKey: patch.altKey ?? false,
    metaKey: patch.metaKey ?? false,
    ctrlKey: patch.ctrlKey ?? false,
    timeStamp: 0
  }
}

function selectedShapeId(): string {
  return Array.from(useCanvasSelectionStore.getState().selectedIds)[0]
}

describe('shape creation tools', () => {
  it('snaps a newly drawn rectangle edge to a nearby object edge', () => {
    if (useCanvasViewportStore.getState().gridVisible) {
      useCanvasViewportStore.getState().toggleGrid()
    }
    executeOps([{ op: 'add', shape: { type: 'rect', x: 100, y: 300, width: 80, height: 80 } }])
    const tool = createRectTool()

    tool.onPointerDown(pointer(0, 0))
    tool.onPointerMove(pointer(96, 31))

    const shape = useCanvasShapeStore.getState().document.objects[selectedShapeId()]
    expect(shape).toMatchObject({ x: 0, y: 0, width: 100, height: 31 })
    expect(useCanvasSelectionStore.getState().activeSnapGuides).toContainEqual({
      axis: 'v',
      position: 100,
      source: 'edge'
    })

    tool.onPointerUp(pointer(96, 31))
    expect(useCanvasViewportStore.getState().activeTool).toBe('select')
    expect(useCanvasSelectionStore.getState().activeSnapGuides).toEqual([])
  })

  it('snaps a newly drawn frame to the visible grid', () => {
    const tool = createFrameTool()

    tool.onPointerDown(pointer(0, 0))
    tool.onPointerMove(pointer(96, 37))

    const shape = useCanvasShapeStore.getState().document.objects[selectedShapeId()]
    expect(shape).toMatchObject({ x: 0, y: 0, width: 100, height: 40 })
    expect(useCanvasSelectionStore.getState().activeSnapGuides).toEqual(
      expect.arrayContaining([
        { axis: 'v', position: 100, source: 'grid' },
        { axis: 'h', position: 40, source: 'grid' }
      ])
    )
  })

  it('snaps a newly drawn screen frame while preserving its HTML artifact link', () => {
    setScreenArtifactFactory((name) => `artifact-${name.toLowerCase()}`)
    const tool = createScreenTool()

    tool.onPointerDown(pointer(0, 0))
    tool.onPointerMove(pointer(96, 37))

    let shape = useCanvasShapeStore.getState().document.objects[selectedShapeId()]
    expect(shape).toMatchObject({
      type: 'frame',
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      htmlArtifactId: 'artifact-screen',
      devicePreset: 'desktop'
    })
    expect(useCanvasSelectionStore.getState().activeSnapGuides).toEqual(
      expect.arrayContaining([
        { axis: 'v', position: 100, source: 'grid' },
        { axis: 'h', position: 40, source: 'grid' }
      ])
    )

    tool.onPointerUp(pointer(96, 37))
    shape = useCanvasShapeStore.getState().document.objects[selectedShapeId()]
    expect(shape.htmlArtifactId).toBe('artifact-screen')
    expect(useCanvasViewportStore.getState().activeTool).toBe('select')
    expect(useCanvasSelectionStore.getState().activeSnapGuides).toEqual([])
  })

  it('keeps shift-drawn ellipses circular instead of applying single-axis snap', () => {
    const tool = createEllipseTool()

    tool.onPointerDown(pointer(0, 0))
    tool.onPointerMove(pointer(96, 40, { shiftKey: true }))

    const shape = useCanvasShapeStore.getState().document.objects[selectedShapeId()]
    expect(shape).toMatchObject({ x: 0, y: 0, width: 96, height: 96 })
    expect(useCanvasSelectionStore.getState().activeSnapGuides).toEqual([])
  })

  it('clicks to create editable default text', () => {
    const tool = createTextTool()

    tool.onPointerDown(pointer(11, 13))
    tool.onPointerUp(pointer(11, 13))

    const shape = useCanvasShapeStore.getState().document.objects[selectedShapeId()]
    expect(shape).toMatchObject({
      type: 'text',
      x: 11,
      y: 13,
      width: 200,
      height: 24,
      textContent: 'Text'
    })
    expect(useCanvasSelectionStore.getState().editingId).toBe(shape.id)
    expect(useCanvasViewportStore.getState().activeTool).toBe('select')
  })

  it('drags to create a snapped text box for canvas notes', () => {
    const tool = createTextTool()

    tool.onPointerDown(pointer(0, 0))
    tool.onPointerMove(pointer(96, 37))

    let shape = useCanvasShapeStore.getState().document.objects[selectedShapeId()]
    expect(shape).toMatchObject({ type: 'text', x: 0, y: 0, width: 100, height: 40 })
    expect(useCanvasSelectionStore.getState().activeSnapGuides).toEqual(
      expect.arrayContaining([
        { axis: 'v', position: 100, source: 'grid' },
        { axis: 'h', position: 40, source: 'grid' }
      ])
    )

    tool.onPointerUp(pointer(96, 37))

    shape = useCanvasShapeStore.getState().document.objects[selectedShapeId()]
    expect(shape).toMatchObject({ type: 'text', width: 100, height: 40 })
    expect(useCanvasSelectionStore.getState().editingId).toBe(shape.id)
    expect(useCanvasSelectionStore.getState().activeSnapGuides).toEqual([])
  })

  it('redoes a dragged rectangle with its final created bounds', () => {
    const tool = createRectTool()

    tool.onPointerDown(pointer(0, 0))
    tool.onPointerMove(pointer(96, 37))
    tool.onPointerUp(pointer(96, 37))

    let shape = useCanvasShapeStore.getState().document.objects[selectedShapeId()]
    const id = shape.id
    expect(shape).toMatchObject({ width: 100, height: 40 })
    expect(useCanvasUndoStore.getState().undoStack).toHaveLength(1)

    useCanvasShapeStore.getState().undo()
    expect(useCanvasShapeStore.getState().document.objects[id]).toBeUndefined()

    useCanvasShapeStore.getState().redo()
    shape = useCanvasShapeStore.getState().document.objects[id]
    expect(shape).toMatchObject({ type: 'rect', width: 100, height: 40 })
    expect(Array.from(useCanvasSelectionStore.getState().selectedIds)).toEqual([id])
  })

  it('does not record undo for a click-only draw stroke that gets discarded', () => {
    const tool = createDrawTool()

    tool.onPointerDown(pointer(5, 5))
    tool.onPointerUp(pointer(5, 5))

    const doc = useCanvasShapeStore.getState().document
    expect(doc.objects[doc.rootId].children).toEqual([])
    expect(useCanvasSelectionStore.getState().selectedIds.size).toBe(0)
    expect(useCanvasUndoStore.getState().undoStack).toHaveLength(0)
  })

  it('simplifies freehand strokes before recording their final undo state', () => {
    const tool = createDrawTool()

    tool.onPointerDown(pointer(0, 0))
    for (let x = 1; x <= 120; x += 1) {
      tool.onPointerMove(pointer(x, Math.sin(x / 4) * 0.25))
    }
    tool.onPointerUp(pointer(120, 0))

    let shape = useCanvasShapeStore.getState().document.objects[selectedShapeId()]
    const id = shape.id
    expect(shape.points).toHaveLength(2)
    expect(shape).toMatchObject({ type: 'draw', x: 0, width: 120 })

    useCanvasShapeStore.getState().undo()
    expect(useCanvasShapeStore.getState().document.objects[id]).toBeUndefined()

    useCanvasShapeStore.getState().redo()
    shape = useCanvasShapeStore.getState().document.objects[id]
    expect(shape.points).toHaveLength(2)
    expect(shape).toMatchObject({ type: 'draw', x: 0, width: 120 })
  })
})
