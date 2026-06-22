import { useCanvasSelectionStore } from './canvas-selection-store'
import { useCanvasShapeStore } from './canvas-shape-store'
import { createDefaultShape, type Rect, type ViewBox } from './canvas-types'
import { useCanvasViewportStore } from './canvas-viewport-store'

const FALLBACK_IMAGE_WIDTH = 320
const FALLBACK_IMAGE_HEIGHT = 220
const MAX_IMAGE_VIEWPORT_RATIO = 0.52
const MAX_IMAGE_WIDTH = 560
const MAX_IMAGE_HEIGHT = 420
const MIN_IMAGE_SIZE = 40

export type ImportedImageDimensions = {
  width?: number
  height?: number
}

export type CanvasImageImportResult =
  | { ok: true; shapeId: string }
  | { ok: false; canceled?: boolean; message?: string }

function finitePositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function roundCanvasValue(value: number): number {
  return Math.round(value * 100) / 100
}

export function computeImportedImagePlacement(
  vbox: ViewBox,
  dimensions: ImportedImageDimensions = {}
): Rect {
  const sourceWidth = finitePositive(dimensions.width) ? dimensions.width : FALLBACK_IMAGE_WIDTH
  const sourceHeight = finitePositive(dimensions.height) ? dimensions.height : FALLBACK_IMAGE_HEIGHT
  const maxWidth = Math.max(MIN_IMAGE_SIZE, Math.min(MAX_IMAGE_WIDTH, vbox.width * MAX_IMAGE_VIEWPORT_RATIO))
  const maxHeight = Math.max(MIN_IMAGE_SIZE, Math.min(MAX_IMAGE_HEIGHT, vbox.height * MAX_IMAGE_VIEWPORT_RATIO))
  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight)
  const width = Math.max(MIN_IMAGE_SIZE, roundCanvasValue(sourceWidth * scale))
  const height = Math.max(MIN_IMAGE_SIZE, roundCanvasValue(sourceHeight * scale))

  return {
    x: roundCanvasValue(vbox.x + vbox.width / 2 - width / 2),
    y: roundCanvasValue(vbox.y + vbox.height / 2 - height / 2),
    width,
    height
  }
}

export async function pasteClipboardImageToCanvas(options: {
  vbox: ViewBox
}): Promise<CanvasImageImportResult> {
  if (typeof window.kunGui?.readClipboardImage !== 'function') {
    return { ok: false, message: 'Clipboard image reading is unavailable.' }
  }

  const image = await window.kunGui.readClipboardImage()
  if (!image.ok) {
    return { ok: false, message: image.message }
  }

  const dataUrl = `data:${image.mimeType};base64,${image.dataBase64}`
  const bounds = computeImportedImagePlacement(options.vbox, {
    width: image.width,
    height: image.height
  })

  const shape = createDefaultShape('image', bounds.x, bounds.y)
  shape.name = image.name || 'Pasted Image'
  shape.width = bounds.width
  shape.height = bounds.height
  shape.imageUrl = dataUrl

  useCanvasShapeStore.getState().addShape(shape)
  useCanvasSelectionStore.getState().select([shape.id])
  useCanvasViewportStore.getState().setActiveTool('select')

  return { ok: true, shapeId: shape.id }
}

function imageNameFromPath(path: string): string {
  const fileName = path.split('/').pop()?.trim() || 'Image'
  const withoutExt = fileName.replace(/\.[^.]+$/, '').trim()
  return withoutExt || 'Image'
}

export async function importWorkspaceImageToCanvas(options: {
  workspaceRoot: string
  vbox: ViewBox
  imageDirectory?: string
}): Promise<CanvasImageImportResult> {
  const workspaceRoot = options.workspaceRoot.trim()
  if (!workspaceRoot) {
    return { ok: false, message: 'Workspace root is required.' }
  }
  if (typeof window.kunGui?.pickWorkspaceImage !== 'function') {
    return { ok: false, message: 'Image picker is unavailable.' }
  }

  const picked = await window.kunGui
    .pickWorkspaceImage({
      workspaceRoot,
      ...(options.imageDirectory ? { imageDirectory: options.imageDirectory } : {})
    })
    .catch((error: unknown) => ({
      ok: false as const,
      message: error instanceof Error ? error.message : String(error)
    }))

  if (!picked.ok) {
    return picked
  }

  const imageUrl = picked.workspaceRelativePath || picked.relativePath
  const bounds = computeImportedImagePlacement(options.vbox, {
    width: picked.width,
    height: picked.height
  })
  const shape = createDefaultShape('image', bounds.x, bounds.y)
  shape.name = imageNameFromPath(imageUrl)
  shape.width = bounds.width
  shape.height = bounds.height
  shape.imageUrl = imageUrl

  useCanvasShapeStore.getState().addShape(shape)
  useCanvasSelectionStore.getState().select([shape.id])
  useCanvasViewportStore.getState().setActiveTool('select')

  return { ok: true, shapeId: shape.id }
}
