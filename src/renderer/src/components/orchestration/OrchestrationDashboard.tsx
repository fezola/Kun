import { useCallback, useMemo, useState, type ReactElement } from 'react'
import { useOrchestrationStore, type OrchestrationGraph, type OrchestrationTaskNode } from '../../stores/orchestration-store'
import { useChatStore } from '../../store/chat-store'
import { TaskGraphCanvas } from './TaskGraphCanvas'

type Props = { className?: string }

function graphStatusBadge(status: OrchestrationGraph['status']): { label: string; className: string } {
  switch (status) {
    case 'running':
      return { label: 'Running', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' }
    case 'completed':
      return { label: 'Completed', className: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' }
    case 'failed':
      return { label: 'Failed', className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' }
    case 'paused':
      return { label: 'Paused', className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300' }
  }
}

function taskStatusIcon(status: OrchestrationTaskNode['status']): string {
  switch (status) {
    case 'pending': return '\u25CB'
    case 'running': return '\u25D4'
    case 'completed': return '\u2713'
    case 'failed': return '\u2717'
  }
}

async function sendOrchestrationCommand(graphId: string, action: 'abort' | 'pause' | 'resume'): Promise<void> {
  try {
    const method = 'POST'
    const path = `/v1/orchestration/graphs/${encodeURIComponent(graphId)}/${action}`
    await window.kunGui.orchestrationCommand(path, method)
  } catch {
    // Control commands are best-effort — the graph may have already finished
  }
}

function GraphCard({ graph }: { graph: OrchestrationGraph }): ReactElement {
  const badge = graphStatusBadge(graph.status)
  const tasks = useMemo(() => Array.from(graph.tasks.values()), [graph.tasks])
  const completedCount = tasks.filter((t) => t.status === 'completed').length
  const failedCount = tasks.filter((t) => t.status === 'failed').length
  const durationMs = graph.finishedAt ? graph.finishedAt - graph.startedAt : Date.now() - graph.startedAt
  const isRunning = graph.status === 'running' || graph.status === 'paused'

  const handleAbort = useCallback(() => sendOrchestrationCommand(graph.id, 'abort'), [graph.id])
  const handlePause = useCallback(() => sendOrchestrationCommand(graph.id, 'pause'), [graph.id])
  const handleResume = useCallback(() => sendOrchestrationCommand(graph.id, 'resume'), [graph.id])

  return (
    <div className="rounded-lg border border-ds-border bg-ds-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[11px] text-ds-muted">{graph.id}</span>
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.className}`}>
          {badge.label}
        </span>
      </div>
      <div className="mb-2 flex gap-3 text-[11px] text-ds-muted">
        <span>{tasks.length} tasks</span>
        <span>{completedCount} done</span>
        {failedCount > 0 && <span className="text-red-600">{failedCount} failed</span>}
        <span>{(durationMs / 1000).toFixed(1)}s</span>
      </div>
      {tasks.length > 0 && (
        <div className="max-h-48 overflow-y-auto">
          {tasks.map((task) => (
            <div key={task.id} className="flex items-center gap-2 py-0.5 font-mono text-[11px]">
              <span>{taskStatusIcon(task.status)}</span>
              <span className="truncate text-ds-secondary">{task.title || task.id}</span>
              {task.profile && (
                <span className="shrink-0 rounded bg-ds-muted px-1 py-0.5 text-[9px] text-ds-muted">
                  {task.profile}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {isRunning && (
        <div className="mt-2 flex gap-2 border-t border-ds-border pt-2">
          {graph.status === 'running' && (
            <button
              type="button"
              onClick={handlePause}
              className="rounded bg-ds-muted px-2 py-0.5 text-[10px] font-medium text-ds-secondary hover:bg-ds-muted/80"
            >
              Pause
            </button>
          )}
          {graph.status === 'paused' && (
            <button
              type="button"
              onClick={handleResume}
              className="rounded bg-blue-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-blue-700"
            >
              Resume
            </button>
          )}
          <button
            type="button"
            onClick={handleAbort}
            className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-red-700"
          >
            Abort
          </button>
        </div>
      )}
    </div>
  )
}

export function OrchestrationDashboard({ className }: Props): ReactElement {
  const graphs = useOrchestrationStore((s) => s.graphs)
  const activeGraphId = useOrchestrationStore((s) => s.activeGraphId)
  const graphList = useMemo(() => Array.from(graphs.values()).reverse(), [graphs])
  const activeGraph = activeGraphId ? graphs.get(activeGraphId) : null
  const sendMessage = useChatStore((s) => s.sendMessage)
  const [sending, setSending] = useState(false)

  const handleDemo = useCallback(async () => {
    if (sending) return
    setSending(true)
    try {
      await sendMessage(
        'Orchestrate the following tasks:\n' +
        '1. Research the project structure and list the main files\n' +
        '2. Analyze the code quality and suggest improvements\n' +
        '3. Write a summary report based on the findings from tasks 1 and 2'
      )
    } finally {
      setSending(false)
    }
  }, [sendMessage, sending])

  if (graphList.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center gap-4 px-6 py-12 text-center ${className ?? ''}`}>
        <div className="text-[13px] font-medium text-ds-ink">Orchestration Dashboard</div>
        <div className="max-w-[260px] text-[11px] leading-relaxed text-ds-muted">
          Run multiple AI agents in parallel on different tasks. Agents can
          collaborate, share results, and work on dependent steps.
        </div>
        <button
          type="button"
          disabled={sending}
          onClick={() => void handleDemo()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-[12px] font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? 'Starting...' : 'Try Demo Orchestration'}
        </button>
        <div className="max-w-[260px] text-[10px] leading-relaxed text-ds-faint">
          Or ask in chat: "Research, analyze, and summarize the project using multiple agents"
        </div>
      </div>
    )
  }

  return (
    <div className={`flex flex-col gap-3 overflow-y-auto p-3 ${className ?? ''}`}>
      {activeGraph && (
        <div className="flex flex-col gap-2">
          <div className="text-[11px] font-medium uppercase tracking-wider text-ds-muted">Active Graph</div>
          <TaskGraphCanvas graph={activeGraph} />
        </div>
      )}
      <div className="flex flex-col gap-2">
        <div className="text-[11px] font-medium uppercase tracking-wider text-ds-muted">All Graphs</div>
        {graphList.map((graph) => (
          <GraphCard key={graph.id} graph={graph} />
        ))}
      </div>
    </div>
  )
}
