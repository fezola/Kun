import type { ReactElement } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange
} from '@xyflow/react'
import { ArrowLeft, Play, Plus, Save, Square } from 'lucide-react'
import type {
  AppSettingsV1,
  WorkflowNodeKind,
  WorkflowNodeRunStatus,
  WorkflowNodeV1,
  WorkflowV1
} from '@shared/app-settings'
import { NODE_ICONS, WorkflowRunStatusContext, workflowNodeTypes } from './WorkflowNodes'
import { NodeConfigPanel } from './NodeConfigPanel'
import {
  WORKFLOW_PALETTE,
  createWorkflowNode,
  flowToWorkflowGraph,
  toFlowEdges,
  toFlowNodes,
  type WorkflowFlowEdge,
  type WorkflowFlowNode
} from './workflow-types'

type Props = {
  workflow: WorkflowV1
  settings: AppSettingsV1
  runStatus: Record<string, WorkflowNodeRunStatus>
  running: boolean
  onPersist: (patch: {
    name: string
    enabled: boolean
    nodes: WorkflowNodeV1[]
    connections: WorkflowConnectionsArg
  }) => Promise<void>
  onRun: () => Promise<void> | void
  onStop: () => Promise<void> | void
  onBack: () => void
}

type WorkflowConnectionsArg = ReturnType<typeof flowToWorkflowGraph>['connections']

