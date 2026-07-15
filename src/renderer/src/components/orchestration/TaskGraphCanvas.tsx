import { useMemo, type ReactElement } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  type Node,
  type Edge
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { OrchestrationGraph, OrchestrationTaskNode } from '../../stores/orchestration-store'

type Props = {
  graph: OrchestrationGraph
  className?: string
}

function nodeColor(status: OrchestrationTaskNode['status']): string {
  switch (status) {
    case 'pending': return '#6b7280'
    case 'running': return '#3b82f6'
    case 'completed': return '#22c55e'
    case 'failed': return '#ef4444'
  }
}

function TaskNode({ data }: { data: Record<string, unknown> }): ReactElement {
  const title = (data.title as string) ?? ''
  const status = (data.status as string) ?? 'pending'
  const profile = data.profile as string | undefined
  const color = nodeColor(status as OrchestrationTaskNode['status'])

  return (
    <div
      className="rounded-md border bg-white px-3 py-2 shadow-sm dark:bg-ds-surface"
      style={{ borderColor: color, borderWidth: 2 }}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-400" />
      <div className="max-w-[160px] truncate text-[11px] font-medium text-ds-primary">{title}</div>
      <div className="mt-0.5 flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-[10px] capitalize text-ds-muted">{status}</span>
        {profile && (
          <span className="rounded bg-ds-muted px-1 py-0.5 text-[9px] text-ds-muted">{profile}</span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-gray-400" />
    </div>
  )
}

const nodeTypes = { taskNode: TaskNode }

function layoutGraph(
  tasks: Map<string, OrchestrationTaskNode>
): { nodes: Node[]; edges: Edge[] } {
  const taskList = Array.from(tasks.values())
  if (taskList.length === 0) return { nodes: [], edges: [] }

  const nodes: Node[] = taskList.map((task, index) => ({
    id: task.id,
    type: 'taskNode',
    position: { x: (index % 3) * 200, y: Math.floor(index / 3) * 100 },
    data: {
      title: task.title,
      status: task.status,
      profile: task.profile
    }
  }))

  const edges: Edge[] = []
  return { nodes, edges }
}

export function TaskGraphCanvas({ graph, className }: Props): ReactElement {
  const { nodes, edges } = useMemo(() => layoutGraph(graph.tasks), [graph.tasks])

  return (
    <div className={`rounded-lg border border-ds-border bg-ds-surface ${className ?? ''}`} style={{ height: 300 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
      </ReactFlow>
    </div>
  )
}
