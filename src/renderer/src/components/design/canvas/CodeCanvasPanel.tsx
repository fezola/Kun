import { useTranslation } from 'react-i18next'
import { CanvasViewport } from './CanvasViewport'
import { PropertiesPanel } from './PropertiesPanel'
import { useApplyShapeOpsLive } from '../../../design/canvas/use-apply-shape-ops-live'

/** Workspace subdir for code-mode canvases. Kept out of `.kun-design` so design
 *  mode's artifact lister (which enumerates `.kun-design/*`) never sees them. */
export const CODE_CANVAS_DIR = '.kun-canvas'

type Props = {
  workspaceRoot: string
  activeThreadId: string | null
  className?: string
}

/**
 * Hosts the reusable {@link CanvasViewport} as a code-workspace right panel.
 * The canvas is per-thread (`code-<threadId>`), persisted under
 * {@link CODE_CANVAS_DIR}. The main chat agent drives it via ShapeOps (Block C).
 */
export function CodeCanvasPanel({ workspaceRoot, activeThreadId, className }: Props) {
  const { t } = useTranslation('common')
  const ready = Boolean(workspaceRoot && activeThreadId)
  const artifactId = activeThreadId ? `code-${activeThreadId}` : ''
  useApplyShapeOpsLive(ready)

  return (
    <div className={`relative flex min-h-0 flex-col bg-ds-sidebar ${className ?? ''}`}>
      {ready ? (
        <>
          <CanvasViewport workspaceRoot={workspaceRoot} artifactId={artifactId} baseDir={CODE_CANVAS_DIR} />
          <PropertiesPanel />
        </>
      ) : (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ds-faint">
          {t('canvasPanelNeedsThread')}
        </div>
      )}
    </div>
  )
}
