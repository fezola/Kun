/**
 * The structured shape-operation interface. The AI Rail emits these as JSON,
 * the inspector commits them, the executor wraps the whole batch in one
 * `withUndoGroup` so a single Cmd+Z reverts the entire batch.
 *
 * Errors are returned as `{ code, message, suggestion? }` so the AI can
 * self-correct in one turn instead of throwing.
 */
import { z } from 'zod'
import type { CanvasShape, Point, ShapeType } from './canvas-types'
import { createDefaultShape, createHtmlFrameShape, type DevicePreset } from './canvas-types'
import { useCanvasShapeStore, withDescendants } from './canvas-shape-store'
import { useCanvasUndoStore } from './canvas-undo-store'
import {
  alignShapes,
  distributeShapes,
  type AlignAxis,
  type DistributeAxis
} from './canvas-align'

import { getScreenArtifactFactory } from './screen-artifact-bridge'

const ShapeTypeSchema = z.enum([
  'rect',
  'ellipse',
  'text',
  'image',
  'frame',
  'group',
  'arrow',
  'line',
  'draw'
])

const PointSchema = z.object({ x: z.number(), y: z.number() })

const FillSchema = z.object({
  type: z.literal('solid'),
  color: z.string(),
  opacity: z.number().min(0).max(1)
})

const StrokeSchema = z.object({
  color: z.string(),
  width: z.number().min(0),
  opacity: z.number().min(0).max(1),
  position: z.enum(['center', 'inside', 'outside']),
  dash: z.enum(['solid', 'dashed', 'dotted']).optional()
})

const ArrowheadSchema = z.enum(['none', 'arrow', 'triangle', 'circle', 'bar', 'diamond'])

const PartialShapeSchema = z
  .object({
    type: ShapeTypeSchema,
    name: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    rotation: z.number().optional(),
    opacity: z.number().min(0).max(1).optional(),
    fills: z.array(FillSchema).optional(),
    strokes: z.array(StrokeSchema).optional(),
    cornerRadius: z.number().min(0).optional(),
    textContent: z.string().optional(),
    fontSize: z.number().positive().optional(),
    fontFamily: z.string().optional(),
    fontWeight: z.number().min(100).max(900).optional(),
    fontColor: z.string().optional(),
    textAlign: z.enum(['left', 'center', 'right']).optional(),
    lineHeight: z.number().positive().optional(),
    imageUrl: z.string().optional(),
    aiImageHolder: z.boolean().optional(),
    clipContent: z.boolean().optional(),
    points: z.array(PointSchema).optional(),
    arrowheadStart: ArrowheadSchema.optional(),
    arrowheadEnd: ArrowheadSchema.optional()
  })
  .strict()

const PatchSchema = z
  .object({
    name: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    rotation: z.number().optional(),
    opacity: z.number().min(0).max(1).optional(),
    fills: z.array(FillSchema).optional(),
    strokes: z.array(StrokeSchema).optional(),
    cornerRadius: z.number().min(0).optional(),
    textContent: z.string().optional(),
    fontSize: z.number().positive().optional(),
    fontFamily: z.string().optional(),
    fontWeight: z.number().min(100).max(900).optional(),
    fontColor: z.string().optional(),
    textAlign: z.enum(['left', 'center', 'right']).optional(),
    lineHeight: z.number().positive().optional(),
    imageUrl: z.string().optional(),
    aiImageHolder: z.boolean().optional(),
    clipContent: z.boolean().optional(),
    points: z.array(PointSchema).optional(),
    arrowheadStart: ArrowheadSchema.optional(),
    arrowheadEnd: ArrowheadSchema.optional(),
    visible: z.boolean().optional(),
    locked: z.boolean().optional()
  })
  .strict()

const BoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive()
})

