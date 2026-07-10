import { beforeEach, describe, expect, it } from 'vitest'
import { useDesignWorkspaceStore } from './design-workspace-store'
import type { DesignArtifact, DesignDocument } from './design-types'

const createdAt = '2026-06-20T00:00:00.000Z'

function canvasArtifact(): DesignArtifact {
  return {
    id: 'canvas',
    kind: 'canvas',
    title: 'Board',
    relativePath: '.kun-design/doc/canvas/canvas.json',
    createdAt,
    updatedAt: createdAt,
    versions: [{ id: 'canvas-v1', relativePath: '.kun-design/doc/canvas/canvas.json', createdAt, summary: '' }]
  }
}

function pendingSvgArtifact(): DesignArtifact {
  return {
    id: 'motion',
    kind: 'svg',
    title: 'Motion',
    relativePath: '.kun-design/doc/motion/v1.svg',
    designMdPath: '.kun-design/doc/motion/DESIGN.md',
    previewStatus: 'pending',
    createdAt,
    updatedAt: createdAt,
    versions: [{
      id: 'motion-v1',
      relativePath: '.kun-design/doc/motion/v1.svg',
      createdAt,
      summary: 'Skeleton reservation'
    }]
  }
}

describe('SVG design workspace versions', () => {
  beforeEach(() => {
    const canvas = canvasArtifact()
    const motion = pendingSvgArtifact()
    const document: DesignDocument = {
      id: 'doc',
      title: 'Doc',
      createdAt,
      updatedAt: createdAt,
      order: 0,
      artifacts: [canvas, motion],
      activeArtifactId: canvas.id
    }
    useDesignWorkspaceStore.setState({
      workspaceRoot: '',
      documents: [document],
      activeDocumentId: document.id,
      artifacts: document.artifacts,
      activeArtifactId: canvas.id,
      designContext: { designTarget: 'web' }
    })
  })

  it('reuses a freshly reserved SVG v1, then versions later edits after it becomes ready', () => {
    const initial = useDesignWorkspaceStore.getState().prepareSvgTurn('Build the real motion', {
      artifactId: 'motion',
      activate: false,
      reusePendingInitial: true
    })
    expect(initial).toEqual({
      artifactId: 'motion',
      relativePath: '.kun-design/doc/motion/v1.svg',
      designMdPath: '.kun-design/doc/motion/DESIGN.md'
    })
    expect(useDesignWorkspaceStore.getState().artifacts.find((item) => item.id === 'motion')?.versions).toHaveLength(1)

    useDesignWorkspaceStore.getState().setArtifactPreviewStatus('motion', 'ready')
    const iteration = useDesignWorkspaceStore.getState().prepareSvgTurn('Slow the loop down', {
      artifactId: 'motion',
      activate: false,
      reusePendingInitial: true
    })
    expect(iteration).toMatchObject({
      artifactId: 'motion',
      relativePath: '.kun-design/doc/motion/v2.svg',
      basePath: '.kun-design/doc/motion/v1.svg'
    })
  })

  it('uses the highest known SVG version instead of the version array length', () => {
    const sparse: DesignArtifact = {
      ...pendingSvgArtifact(),
      relativePath: '.kun-design/doc/motion/v3.svg',
      previewStatus: 'ready',
      versions: [
        { id: 'motion-v3', relativePath: '.kun-design/doc/motion/v3.svg', createdAt, summary: 'Latest hand-authored version' },
        { id: 'motion-v1', relativePath: '.kun-design/doc/motion/v1.svg', createdAt, summary: 'Initial version' }
      ]
    }
    const document: DesignDocument = {
      id: 'doc',
      title: 'Doc',
      createdAt,
      updatedAt: createdAt,
      order: 0,
      artifacts: [canvasArtifact(), sparse],
      activeArtifactId: sparse.id
    }
    useDesignWorkspaceStore.setState({
      documents: [document],
      activeDocumentId: document.id,
      artifacts: document.artifacts,
      activeArtifactId: sparse.id
    })

    const iteration = useDesignWorkspaceStore.getState().prepareSvgTurn('Refine the hand-authored motion', {
      artifactId: sparse.id,
      activate: false
    })

    expect(iteration).toMatchObject({
      relativePath: '.kun-design/doc/motion/v4.svg',
      basePath: '.kun-design/doc/motion/v3.svg'
    })
  })
})
