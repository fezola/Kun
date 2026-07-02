import { useCanvasSelectionStore } from '../canvas-selection-store'
import { useCanvasShapeStore } from '../canvas-shape-store'
import { useCanvasUndoStore } from '../canvas-undo-store'
import { executeAdvancedShapeOp } from './handlers-advanced'
import { executeBasicShapeOp } from './handlers-basic'
import { executeDesignSystemShapeOp } from './handlers-system'
import { type ExecuteOpsOptions, type ExecuteResult, type OpError, type ShapeOp, ShapeOpSchema } from './schema'

function executeOne(
  op: ShapeOp,
  affectedIds: Set<string>,
  errors: OpError[],
  options: ExecuteOpsOptions = {}
): void {
  if (executeBasicShapeOp(op, affectedIds, errors, options)) return
  if (executeDesignSystemShapeOp(op, affectedIds, errors)) return
  if (executeAdvancedShapeOp(op, affectedIds, errors, options)) return

  errors.push({ code: 'INVALID_OP', message: `Unknown op: ${JSON.stringify(op)}` })
}

/** Execute a batch of operations atomically. Returns affected ids + structured errors. */
export function executeOps(
  rawOps: unknown[],
  label = 'shape-ops',
  options?: ExecuteOpsOptions
): ExecuteResult {
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
      executeOne(op, affectedIds, errors, options)
    }
    const selectedAfter = options?.selectAfter?.(Array.from(affectedIds))
    if (selectedAfter) {
      useCanvasSelectionStore.getState().select(
        selectedAfter.filter((id) => Boolean(useCanvasShapeStore.getState().document.objects[id]))
      )
    }
  })

  return {
    ok: errors.length === 0,
    affectedIds: Array.from(affectedIds),
    errors
  }
}
