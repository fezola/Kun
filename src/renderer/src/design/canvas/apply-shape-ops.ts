import { executeOps, type OpError } from './shape-ops'

/**
 * Extract every `shapeops` fenced code block from a markdown-ish string.
 * Tolerates leading/trailing whitespace inside the fence and json/array shapes.
 */
export function extractShapeOpsBlocks(text: string): unknown[][] {
  const out: unknown[][] = []
  const re = /```shapeops\s*([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const raw = m[1].trim()
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) out.push(parsed)
      else out.push([parsed])
    } catch {
      // ignore malformed JSON — executor will report via Zod when called with garbage
    }
  }
  return out
}

export type ApplyShapeOpsResult = {
  affectedIds: string[]
  errors: OpError[]
  /** Number of ```shapeops``` blocks parsed and executed (each is one undo batch). */
  batchCount: number
}

/**
 * Parse every ```shapeops``` block in `text` and execute each as its own atomic
 * undo batch against the singleton canvas stores. Pure engine — no UI side
 * effects (no glow, no viewport focus). Callers layer those on top.
 */
export function applyShapeOpsFromText(text: string): ApplyShapeOpsResult {
  const blocks = extractShapeOpsBlocks(text)
  const affectedIds: string[] = []
  const errors: OpError[] = []
  blocks.forEach((ops, i) => {
    const result = executeOps(ops, `ai:${i}`)
    affectedIds.push(...result.affectedIds)
    errors.push(...result.errors)
  })
  return { affectedIds, errors, batchCount: blocks.length }
}
