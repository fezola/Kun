import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createScreenFrameArtifact,
  findDesignBoardArtifact,
  syncHtmlArtifactsToBoardDocument
} from './design-board'
import { useCanvasSelectionStore } from './canvas/canvas-selection-store'
import { useCanvasShapeStore } from './canvas/canvas-shape-store'
import { createEmptyDocument, isHtmlFrame } from './canvas/canvas-types'
import { useCanvasUndoStore } from './canvas/canvas-undo-store'
import { useCanvasViewportStore } from './canvas/canvas-viewport-store'
import { useDesignWorkspaceStore } from './design-workspace-store'
import type { DesignArtifact, DesignDocument } from './design-types'

const createdAt = '2026-06-20T00:00:00.000Z'

function artifact(
  id: string,
  kind: DesignArtifact['kind'],
  extra: Partial<DesignArtifact> = {}
): DesignArtifact {
  const relativePath =
    kind === 'canvas' ? `.kun-design/doc/${id}/canvas.json` : `.kun-design/doc/${id}/v1.html`
  return {
    id,
    kind,
    title: id,
    relativePath,
    createdAt,
    updatedAt: extra.updatedAt ?? createdAt,
    versions: [{ id: `${id}-v1`, relativePath, createdAt, summary: '' }],
    ...extra
  }
}

function installDesignDocument(artifacts: DesignArtifact[], activeArtifactId: string | null): void {
  const doc: DesignDocument = {
    id: 'doc',
    title: 'Doc',
    createdAt,
    updatedAt: createdAt,
    order: 0,
    artifacts,
    activeArtifactId
  }
  useDesignWorkspaceStore.setState({
    workspaceRoot: '/workspace',
    documents: [doc],
    activeDocumentId: 'doc',
    artifacts,
    activeArtifactId,
    fileError: null
  })
}

beforeEach(() => {
  vi.stubGlobal('window', {
    kunGui: {
      writeWorkspaceFile: vi.fn(async () => ({ ok: true as const }))
    }
  })
  useCanvasShapeStore.getState().loadDocument(createEmptyDocument())
  useCanvasUndoStore.getState().clear()
  useCanvasSelectionStore.getState().clearSelection()
  useCanvasViewportStore.getState().setVbox({ x: -600, y: -400, width: 1200, height: 800 })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('design board helpers', () => {
  it('finds the most recently updated canvas artifact as the board', () => {
    const oldBoard = artifact('old', 'canvas', { updatedAt: '2026-06-20T00:00:00.000Z' })
    const newBoard = artifact('new', 'canvas', { updatedAt: '2026-06-21T00:00:00.000Z' })

    expect(findDesignBoardArtifact([oldBoard, artifact('screen', 'html'), newBoard])?.id).toBe('new')
  })

  it('syncs unmounted HTML artifacts into screen frames only once', () => {
    const screen = artifact('screen', 'html', {
      title: 'Login',
      node: { x: 40, y: 60, width: 390, height: 844, sizeMode: 'manual' }
    })

    const first = syncHtmlArtifactsToBoardDocument(createEmptyDocument(), [screen])
    expect(first.addedFrameIds).toHaveLength(1)
    const frame = first.document.objects[first.addedFrameIds[0]]
    expect(frame).toMatchObject({
      type: 'frame',
      name: 'Login',
      htmlArtifactId: 'screen',
      x: 40,
      y: 60,
      width: 390,
      height: 844
    })
    expect(isHtmlFrame(frame)).toBe(true)

    const second = syncHtmlArtifactsToBoardDocument(first.document, [screen])
    expect(second.addedFrameIds).toEqual([])
  })

  it('creates a centered screen frame without stealing the active board', () => {
    const board = artifact('board', 'canvas')
    installDesignDocument([board], board.id)

    const result = createScreenFrameArtifact({
      boardArtifactId: board.id,
      brief: 'Design an onboarding screen'
    })

    const state = useDesignWorkspaceStore.getState()
    const created = state.artifacts.find((item) => item.id === result.artifactId)
    const shape = useCanvasShapeStore.getState().document.objects[result.shape.id]

    expect(state.activeArtifactId).toBe(board.id)
    expect(created).toMatchObject({
      kind: 'html',
      title: 'Design an onboarding screen',
      relativePath: expect.stringMatching(/^\.kun-design\/doc\/.+\/v1\.html$/),
      previewStatus: 'pending'
    })
    expect(shape).toMatchObject({
      type: 'frame',
      htmlArtifactId: result.artifactId,
      x: -640,
      y: -400,
      width: 1280,
      height: 800
    })
    expect(useCanvasSelectionStore.getState().selectedIds.has(shape.id)).toBe(true)
    expect(useCanvasViewportStore.getState().activeTool).toBe('select')
  })
})
