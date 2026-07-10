import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeEvent } from '../src/contracts/events.js'
import type { EventBus } from '../src/ports/event-bus.js'
import type { SessionStore } from '../src/ports/session-store.js'
import {
  buildEventStreamResponse,
  HEARTBEAT_INTERVAL_MS,
  MAX_LIVE_EVENTS_DURING_REPLAY,
  parseEventCursor
} from '../src/server/routes/events.js'

describe('event stream replay', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('accepts only non-negative safe integer cursors', () => {
    expect(parseEventCursor(new Request('http://localhost/events?since_seq=0', { headers: { 'Last-Event-ID': '9' } }))).toBe(0)
    expect(parseEventCursor(new Request('http://localhost/events?since_seq=-1'))).toBeNull()
    expect(parseEventCursor(new Request('http://localhost/events?since_seq=Infinity'))).toBeNull()
    expect(parseEventCursor(new Request('http://localhost/events?since_seq=9007199254740992'))).toBeNull()
  })

  it('delivers an event published between subscription and persisted replay', async () => {
    let subscriber: ((event: RuntimeEvent) => void) | undefined
    const live: RuntimeEvent = {
      kind: 'heartbeat', seq: 2, timestamp: '2026-07-10T00:00:02.000Z', threadId: 'thr_events'
    }
    const eventBus: EventBus = {
      publish: () => undefined,
      subscribe: (_threadId, handler) => {
        subscriber = handler
        return () => {
          subscriber = undefined
        }
      },
      snapshotSince: () => [],
      highestSeq: () => 0,
      reset: () => undefined
    }
    const sessionStore = {
      highestSeq: async () => 1,
      loadEventsSince: async () => {
        subscriber?.(live)
        return [{ kind: 'heartbeat', seq: 1, timestamp: '2026-07-10T00:00:01.000Z', threadId: 'thr_events' }]
      }
    } as unknown as SessionStore
    const response = buildEventStreamResponse({
      request: new Request('http://localhost/v1/threads/thr_events/events?since_seq=0'),
      threadId: 'thr_events',
      eventBus,
      sessionStore
    })
    const reader = response.body!.getReader()
    try {
      const decoder = new TextDecoder()
      const first = await reader.read()
      const second = await reader.read()
      expect(`${decoder.decode(first.value)}${decoder.decode(second.value)}`).toContain('id: 1')
      expect(`${decoder.decode(first.value)}${decoder.decode(second.value)}`).toContain('id: 2')
    } finally {
      await reader.cancel()
    }
  })

  it('closes an SSE stream when live events overflow a slow replay buffer', async () => {
    let subscriber: ((event: RuntimeEvent) => void) | undefined
    let releaseReplay: (() => void) | undefined
    let notifySubscribed: (() => void) | undefined
    let notifyReplayStarted: (() => void) | undefined
    const subscribed = new Promise<void>((resolve) => { notifySubscribed = resolve })
    const replayStarted = new Promise<void>((resolve) => { notifyReplayStarted = resolve })
    const eventBus: EventBus = {
      publish: () => undefined,
      subscribe: (_threadId, handler) => {
        subscriber = handler
        notifySubscribed?.()
        return () => { subscriber = undefined }
      },
      snapshotSince: () => [], highestSeq: () => 0, reset: () => undefined
    }
    const sessionStore = {
      highestSeq: async () => 1,
      loadEventsSince: async () => new Promise<RuntimeEvent[]>((resolveReplay) => {
        releaseReplay = () => resolveReplay([])
        notifyReplayStarted?.()
      })
    } as unknown as SessionStore
    const response = buildEventStreamResponse({
      request: new Request('http://localhost/v1/threads/thr_events/events?since_seq=0'),
      threadId: 'thr_events', eventBus, sessionStore
    })
    await subscribed
    await replayStarted
    for (let seq = 1; seq <= MAX_LIVE_EVENTS_DURING_REPLAY + 1; seq += 1) {
      subscriber?.({ kind: 'heartbeat', seq, timestamp: '2026-07-10T00:00:00.000Z', threadId: 'thr_events' })
    }
    releaseReplay?.()
    const reader = response.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toContain('SSE replay overflow')
    await expect(reader.read()).resolves.toMatchObject({ done: true })
  })

  it('closes a stalled live SSE client instead of accumulating events', async () => {
    let subscriber: ((event: RuntimeEvent) => void) | undefined
    const eventBus: EventBus = {
      publish: () => undefined,
      subscribe: (_threadId, handler) => {
        subscriber = handler
        return () => { subscriber = undefined }
      },
      snapshotSince: () => [], highestSeq: () => 0, reset: () => undefined
    }
    const sessionStore = {
      highestSeq: async () => 0,
      loadEventsSince: async () => []
    } as unknown as SessionStore
    const response = buildEventStreamResponse({
      request: new Request('http://localhost/v1/threads/thr_events/events?since_seq=0'),
      threadId: 'thr_events', eventBus, sessionStore
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    subscriber?.({ kind: 'heartbeat', seq: 1, timestamp: '2026-07-10T00:00:00.000Z', threadId: 'thr_events' })
    subscriber?.({ kind: 'heartbeat', seq: 2, timestamp: '2026-07-10T00:00:01.000Z', threadId: 'thr_events' })

    const reader = response.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toContain('id: 1')
    await expect(reader.read()).resolves.toMatchObject({ done: true })
  })

  it('closes an idle SSE client once an unread heartbeat fills its queue', async () => {
    vi.useFakeTimers()
    let unsubscribed = false
    const eventBus: EventBus = {
      publish: () => undefined,
      subscribe: () => () => {
        unsubscribed = true
      },
      snapshotSince: () => [], highestSeq: () => 0, reset: () => undefined
    }
    const sessionStore = {
      highestSeq: async () => 0,
      loadEventsSince: async () => []
    } as unknown as SessionStore
    const response = buildEventStreamResponse({
      request: new Request('http://localhost/v1/threads/thr_events/events?since_seq=0'),
      threadId: 'thr_events', eventBus, sessionStore
    })

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 2)

    expect(unsubscribed).toBe(true)
    const reader = response.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toContain('event: heartbeat')
    await expect(reader.read()).resolves.toMatchObject({ done: true })
  })
})
