/**
 * In-memory registry tracking active orchestration graph executors.
 *
 * The GUI communicates with running executors through HTTP routes that
 * look up entries by `graphId`. Each entry carries the abort controller,
 * pause signal, and metadata needed for runtime control.
 */
export type OrchestrationGraphEntry = {
  graphId: string
  threadId: string
  turnId: string
  abort: AbortController
  /** Shared flag checked by the executor's main loop. */
  paused: boolean
  pausedAt?: number
  startedAt: number
  maxConcurrency: number
}

export class OrchestrationRegistry {
  private readonly active = new Map<string, OrchestrationGraphEntry>()

  /** Called by the executor when a graph starts executing. */
  register(entry: OrchestrationGraphEntry): void {
    this.active.set(entry.graphId, entry)
  }

  /** Called when a graph finishes (completed/failed/aborted). */
  unregister(graphId: string): void {
    this.active.delete(graphId)
  }

  get(graphId: string): OrchestrationGraphEntry | undefined {
    return this.active.get(graphId)
  }

  list(): OrchestrationGraphEntry[] {
    return [...this.active.values()]
  }

  abort(graphId: string): boolean {
    const entry = this.active.get(graphId)
    if (!entry) return false
    entry.abort.abort()
    return true
  }

  pause(graphId: string): boolean {
    const entry = this.active.get(graphId)
    if (!entry || entry.paused) return false
    entry.paused = true
    entry.pausedAt = Date.now()
    return true
  }

  resume(graphId: string): boolean {
    const entry = this.active.get(graphId)
    if (!entry || !entry.paused) return false
    entry.paused = false
    entry.pausedAt = undefined
    return true
  }

  snapshot(): Array<{
    graphId: string
    threadId: string
    paused: boolean
    startedAt: number
    maxConcurrency: number
  }> {
    return this.list().map((e) => ({
      graphId: e.graphId,
      threadId: e.threadId,
      paused: e.paused,
      startedAt: e.startedAt,
      maxConcurrency: e.maxConcurrency
    }))
  }
}
