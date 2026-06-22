import { artifactDesignMdPath } from './design-artifact-persistence'
import { createEmptyDocument, createHtmlFrameShape, isHtmlFrame, type CanvasDocument, type CanvasShape } from './canvas/canvas-types'
import { useCanvasSelectionStore } from './canvas/canvas-selection-store'
import { useCanvasShapeStore } from './canvas/canvas-shape-store'
import { useCanvasViewportStore } from './canvas/canvas-viewport-store'
import { serializeCanvasDocument } from './canvas/canvas-persistence'
import { createDesignArtifactId, defaultDesignArtifactNode, type DesignArtifact } from './design-types'
import { useDesignWorkspaceStore } from './design-workspace-store'

export type SyncHtmlArtifactsToBoardResult = {
  document: CanvasDocument
  addedFrameIds: string[]
}

export type CreateScreenFrameArtifactResult = {
  artifactId: string
  relativePath: string
  designMdPath: string
  shape: CanvasShape
}

export function findDesignBoardArtifact(
  artifacts: readonly DesignArtifact[]
): (DesignArtifact & { kind: 'canvas' }) | null {
  const boards = artifacts.filter((artifact): artifact is DesignArtifact & { kind: 'canvas' } =>
    artifact.kind === 'canvas'
  )
  if (boards.length === 0) return null
  return [...boards].sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt)
  )[0] ?? null
}

function cloneDocument(doc: CanvasDocument): CanvasDocument {
  return {
    ...doc,
    objects: Object.fromEntries(
      Object.entries(doc.objects).map(([id, shape]) => [id, { ...shape, children: [...shape.children] }])
    )
  }
}

function linkedHtmlArtifactIds(doc: CanvasDocument): Set<string> {
  const ids = new Set<string>()
  for (const shape of Object.values(doc.objects)) {
    if (shape && isHtmlFrame(shape) && shape.htmlArtifactId) ids.add(shape.htmlArtifactId)
  }
  return ids
}

export function syncHtmlArtifactsToBoardDocument(
  doc: CanvasDocument,
  artifacts: readonly DesignArtifact[]
): SyncHtmlArtifactsToBoardResult {
  const root = doc.objects[doc.rootId]
  if (!root) return { document: doc, addedFrameIds: [] }

  const linkedIds = linkedHtmlArtifactIds(doc)
  const htmlArtifacts = artifacts.filter((artifact) => artifact.kind === 'html')
  const addedFrameIds: string[] = []
  let next: CanvasDocument | null = null

  htmlArtifacts.forEach((artifact, index) => {
    if (linkedIds.has(artifact.id)) return
    if (!next) next = cloneDocument(doc)
    const nextRoot = next.objects[next.rootId]
    if (!nextRoot) return

    const node = artifact.node ?? defaultDesignArtifactNode(index)
    const frame = createHtmlFrameShape(artifact.title || 'Screen', node.x, node.y, artifact.id, 'desktop')
    frame.width = node.width
    frame.height = node.height
    frame.name = artifact.title || frame.name

    next.objects[frame.id] = frame
    next.objects[next.rootId] = {
      ...nextRoot,
      children: [...nextRoot.children, frame.id]
    }
    linkedIds.add(artifact.id)
    addedFrameIds.push(frame.id)
  })

  return { document: next ?? doc, addedFrameIds }
}

export async function ensureDesignBoardArtifact(
  workspaceRoot: string
): Promise<(DesignArtifact & { kind: 'canvas' }) | null> {
  const trimmedRoot = workspaceRoot.trim()
  if (!trimmedRoot) return null

  const store = useDesignWorkspaceStore.getState()
  const existing = findDesignBoardArtifact(store.artifacts)
  if (existing) {
    if (store.activeArtifactId !== existing.id) store.setActiveArtifact(existing.id)
    return existing
  }

  const docId = store.ensureActiveDocument()
  const createdAt = new Date().toISOString()
  const artifactId = createDesignArtifactId()
  const relativePath = `.kun-design/${docId}/${artifactId}/canvas.json`
  const artifact: DesignArtifact & { kind: 'canvas' } = {
    id: artifactId,
    kind: 'canvas',
    title: 'Design board',
    relativePath,
    createdAt,
    updatedAt: createdAt,
    versions: [{ id: `${artifactId}-v1`, relativePath, createdAt, summary: '' }]
  }

  if (typeof window.kunGui?.writeWorkspaceFile === 'function') {
    const write = await window.kunGui
      .writeWorkspaceFile({
        path: relativePath,
        workspaceRoot: trimmedRoot,
        content: serializeCanvasDocument(createEmptyDocument())
      })
      .catch((error: unknown) => ({
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }))
    if (!write.ok) useDesignWorkspaceStore.getState().setFileError(write.message)
  }

  useDesignWorkspaceStore.getState().upsertArtifact(artifact)
  return artifact
}

export function createScreenFrameArtifact(options: {
  boardArtifactId: string
  brief?: string
  title?: string
  width?: number
  height?: number
  x?: number
  y?: number
}): CreateScreenFrameArtifactResult {
  const state = useDesignWorkspaceStore.getState()
  const docId = state.ensureActiveDocument()
  const createdAt = new Date().toISOString()
  const artifactId = createDesignArtifactId()
  const relativePath = `.kun-design/${docId}/${artifactId}/v1.html`
  const designMdPath = artifactDesignMdPath(docId, artifactId)
  const brief = options.brief?.trim() ?? ''
  const titleSource = options.title?.trim() || brief || 'Screen'
  const title = titleSource.length > 48 ? `${titleSource.slice(0, 48)}...` : titleSource
  const width = Math.max(240, options.width ?? 1280)
  const height = Math.max(180, options.height ?? 800)
  const vbox = useCanvasViewportStore.getState().vbox
  const x = options.x ?? Math.round(vbox.x + vbox.width / 2 - width / 2)
  const y = options.y ?? Math.round(vbox.y + vbox.height / 2 - height / 2)

  state.upsertArtifact({
    id: artifactId,
    kind: 'html',
    title,
    relativePath,
    createdAt,
    updatedAt: createdAt,
    versions: [{ id: `${artifactId}-v1`, relativePath, createdAt, summary: brief }],
    designMdPath,
    previewStatus: 'pending',
    node: { x, y, width, height, sizeMode: 'manual', viewMode: 'preview' }
  })
  useDesignWorkspaceStore.getState().setActiveArtifact(options.boardArtifactId)

  const shape = createHtmlFrameShape(title, x, y, artifactId, 'desktop')
  shape.width = width
  shape.height = height
  useCanvasShapeStore.getState().addShape(shape)
  useCanvasSelectionStore.getState().select([shape.id])
  useCanvasViewportStore.getState().setActiveTool('select')

  return { artifactId, relativePath, designMdPath, shape }
}
