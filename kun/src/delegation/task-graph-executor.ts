import type { DelegationRuntime, ChildRunRecord } from '../delegation/delegation-runtime.js'
import type { AgentMessageBus } from '../delegation/agent-message-bus.js'
import { TaskGraph, type TaskNode } from '../tasks/task-graph.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { OrchestrationRegistry } from './orchestration-registry.js'

export type GraphExecutionResult = {
  graphId: string
  status: 'completed' | 'failed' | 'aborted'
  results: Map<string, string>
  errors: Map<string, string>
  totalDurationMs: number
}

export type TaskGraphExecutorOptions = {
  runtime: DelegationRuntime
  messageBus?: AgentMessageBus
  events?: RuntimeEventRecorder
  registry?: OrchestrationRegistry
  maxConcurrency?: number
  signal: AbortSignal
  nowIso?: () => string
}

export class TaskGraphExecutor {
  private readonly runtime: DelegationRuntime
  private readonly messageBus?: AgentMessageBus
  private readonly events?: RuntimeEventRecorder
  private readonly registry?: OrchestrationRegistry
  private readonly maxConcurrency: number
  private readonly signal: AbortSignal
  private readonly nowIso: () => string
  private activeChildren = new Map<string, { childId: string; abort: AbortController }>()
  private activeGraphId: string | null = null

  constructor(options: TaskGraphExecutorOptions) {
    this.runtime = options.runtime
    this.messageBus = options.messageBus
    this.events = options.events
    this.registry = options.registry
    this.maxConcurrency = options.maxConcurrency ?? 3
    this.signal = options.signal
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
  }

  async execute(
    graph: TaskGraph,
    parentThreadId: string,
    parentTurnId: string
  ): Promise<GraphExecutionResult> {
    const graphId = `graph_${Date.now().toString(36)}`
    const startTime = Date.now()
    const results = new Map<string, string>()
    const errors = new Map<string, string>()

    if (graph.list().length === 0) {
      return { graphId, status: 'completed', results, errors, totalDurationMs: 0 }
    }

    this.activeGraphId = graphId

    this.emitOrchestration(parentThreadId, parentTurnId, {
      graphId,
      status: 'graph_started'
    })

    if (this.registry) {
      this.registry.register({
        graphId,
        threadId: parentThreadId,
        turnId: parentTurnId,
        abort: new AbortController(),
        paused: false,
        startedAt: startTime,
        maxConcurrency: this.maxConcurrency
      })
    }

    while (!graph.isComplete()) {
      if (this.signal.aborted) {
        this.cancelAll()
        this.emitOrchestration(parentThreadId, parentTurnId, {
          graphId,
          status: 'graph_aborted'
        })
        this.registry?.unregister(graphId)
        return {
          graphId,
          status: 'aborted',
          results,
          errors,
          totalDurationMs: Date.now() - startTime
        }
      }

      const entry = this.registry?.get(graphId)
      if (entry?.paused) {
        this.emitOrchestration(parentThreadId, parentTurnId, {
          graphId,
          status: 'graph_paused'
        })
        while (entry.paused && !this.signal.aborted) {
          await sleep(200)
        }
        if (this.signal.aborted) {
          this.cancelAll()
          this.emitOrchestration(parentThreadId, parentTurnId, {
            graphId,
            status: 'graph_aborted'
          })
          this.registry?.unregister(graphId)
          return {
            graphId,
            status: 'aborted',
            results,
            errors,
            totalDurationMs: Date.now() - startTime
          }
        }
        this.emitOrchestration(parentThreadId, parentTurnId, {
          graphId,
          status: 'graph_resumed'
        })
      }

      const runnable = graph.nextRunnable()
      if (runnable.length === 0) {
        await sleep(200)
        continue
      }

      const promises = runnable.map((node) =>
        this.executeNode(graph, node, parentThreadId, parentTurnId, results, errors)
      )
      await Promise.allSettled(promises)
    }

    const hasFailures = [...errors.values()].some((v) => v !== 'aborted')
    const hasBlocked = graph.list().some((n) => n.state === 'blocked')
    const hasAborted = [...errors.values()].some((v) => v === 'aborted')
    const finalStatus = hasAborted ? 'aborted' : hasFailures || hasBlocked ? 'failed' : 'completed'

    this.emitOrchestration(parentThreadId, parentTurnId, {
      graphId,
      status: finalStatus === 'completed' ? 'graph_completed' : 'graph_failed'
    })

    this.registry?.unregister(graphId)

    return {
      graphId,
      status: finalStatus,
      results,
      errors,
      totalDurationMs: Date.now() - startTime
    }
  }

