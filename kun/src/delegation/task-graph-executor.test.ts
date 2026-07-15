import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TaskGraph } from '../tasks/task-graph.js'
import { TaskGraphExecutor } from './task-graph-executor.js'
import { OrchestrationRegistry } from './orchestration-registry.js'
import type { DelegationRuntime, ChildRunRecord } from './delegation-runtime.js'

function makeRuntime(overrides: Partial<DelegationRuntime> = {}): DelegationRuntime {
  return {
    enabled: () => true,
    listProfiles: () => [],
    runChild: vi.fn().mockResolvedValue({
      id: 'child_1',
      status: 'completed',
      summary: 'done',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    } as ChildRunRecord),
    ...overrides
  } as unknown as DelegationRuntime
}

function makeGraph(tasks: Array<{ id: string; prompt: string; profile?: string; dependsOn?: string[] }>): TaskGraph {
  const graph = new TaskGraph({ concurrency: 2 })
  for (const t of tasks) {
    graph.add({
      id: t.id,
      title: t.id,
      prompt: t.prompt,
      ...(t.profile ? { profile: t.profile } : {}),
      ...(t.dependsOn ? { dependsOn: t.dependsOn } : {})
    })
  }
  return graph
}

describe('TaskGraphExecutor', () => {
  it('executes a single task', async () => {
    const runtime = makeRuntime()
    const executor = new TaskGraphExecutor({
      runtime,
      signal: new AbortController().signal
    })

    const graph = makeGraph([{ id: 't1', prompt: 'do something' }])
    const result = await executor.execute(graph, 'thread_1', 'turn_1')

    expect(result.status).toBe('completed')
    expect(result.results.get('t1')).toBe('done')
    expect(runtime.runChild).toHaveBeenCalledOnce()
  })

  it('executes tasks in dependency order', async () => {
    const callOrder: string[] = []
    const runtime = makeRuntime({
      runChild: vi.fn().mockImplementation(async (input: any) => {
        callOrder.push(input.label)
        return {
          id: `child_${input.label}`,
          status: 'completed',
          summary: `result from ${input.label}`,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
        } as ChildRunRecord
      })
    })

    const graph = makeGraph([
      { id: 't1', prompt: 'first' },
      { id: 't2', prompt: 'second', dependsOn: ['t1'] },
      { id: 't3', prompt: 'third', dependsOn: ['t2'] }
    ])

    const executor = new TaskGraphExecutor({ runtime, signal: new AbortController().signal })
    const result = await executor.execute(graph, 'thread_1', 'turn_1')

    expect(result.status).toBe('completed')
    expect(callOrder).toEqual(['t1', 't2', 't3'])
  })

  it('injects dependency results into dependent prompts', async () => {
    let capturedPrompt = ''
    const runtime = makeRuntime({
      runChild: vi.fn().mockImplementation(async (input: any) => {
        if (input.label === 't2') capturedPrompt = input.prompt
        return {
          id: `child_${input.label}`,
          status: 'completed',
          summary: 'done',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
        } as ChildRunRecord
      })
    })

    const graph = makeGraph([
      { id: 't1', prompt: 'find files' },
      { id: 't2', prompt: 'edit files', dependsOn: ['t1'] }
    ])

    const executor = new TaskGraphExecutor({ runtime, signal: new AbortController().signal })
    await executor.execute(graph, 'thread_1', 'turn_1')

    expect(capturedPrompt).toContain('edit files')
    expect(capturedPrompt).toContain('Result from "t1"')
  })

  it('handles child failure by blocking dependents', async () => {
    const runtime = makeRuntime({
      runChild: vi.fn().mockImplementation(async (input: any) => {
        if (input.label === 't1') {
          return {
            id: 'child_t1',
            status: 'failed',
            error: 'crashed',
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
          } as ChildRunRecord
        }
        return {
          id: `child_${input.label}`,
          status: 'completed',
          summary: 'done',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
        } as ChildRunRecord
      })
    })

    const graph = makeGraph([
      { id: 't1', prompt: 'will fail' },
      { id: 't2', prompt: 'depends on failure', dependsOn: ['t1'] }
    ])

    const executor = new TaskGraphExecutor({ runtime, signal: new AbortController().signal })
    const result = await executor.execute(graph, 'thread_1', 'turn_1')

    expect(result.status).toBe('failed')
    expect(result.errors.get('t1')).toBe('crashed')
    expect(graph.get('t2')?.state).toBe('blocked')
  })

  it('respects concurrency limits', async () => {
    let running = 0
    let maxRunning = 0
    const runtime = makeRuntime({
      runChild: vi.fn().mockImplementation(async () => {
        running++
        maxRunning = Math.max(maxRunning, running)
        await new Promise((r) => setTimeout(r, 50))
        running--
        return {
          id: `child_${Date.now()}`,
          status: 'completed',
          summary: 'done',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
        } as ChildRunRecord
      })
    })

    const graph = new TaskGraph({ concurrency: 2 })
    graph.add({ id: 't1', prompt: 'a', title: 't1' })
    graph.add({ id: 't2', prompt: 'b', title: 't2' })
    graph.add({ id: 't3', prompt: 'c', title: 't3' })

    const executor = new TaskGraphExecutor({ runtime, signal: new AbortController().signal })
    await executor.execute(graph, 'thread_1', 'turn_1')

    expect(maxRunning).toBeLessThanOrEqual(2)
  })

  it('aborts when signal fires', async () => {
    const abort = new AbortController()
    const runtime = makeRuntime({
      runChild: vi.fn().mockImplementation(async (input: any) => {
        const signal = input.signal
        await new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'))
          }, { once: true })
        })
        return {} as ChildRunRecord
      })
    })

    const graph = makeGraph([{ id: 't1', prompt: 'slow task' }])

    setTimeout(() => abort.abort(), 50)
    const executor = new TaskGraphExecutor({ runtime, signal: abort.signal })
    const result = await executor.execute(graph, 'thread_1', 'turn_1')

    expect(result.status).toBe('aborted')
  })

  it('registers graph in orchestration registry', async () => {
    const registry = new OrchestrationRegistry()
    const runtime = makeRuntime()
    const executor = new TaskGraphExecutor({
      runtime,
      registry,
      signal: new AbortController().signal
    })

    const graph = makeGraph([{ id: 't1', prompt: 'task' }])
    const result = await executor.execute(graph, 'thread_1', 'turn_1')

    expect(result.status).toBe('completed')
    expect(registry.list()).toHaveLength(0)
  })

  it('unregisters graph from registry after completion', async () => {
    const registry = new OrchestrationRegistry()
    const runtime = makeRuntime()
    const executor = new TaskGraphExecutor({
      runtime,
      registry,
      signal: new AbortController().signal
    })

    const graph = makeGraph([{ id: 't1', prompt: 'task' }])
    await executor.execute(graph, 'thread_1', 'turn_1')

    expect(registry.list()).toHaveLength(0)
  })

  it('unregisters graph from registry on abort', async () => {
    const registry = new OrchestrationRegistry()
    const abort = new AbortController()
    const runtime = makeRuntime({
      runChild: vi.fn().mockImplementation(async (input: any) => {
        const signal = input.signal
        await new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'))
          }, { once: true })
        })
        return {} as ChildRunRecord
      })
    })

    const graph = makeGraph([{ id: 't1', prompt: 'slow task' }])
    const executor = new TaskGraphExecutor({
      runtime,
      registry,
      signal: abort.signal
    })

    setTimeout(() => abort.abort(), 50)
    await executor.execute(graph, 'thread_1', 'turn_1')

    expect(registry.list()).toHaveLength(0)
  })

  it('pauses and resumes via registry', async () => {
    const registry = new OrchestrationRegistry()
    const runtime = makeRuntime()
    const executor = new TaskGraphExecutor({
      runtime,
      registry,
      signal: new AbortController().signal
    })

    const graph = makeGraph([
      { id: 't1', prompt: 'task 1' },
      { id: 't2', prompt: 'task 2' }
    ])

    const executePromise = executor.execute(graph, 'thread_1', 'turn_1')

    await vi.waitFor(() => {
      expect(registry.list().length).toBe(1)
    })

    const entry = registry.list()[0]
    expect(registry.pause(entry.graphId)).toBe(true)
    expect(registry.get(entry.graphId)?.paused).toBe(true)

    expect(registry.resume(entry.graphId)).toBe(true)
    expect(registry.get(entry.graphId)?.paused).toBe(false)

    const result = await executePromise
    expect(result.status).toBe('completed')
  })
})
