import { memo, useState } from 'react'
import {
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Square,
  Circle,
  Type,
  Image,
  Frame,
  Group,
  ArrowUpRight,
  Slash,
  Pencil
} from 'lucide-react'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import type { CanvasShape, ShapeType } from '../../../design/canvas/canvas-types'

const TYPE_ICONS: Record<ShapeType, typeof Square> = {
  rect: Square,
  ellipse: Circle,
  text: Type,
  image: Image,
  frame: Frame,
  group: Group,
  arrow: ArrowUpRight,
  line: Slash,
  draw: Pencil
}

function LayerRow({
  shape,
  depth,
  objects
}: {
  shape: CanvasShape
  depth: number
  objects: Record<string, CanvasShape>
}) {
  const selectedIds = useCanvasSelectionStore((s) => s.selectedIds)
  const select = useCanvasSelectionStore((s) => s.select)
  const toggle = useCanvasSelectionStore((s) => s.toggle)
  const updateShape = useCanvasShapeStore((s) => s.updateShape)

  const selected = selectedIds.has(shape.id)
  const Icon = TYPE_ICONS[shape.type] ?? Square
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')

  const hasChildren = shape.children.length > 0 && (shape.type === 'frame' || shape.type === 'group')

  return (
    <>
      <div
        className={`flex items-center gap-1 px-1 py-0.5 cursor-pointer rounded text-[12px] transition-colors ${
          selected
            ? 'bg-blue-100 dark:bg-blue-900/30'
            : 'hover:bg-gray-100 dark:hover:bg-white/5'
        }`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={(e) => {
          if (e.shiftKey || e.metaKey) toggle(shape.id)
          else select([shape.id])
        }}
        onDoubleClick={() => {
          setDraft(shape.name)
          setRenaming(true)
        }}
      >
        <Icon className="h-3 w-3 shrink-0 text-gray-400" strokeWidth={1.5} />
        {renaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              updateShape(shape.id, { name: draft })
              setRenaming(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                updateShape(shape.id, { name: draft })
                setRenaming(false)
              }
              if (e.key === 'Escape') setRenaming(false)
            }}
            className="min-w-0 flex-1 bg-transparent text-[12px] outline-none"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-300">
            {shape.name}
          </span>
        )}
        <button
          className="shrink-0 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          onClick={(e) => {
            e.stopPropagation()
            updateShape(shape.id, { visible: !shape.visible })
          }}
        >
          {shape.visible ? (
            <Eye className="h-3 w-3" strokeWidth={1.5} />
          ) : (
            <EyeOff className="h-3 w-3" strokeWidth={1.5} />
          )}
        </button>
        <button
          className="shrink-0 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          onClick={(e) => {
            e.stopPropagation()
            updateShape(shape.id, { locked: !shape.locked })
          }}
        >
          {shape.locked ? (
            <Lock className="h-3 w-3" strokeWidth={1.5} />
          ) : (
            <Unlock className="h-3 w-3" strokeWidth={1.5} />
          )}
        </button>
      </div>
      {hasChildren &&
        [...shape.children].reverse().map((childId) => {
          const child = objects[childId]
          if (!child) return null
          return (
            <LayerRow key={childId} shape={child} depth={depth + 1} objects={objects} />
          )
        })}
    </>
  )
}

function CanvasLayersPanelInner() {
  const document = useCanvasShapeStore((s) => s.document)
  const root = document.objects[document.rootId]
  if (!root) return null

  const topLevel = [...root.children].reverse()

  return (
    <div className="flex flex-col gap-0.5 px-1 py-1">
      {topLevel.map((childId) => {
        const child = document.objects[childId]
        if (!child) return null
        return (
          <LayerRow
            key={childId}
            shape={child}
            depth={0}
            objects={document.objects}
          />
        )
      })}
      {topLevel.length === 0 && (
        <div className="px-2 py-3 text-center text-[12px] text-gray-400">
          No layers
        </div>
      )}
    </div>
  )
}

export const CanvasLayersPanel = memo(CanvasLayersPanelInner)
