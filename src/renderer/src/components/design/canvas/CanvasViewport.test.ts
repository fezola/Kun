import { describe, expect, it } from 'vitest'
import {
  resolveCanvasDesignSystemBaseDir,
  shouldRenderCanvasMinimap,
  shouldHandleCanvasKeyboardEvent,
  shouldRenderDesignArtifactOverlays,
  shouldOpenImageAnnotation,
  resolveCanvasSelectionAfterDocumentSync,
  resolveHtmlFrameOverlayInteractionState,
  shouldResetCanvasTransientInteractionAfterDocumentSync,
  shouldSyncCanvasHtmlFrames,
  shouldToggleHtmlFrameInteractiveOnDoubleClick
} from './CanvasViewport'
import { createDefaultShape, createEmptyDocument, createHtmlFrameShape } from '../../../design/canvas/canvas-types'

describe('CanvasViewport surface behavior', () => {
  it('keeps design artifact overlays out of the code canvas', () => {
    expect(shouldRenderDesignArtifactOverlays('code')).toBe(false)
    expect(shouldRenderDesignArtifactOverlays('design')).toBe(true)
  })

  it('keeps the minimap out of the code sidebar canvas', () => {
    expect(shouldRenderCanvasMinimap('code')).toBe(false)
    expect(shouldRenderCanvasMinimap('design')).toBe(true)
  })

  it('keeps HTML frame artifact sync scoped to the design canvas', () => {
    expect(shouldSyncCanvasHtmlFrames('design', true)).toBe(true)
    expect(shouldSyncCanvasHtmlFrames('design', false)).toBe(false)
    expect(shouldSyncCanvasHtmlFrames('code', true)).toBe(false)
  })

  it('allows filled images to open annotation on design and code canvases', () => {
    const image = createDefaultShape('image', 0, 0)
    image.imageUrl = 'assets/image.png'
    const emptyImage = createDefaultShape('image', 0, 0)
    const rect = createDefaultShape('rect', 0, 0)

    expect(shouldOpenImageAnnotation('design', image)).toBe(true)
    expect(shouldOpenImageAnnotation('code', image)).toBe(true)
    expect(shouldOpenImageAnnotation('code', emptyImage)).toBe(false)
    expect(shouldOpenImageAnnotation('code', rect)).toBe(false)
  })

  it('toggles live HTML frame interaction from design-surface double-clicks only', () => {
    const htmlFrame = createDefaultShape('frame', 0, 0)
    htmlFrame.htmlArtifactId = 'artifact_html'
    const plainFrame = createDefaultShape('frame', 0, 0)

    expect(shouldToggleHtmlFrameInteractiveOnDoubleClick('design', htmlFrame)).toBe(true)
    expect(shouldToggleHtmlFrameInteractiveOnDoubleClick('code', htmlFrame)).toBe(false)
    expect(shouldToggleHtmlFrameInteractiveOnDoubleClick('design', plainFrame)).toBe(false)
    expect(shouldToggleHtmlFrameInteractiveOnDoubleClick('design', undefined)).toBe(false)
  })

  it('allows code canvases to override the design-system persistence directory', () => {
    expect(resolveCanvasDesignSystemBaseDir('.kun-canvas', '.kun-canvas/code-thread-1')).toBe(
      '.kun-canvas/code-thread-1'
    )
    expect(resolveCanvasDesignSystemBaseDir('.kun-design/doc-1', undefined)).toBe('.kun-design/doc-1')
  })

  it('keeps design canvas keyboard shortcuts global', () => {
    expect(shouldHandleCanvasKeyboardEvent('design', null, null, null)).toBe(true)
  })

  it('scopes code canvas keyboard shortcuts to the whiteboard tree', () => {
    const inside = {}
    const activeInside = {}
    const outside = {}
    const root = {
      contains: (target: unknown) => target === inside || target === activeInside
    } as HTMLElement

    expect(shouldHandleCanvasKeyboardEvent('code', inside as EventTarget, root, null)).toBe(true)
    expect(shouldHandleCanvasKeyboardEvent('code', outside as EventTarget, root, activeInside as Element)).toBe(true)
    expect(shouldHandleCanvasKeyboardEvent('code', outside as EventTarget, root, null)).toBe(false)
    expect(shouldHandleCanvasKeyboardEvent('code', inside as EventTarget, null, null)).toBe(false)
  })

  it('prunes selection state to shapes that still exist after document sync', () => {
    const doc = createEmptyDocument()
    const surviving = createDefaultShape('frame', 0, 0)
    doc.objects[surviving.id] = { ...surviving, parentId: doc.rootId }
    doc.objects[doc.rootId] = {
      ...doc.objects[doc.rootId]!,
      children: [surviving.id]
    }

    expect(resolveCanvasSelectionAfterDocumentSync(doc, {
      selectedIds: [surviving.id, 'removed-frame'],
      editingId: 'removed-frame',
      hoverTargetId: surviving.id
    })).toEqual({
      selectedIds: [surviving.id],
      editingId: null,
      hoverTargetId: surviving.id
    })
  })

  it('clears HTML overlay interaction state for removed, unselected, or non-html frames', () => {
    const doc = createEmptyDocument()
    const htmlFrame = createHtmlFrameShape('Home', 0, 0, 'artifact-home', 'desktop')
    const hiddenHtmlFrame = createHtmlFrameShape('Hidden', 0, 0, 'artifact-hidden', 'desktop')
    hiddenHtmlFrame.visible = false
    const plainFrame = createDefaultShape('frame', 0, 0)
    for (const shape of [htmlFrame, hiddenHtmlFrame, plainFrame]) {
      doc.objects[shape.id] = { ...shape, parentId: doc.rootId }
      doc.objects[doc.rootId]!.children.push(shape.id)
    }

    expect(resolveHtmlFrameOverlayInteractionState(doc, new Set([htmlFrame.id]), {
      interactiveId: htmlFrame.id,
      editingId: htmlFrame.id
    })).toEqual({
      interactiveId: htmlFrame.id,
      editingId: htmlFrame.id
    })
    expect(resolveHtmlFrameOverlayInteractionState(doc, new Set([htmlFrame.id]), {
      interactiveId: 'removed-frame',
      editingId: htmlFrame.id
    })).toEqual({
      interactiveId: null,
      editingId: htmlFrame.id
    })
    expect(resolveHtmlFrameOverlayInteractionState(doc, new Set(), {
      interactiveId: htmlFrame.id,
      editingId: htmlFrame.id
    })).toEqual({
      interactiveId: null,
      editingId: null
    })
    expect(resolveHtmlFrameOverlayInteractionState(doc, new Set([hiddenHtmlFrame.id, plainFrame.id]), {
      interactiveId: hiddenHtmlFrame.id,
      editingId: plainFrame.id
    })).toEqual({
      interactiveId: null,
      editingId: null
    })
    expect(resolveHtmlFrameOverlayInteractionState(doc, new Set([htmlFrame.id]), {
      interactiveId: htmlFrame.id,
      editingId: htmlFrame.id,
      overlayAvailable: false
    })).toEqual({
      interactiveId: null,
      editingId: null
    })
    expect(resolveHtmlFrameOverlayInteractionState(doc, new Set([htmlFrame.id]), {
      interactiveId: htmlFrame.id,
      editingId: htmlFrame.id,
      mountableFrameIds: new Set()
    })).toEqual({
      interactiveId: null,
      editingId: null
    })
  })

  it('resets transient marquee and snap guides when sync removes shapes', () => {
    expect(shouldResetCanvasTransientInteractionAfterDocumentSync(['removed-frame'])).toBe(true)
    expect(shouldResetCanvasTransientInteractionAfterDocumentSync([])).toBe(false)
  })
})
