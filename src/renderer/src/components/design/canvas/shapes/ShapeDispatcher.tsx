import { memo } from 'react'
import type { CanvasShape } from '../../../../design/canvas/canvas-types'
import { RectShape } from './RectShape'
import { EllipseShape } from './EllipseShape'
import { TextShape } from './TextShape'
import { ImageShape } from './ImageShape'
import { FrameShape } from './FrameShape'
import { GroupShape } from './GroupShape'
import { LinearShape } from './LinearShape'

function ShapeDispatcherInner({
  shapeId,
  objects
}: {
  shapeId: string
  objects: Record<string, CanvasShape>
}) {
  const shape = objects[shapeId]
  if (!shape || !shape.visible) return null

  const transform = `translate(${shape.x}, ${shape.y})${shape.rotation ? ` rotate(${shape.rotation}, ${shape.width / 2}, ${shape.height / 2})` : ''}`

  let content: React.ReactNode
  switch (shape.type) {
    case 'rect':
      content = <RectShape shape={shape} />
      break
    case 'ellipse':
      content = <EllipseShape shape={shape} />
      break
    case 'text':
      content = <TextShape shape={shape} />
      break
    case 'image':
      content = <ImageShape shape={shape} />
      break
    case 'frame':
      content = <FrameShape shape={shape} objects={objects} />
      break
    case 'group':
      content = <GroupShape shape={shape} objects={objects} />
      break
    case 'arrow':
    case 'line':
    case 'draw':
      content = <LinearShape shape={shape} />
      break
    default:
      return null
  }

  return (
    <g
      id={`shape-${shape.id}`}
      transform={transform}
      opacity={shape.opacity}
      style={{ pointerEvents: shape.locked ? 'none' : 'auto' }}
    >
      {content}
    </g>
  )
}

export const ShapeDispatcher = memo(ShapeDispatcherInner)