  private async executeNode(
    graph: TaskGraph,
    node: TaskNode,
    parentThreadId: string,
    parentTurnId: string,
    results: Map<string, string>,
    errors: Map<string, string>
  ): Promise<void> {
    if (!node.prompt) {
      graph.markRunning(node.id)
      graph.markSucceeded(node.id)
      node.result = '(no prompt — skipped)'
      results.set(node.id, node.result)
      return
    }

    const prompt = this.buildPrompt(node, results)
    const abort = new AbortController()
    this.activeChildren.set(node.id, { childId: '', abort })

    graph.markRunning(node.id)

    this.emitOrchestration(parentThreadId, parentTurnId, {
      graphId: '',
      taskId: node.id,
      taskTitle: node.title,
      status: 'task_started',
      ...(node.profile ? { profile: node.profile } : {})
    })

    try {
      const childSignal = AbortSignal.any([abort.signal, this.signal])
      const record = await this.runtime.runChild({
        parentThreadId,
        parentTurnId,
        label: node.title,
        prompt,
        ...(node.profile ? { profile: node.profile } : {}),
        ...(node.tokenBudget ? { tokenBudget: node.tokenBudget } : {}),
        signal: childSignal,
        onStart: (childId) => {
          const entry = this.activeChildren.get(node.id)
          if (entry) entry.childId = childId
          node.childId = childId
        }
      })

      if (record.status === 'completed') {
        graph.markSucceeded(node.id)
        const summary = record.summary ?? '(no summary)'
        node.result = summary
        results.set(node.id, summary)
        this.emitOrchestration(parentThreadId, parentTurnId, {
          graphId: '',
          taskId: node.id,
          taskTitle: node.title,
          status: 'task_completed',
          result: summary
        })
      } else if (record.status === 'aborted') {
        graph.markFailed(node.id, 'aborted')
        errors.set(node.id, 'aborted')
        this.emitOrchestration(parentThreadId, parentTurnId, {
          graphId: '',
          taskId: node.id,
          taskTitle: node.title,
          status: 'task_failed',
          error: 'aborted'
        })
      } else {
        const error = record.error ?? 'unknown failure'
        graph.markFailed(node.id, error)
        errors.set(node.id, error)
        this.emitOrchestration(parentThreadId, parentTurnId, {
          graphId: '',
          taskId: node.id,
          taskTitle: node.title,
          status: 'task_failed',
          error
        })
      }
    } catch (error) {
      const isAbort =
        (error instanceof DOMException && error.name === 'AbortError') ||
        this.signal.aborted
      if (isAbort) {
        graph.markFailed(node.id, 'aborted')
        errors.set(node.id, 'aborted')
      } else {
        const msg = error instanceof Error ? error.message : String(error)
        graph.markFailed(node.id, msg)
        errors.set(node.id, msg)
      }
      this.emitOrchestration(parentThreadId, parentTurnId, {
        graphId: '',
        taskId: node.id,
        taskTitle: node.title,
        status: 'task_failed',
        error: isAbort ? 'aborted' : (error instanceof Error ? error.message : String(error))
      })
    } finally {
      this.activeChildren.delete(node.id)
    }
  }

  private buildPrompt(node: TaskNode, results: Map<string, string>): string {
    const parts: string[] = [node.prompt ?? '']

    const depContext: string[] = []
    for (const depId of node.dependsOn) {
      const depResult = results.get(depId)
      if (depResult) {
        depContext.push(`## Result from "${depId}"\n${depResult}`)
      }
    }

    if (depContext.length > 0) {
      parts.push(
        '\n\n## Context from previous tasks\n' +
          'Your dependencies completed with these results. Use them as context:\n\n' +
          depContext.join('\n\n')
      )
    }

    return parts.join('')
  }

  private cancelAll(): void {
    for (const [, entry] of this.activeChildren) {
      entry.abort.abort()
    }
  }

  abortNode(nodeId: string): boolean {
    const entry = this.activeChildren.get(nodeId)
    if (!entry) return false
    entry.abort.abort()
    return true
  }

  abortAll(): void {
    this.cancelAll()
  }

  private emitOrchestration(
    threadId: string,
    turnId: string,
    data: {
      graphId: string
      taskId?: string
      taskTitle?: string
      status:
        | 'graph_started'
        | 'task_started'
        | 'task_completed'
        | 'task_failed'
        | 'graph_completed'
        | 'graph_failed'
        | 'graph_paused'
        | 'graph_resumed'
        | 'graph_aborted'
      profile?: string
      result?: string
      error?: string
    }
  ): void {
    if (!this.events) return
    void this.events.record({
      kind: 'orchestration_updated',
      threadId,
      turnId,
      graphId: data.graphId,
      ...(data.taskId ? { taskId: data.taskId } : {}),
      ...(data.taskTitle ? { taskTitle: data.taskTitle } : {}),
      status: data.status,
      ...(data.profile ? { profile: data.profile } : {}),
      ...(data.result ? { result: data.result } : {}),
      ...(data.error ? { error: data.error } : {})
    })
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
