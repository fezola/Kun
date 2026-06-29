import { describe, expect, it } from 'vitest'
import { createEmptyDocument, createHtmlFrameShape } from './canvas-types'
import { computePrototypeFlowEdges } from './prototype-flow'
import type { DesignArtifact } from '../design-types'

const createdAt = '2026-06-29T00:00:00.000Z'

function artifact(id: string, title: string, extra: Partial<DesignArtifact> = {}): DesignArtifact {
  const relativePath = `.kun-design/doc/${id}/v1.html`
  return {
    id,
    kind: 'html',
    title,
    relativePath,
    createdAt,
    updatedAt: createdAt,
    versions: [{ id: `${id}-v1`, relativePath, createdAt, summary: '' }],
    ...extra
  }
}

describe('computePrototypeFlowEdges', () => {
  it('connects visible HTML frames from persisted prototype links', () => {
    const doc = createEmptyDocument()
    const homeFrame = createHtmlFrameShape('Home', 0, 0, 'home', 'desktop')
    const signupFrame = createHtmlFrameShape('Signup', 1500, 0, 'signup', 'desktop')
    doc.objects[homeFrame.id] = { ...homeFrame, parentId: doc.rootId }
    doc.objects[signupFrame.id] = { ...signupFrame, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...doc.objects[doc.rootId], children: [homeFrame.id, signupFrame.id] }

    const edges = computePrototypeFlowEdges(
      [
        artifact('home', 'Home', {
          prototypeLinks: [
            {
              targetTitle: 'Signup',
              targetArtifactId: 'signup',
              href: '../signup/v1.html',
              label: 'Start trial'
            }
          ]
        }),
        artifact('signup', 'Signup')
      ],
      doc.objects
    )

    expect(edges).toEqual([
      expect.objectContaining({
        sourceArtifactId: 'home',
        targetArtifactId: 'signup',
        sourceTitle: 'Home',
        targetTitle: 'Signup',
        label: 'Start trial',
        href: '../signup/v1.html',
        x1: 640,
        y1: 400,
        x2: 2140,
        y2: 400
      })
    ])
  })

  it('resolves by target title and skips hidden frames', () => {
    const doc = createEmptyDocument()
    const homeFrame = createHtmlFrameShape('Home', 0, 0, 'home', 'desktop')
    const hiddenFrame = createHtmlFrameShape('Details', 1500, 0, 'details', 'desktop')
    doc.objects[homeFrame.id] = { ...homeFrame, parentId: doc.rootId }
    doc.objects[hiddenFrame.id] = { ...hiddenFrame, parentId: doc.rootId, visible: false }
    doc.objects[doc.rootId] = { ...doc.objects[doc.rootId], children: [homeFrame.id, hiddenFrame.id] }

    const edges = computePrototypeFlowEdges(
      [
        artifact('home', 'Home', { prototypeLinks: [{ targetTitle: 'Details' }] }),
        artifact('details', 'Details')
      ],
      doc.objects
    )

    expect(edges).toEqual([])
  })
})