export const ShapeOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), shape: PartialShapeSchema, parentId: z.string().optional() }),
  z.object({ op: z.literal('update'), id: z.string(), patch: PatchSchema }),
  z.object({ op: z.literal('delete'), id: z.string() }),
  z.object({
    op: z.literal('reparent'),
    id: z.string(),
    newParentId: z.string(),
    index: z.number().int().nonnegative().optional()
  }),
  z.object({ op: z.literal('move'), ids: z.array(z.string()).min(1), dx: z.number(), dy: z.number() }),
  z.object({ op: z.literal('resize'), id: z.string(), bounds: BoundsSchema }),
  z.object({
    op: z.literal('align'),
    ids: z.array(z.string()).min(2),
    axis: z.enum(['left', 'h-center', 'right', 'top', 'v-center', 'bottom'])
  }),
  z.object({
    op: z.literal('distribute'),
    ids: z.array(z.string()).min(3),
    axis: z.enum(['horizontal', 'vertical'])
  }),
  z.object({
    op: z.literal('add-screen'),
    name: z.string(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    devicePreset: z.enum(['mobile', 'tablet', 'desktop']).optional()
  }),
  z.object({
    op: z.literal('duplicate'),
    id: z.string(),
    count: z.number().int().positive().max(20).optional(),
    offset: z.object({ dx: z.number(), dy: z.number() }).optional()
  }),
  z.object({
    op: z.literal('reorder'),
    id: z.string(),
    action: z.enum(['front', 'back', 'forward', 'backward'])
  })
])

export type ShapeOp = z.infer<typeof ShapeOpSchema>

export type OpError = {
  code:
    | 'INVALID_OP'
    | 'SHAPE_NOT_FOUND'
    | 'PARENT_NOT_FOUND'
    | 'WOULD_CYCLE'
    | 'UNSUPPORTED_TYPE'
  message: string
  suggestion?: string
}

export type ExecuteResult = {
  ok: boolean
  affectedIds: string[]
  errors: OpError[]
}

function findShape(id: string): CanvasShape | null {
  return useCanvasShapeStore.getState().document.objects[id] ?? null
}

function listShapeIds(): string[] {
  const { objects, rootId } = useCanvasShapeStore.getState().document
  return Object.keys(objects).filter((id) => id !== rootId)
}

function suggestionForMissingId(missing: string): string {
  const ids = listShapeIds()
  const doc = useCanvasShapeStore.getState().document
  const names = ids.map((id) => `"${doc.objects[id].name}" (${id})`).slice(0, 10)
  return `Available shapes: ${names.join(', ')}`
}

const LINEAR_TYPES = new Set<ShapeType>(['arrow', 'line', 'draw'])

/**
 * Ops supply linear `points` in ABSOLUTE canvas coords (natural for the AI).
 * Convert them to the stored form: bounding box in x/y/width/height + points
 * relative to that box (matching how the drawing tools persist).
 */
function bboxRelative(pts: Point[]): {
  x: number
  y: number
  width: number
  height: number
  points: Point[]
} {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    points: pts.map((p) => ({ x: p.x - minX, y: p.y - minY }))
  }
}

