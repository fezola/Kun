import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentMessageBus, type AgentMessage, type AgentMessageBusConfig } from './agent-message-bus.js'

function makeMsg(overrides: Partial<Omit<AgentMessage, 'id' | 'timestamp'>> = {}): Omit<AgentMessage, 'id' | 'timestamp'> {
  return {
    from: 'child_1',
    to: 'child_2',
    type: 'finding',
    threadId: 'thread_1',
    payload: { title: 'test', content: 'hello' },
    ...overrides
  }
}

describe('AgentMessageBus', () => {
  let bus: AgentMessageBus

  beforeEach(() => {
    bus = new AgentMessageBus({ config: { maxMessagesPerThread: 10, retentionMs: 60_000 } })
  })

  it('publishes and delivers to specific subscriber', () => {
    const handler = vi.fn()
    bus.subscribe('child_2', handler)

    const msg = bus.publish(makeMsg())

    expect(msg.id).toMatch(/^msg_/)
    expect(msg.timestamp).toBeGreaterThan(0)
    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ from: 'child_1', to: 'child_2' }))
  })

  it('publishes broadcast to all subscribers', () => {
    const h1 = vi.fn()
    const h2 = vi.fn()
    bus.subscribe('child_1', h1)
    bus.subscribe('child_2', h2)

    bus.publish(makeMsg({ to: '*' }))

    expect(h1).toHaveBeenCalledOnce()
    expect(h2).toHaveBeenCalledOnce()
  })

  it('does not deliver to unrelated subscribers', () => {
    const handler = vi.fn()
    bus.subscribe('child_3', handler)

    bus.publish(makeMsg({ to: 'child_2' }))

    expect(handler).not.toHaveBeenCalled()
  })

  it('unsubscribe stops delivery', () => {
    const handler = vi.fn()
    const unsub = bus.subscribe('child_2', handler)

    bus.publish(makeMsg())
    expect(handler).toHaveBeenCalledOnce()

    unsub()
    bus.publish(makeMsg())
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('getHistory filters by thread, from, to, type', () => {
    bus.publish(makeMsg({ threadId: 't1', from: 'a', to: 'b', type: 'finding' }))
    bus.publish(makeMsg({ threadId: 't1', from: 'a', to: 'c', type: 'request' }))
    bus.publish(makeMsg({ threadId: 't2', from: 'a', to: 'b', type: 'finding' }))

    expect(bus.getHistory('t1')).toHaveLength(2)
    expect(bus.getHistory('t1', { from: 'a' })).toHaveLength(2)
    expect(bus.getHistory('t1', { to: 'b' })).toHaveLength(1)
    expect(bus.getHistory('t1', { type: 'request' })).toHaveLength(1)
    expect(bus.getHistory('t2', { from: 'a', to: 'b', type: 'finding' })).toHaveLength(1)
  })

  it('getChildSummaries groups by sender', () => {
    bus.publish(makeMsg({ threadId: 't1', from: 'agent_1', type: 'finding', payload: { title: 'found X', content: '' } }))
    bus.publish(makeMsg({ threadId: 't1', from: 'agent_1', type: 'result', payload: { title: 'done', content: '' } }))
    bus.publish(makeMsg({ threadId: 't1', from: 'agent_2', type: 'status', payload: { title: 'running', content: '' } }))

    const summaries = bus.getChildSummaries('t1')
    expect(summaries.get('agent_1')).toEqual(['[finding] found X', '[result] done'])
    expect(summaries.get('agent_2')).toEqual(['[status] running'])
  })

  it('trims oldest messages when over maxMessagesPerThread', () => {
    for (let i = 0; i < 15; i++) {
      bus.publish(makeMsg({ threadId: 't1', payload: { title: `msg ${i}`, content: '' } }))
    }

    const history = bus.getHistory('t1')
    expect(history).toHaveLength(10)
    expect(history[0].payload.title).toBe('msg 5')
  })

  it('clearThread removes all messages for a thread', () => {
    bus.publish(makeMsg({ threadId: 't1' }))
    bus.publish(makeMsg({ threadId: 't2' }))

    bus.clearThread('t1')

    expect(bus.getHistory('t1')).toHaveLength(0)
    expect(bus.getHistory('t2')).toHaveLength(1)
  })

  it('messageCount returns correct count', () => {
    bus.publish(makeMsg({ threadId: 't1' }))
    bus.publish(makeMsg({ threadId: 't1' }))
    bus.publish(makeMsg({ threadId: 't2' }))

    expect(bus.messageCount('t1')).toBe(2)
    expect(bus.messageCount('t2')).toBe(1)
  })

  it('records events when event recorder is provided', () => {
    const record = vi.fn()
    const busWithEvents = new AgentMessageBus({
      events: { record } as any
    })

    busWithEvents.publish(makeMsg({ threadId: 't1', type: 'finding', payload: { title: 'test', content: '' } }))

    expect(record).toHaveBeenCalledOnce()
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent_message',
        threadId: 't1'
      })
    )
  })
})
