import { useDesignWorkspaceStore } from '../design-workspace-store'
import {
  createSvgFrameShape,
  isArtifactFrame,
  shapeBounds,
  type CanvasShape,
  type Rect
} from './canvas-types'
import { placeRectInViewportAvoiding } from './canvas-placement'
import { useCanvasSelectionStore } from './canvas-selection-store'
import { useCanvasShapeStore } from './canvas-shape-store'
import { useCanvasViewportStore } from './canvas-viewport-store'

export type CreateLinkedSvgArtifactOptions = Partial<Rect> & {
  boardArtifactId: string
  name?: string
  brief?: string
  targetFrameId?: string
  select?: boolean
}

export type CreateLinkedSvgArtifactResult = {
  artifactId: string
  relativePath: string
  designMdPath: string
  shape: CanvasShape
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function buildSvgArtifactSkeleton(options: {
  title: string
  brief?: string
  width: number
  height: number
}): string {
  const title = escapeXml(options.title.trim() || 'SVG motion')
  const description = escapeXml(options.brief?.trim() || 'SVG motion design generated in Kun.')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.round(options.width)} ${Math.round(options.height)}" width="${Math.round(options.width)}" height="${Math.round(options.height)}" role="img" aria-labelledby="title desc">`,
    `  <title id="title">${title}</title>`,
    `  <desc id="desc">${description}</desc>`,
    '  <g id="artwork" />',
    '</svg>',
    ''
  ].join('\n')
}

function uniqueSvgTitle(name?: string, brief?: string): string {
  const source = name?.trim() || brief?.trim() || 'SVG motion'
  const base = source.length > 48 ? `${source.slice(0, 48)}...` : source
  const used = new Set(useDesignWorkspaceStore.getState().artifacts.map((item) => item.title))
  if (!used.has(base)) return base
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base} ${index}`
    if (!used.has(candidate)) return candidate
  }
  return `${base} ${Date.now()}`
}

function reusableTargetFrame(shape: CanvasShape | undefined): shape is CanvasShape {
  return Boolean(
    shape &&
      shape.type === 'frame' &&
      !isArtifactFrame(shape) &&
      shape.visible !== false &&
      !shape.locked &&
      shape.children.length === 0
  )
}

function geometry(options: CreateLinkedSvgArtifactOptions): Rect {
  const width = Math.min(4096, Math.max(64, options.width ?? 640))
  const height = Math.min(4096, Math.max(64, options.height ?? 480))
  const occupied = Object.values(useCanvasShapeStore.getState().document.objects)
    .filter((shape) => shape.visible !== false && isArtifactFrame(shape))
    .map(shapeBounds)
  const placed = placeRectInViewportAvoiding(
    { width, height },
    useCanvasViewportStore.getState().vbox,
    occupied
  )
  return { x: options.x ?? placed.x, y: options.y ?? placed.y, width, height }
}

export function createLinkedSvgArtifact(
  options: CreateLinkedSvgArtifactOptions
): CreateLinkedSvgArtifactResult | null {
  const store = useDesignWorkspaceStore.getState()
  const title = uniqueSvgTitle(options.name, options.brief)
  const target = options.targetFrameId
    ? useCanvasShapeStore.getState().document.objects[options.targetFrameId]
    : undefined
  const reusable = reusableTargetFrame(target) ? target : null
  const rect = reusable ? shapeBounds(reusable) : geometry(options)
  const prepared = store.prepareSvgTurn(options.brief ?? title, {
    forceNew: true,
    width: rect.width,
    height: rect.height,
    title
  })
  store.updateArtifactNode(prepared.artifactId, {
    ...rect,
    sizeMode: 'manual',
    viewMode: 'preview'
  })
  store.setActiveArtifact(options.boardArtifactId)

  let shape: CanvasShape
  if (reusable) {
    useCanvasShapeStore.getState().updateShape(reusable.id, {
      name: title,
      embeddedArtifact: { id: prepared.artifactId, kind: 'svg' },
      clipContent: true,
      ...rect
    })
    shape = useCanvasShapeStore.getState().document.objects[reusable.id] ?? reusable
  } else {
    shape = createSvgFrameShape(title, rect.x, rect.y, prepared.artifactId, rect.width, rect.height)
    useCanvasShapeStore.getState().addShape(shape)
  }
  if (options.select !== false) {
    useCanvasSelectionStore.getState().select([shape.id])
    useCanvasViewportStore.getState().setActiveTool('select')
  }
  if (store.workspaceRoot && typeof window.kunGui?.writeWorkspaceFile === 'function') {
    void window.kunGui
      .writeWorkspaceFile({
        path: prepared.relativePath,
        workspaceRoot: store.workspaceRoot,
        content: buildSvgArtifactSkeleton({
          title,
          brief: options.brief,
          width: rect.width,
          height: rect.height
        })
      })
      .then((result) => {
        if (!result.ok) {
          useDesignWorkspaceStore.getState().setArtifactPreviewStatus(prepared.artifactId, 'error')
        }
      })
      .catch(() => {
        useDesignWorkspaceStore.getState().setArtifactPreviewStatus(prepared.artifactId, 'error')
      })
  }
  const created = useCanvasShapeStore.getState().document.objects[shape.id] ?? shape
  return { ...prepared, shape: created }
}