function WorkflowEditorInner({
  workflow,
  settings,
  runStatus,
  running,
  onPersist,
  onRun,
  onStop,
  onBack
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [name, setName] = useState(workflow.name)
  const [enabled, setEnabled] = useState(workflow.enabled)
  const [rfNodes, setRfNodes] = useState<WorkflowFlowNode[]>(() => toFlowNodes(workflow.nodes))
  const [rfEdges, setRfEdges] = useState<WorkflowFlowEdge[]>(() => toFlowEdges(workflow.connections))
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const styledEdges = useMemo(() => {
    const decorated = toFlowEdges(flowToWorkflowGraph(rfNodes, rfEdges).connections, runStatus)
    return decorated
  }, [rfEdges, rfNodes, runStatus])

  const selectedNode = useMemo(
    () => (selectedNodeId ? rfNodes.find((node) => node.id === selectedNodeId)?.data.node ?? null : null),
    [rfNodes, selectedNodeId]
  )

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setRfNodes((nodes) => applyNodeChanges(changes, nodes) as WorkflowFlowNode[])
    if (changes.some((change) => change.type !== 'select' && change.type !== 'dimensions')) {
      setDirty(true)
    }
  }, [])

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setRfEdges((edges) => applyEdgeChanges(changes, edges) as WorkflowFlowEdge[])
    if (changes.some((change) => change.type !== 'select')) setDirty(true)
  }, [])

  const onConnect = useCallback((connection: Connection) => {
    setRfEdges((edges) => addEdge(connection, edges) as WorkflowFlowEdge[])
    setDirty(true)
  }, [])

  const addNode = useCallback((kind: WorkflowNodeKind) => {
    setRfNodes((nodes) => {
      const offset = nodes.length * 24
      const node = createWorkflowNode(kind, { x: 320 + (offset % 160), y: 120 + offset })
      return [...nodes, { id: node.id, type: node.type, position: node.position, data: { node } }]
    })
    setDirty(true)
  }, [])

  const handleNodeChange = useCallback((updated: WorkflowNodeV1) => {
    setRfNodes((nodes) =>
      nodes.map((node) => (node.id === updated.id ? { ...node, type: updated.type, data: { node: updated } } : node))
    )
    setDirty(true)
  }, [])

  const handleDeleteNode = useCallback((nodeId: string) => {
    setRfNodes((nodes) => nodes.filter((node) => node.id !== nodeId))
    setRfEdges((edges) => edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId))
    setSelectedNodeId((current) => (current === nodeId ? null : current))
    setDirty(true)
  }, [])

  const buildGraph = useCallback(() => {
    const graph = flowToWorkflowGraph(rfNodes, rfEdges)
    return { name: name.trim() || t('workflowUntitled'), enabled, nodes: graph.nodes, connections: graph.connections }
  }, [enabled, name, rfEdges, rfNodes, t])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await onPersist(buildGraph())
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }, [buildGraph, onPersist])

  const handleRun = useCallback(async () => {
    await onPersist(buildGraph())
    setDirty(false)
    await onRun()
  }, [buildGraph, onPersist, onRun])

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-ds-main">
      <header className="ds-drag ds-window-controls-safe-inset flex shrink-0 items-center gap-3 border-b border-ds-border py-2.5 pr-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 text-[13px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.8} />
          {t('workflowBack')}
        </button>
        <input
          className="min-w-0 flex-1 rounded-xl border border-transparent bg-transparent px-2 py-1.5 text-[15px] font-medium text-ds-ink outline-none focus:border-ds-border focus:bg-ds-card"
          value={name}
          placeholder={t('workflowNamePlaceholder')}
          onChange={(event) => {
            setName(event.target.value)
            setDirty(true)
          }}
        />
        <label className="flex shrink-0 items-center gap-2 text-[13px] font-medium text-ds-muted">
          {t('workflowEnabled')}
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => {
              setEnabled(event.target.checked)
              setDirty(true)
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 text-[13px] font-medium text-ds-ink transition hover:bg-ds-hover disabled:opacity-60"
        >
          <Save className="h-4 w-4" strokeWidth={1.8} />
          {dirty ? t('workflowSave') : t('workflowSaved')}
        </button>
        {running ? (
          <button
            type="button"
            onClick={() => void onStop()}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-red-500/90 px-4 text-[13px] font-semibold text-white shadow-sm transition hover:bg-red-500"
          >
            <Square className="h-3.5 w-3.5" strokeWidth={2} />
            {t('workflowStop')}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleRun()}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-ds-userbubble px-4 text-[13px] font-semibold text-ds-userbubbleFg shadow-sm transition hover:opacity-90"
          >
            <Play className="h-4 w-4" strokeWidth={2} />
            {t('workflowRunNow')}
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[180px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-ds-border bg-ds-card/40 px-2 py-3">
          <span className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ds-faint">
            {t('workflowPalette')}
          </span>
          {WORKFLOW_PALETTE.map((kind) => {
            const Icon = NODE_ICONS[kind]
            return (
              <button
                key={kind}
                type="button"
                onClick={() => addNode(kind)}
                className="flex items-center gap-2 rounded-lg border border-transparent px-2 py-2 text-left text-[12.5px] text-ds-ink transition hover:border-ds-border hover:bg-ds-hover"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
                </span>
                <span className="min-w-0 flex-1 truncate">{t(`workflowNode_${kind}`)}</span>
                <Plus className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
              </button>
            )
          })}
        </aside>

        <div className="relative min-w-0 flex-1">
          <WorkflowRunStatusContext.Provider value={runStatus}>
            <ReactFlow
              className="ds-workflow-canvas"
              nodes={rfNodes}
              edges={styledEdges}
              nodeTypes={workflowNodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, node) => setSelectedNodeId(node.id)}
              onPaneClick={() => setSelectedNodeId(null)}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable />
            </ReactFlow>
          </WorkflowRunStatusContext.Provider>
        </div>

        <aside className="flex w-[320px] shrink-0 flex-col overflow-hidden border-l border-ds-border bg-ds-card/40">
          <NodeConfigPanel
            node={selectedNode}
            settings={settings}
            onChange={handleNodeChange}
            onDelete={handleDeleteNode}
          />
        </aside>
      </div>
    </div>
  )
}

export function WorkflowEditorView(props: Props): ReactElement {
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner {...props} />
    </ReactFlowProvider>
  )
}

export type WorkflowEditorProps = Props
