import { create } from 'zustand'
import type { OrchestrationEventPayload } from '../agent/types'

export type TaskNodeStatus = 'pending' | 'running' | 'completed' | 'failed'

export type OrchestrationTaskNode = {
  id: string
  title: string
  status: TaskNodeStatus
  profile?: string
  result?: string
  error?: string
}

export type GraphControlStatus = 'running' | 'completed' | 'failed' | 'paused'

export type OrchestrationGraph = {
  id: string
  status: GraphControlStatus
  tasks: Map<string, OrchestrationTaskNode>
  startedAt: number
  finishedAt?: number
}

type OrchestrationStoreState = {
  graphs: Map<string, OrchestrationGraph>
  activeGraphId: string | null
  lastEvent: OrchestrationEventPayload | null
  eventSeq: number
  applyEvent: (event: OrchestrationEventPayload) => void
  clearGraph: (graphId: string) => void
  clearAll: () => void
}

function applyEventToGraphs(
  graphs: Map<string, OrchestrationGraph>,
  event: OrchestrationEventPayload
): Map<string, OrchestrationGraph> {
  const next = new Map(graphs)
  const now = Date.now()

  switch (event.status) {
    case 'graph_started': {
      next.set(event.graphId, {
        id: event.graphId,
        status: 'running',
        tasks: new Map(),
        startedAt: now
      })
      return next
    }
    case 'graph_completed':
    case 'graph_failed': {
      const graph = next.get(event.graphId)
      if (graph) {
        next.set(event.graphId, {
          ...graph,
          status: event.status === 'graph_completed' ? 'completed' : 'failed',
          finishedAt: now
        })
      }
      return next
    }
    case 'graph_paused': {
      const graph = next.get(event.graphId)
      if (graph && graph.status === 'running') {
        next.set(event.graphId, { ...graph, status: 'paused' })
      }
      return next
    }
    case 'graph_resumed': {
      const graph = next.get(event.graphId)
      if (graph && graph.status === 'paused') {
        next.set(event.graphId, { ...graph, status: 'running' })
      }
      return next
    }
    case 'graph_aborted': {
      const graph = next.get(event.graphId)
      if (graph) {
        next.set(event.graphId, {
          ...graph,
          status: 'failed',
          finishedAt: now
        })
      }
      return next
    }
    case 'task_started': {
      const graph = next.get(event.graphId)
      if (!graph) return next
      const tasks = new Map(graph.tasks)
      tasks.set(event.taskId ?? '', {
        id: event.taskId ?? '',
        title: event.taskTitle ?? event.taskId ?? '',
        status: 'running',
        ...(event.profile ? { profile: event.profile } : {})
      })
      next.set(event.graphId, { ...graph, tasks })
      return next
    }
    case 'task_completed': {
      const graph = next.get(event.graphId)
      if (!graph) return next
      const tasks = new Map(graph.tasks)
      const existing = tasks.get(event.taskId ?? '')
      tasks.set(event.taskId ?? '', {
        ...(existing ?? { id: event.taskId ?? '', title: event.taskTitle ?? event.taskId ?? '' }),
        status: 'completed',
        ...(event.result ? { result: event.result } : {})
      })
      next.set(event.graphId, { ...graph, tasks })
      return next
    }
    case 'task_failed': {
      const graph = next.get(event.graphId)
      if (!graph) return next
      const tasks = new Map(graph.tasks)
      const existing = tasks.get(event.taskId ?? '')
      tasks.set(event.taskId ?? '', {
        ...(existing ?? { id: event.taskId ?? '', title: event.taskTitle ?? event.taskId ?? '' }),
        status: 'failed',
        ...(event.error ? { error: event.error } : {})
      })
      next.set(event.graphId, { ...graph, tasks })
      return next
    }
    default:
      return next
  }
}

export const useOrchestrationStore = create<OrchestrationStoreState>((set) => ({
  graphs: new Map(),
  activeGraphId: null,
  lastEvent: null,
  eventSeq: 0,
  applyEvent: (event) =>
    set((state) => {
      const graphs = applyEventToGraphs(state.graphs, event)
      const graphStatus = graphs.get(event.graphId)?.status
      const activeGraphId =
        graphStatus === 'running' ? event.graphId : state.activeGraphId
      return {
        graphs,
        activeGraphId,
        lastEvent: event,
        eventSeq: state.eventSeq + 1
      }
    }),
  clearGraph: (graphId) =>
    set((state) => {
      const graphs = new Map(state.graphs)
      graphs.delete(graphId)
      return {
        graphs,
        activeGraphId: state.activeGraphId === graphId ? null : state.activeGraphId
      }
    }),
  clearAll: () => set({ graphs: new Map(), activeGraphId: null })
}))