function executeOne(op: ShapeOp, affectedIds: Set<string>, errors: OpError[]): void {
  const store = useCanvasShapeStore.getState()
  switch (op.op) {
    case 'add': {
      // Validate an explicit parent up front: addShape silently no-ops when the
      // parent is missing, so without this the op would report phantom success
      // (a bogus affected id) and the agent would never learn its frame id was wrong.
      if (op.parentId && !findShape(op.parentId)) {
        errors.push({
          code: 'PARENT_NOT_FOUND',
          message: `Cannot add shape: parent "${op.parentId}" does not exist`,
          suggestion: suggestionForMissingId(op.parentId)
        })
        return
      }
      const { type } = op.shape
      const x = op.shape.x ?? 0
      const y = op.shape.y ?? 0
      const base = createDefaultShape(type as ShapeType, x, y)
      // Apply optional overrides from the op (excluding type/x/y already baked in).
      const overrides: Partial<CanvasShape> = { ...op.shape }
      delete (overrides as Record<string, unknown>).type
      delete (overrides as Record<string, unknown>).x
      delete (overrides as Record<string, unknown>).y
      Object.assign(base, overrides)
      if (LINEAR_TYPES.has(base.type) && base.points && base.points.length > 0) {
        Object.assign(base, bboxRelative(base.points))
      }
      store.addShape(base, op.parentId)
      affectedIds.add(base.id)
      break
    }
    case 'update': {
      const existing = findShape(op.id)
      if (!existing) {
        errors.push({
          code: 'SHAPE_NOT_FOUND',
          message: `No shape with id "${op.id}"`,
          suggestion: suggestionForMissingId(op.id)
        })
        return
      }
      {
        const patch: Partial<CanvasShape> = { ...op.patch }
        if (LINEAR_TYPES.has(existing.type) && patch.points && patch.points.length > 0) {
          Object.assign(patch, bboxRelative(patch.points))
        }
        store.updateShape(op.id, patch)
      }
      affectedIds.add(op.id)
      break
    }
    case 'delete': {
      if (!findShape(op.id)) {
        errors.push({
          code: 'SHAPE_NOT_FOUND',
          message: `No shape with id "${op.id}"`,
          suggestion: suggestionForMissingId(op.id)
        })
        return
      }
      store.deleteShape(op.id)
      affectedIds.add(op.id)
      break
    }
    case 'reparent': {
      if (!findShape(op.id)) {
        errors.push({ code: 'SHAPE_NOT_FOUND', message: `No shape "${op.id}"` })
        return
      }
      if (!findShape(op.newParentId)) {
        errors.push({ code: 'PARENT_NOT_FOUND', message: `No parent "${op.newParentId}"` })
        return
      }
      store.reparentShape(op.id, op.newParentId, op.index)
      affectedIds.add(op.id)
      break
    }
    case 'move': {
      // Validate the explicitly-named ids, then move them AND their descendants
      // by the same delta — children store absolute coords, so a frame's move
      // must carry them along (deduped so an id named twice moves once).
      const present = op.ids.filter((id) => {
        if (findShape(id)) return true
        errors.push({ code: 'SHAPE_NOT_FOUND', message: `No shape "${id}"` })
        return false
      })
      const objects = useCanvasShapeStore.getState().document.objects
      for (const id of withDescendants(objects, present)) {
        const s = findShape(id)
        if (!s) continue
        store.updateShape(id, { x: s.x + op.dx, y: s.y + op.dy })
        affectedIds.add(id)
      }
      break
    }
    case 'resize': {
      if (!findShape(op.id)) {
        errors.push({ code: 'SHAPE_NOT_FOUND', message: `No shape "${op.id}"` })
        return
      }
      store.updateShape(op.id, {
        x: op.bounds.x,
        y: op.bounds.y,
        width: op.bounds.width,
        height: op.bounds.height
      })
      affectedIds.add(op.id)
      break
    }
    case 'align': {
      const doc = useCanvasShapeStore.getState().document
      const shapes = op.ids
        .map((id) => doc.objects[id])
        .filter((s): s is CanvasShape => Boolean(s))
        .map((s) => ({ id: s.id, x: s.x, y: s.y, width: s.width, height: s.height }))
      if (shapes.length < 2) {
        errors.push({ code: 'INVALID_OP', message: 'align requires ≥2 valid shapes' })
        return
      }
      const out = alignShapes(shapes, op.axis as AlignAxis)
      for (const [id, patch] of out) {
        store.updateShape(id, patch)
        affectedIds.add(id)
      }
      break
    }
    case 'distribute': {
      const doc = useCanvasShapeStore.getState().document
      const shapes = op.ids
        .map((id) => doc.objects[id])
        .filter((s): s is CanvasShape => Boolean(s))
        .map((s) => ({ id: s.id, x: s.x, y: s.y, width: s.width, height: s.height }))
      if (shapes.length < 3) {
        errors.push({ code: 'INVALID_OP', message: 'distribute requires ≥3 valid shapes' })
        return
      }
      const out = distributeShapes(shapes, op.axis as DistributeAxis)
      for (const [id, patch] of out) {
        store.updateShape(id, patch)
        affectedIds.add(id)
      }
      break
    }
    case 'duplicate': {
      if (!findShape(op.id)) {
        errors.push({
          code: 'SHAPE_NOT_FOUND',
          message: `No shape with id "${op.id}"`,
          suggestion: suggestionForMissingId(op.id)
        })
        return
      }
      const count = Math.max(1, Math.min(op.count ?? 1, 20))
      const dx = op.offset?.dx ?? 24
      const dy = op.offset?.dy ?? 24
      for (let i = 0; i < count; i += 1) {
        const newId = store.duplicateShape(op.id)
        if (!newId) {
          errors.push({ code: 'INVALID_OP', message: `Cannot duplicate "${op.id}" (root or detached shapes can't be duplicated)` })
          break
        }
        // Stagger each copy so duplicates don't stack exactly on the original.
        // Children store ABSOLUTE coords, so the whole clone subtree shifts together.
        if (dx !== 0 || dy !== 0) {
          const objects = useCanvasShapeStore.getState().document.objects
          const step = i + 1
          for (const cloneId of withDescendants(objects, [newId])) {
            const cs = objects[cloneId]
            if (cs) store.updateShape(cloneId, { x: cs.x + dx * step, y: cs.y + dy * step })
          }
        }
        affectedIds.add(newId)
      }
      break
    }
    case 'reorder': {
      const shape = findShape(op.id)
      if (!shape) {
        errors.push({
          code: 'SHAPE_NOT_FOUND',
          message: `No shape with id "${op.id}"`,
          suggestion: suggestionForMissingId(op.id)
        })
        return
      }
      const parent = shape.parentId ? findShape(shape.parentId) : null
      const siblings = parent?.children ?? []
      const current = siblings.indexOf(op.id)
      if (!parent || current < 0) {
        errors.push({ code: 'INVALID_OP', message: `Shape "${op.id}" has no parent layer order to change` })
        return
      }
      const last = siblings.length - 1
      const target =
        op.action === 'front'
          ? last
          : op.action === 'back'
            ? 0
            : op.action === 'forward'
              ? Math.min(last, current + 1)
              : Math.max(0, current - 1)
      if (target !== current) store.reorderShape(op.id, target)
      affectedIds.add(op.id)
      break
    }
    case 'add-screen': {
      const factory = getScreenArtifactFactory()
      const artifactId = factory?.(op.name) ?? null
      if (!artifactId) {
        errors.push({ code: 'INVALID_OP', message: 'Cannot create screen artifact — no handler registered' })
        return
      }
      const preset = (op.devicePreset ?? 'desktop') as DevicePreset
      const shape = createHtmlFrameShape(op.name, op.x ?? 0, op.y ?? 0, artifactId, preset)
      if (op.width) shape.width = op.width
      if (op.height) shape.height = op.height
      store.addShape(shape)
      affectedIds.add(shape.id)
      break
    }
    default: {
      const exhaustive: never = op
      errors.push({ code: 'INVALID_OP', message: `Unknown op: ${JSON.stringify(exhaustive)}` })
    }
  }
}

/** Execute a batch of operations atomically. Returns affected ids + structured errors. */
export function executeOps(rawOps: unknown[], label = 'shape-ops'): ExecuteResult {
  const affectedIds = new Set<string>()
  const errors: OpError[] = []

  // Validate every op first; collect errors but don't abort — let the user see all problems.
  const validatedOps: ShapeOp[] = []
  for (let i = 0; i < rawOps.length; i++) {
    const parsed = ShapeOpSchema.safeParse(rawOps[i])
    if (!parsed.success) {
      errors.push({
        code: 'INVALID_OP',
        message: `Op #${i}: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`
      })
      continue
    }
    validatedOps.push(parsed.data)
  }

  if (validatedOps.length === 0) {
    return { ok: errors.length === 0, affectedIds: [], errors }
  }

  useCanvasUndoStore.getState().withGroup(label, () => {
    for (const op of validatedOps) {
      executeOne(op, affectedIds, errors)
    }
  })

  return {
    ok: errors.length === 0,
    affectedIds: Array.from(affectedIds),
    errors
  }
}
