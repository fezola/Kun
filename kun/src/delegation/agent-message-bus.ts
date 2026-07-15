import { z } from 'zod'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'

export const AgentMessageType = z.enum(['finding', 'request', 'context', 'result', 'status'])
export type AgentMessageType = z.infer<typeof AgentMessageType>

export const AgentMessageSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  type: AgentMessageType,
  payload: z.object({
    title: z.string().min(1).max(200),
    content: z.string().min(1).max(10_000),
    fileRefs: z.array(z.string().min(1)).max(32).optional(),
    codeSnippets: z
      .array(
        z.object({
          path: z.string().min(1),
          start: z.number().int().nonnegative(),
          end: z.number().int().nonnegative(),
          content: z.string().min(1).max(5_000)
        })
      )
      .max(8)
      .optional()
  }),
  threadId: z.string().min(1),
  timestamp: z.number().int().nonnegative()
})
export type AgentMessage = z.infer<typeof AgentMessageSchema>

export const AgentMessageBusConfig = z.object({
  maxMessagesPerThread: z.number().int().positive().default(500),
  maxMessageSize: z.number().int().positive().default(10_000),
  retentionMs: z.number().int().positive().default(3_600_000)
})
export type AgentMessageBusConfig = z.infer<typeof AgentMessageBusConfig>

type MessageHandler = (msg: AgentMessage) => void

export class AgentMessageBus {
  private messages: AgentMessage[] = []
  private subscribers = new Map<string, Set<MessageHandler>>()
  private config: AgentMessageBusConfig
  private events?: RuntimeEventRecorder

  constructor(options?: { config?: Partial<AgentMessageBusConfig>; events?: RuntimeEventRecorder }) {
    this.config = AgentMessageBusConfig.parse(options?.config ?? {})
    this.events = options?.events
  }

  publish(msg: Omit<AgentMessage, 'id' | 'timestamp'>): AgentMessage {
    const id = `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const full: AgentMessage = { ...msg, id, timestamp: Date.now() }

    this.messages.push(full)
    this.trimThread(full.threadId)
    this.evictExpired()

    this.deliver(full)
    this.recordEvent(full)

    return full
  }

  subscribe(childId: string, handler: MessageHandler): () => void {
    let bucket = this.subscribers.get(childId)
    if (!bucket) {
      bucket = new Set()
      this.subscribers.set(childId, bucket)
    }
    bucket.add(handler)
    return () => {
      bucket!.delete(handler)
      if (bucket!.size === 0) this.subscribers.delete(childId)
    }
  }

  getHistory(threadId: string, filter?: { from?: string; to?: string; type?: AgentMessageType }): AgentMessage[] {
    return this.messages.filter((m) => {
      if (m.threadId !== threadId) return false
      if (filter?.from && m.from !== filter.from) return false
      if (filter?.to && m.to !== filter.to) return false
      if (filter?.type && m.type !== filter.type) return false
      return true
    })
  }

  getChildSummaries(threadId: string): Map<string, string[]> {
    const summaries = new Map<string, string[]>()
    for (const msg of this.getHistory(threadId)) {
      const list = summaries.get(msg.from) ?? []
      list.push(`[${msg.type}] ${msg.payload.title}`)
      summaries.set(msg.from, list)
    }
    return summaries
  }

  messageCount(threadId: string): number {
    return this.messages.filter((m) => m.threadId === threadId).length
  }

  clearThread(threadId: string): void {
    this.messages = this.messages.filter((m) => m.threadId !== threadId)
  }

  private deliver(msg: AgentMessage): void {
    if (msg.to === '*') {
      for (const [, handlers] of this.subscribers) {
        for (const handler of handlers) {
          handler(msg)
        }
      }
      return
    }
    const handlers = this.subscribers.get(msg.to)
    if (handlers) {
      for (const handler of handlers) {
        handler(msg)
      }
    }
  }

  private trimThread(threadId: string): void {
    const threadStart = this.messages.findIndex((m) => m.threadId === threadId)
    if (threadStart === -1) return
    let threadCount = 0
    for (let i = threadStart; i < this.messages.length; i++) {
      if (this.messages[i].threadId === threadId) threadCount++
    }
    if (threadCount <= this.config.maxMessagesPerThread) return
    const excess = threadCount - this.config.maxMessagesPerThread
    let removed = 0
    for (let i = threadStart; i < this.messages.length && removed < excess; i++) {
      if (this.messages[i].threadId === threadId) {
        this.messages.splice(i, 1)
        removed++
        i--
      }
    }
  }

  private evictExpired(): void {
    const now = Date.now()
    const cutoff = now - this.config.retentionMs
    this.messages = this.messages.filter((m) => m.timestamp >= cutoff)
  }

  private recordEvent(msg: AgentMessage): void {
    if (!this.events) return
    this.events.record({
      kind: 'agent_message' as any,
      threadId: msg.threadId,
      timestamp: new Date(msg.timestamp).toISOString(),
      agentMessage: {
        messageId: msg.id,
        from: msg.from,
        to: msg.to,
        type: msg.type,
        title: msg.payload.title
      }
    } as any)
  }
}
