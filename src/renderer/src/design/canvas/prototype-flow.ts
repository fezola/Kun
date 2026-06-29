import type { CanvasShape } from './canvas-types'
import { isHtmlFrame, shapeBounds } from './canvas-types'
import type { DesignArtifact } from '../design-types'

export type PrototypeFlowEdge = {
  id: string
  sourceArtifactId: string
  targetArtifactId: string
  sourceTitle: string
  targetTitle: string
  label?: string
  href?: string
  x1: number
  y1: number
  x2: number
  y2: number
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ')
}

function center(shape: CanvasShape): { x: number; y: number } {
  const bounds = shapeBounds(shape)
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

export function computePrototypeFlowEdges(
  artifacts: readonly DesignArtifact[],
  objects: Record<string, CanvasShape>
): PrototypeFlowEdge[] {
  const framesByArtifactId = new Map<string, CanvasShape>()
  for (const shape of Object.values(objects)) {
    if (!shape || shape.visible === false || !isHtmlFrame(shape) || !shape.htmlArtifactId) continue
    framesByArtifactId.set(shape.htmlArtifactId, shape)
  }

  const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]))
  const artifactsByTitle = new Map(
    artifacts
      .filter((artifact) => artifact.kind === 'html')
      .map((artifact) => [normalizeTitle(artifact.title), artifact])
  )
  const edges: PrototypeFlowEdge[] = []
  const seen = new Set<string>()

  for (const artifact of artifacts) {
    if (artifact.kind !== 'html' || !artifact.prototypeLinks?.length) continue
    const sourceFrame = framesByArtifactId.get(artifact.id)
    if (!sourceFrame) continue
    const source = center(sourceFrame)

    for (const link of artifact.prototypeLinks) {
      const targetArtifact =
        (link.targetArtifactId ? artifactsById.get(link.targetArtifactId) : undefined) ??
        artifactsByTitle.get(normalizeTitle(link.targetTitle))
      if (!targetArtifact || targetArtifact.kind !== 'html') continue
      if (targetArtifact.id === artifact.id) continue
      const targetFrame = framesByArtifactId.get(targetArtifact.id)
      if (!targetFrame) continue
      const key = `${artifact.id}->${targetArtifact.id}:${link.label ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      const target = center(targetFrame)
      edges.push({
        id: key,
        sourceArtifactId: artifact.id,
        targetArtifactId: targetArtifact.id,
        sourceTitle: artifact.title,
        targetTitle: targetArtifact.title,
        ...(link.label ? { label: link.label } : {}),
        ...(link.href ? { href: link.href } : {}),
        x1: source.x,
        y1: source.y,
        x2: target.x,
        y2: target.y
      })
    }
  }

  return edges
}
