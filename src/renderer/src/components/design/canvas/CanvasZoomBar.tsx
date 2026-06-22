import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Undo2, Redo2, ZoomIn, ZoomOut, Maximize, Focus, ScanSearch } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCanvasViewportStore } from '../../../design/canvas/canvas-viewport-store'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import { useCanvasUndoStore } from '../../../design/canvas/canvas-undo-store'
import { getSelectionBounds } from '../../../design/canvas/canvas-hit-test'

const isMac = navigator.platform.startsWith('Mac')
const MOD = isMac ? '⌘' : 'Ctrl+'

function CanvasZoomBarInner() {
  const { t } = useTranslation('common')
  const vbox = useCanvasViewportStore((s) => s.vbox)
  const containerWidth = useCanvasViewportStore((s) => s.containerWidth)
  const undoCount = useCanvasUndoStore((s) => s.undoStack.length)
  const redoCount = useCanvasUndoStore((s) => s.redoStack.length)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const zoom = containerWidth / vbox.width
  const zoomPercent = Math.round(zoom * 100)

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const zoomIn = useCallback(() => {
    const s = useCanvasViewportStore.getState()
    const cx = s.vbox.x + s.vbox.width / 2
    const cy = s.vbox.y + s.vbox.height / 2
    s.zoomTo(1.2, { x: cx, y: cy })
  }, [])

  const zoomOut = useCallback(() => {
    const s = useCanvasViewportStore.getState()
    const cx = s.vbox.x + s.vbox.width / 2
    const cy = s.vbox.y + s.vbox.height / 2
    s.zoomTo(1 / 1.2, { x: cx, y: cy })
  }, [])

  const zoomTo100 = useCallback(() => {
    useCanvasViewportStore.getState().resetView()
  }, [])

  const zoomToFit = useCallback(() => {
    const doc = useCanvasShapeStore.getState().document
    const root = doc.objects[doc.rootId]
    if (!root) return
    const bounds = getSelectionBounds(doc.objects, new Set(root.children))
    if (bounds) useCanvasViewportStore.getState().zoomToFit(bounds)
  }, [])

  const zoomToSelection = useCallback(() => {
    const doc = useCanvasShapeStore.getState().document
    const { selectedIds } = useCanvasSelectionStore.getState()
    if (selectedIds.size === 0) return
    const bounds = getSelectionBounds(doc.objects, selectedIds)
    if (bounds) useCanvasViewportStore.getState().zoomToFit(bounds, 60)
  }, [])

  const undo = useCallback(() => useCanvasShapeStore.getState().undo(), [])
  const redo = useCallback(() => useCanvasShapeStore.getState().redo(), [])

  const btnBase =
    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-35'
  const btnNormal = 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink dark:hover:bg-white/10'
  const pill =
    'rounded-full border border-ds-border bg-white/82 shadow-[0_12px_34px_rgba(20,47,95,0.10)] backdrop-blur-2xl dark:bg-ds-card/84 dark:shadow-none'

  const menuItems: { labelKey: string; shortcut: string; icon: typeof ZoomIn; action: () => void }[] = [
    { labelKey: 'canvasZoomIn', shortcut: `${MOD}+`, icon: ZoomIn, action: zoomIn },
    { labelKey: 'canvasZoomOut', shortcut: `${MOD}-`, icon: ZoomOut, action: zoomOut },
    { labelKey: 'canvasZoomTo100', shortcut: '⇧0', icon: Maximize, action: zoomTo100 },
    { labelKey: 'canvasZoomFit', shortcut: '⇧1', icon: Focus, action: zoomToFit },
    { labelKey: 'canvasZoomToSelection', shortcut: '⇧2', icon: ScanSearch, action: zoomToSelection }
  ]

  return (
    <div ref={menuRef} className="relative">
      {menuOpen && (
        <div
          className={`absolute bottom-full right-0 mb-2 w-52 overflow-hidden rounded-xl ${pill} py-1`}
        >
          {menuItems.map((item) => (
            <button
              key={item.labelKey}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-ds-ink transition-colors hover:bg-ds-hover dark:hover:bg-white/8"
              onClick={() => {
                item.action()
                setMenuOpen(false)
              }}
            >
              <item.icon className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.8} />
              <span className="flex-1 text-left">{t(item.labelKey)}</span>
              <kbd className="shrink-0 text-[11px] text-ds-faint">{item.shortcut}</kbd>
            </button>
          ))}
        </div>
      )}

      <div className={`flex items-center gap-1 px-1.5 py-1 ${pill}`}>
        <button
          type="button"
          className={`${btnBase} ${btnNormal}`}
          onClick={undo}
          disabled={undoCount === 0}
          title={`${t('canvasUndo')} (${MOD}Z)`}
          aria-label={t('canvasUndo')}
        >
          <Undo2 className="h-4 w-4" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className={`${btnBase} ${btnNormal}`}
          onClick={redo}
          disabled={redoCount === 0}
          title={`${t('canvasRedo')} (${MOD}⇧Z)`}
          aria-label={t('canvasRedo')}
        >
          <Redo2 className="h-4 w-4" strokeWidth={1.8} />
        </button>

        <button
          type="button"
          className="inline-flex h-8 min-w-[3rem] items-center justify-center rounded-lg px-2 text-[13px] font-semibold tabular-nums text-ds-muted transition-colors hover:bg-ds-hover hover:text-ds-ink dark:hover:bg-white/10"
          onClick={() => setMenuOpen((o) => !o)}
          title={t('canvasZoomIn')}
        >
          {zoomPercent}%
        </button>
      </div>
    </div>
  )
}

export const CanvasZoomBar = memo(CanvasZoomBarInner)
