import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultShape, createEmptyDocument, isSvgFrame } from './canvas-types'
import { useCanvasSelectionStore } from './canvas-selection-store'
import { useCanvasShapeStore } from './canvas-shape-store'
import { useCanvasUndoStore } from './canvas-undo-store'
import { useCanvasViewportStore } from './canvas-viewport-store'
import { buildSvgArtifactSkeleton, createLinkedSvgArtifact } from './svg-artifact-lifecycle'
import { useDesignWorkspaceStore } from '../design-workspace-store'
import { artifact, installDesignDocument } from '../design-board.test-helpers'

describe('first-class SVG artifact lifecycle', () => {
  const writeWorkspaceFile = vi.fn(async ({ path }: { path: string; content: string; workspaceRoot: string }) => ({
    ok: true as const,
    path,
    savedAt: '2026-07-10T00:00:00.000Z'
  }))

  beforeEach(() => {
    writeWorkspaceFile.mockClear()
    vi.stubGlobal('window', { kunGui: { writeWorkspaceFile } })
    useCanvasShapeStore.getState().loadDocument(createEmptyDocument())
    useCanvasUndoStore.getState().clear()
    useCanvasSelectionStore.getState().clearSelection()
    useCanvasViewportStore.getState().setContainerSize(1200, 800)
    useCanvasViewportStore.getState().setVbox({ x: -600, y: -400, width: 1200, height: 800 })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reserves an SVG file, creates a linked frame, and writes an accessible skeleton', async () => {
    const board = artifact('board', 'canvas')
    installDesignDocument([board], board.id)

    const created = createLinkedSvgArtifact({
      boardArtifactId: board.id,
      name: 'Orbit loader',
      brief: 'A calm looping orbit animation',
      width: 320,
      height: 240
    })

    expect(created).not.toBeNull()
    const result = created!
    const state = useDesignWorkspaceStore.getState()
    const motion = state.artifacts.find((item) => item.id === result.artifactId)
    const frame = useCanvasShapeStore.getState().document.objects[result.shape.id]
    expect(state.activeArtifactId).toBe(board.id)
    expect(motion).toMatchObject({
      kind: 'svg',
      title: 'Orbit loader',
      relativePath: expect.stringMatching(/^\.kun-design\/doc\/.+\/v1\.svg$/),
      designMdPath: expect.stringMatching(/^\.kun-design\/doc\/.+\/DESIGN\.md$/),
      node: { width: 320, height: 240, sizeMode: 'manual', viewMode: 'preview' }
    })
    expect(frame && isSvgFrame(frame)).toBe(true)
    expect(frame).toMatchObject({
      embeddedArtifact: { id: result.artifactId, kind: 'svg' },
      width: 320,
      height: 240,
      clipContent: true
    })
    expect(useCanvasSelectionStore.getState().selectedIds.has(frame.id)).toBe(true)

    await vi.waitFor(() => expect(writeWorkspaceFile).toHaveBeenCalled())
    expect(writeWorkspaceFile).toHaveBeenCalledWith(expect.objectContaining({
      path: result.relativePath,
      workspaceRoot: '/workspace',
      content: expect.stringContaining('<g id="artwork" />')
    }))
    const svgWrite = writeWorkspaceFile.mock.calls.find(([payload]) => payload.path === result.relativePath)?.[0]
    expect(svgWrite?.content).toContain('viewBox="0 0 320 240"')
    expect(svgWrite?.content).toContain('<title id="title">Orbit loader</title>')
  })

  it('converts a selected empty frame into the SVG artifact frame instead of stacking a new frame', () => {
    const board = artifact('board', 'canvas')
    installDesignDocument([board], board.id)
    const frame = createDefaultShape('frame', 80, 120)
    frame.width = 480
    frame.height = 300
    useCanvasShapeStore.getState().addShape(frame)

    const created = createLinkedSvgArtifact({
      boardArtifactId: board.id,
      targetFrameId: frame.id,
      name: 'Animated mark',
      brief: 'Animate the existing mark frame'
    })

    expect(created?.shape.id).toBe(frame.id)
    expect(Object.values(useCanvasShapeStore.getState().document.objects).filter(isSvgFrame)).toHaveLength(1)
    expect(useCanvasShapeStore.getState().document.objects[frame.id]).toMatchObject({
      x: 80,
      y: 120,
      width: 480,
      height: 300,
      embeddedArtifact: { id: created?.artifactId, kind: 'svg' }
    })
  })

  it('preserves an explicitly requested 64px SVG size', async () => {
    const board = artifact('board', 'canvas')
    installDesignDocument([board], board.id)

    const created = createLinkedSvgArtifact({
      boardArtifactId: board.id,
      name: 'Tiny loader',
      brief: 'A compact 64px loading mark',
      width: 64,
      height: 64
    })

    expect(created).not.toBeNull()
    const result = created!
    const motion = useDesignWorkspaceStore.getState().artifacts.find((item) => item.id === result.artifactId)
    const frame = useCanvasShapeStore.getState().document.objects[result.shape.id]
    expect(motion?.node).toMatchObject({ width: 64, height: 64 })
    expect(frame).toMatchObject({ width: 64, height: 64 })
    await vi.waitFor(() => expect(writeWorkspaceFile).toHaveBeenCalledWith(expect.objectContaining({
      path: result.relativePath,
      content: expect.stringContaining('viewBox="0 0 64 64"')
    })))
  })

  it('escapes user text in the standalone SVG skeleton', () => {
    const source = buildSvgArtifactSkeleton({
      title: '<Logo & mark>',
      brief: 'Use "motion" safely',
      width: 128,
      height: 128
    })
    expect(source).toContain('&lt;Logo &amp; mark&gt;')
    expect(source).toContain('Use &quot;motion&quot; safely')
    expect(source).not.toContain('<script')
  })
})
