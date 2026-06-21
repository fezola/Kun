import { describe, expect, it } from 'vitest'
import { snapshotCanvas } from './canvas-snapshot'
import { createDefaultShape, createEmptyDocument } from './canvas-types'

describe('snapshotCanvas', () => {
  it('returns empty for a fresh document', () => {
    const snap = snapshotCanvas(createEmptyDocument())
    expect(snap.shapeCount).toBe(0)
    expect(snap.shapes).toEqual([])
  })

  it('lists shapes with name + bbox + parentName', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const rect = createDefaultShape('rect', 10, 20)
    rect.name = 'My Rect'
    rect.width = 30
    rect.height = 40
    doc.objects[rect.id] = { ...rect, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [rect.id] }

    const snap = snapshotCanvas(doc)
    expect(snap.shapeCount).toBe(1)
    expect(snap.shapes[0]).toMatchObject({
      id: rect.id,
      name: 'My Rect',
      type: 'rect',
      x: 10,
      y: 20,
      w: 30,
      h: 40,
      parentName: null
    })
  })

  it('rotation is included only when non-zero', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const flat = createDefaultShape('rect', 0, 0)
    const rotated = createDefaultShape('rect', 0, 0)
    rotated.rotation = 45
    doc.objects[flat.id] = { ...flat, parentId: doc.rootId }
    doc.objects[rotated.id] = { ...rotated, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [flat.id, rotated.id] }

    const snap = snapshotCanvas(doc)
    expect(snap.shapes[0]).not.toHaveProperty('rotation')
    expect(snap.shapes[1].rotation).toBe(45)
  })

  it('text shapes include textContent (truncated)', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const text = createDefaultShape('text', 0, 0)
    text.textContent = 'hello world'
    doc.objects[text.id] = { ...text, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [text.id] }

    const snap = snapshotCanvas(doc)
    expect(snap.shapes[0].textContent).toBe('hello world')
  })

  it('flags selected shapes so "this panel" resolves to an id', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const a = createDefaultShape('frame', 0, 0)
    const b = createDefaultShape('frame', 0, 0)
    doc.objects[a.id] = { ...a, parentId: doc.rootId }
    doc.objects[b.id] = { ...b, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [a.id, b.id] }

    const snap = snapshotCanvas(doc, new Set([b.id]))
    expect(snap.shapes[0]).not.toHaveProperty('selected')
    expect(snap.shapes[1].selected).toBe(true)
  })

  it('flags AI image holders (only when set)', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const plain = createDefaultShape('image', 0, 0)
    const holder = createDefaultShape('image', 0, 0)
    holder.aiImageHolder = true
    doc.objects[plain.id] = { ...plain, parentId: doc.rootId }
    doc.objects[holder.id] = { ...holder, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [plain.id, holder.id] }

    const snap = snapshotCanvas(doc)
    expect(snap.shapes[0]).not.toHaveProperty('aiImageHolder')
    expect(snap.shapes[1].aiImageHolder).toBe(true)
  })
})
