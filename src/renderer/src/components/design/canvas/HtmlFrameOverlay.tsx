import { useEffect, useMemo, type ReactElement } from 'react'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useCanvasViewportStore } from '../../../design/canvas/canvas-viewport-store'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import { isHtmlFrame, type CanvasShape } from '../../../design/canvas/canvas-types'
import type { DesignHtmlElementContext } from '../../../design/design-composer-context'
import type { DesignRuntimeQualityPayload } from '../../../design/design-html-quality'
import { ScreenOverlay } from './html-frame/HtmlFrameScreenOverlay'

export {
  HTML_FRAME_CONTENT_SIZE_QUERY,
  buildHtmlFrameScrollbarSuppressionScript,
  executeHtmlFrameWebviewScript,
  htmlFrameAllowsWidthAutoGrow,
  htmlFrameDrawingActive,
  htmlFrameOverlayPointerEvents,
  htmlFrameShouldApplyScrollbarSuppression,
  htmlFrameShouldSuppressDocumentScrollbars,
  htmlFrameVisualCanvasHeight,
  htmlFrameWebviewPartition,
  resolveHtmlFrameMeasurementDecision,
  shouldAutoResizeHtmlFrame,
  shouldRenderHtmlFrameWebview
} from './html-frame/html-frame-helpers'
export type { HtmlFrameMeasurementDecision } from './html-frame/html-frame-helpers'

const MAX_ACTIVE_WEBVIEWS = 10
const MIN_ZOOM_FOR_WEBVIEW = 0.04

type Props = {
  workspaceRoot: string
  interactiveId: string | null
  editingId: string | null
  onToggleInteractive: (shapeId: string) => void
  onToggleModify: (shapeId: string) => void
  onUseElementAsContext?: (context: DesignHtmlElementContext | null, promptSeed?: string) => void
  onRuntimeQualityFindings?: (payload: DesignRuntimeQualityPayload) => void
  onRequestQualityRepair?: (payload: DesignRuntimeQualityPayload) => void
}

export function HtmlFrameOverlay({
  workspaceRoot,
  interactiveId,
  editingId,
  onToggleInteractive,
  onToggleModify,
  onUseElementAsContext,
  onRuntimeQualityFindings,
  onRequestQualityRepair
}: Props): ReactElement {
  const objects = useCanvasShapeStore((s) => s.document.objects)
  const vbox = useCanvasViewportStore((s) => s.vbox)
  const containerWidth = useCanvasViewportStore((s) => s.containerWidth)
  const containerHeight = useCanvasViewportStore((s) => s.containerHeight)
  const activeTool = useCanvasViewportStore((s) => s.activeTool)
  const selectedIds = useCanvasSelectionStore((s) => s.selectedIds)

  const zoom = containerWidth / vbox.width
  const panning = activeTool === 'hand'

  const htmlFrames = useMemo(() => {
    const frames: CanvasShape[] = []
    for (const id of Object.keys(objects)) {
      const shape = objects[id]
      if (shape && isHtmlFrame(shape) && shape.visible) {
        frames.push(shape)
      }
    }
    return frames
  }, [objects])

  // Visibility + priority: viewport-visible frames first, selected frames get priority
  const visibleFrames = useMemo(() => {
    return htmlFrames
      .filter((shape) => {
        const right = shape.x + shape.width
        const bottom = shape.y + shape.height
        const vRight = vbox.x + vbox.width
        const vBottom = vbox.y + vbox.height
        return right > vbox.x && shape.x < vRight && bottom > vbox.y && shape.y < vBottom
      })
      .sort((a, b) => {
        const aSelected = selectedIds.has(a.id) ? 1 : 0
        const bSelected = selectedIds.has(b.id) ? 1 : 0
        return bSelected - aSelected
      })
  }, [htmlFrames, vbox, selectedIds])

  const selectedIdsKey = useMemo(() => [...selectedIds].sort().join(','), [selectedIds])

  useEffect(() => {
    onUseElementAsContext?.(null)
  }, [onUseElementAsContext, selectedIdsKey])

  if (htmlFrames.length === 0 || zoom < MIN_ZOOM_FOR_WEBVIEW) return <></>

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {visibleFrames.slice(0, MAX_ACTIVE_WEBVIEWS).map((shape) => {
        const screenX = ((shape.x - vbox.x) / vbox.width) * containerWidth
        const screenY = ((shape.y - vbox.y) / vbox.height) * containerHeight
        const screenWidth = (shape.width / vbox.width) * containerWidth
        const screenHeight = (shape.height / vbox.height) * containerHeight
        const active = selectedIds.has(shape.id)

        return (
          <ScreenOverlay
            key={shape.id}
            shape={shape}
            workspaceRoot={workspaceRoot}
            screenX={screenX}
            screenY={screenY}
            screenWidth={screenWidth}
            screenHeight={screenHeight}
            zoom={zoom}
            active={active}
            interactive={interactiveId === shape.id}
            panning={panning}
            editing={editingId === shape.id}
            onDoubleClick={onToggleInteractive}
            onToggleModify={onToggleModify}
            onUseElementAsContext={onUseElementAsContext}
            onRuntimeQualityFindings={onRuntimeQualityFindings}
            onRequestQualityRepair={onRequestQualityRepair}
          />
        )
      })}
    </div>
  )
}
