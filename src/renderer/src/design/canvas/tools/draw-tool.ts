import { useCanvasSelectionStore } from '../canvas-selection-store'
import { useCanvasShapeStore } from '../canvas-shape-store'
import { useCanvasViewportStore } from '../canvas-viewport-store'
import { createDefaultShape } from '../canvas-types'
import type { Point } from '../canvas-types'
import type { CanvasPointerEvent, CanvasToolHandler } from './tool-types'

/**
 * Freehand pencil. Accumulates raw pointer samples and stores them as a points
 * polyline relative to the (recomputed) bounding box on every move.
 */
export function createDrawTool(): CanvasToolHandler {
  let drawing = false
  let previewId: string | null = null
  let raw: Point[] = []

  return {
    cursor: 'crosshair',

    onPointerDown(e: CanvasPointerEvent) {
      drawing = true
      raw = [{ x: e.canvasX, y: e.canvasY }]
      const shape = createDefaultShape('draw', e.canvasX, e.canvasY)
      shape.width = 0
      shape.height = 0
      shape.points = [{ x: 0, y: 0 }]
      previewId = shape.id
      useCanvasShapeStore.getState().addShape(shape)
      useCanvasSelectionStore.getState().select([shape.id])
    },

    onPointerMove(e: CanvasPointerEvent) {
      if (!drawing || !previewId) return
      raw.push({ x: e.canvasX, y: e.canvasY })

      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const p of raw) {
        if (p.x < minX) minX = p.x
        if (p.y < minY) minY = p.y
        if (p.x > maxX) maxX = p.x
        if (p.y > maxY) maxY = p.y
      }

      useCanvasShapeStore.getState().updateShape(
        previewId,
        {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
          points: raw.map((p) => ({ x: p.x - minX, y: p.y - minY }))
        },
        true
      )
    },

    onPointerUp() {
      if (!drawing || !previewId) return
      drawing = false
      const shape = useCanvasShapeStore.getState().getShape(previewId)
      if (shape && (shape.points?.length ?? 0) < 2) {
        useCanvasShapeStore.getState().deleteShape(previewId)
      }
      useCanvasViewportStore.getState().setActiveTool('select')
      previewId = null
    }
  }
}
