import { memo } from 'react'
import {
  MousePointer2,
  Square,
  Circle,
  Type,
  Frame,
  Monitor,
  ImagePlus,
  ArrowUpRight,
  Slash,
  Pencil,
  Hand,
  ZoomIn,
  ZoomOut,
  Maximize,
  Undo2,
  Redo2,
  Grid3x3,
  Magnet
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCanvasViewportStore } from '../../../design/canvas/canvas-viewport-store'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import type { CanvasTool } from '../../../design/canvas/canvas-types'

const tools: { id: CanvasTool; icon: typeof MousePointer2; labelKey: string }[] = [
  { id: 'select', icon: MousePointer2, labelKey: 'canvasToolSelect' },
  { id: 'screen', icon: Monitor, labelKey: 'canvasToolScreen' },
  { id: 'frame', icon: Frame, labelKey: 'canvasToolFrame' },
  { id: 'rect', icon: Square, labelKey: 'canvasToolRect' },
  { id: 'ellipse', icon: Circle, labelKey: 'canvasToolEllipse' },
  { id: 'text', icon: Type, labelKey: 'canvasToolText' },
  { id: 'arrow', icon: ArrowUpRight, labelKey: 'canvasToolArrow' },
  { id: 'line', icon: Slash, labelKey: 'canvasToolLine' },
  { id: 'draw', icon: Pencil, labelKey: 'canvasToolDraw' },
  { id: 'image', icon: ImagePlus, labelKey: 'canvasToolImage' },
  { id: 'hand', icon: Hand, labelKey: 'canvasToolHand' }
]

function CanvasToolbarInner() {
  const { t } = useTranslation()
  const activeTool = useCanvasViewportStore((s) => s.activeTool)
  const setActiveTool = useCanvasViewportStore((s) => s.setActiveTool)
  const zoomTo = useCanvasViewportStore((s) => s.zoomTo)
  const zoomToFit = useCanvasViewportStore((s) => s.zoomToFit)
  const zoom = useCanvasViewportStore((s) => s.getZoom())
  const gridVisible = useCanvasViewportStore((s) => s.gridVisible)
  const toggleGrid = useCanvasViewportStore((s) => s.toggleGrid)
  const snapEnabled = useCanvasViewportStore((s) => s.snapEnabled)
  const toggleSnap = useCanvasViewportStore((s) => s.toggleSnap)
  const undo = useCanvasShapeStore((s) => s.undo)
  const redo = useCanvasShapeStore((s) => s.redo)

  const zoomPercent = `${Math.round(zoom * 100)}%`

  const iconBtnBase =
    'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors'
  const zoomBtnBase =
    'inline-flex h-9 min-w-[58px] shrink-0 items-center justify-center rounded-full px-2 transition-colors'
  const btnActive =
    'bg-accent-soft text-accent shadow-[inset_0_0_0_1px_var(--ds-sidebar-row-ring)]'
  const btnInactive =
    'text-ds-faint hover:bg-ds-hover hover:text-ds-ink dark:hover:bg-white/10'
  const divider = 'mx-1 h-6 w-px shrink-0 bg-ds-border-muted/80'

  return (
    <div className="flex max-w-[calc(100vw-7rem)] min-w-0 items-center gap-1 overflow-x-auto rounded-full border border-ds-border bg-white/74 px-1.5 py-1.5 shadow-[0_16px_42px_rgba(20,47,95,0.11)] backdrop-blur-2xl dark:bg-ds-card/72 dark:shadow-none">
      {tools.map((tool) => (
        <button
          key={tool.id}
          className={`${iconBtnBase} ${activeTool === tool.id ? btnActive : btnInactive}`}
          onClick={() => setActiveTool(tool.id)}
          title={t(tool.labelKey)}
          aria-label={t(tool.labelKey)}
        >
          <tool.icon className="h-4 w-4" />
        </button>
      ))}

      <div className={divider} />

      <button className={`${iconBtnBase} ${btnInactive}`} onClick={undo} title={t('canvasUndo')} aria-label={t('canvasUndo')}>
        <Undo2 className="h-4 w-4" />
      </button>
      <button className={`${iconBtnBase} ${btnInactive}`} onClick={redo} title={t('canvasRedo')} aria-label={t('canvasRedo')}>
        <Redo2 className="h-4 w-4" />
      </button>

      <div className={divider} />

      <button
        className={`${zoomBtnBase} ${btnInactive}`}
        onClick={() => zoomTo(1 / zoom, { x: 0, y: 0 })}
        title={t('canvasZoomReset')}
        aria-label={t('canvasZoomReset')}
      >
        <span className="text-center text-[12px] font-semibold tabular-nums">{zoomPercent}</span>
      </button>
      <button
        className={`${iconBtnBase} ${btnInactive}`}
        onClick={() => zoomTo(1.25, { x: 0, y: 0 })}
        title={t('canvasZoomIn')}
        aria-label={t('canvasZoomIn')}
      >
        <ZoomIn className="h-4 w-4" />
      </button>
      <button
        className={`${iconBtnBase} ${btnInactive}`}
        onClick={() => zoomTo(0.8, { x: 0, y: 0 })}
        title={t('canvasZoomOut')}
        aria-label={t('canvasZoomOut')}
      >
        <ZoomOut className="h-4 w-4" />
      </button>
      <button
        className={`${iconBtnBase} ${btnInactive}`}
        onClick={() => zoomToFit({ x: -200, y: -200, width: 400, height: 400 })}
        title={t('canvasZoomFit')}
        aria-label={t('canvasZoomFit')}
      >
        <Maximize className="h-4 w-4" />
      </button>

      <div className={divider} />

      <button
        className={`${iconBtnBase} ${gridVisible ? btnActive : btnInactive}`}
        onClick={toggleGrid}
        title={t('canvasGridToggle')}
        aria-label={t('canvasGridToggle')}
      >
        <Grid3x3 className="h-4 w-4" />
      </button>
      <button
        className={`${iconBtnBase} ${snapEnabled ? btnActive : btnInactive}`}
        onClick={toggleSnap}
        title={t('canvasSnap')}
        aria-label={t('canvasSnap')}
      >
        <Magnet className="h-4 w-4" />
      </button>
    </div>
  )
}

export const CanvasToolbar = memo(CanvasToolbarInner)
