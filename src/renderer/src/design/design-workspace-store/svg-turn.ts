import {
  artifactDesignMdPath,
  artifactDesignMdPathOf,
  artifactDirPath,
  persistArtifactMeta
} from '../design-artifact-persistence'
import {
  createDesignArtifactId,
  currentDesignArtifactVersion,
  designArtifactVersionNumber,
  defaultDesignArtifactNode
} from '../design-types'
import type { DesignArtifact } from '../design-types'
import type { DesignWorkspaceState } from '../design-workspace-store-types'
import { applyToActiveDoc } from './helpers'

type SetDesignWorkspaceState = (
  partial:
    | Partial<DesignWorkspaceState>
    | ((state: DesignWorkspaceState) => Partial<DesignWorkspaceState>)
) => void

export type PrepareSvgTurnOptions = {
  forceNew?: boolean
  artifactId?: string
  activate?: boolean
  reusePendingInitial?: boolean
  width?: number
  height?: number
  title?: string
}

type PrepareSvgTurnArgs = {
  brief: string
  options?: PrepareSvgTurnOptions
  get: () => DesignWorkspaceState
  set: SetDesignWorkspaceState
  persistIndex: () => void
}

export type PreparedSvgTurn = {
  artifactId: string
  relativePath: string
  basePath?: string
  designMdPath: string
}

function svgTitle(brief: string, explicit?: string): string {
  const title = explicit?.trim() || brief.trim()
  return title.length > 48 ? `${title.slice(0, 48)}...` : title || 'SVG motion'
}

function svgNode(index: number, width?: number, height?: number) {
  return {
    ...defaultDesignArtifactNode(index),
    width: Math.max(64, width ?? 640),
    height: Math.max(64, height ?? 480),
    sizeMode: 'manual' as const,
    viewMode: 'preview' as const
  }
}

function nextSvgVersionNumber(artifact: Pick<DesignArtifact, 'relativePath' | 'versions'>): number {
  const knownVersions = [
    ...artifact.versions,
    { id: '', relativePath: artifact.relativePath }
  ]
  return Math.max(0, ...knownVersions.map((version) => designArtifactVersionNumber(version) ?? 0)) + 1
}

export function prepareDesignSvgTurn({
  brief,
  options = {},
  get,
  set,
  persistIndex
}: PrepareSvgTurnArgs): PreparedSvgTurn {
  const text = brief.trim()
  const docId = get().ensureActiveDocument()
  const state = get()
  const active = state.artifacts.find((item) => item.id === state.activeArtifactId) ?? null
  const target = options.artifactId
    ? state.artifacts.find((item) => item.id === options.artifactId) ?? null
    : active
  const activeSvg = !options.forceNew && target?.kind === 'svg' ? target : null
  const createdAt = new Date().toISOString()

  if (
    activeSvg &&
    options.reusePendingInitial &&
    activeSvg.previewStatus === 'pending' &&
    activeSvg.versions.length === 1 &&
    activeSvg.versions[0]?.relativePath === activeSvg.relativePath
  ) {
    const designMdPath = activeSvg.designMdPath ?? artifactDesignMdPathOf(activeSvg.relativePath)
    set((current) =>
      applyToActiveDoc(current, (artifacts) =>
        artifacts.map((item) =>
          item.id === activeSvg.id
            ? {
                ...item,
                updatedAt: createdAt,
                designMdPath,
                previewStatus: 'pending' as const,
                versions: item.versions.map((version) =>
                  version.id === activeSvg.versions[0]?.id ? { ...version, summary: text } : version
                )
              }
            : item
        )
      )
    )
    if (options.activate !== false) get().setActiveArtifact(activeSvg.id)
    const updated = get().artifacts.find((item) => item.id === activeSvg.id)
    if (updated) persistArtifactMeta(get().workspaceRoot, updated)
    persistIndex()
    return { artifactId: activeSvg.id, relativePath: activeSvg.relativePath, designMdPath }
  }

  if (activeSvg) {
    const versionN = nextSvgVersionNumber(activeSvg)
    const dir = activeSvg.relativePath.slice(0, activeSvg.relativePath.lastIndexOf('/'))
    const relativePath = `${dir}/v${versionN}.svg`
    const designMdPath = activeSvg.designMdPath ?? `${dir}/DESIGN.md`
    get().addArtifactVersion(activeSvg.id, {
      id: `${activeSvg.id}-v${versionN}`,
      relativePath,
      createdAt,
      summary: text
    })
    if (options.activate !== false) get().setActiveArtifact(activeSvg.id)
    return { artifactId: activeSvg.id, relativePath, basePath: activeSvg.relativePath, designMdPath }
  }

  const artifactId = createDesignArtifactId()
  const relativePath = `${artifactDirPath(docId, artifactId)}/v1.svg`
  const designMdPath = artifactDesignMdPath(docId, artifactId)
  const artifact: DesignArtifact = {
    id: artifactId,
    kind: 'svg',
    title: svgTitle(text, options.title),
    relativePath,
    createdAt,
    updatedAt: createdAt,
    versions: [{ id: `${artifactId}-v1`, relativePath, createdAt, summary: text }],
    designMdPath,
    previewStatus: 'pending',
    node: svgNode(state.artifacts.length, options.width, options.height)
  }
  get().upsertArtifact(artifact)
  if (options.activate === false) set({ activeArtifactId: state.activeArtifactId })
  return { artifactId, relativePath, designMdPath }
}

export async function duplicateSvgArtifact(
  artifactId: string,
  get: () => DesignWorkspaceState
): Promise<void> {
  const state = get()
  const source = state.artifacts.find((item) => item.id === artifactId)
  const workspaceRoot = state.workspaceRoot
  if (
    !source ||
    source.kind !== 'svg' ||
    !workspaceRoot ||
    typeof window.kunGui?.readWorkspaceFile !== 'function' ||
    typeof window.kunGui?.writeWorkspaceFile !== 'function'
  ) {
    return
  }
  const read = await window.kunGui.readWorkspaceFile({ path: source.relativePath, workspaceRoot }).catch(() => null)
  if (!read?.ok) return
  const docId = get().ensureActiveDocument()
  const createdAt = new Date().toISOString()
  const copyId = createDesignArtifactId()
  const relativePath = `${artifactDirPath(docId, copyId)}/v1.svg`
  const designMdPath = artifactDesignMdPath(docId, copyId)
  const write = await window.kunGui
    .writeWorkspaceFile({ path: relativePath, workspaceRoot, content: read.content })
    .catch(() => null)
  if (!write?.ok) return
  const sourceNotes = source.designMdPath ?? artifactDesignMdPathOf(source.relativePath)
  const notes = await window.kunGui.readWorkspaceFile({ path: sourceNotes, workspaceRoot }).catch(() => null)
  if (notes?.ok) {
    await window.kunGui
      .writeWorkspaceFile({ path: designMdPath, workspaceRoot, content: notes.content })
      .catch(() => null)
  }
  const sourceNode = source.node ?? defaultDesignArtifactNode(state.artifacts.indexOf(source))
  get().upsertArtifact({
    id: copyId,
    kind: 'svg',
    title: `${source.title} copy`,
    relativePath,
    createdAt,
    updatedAt: createdAt,
    versions: [{
      id: `${copyId}-v1`,
      relativePath,
      createdAt,
      summary: currentDesignArtifactVersion(source)?.summary ?? ''
    }],
    designMdPath,
    previewStatus: 'ready',
    node: { ...sourceNode, x: sourceNode.x + 44, y: sourceNode.y + 44, boardHidden: false }
  })
}
