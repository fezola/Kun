import { useCanvasSelectionStore } from '../canvas-selection-store'
import { useCanvasShapeStore } from '../canvas-shape-store'
import { useCanvasViewportStore } from '../canvas-viewport-store'
import { createHtmlFrameShape } from '../canvas-types'
import { getScreenArtifactFactory } from '../screen-artifact-bridge'
import type { CanvasPointerEvent, CanvasToolHandler } from './tool-types'
import { computeSnappedCreateShapeBounds } from './create-shape-bounds'
import { addShapeForCreation, commitCreatedShapeUndo, type CreatedShapeUndo } from './creation-undo'

export function createScreenTool(): CanvasToolHandler {
  let drawing = false
  let startX = 0
  let startY = 0
  let previewId: string | null = null
  let creationUndo: CreatedShapeUndo | null = null

  return {
    cursor: 'crosshair',

    onPointerDown(e: CanvasPointerEvent) {
      drawing = true
      startX = e.canvasX
      startY = e.canvasY

      const factory = getScreenArtifactFactory()
      const artifactId = factory?.('Screen') ?? null
      if (!artifactId) {
        drawing = false
        return
      }

      const shape = createHtmlFrameShape('Screen', e.canvasX, e.canvasY, artifactId, 'desktop')
      shape.width = 0
      shape.height = 0
      previewId = shape.id
      creationUndo = addShapeForCreation(shape)
      useCanvasSelectionStore.getState().select([shape.id])
    },

    onPointerMove(e: CanvasPointerEvent) {
      if (!drawing || !previewId) return
      const bounds = computeSnappedCreateShapeBounds(startX, startY, e, previewId)
      useCanvasShapeStore.getState().updateShape(previewId, bounds, true)
    },

    onPointerUp() {
      if (!drawing || !previewId) return
      drawing = false

      const shape = useCanvasShapeStore.getState().getShape(previewId)
      if (shape && shape.width < 2 && shape.height < 2) {
        useCanvasShapeStore.getState().updateShape(previewId, { width: 1280, height: 800 }, true)
      }

      useCanvasViewportStore.getState().setActiveTool('select')
      useCanvasSelectionStore.getState().setSnapGuides([])
      commitCreatedShapeUndo(creationUndo, 'create-screen')
      previewId = null
      creationUndo = null
    }
  }
}
