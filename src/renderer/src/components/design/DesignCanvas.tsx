import { useEffect, type ReactElement } from 'react'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import type { DesignArtifact } from '../../design/design-types'
import type { DesignHtmlElementContext } from '../../design/design-composer-context'
import type { DesignRuntimeQualityPayload } from '../../design/design-html-quality'
import { setScreenCreationFactory } from '../../design/canvas/screen-artifact-bridge'
import { ensureDesignBoardArtifact, findDesignBoardArtifact } from '../../design/design-board'
import { createLinkedHtmlScreen } from '../../design/canvas/screen-lifecycle'
import { CanvasViewport } from './canvas/CanvasViewport'
import { PropertiesPanel } from './canvas/PropertiesPanel'
import { useApplyShapeOpsLive } from '../../design/canvas/use-apply-shape-ops-live'

type CanvasProps = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  busy?: boolean
  onOpenAgentSettings?: () => void
  onImplementDesign?: (artifact: DesignArtifact) => void
  onScreenCreated?: (shapeId: string, userPrompt: string, brief?: string) => void
  onUseElementAsContext?: (context: DesignHtmlElementContext | null, promptSeed?: string) => void
  onRuntimeQualityFindings?: (payload: DesignRuntimeQualityPayload) => void
  onRequestQualityRepair?: (payload: DesignRuntimeQualityPayload) => void
}

/** Design-mode unified stage: one SVG/Figma-style board hosts HTML screen frames and vector layers. */
export function DesignCanvas({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  busy = false,
  onOpenAgentSettings,
  onImplementDesign,
  onScreenCreated,
  onUseElementAsContext,
  onRuntimeQualityFindings,
  onRequestQualityRepair
}: CanvasProps): ReactElement {
  const workspaceRoot = useDesignWorkspaceStore((s) => s.workspaceRoot)
  const settingsLoaded = useDesignWorkspaceStore((s) => s.settingsLoaded)
  const artifacts = useDesignWorkspaceStore((s) => s.artifacts)
  const activeDocumentId = useDesignWorkspaceStore((s) => s.activeDocumentId)
  const boardArtifact = findDesignBoardArtifact(artifacts)
  const baseDir = activeDocumentId ? `.kun-design/${activeDocumentId}` : undefined

  useEffect(() => {
    if (!workspaceRoot || !settingsLoaded) return
    void ensureDesignBoardArtifact(workspaceRoot)
  }, [workspaceRoot, settingsLoaded, artifacts.length])

  // Register the factory that design_canvas/add-screen calls to create the
  // linked HTML artifact and canvas frame in one lifecycle step.
  useEffect(() => {
    if (!boardArtifact) return
    setScreenCreationFactory((request) => {
      const created = createLinkedHtmlScreen({
        boardArtifactId: boardArtifact.id,
        name: request.name,
        brief: request.brief,
        x: request.x,
        y: request.y,
        width: request.width,
        height: request.height,
        devicePreset: request.devicePreset,
        preparePreview: request.preparePreview
      })
      return created ? { artifactId: created.artifactId, shapeId: created.shape.id } : null
    })
    return () => setScreenCreationFactory(null)
  }, [boardArtifact])

  useApplyShapeOpsLive(Boolean(boardArtifact), onScreenCreated)

  if (!boardArtifact) {
    return (
      <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-ds-main text-sm text-ds-faint">
        Loading design board...
      </div>
    )
  }

  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-ds-main">
      <CanvasViewport
        workspaceRoot={workspaceRoot}
        artifactId={boardArtifact.id}
        {...(baseDir ? { baseDir } : {})}
        leftSidebarCollapsed={leftSidebarCollapsed}
        onToggleLeftSidebar={onToggleLeftSidebar}
        busy={busy}
        onOpenAgentSettings={onOpenAgentSettings}
        syncHtmlScreens
        onImplementDesign={onImplementDesign}
        onUseElementAsContext={onUseElementAsContext}
        onRuntimeQualityFindings={onRuntimeQualityFindings}
        onRequestQualityRepair={onRequestQualityRepair}
      />
      <PropertiesPanel onImplementDesign={onImplementDesign} />
    </div>
  )
}
