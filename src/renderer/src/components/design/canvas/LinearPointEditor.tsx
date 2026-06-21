import { memo, useCallback, useRef, type ReactElement } from 'react'
import type { CanvasShape, Point } from '../../../design/canvas/canvas-types'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useCanvasUndoStore } from '../../../design/canvas/canvas-undo-store'

const VERTEX_R_PX = 5
const MID_R_PX = 4
const SELECTION_COLOR = '#3b82f6'

type SnapshotPatch = {
  x: number
  y: number
  width: number
  height: number
  points: Point[]
}

function snapshot(shape: CanvasShape): SnapshotPatch {
  return {
    x: shape.x,
    y: shape.y,
    width: shape.width,
    height: shape.height,
    points: (shape.points ?? []).map((p) => ({ x: p.x, y: p.y }))
  }
}

/** Recompute axis-aligned bbox + points relative to that bbox, given absolute coords. */
function normalizeAbs(abs: Point[]): SnapshotPatch {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of abs) {
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
    points: abs.map((p) => ({ x: p.x - minX, y: p.y - minY }))
  }
}

/**
 * Excalidraw-style polyline editor for selected `arrow` / `line` shapes.
 * Solid blue dots = vertices (drag to move). Dashed dots between every pair of
 * vertices = midpoint handles: dragging one inserts a new vertex at that
 * position, so a 2-point straight line immediately becomes a 3-point polyline
 * that LinearShape smooths into a Catmull-Rom curve. The bbox + relative points
 * are recomputed on every move so the rest of the box-based machinery (select,
 * snap, properties) keeps working unchanged.
 */
function LinearPointEditorInner({ shape, zoom }: { shape: CanvasShape; zoom: number }): ReactElement | null {
  const startRef = useRef<SnapshotPatch | null>(null)

  const beginDrag = useCallback(
    (
      e: React.PointerEvent,
      targetSvg: SVGSVGElement | null,
      // null = drag an existing vertex; non-null = a brand new vertex was
      // inserted at this index, the absolute polyline pre-insertion is given.
      seedAbs: Point[] | null,
      movingIndex: number
    ) => {
      e.stopPropagation()
      e.preventDefault()
      const svg = targetSvg
      if (!svg) return

      const store = useCanvasShapeStore.getState()
      const before = store.document.objects[shape.id]
      if (!before) return
      startRef.current = snapshot(before)

      // Commit the insertion immediately for midpoint drags so the user sees
      // their grabbed dot already sitting on the polyline.
      if (seedAbs) {
        store.updateShape(shape.id, normalizeAbs(seedAbs), true)
      }

      const onMove = (ev: PointerEvent): void => {
        const svgRect = svg.getBoundingClientRect()
        const vbox = svg.viewBox.baseVal
        const canvasX = vbox.x + ((ev.clientX - svgRect.left) / svgRect.width) * vbox.width
        const canvasY = vbox.y + ((ev.clientY - svgRect.top) / svgRect.height) * vbox.height

        const cur = useCanvasShapeStore.getState().document.objects[shape.id]
        if (!cur || !cur.points) return
        const abs = cur.points.map((p) => ({ x: cur.x + p.x, y: cur.y + p.y }))
        if (movingIndex < 0 || movingIndex >= abs.length) return
        abs[movingIndex] = { x: canvasX, y: canvasY }
        useCanvasShapeStore.getState().updateShape(shape.id, normalizeAbs(abs), true)
      }

      const onUp = (): void => {
        const before = startRef.current
        startRef.current = null
        if (before) {
          const after = useCanvasShapeStore.getState().document.objects[shape.id]
          if (after) {
            useCanvasUndoStore.getState().pushChange({
              patches: [{ id: shape.id, before, after: snapshot(after) }],
              label: 'edit-points'
            })
          }
        }
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [shape.id]
  )

  const pts = shape.points ?? []
  if (pts.length < 2) return null

  const vertexR = VERTEX_R_PX / zoom
  const midR = MID_R_PX / zoom
  const sw = 1.5 / zoom

  const absVerts = pts.map((p) => ({ x: shape.x + p.x, y: shape.y + p.y }))

  return (
    <g>
      {/* Midpoint placeholders: dashed empty circles between every pair of vertices. */}
      {absVerts.slice(0, -1).map((v, i) => {
        const next = absVerts[i + 1]
        const cx = (v.x + next.x) / 2
        const cy = (v.y + next.y) / 2
        const inserted: Point[] = [
          ...absVerts.slice(0, i + 1),
          { x: cx, y: cy },
          ...absVerts.slice(i + 1)
        ]
        return (
          <circle
            key={`mid-${i}`}
            cx={cx}
            cy={cy}
            r={midR}
            fill="#ffffff"
            fillOpacity={0.55}
            stroke={SELECTION_COLOR}
            strokeOpacity={0.55}
            strokeWidth={sw}
            strokeDasharray={`${2 / zoom} ${1.5 / zoom}`}
            style={{ cursor: 'pointer' }}
            pointerEvents="all"
            onPointerDown={(e) =>
              beginDrag(e, (e.currentTarget as SVGCircleElement).ownerSVGElement, inserted, i + 1)
            }
          />
        )
      })}

      {/* Vertex handles. */}
      {absVerts.map((v, i) => (
        <circle
          key={`vert-${i}`}
          cx={v.x}
          cy={v.y}
          r={vertexR}
          fill="#ffffff"
          stroke={SELECTION_COLOR}
          strokeWidth={sw}
          style={{ cursor: 'grab' }}
          pointerEvents="all"
          onPointerDown={(e) =>
            beginDrag(e, (e.currentTarget as SVGCircleElement).ownerSVGElement, null, i)
          }
        />
      ))}
    </g>
  )
}

export const LinearPointEditor = memo(LinearPointEditorInner)
