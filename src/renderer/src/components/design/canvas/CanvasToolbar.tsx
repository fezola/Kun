import { memo, useCallback, useState } from 'react'
import {
  ArrowRight,
  Circle,
  Frame,
  Hand,
  ImagePlus,
  Minus,
  Monitor,
  MousePointer2,
  Palette,
  Pencil,
  Sparkles,
  Square,
  Type as TypeIcon
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { importWorkspaceImageToCanvas } from '../../../design/canvas/canvas-image-import'
import type { CanvasTool } from '../../../design/canvas/canvas-types'
import { useCanvasViewportStore } from '../../../design/canvas/canvas-viewport-store'
import { useDesignWorkspaceStore } from '../../../design/design-workspace-store'
import { DesignContextPopover } from '../DesignContextPopover'

type Props = {
  workspaceRoot: string
  onOpenAgentSettings?: () => void
}

type ToolButton = {
  id: CanvasTool
  icon: typeof MousePointer2
  labelKey: string
}

const tools: ToolButton[] = [
  { id: 'select', icon: MousePointer2, labelKey: 'canvasToolSelect' },
  { id: 'screen', icon: Monitor, labelKey: 'canvasToolScreen' },
  { id: 'frame', icon: Frame, labelKey: 'canvasToolFrame' },
  { id: 'rect', icon: Square, labelKey: 'canvasToolRect' },
  { id: 'ellipse', icon: Circle, labelKey: 'canvasToolEllipse' },
  { id: 'text', icon: TypeIcon, labelKey: 'canvasToolText' },
  { id: 'arrow', icon: ArrowRight, labelKey: 'canvasToolArrow' },
  { id: 'line', icon: Minus, labelKey: 'canvasToolLine' },
  { id: 'draw', icon: Pencil, labelKey: 'canvasToolDraw' },
  { id: 'hand', icon: Hand, labelKey: 'canvasToolHand' }
]

function CanvasToolbarInner({ workspaceRoot, onOpenAgentSettings }: Props) {
  const { t } = useTranslation('common')
  const activeTool = useCanvasViewportStore((s) => s.activeTool)
  const setActiveTool = useCanvasViewportStore((s) => s.setActiveTool)
  const vbox = useCanvasViewportStore((s) => s.vbox)
  const setFileError = useDesignWorkspaceStore((s) => s.setFileError)
  const setCanvasAssistantOpen = useDesignWorkspaceStore((s) => s.setCanvasAssistantOpen)
  const [imageImportBusy, setImageImportBusy] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)

  const importImage = useCallback((): void => {
    if (imageImportBusy) return
    setImageImportBusy(true)
    setFileError(null)
    void importWorkspaceImageToCanvas({ workspaceRoot, vbox })
      .then((result) => {
        if (!result.ok && !result.canceled) {
          setFileError(result.message ?? t('canvasToolUploadFailed'))
        }
      })
      .finally(() => setImageImportBusy(false))
  }, [imageImportBusy, setFileError, t, vbox, workspaceRoot])

  const iconBtnBase =
    'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-45'
  const btnActive = 'bg-[#1f2733] text-white shadow-[0_6px_16px_rgba(15,23,42,0.22)]'
  const btnInactive =
    'text-ds-muted hover:bg-ds-hover hover:text-ds-ink dark:hover:bg-white/10'
  const divider = 'my-1 h-px w-7 shrink-0 bg-ds-border-muted/80'

  return (
    <div className="relative pointer-events-auto">
      <div className="flex flex-col items-center gap-1 rounded-full border border-ds-border bg-white/82 px-1.5 py-2 shadow-[0_16px_42px_rgba(20,47,95,0.13)] backdrop-blur-2xl dark:bg-ds-card/84 dark:shadow-none">
        {tools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={`${iconBtnBase} ${activeTool === tool.id ? btnActive : btnInactive}`}
            onClick={() => setActiveTool(tool.id)}
            title={t(tool.labelKey)}
            aria-label={t(tool.labelKey)}
          >
            <tool.icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
          </button>
        ))}

        <button
          type="button"
          className={`${iconBtnBase} ${btnInactive}`}
          onClick={importImage}
          disabled={imageImportBusy}
          title={t('canvasToolUploadImage')}
          aria-label={t('canvasToolUploadImage')}
        >
          <ImagePlus className="h-[18px] w-[18px]" strokeWidth={1.9} />
        </button>

        <div className={divider} />

        <button
          type="button"
          className={`${iconBtnBase} ${contextOpen ? btnActive : btnInactive}`}
          onClick={() => setContextOpen((open) => !open)}
          title={t('designContextLabel')}
          aria-label={t('designContextLabel')}
        >
          <Palette className="h-[18px] w-[18px]" strokeWidth={1.9} />
        </button>

        <button
          type="button"
          className={`${iconBtnBase} ${btnInactive}`}
          onClick={() => setCanvasAssistantOpen(true)}
          title={t('canvasToolAssistant')}
          aria-label={t('canvasToolAssistant')}
        >
          <Sparkles className="h-[18px] w-[18px]" strokeWidth={1.9} />
        </button>
      </div>
      {contextOpen ? (
        <div className="absolute right-14 top-1/2 -translate-y-1/2">
          <DesignContextPopover
            open={contextOpen}
            onClose={() => setContextOpen(false)}
            onOpenSettings={onOpenAgentSettings}
            titleKey="designContextLabel"
          />
        </div>
      ) : null}
    </div>
  )
}

export const CanvasToolbar = memo(CanvasToolbarInner)
