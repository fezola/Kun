import { describe, it, expect, vi } from 'vitest'
import { OrchestrationRegistry } from './orchestration-registry.js'

describe('OrchestrationRegistry', () => {
  it('registers and retrieves a graph entry', () => {
    const registry = new OrchestrationRegistry()
    const abort = new AbortController()
    registry.register({
      graphId: 'g1',
      threadId: 't1',
      turnId: 'tr1',
      abort,
      paused: false,
      startedAt: Date.now(),
      maxConcurrency: 3
    })

    const entry = registry.get('g1')
    expect(entry).toBeDefined()
    expect(entry?.graphId).toBe('g1')
    expect(entry?.threadId).toBe('t1')
    expect(entry?.paused).toBe(false)
  })

  it('unregisters a graph entry', () => {
    const registry = new OrchestrationRegistry()
    registry.register({
      graphId: 'g1',
      threadId: 't1',
      turnId: 'tr1',
      abort: new AbortController(),
      paused: false,
      startedAt: Date.now(),
      maxConcurrency: 3
    })

    registry.unregister('g1')
    expect(registry.get('g1')).toBeUndefined()
  })

  it('lists all active entries', () => {
    const registry = new OrchestrationRegistry()
    registry.register({
      graphId: 'g1',
      threadId: 't1',
      turnId: 'tr1',
      abort: new AbortController(),
      paused: false,
      startedAt: Date.now(),
      maxConcurrency: 3
    })
    registry.register({
      graphId: 'g2',
      threadId: 't2',
      turnId: 'tr2',
      abort: new AbortController(),
      paused: true,
      startedAt: Date.now(),
      maxConcurrency: 1
    })

    const list = registry.list()
    expect(list).toHaveLength(2)
    expect(list.map((e) => e.graphId)).toEqual(['g1', 'g2'])
  })

  it('aborts a graph entry', () => {
    const registry = new OrchestrationRegistry()
    const abort = new AbortController()
    const spy = vi.spyOn(abort, 'abort')
    registry.register({
      graphId: 'g1',
      threadId: 't1',
      turnId: 'tr1',
      abort,
      paused: false,
      startedAt: Date.now(),
      maxConcurrency: 3
    })

    expect(registry.abort('g1')).toBe(true)
    expect(spy).toHaveBeenCalledOnce()
  })

  it('returns false when aborting a non-existent graph', () => {
    const registry = new OrchestrationRegistry()
    expect(registry.abort('nonexistent')).toBe(false)
  })

  it('pauses and resumes a graph', () => {
    const registry = new OrchestrationRegistry()
    registry.register({
      graphId: 'g1',
      threadId: 't1',
      turnId: 'tr1',
      abort: new AbortController(),
      paused: false,
      startedAt: Date.now(),
      maxConcurrency: 3
    })

    expect(registry.pause('g1')).toBe(true)
    expect(registry.get('g1')?.paused).toBe(true)
    expect(registry.get('g1')?.pausedAt).toBeTypeOf('number')

    expect(registry.resume('g1')).toBe(true)
    expect(registry.get('g1')?.paused).toBe(false)
    expect(registry.get('g1')?.pausedAt).toBeUndefined()
  })

  it('returns false when pausing an already paused graph', () => {
    const registry = new OrchestrationRegistry()
    registry.register({
      graphId: 'g1',
      threadId: 't1',
      turnId: 'tr1',
      abort: new AbortController(),
      paused: true,
      startedAt: Date.now(),
      maxConcurrency: 3
    })

    expect(registry.pause('g1')).toBe(false)
  })

  it('returns false when resuming a non-paused graph', () => {
    const registry = new OrchestrationRegistry()
    registry.register({
      graphId: 'g1',
      threadId: 't1',
      turnId: 'tr1',
      abort: new AbortController(),
      paused: false,
      startedAt: Date.now(),
      maxConcurrency: 3
    })

    expect(registry.resume('g1')).toBe(false)
  })

  it('returns snapshot of all entries', () => {
    const registry = new OrchestrationRegistry()
    registry.register({
      graphId: 'g1',
      threadId: 't1',
      turnId: 'tr1',
      abort: new AbortController(),
      paused: false,
      startedAt: 1000,
      maxConcurrency: 3
    })

    const snapshot = registry.snapshot()
    expect(snapshot).toHaveLength(1)
    expect(snapshot[0]).toEqual({
      graphId: 'g1',
      threadId: 't1',
      paused: false,
      startedAt: 1000,
      maxConcurrency: 3
    })
  })
})
