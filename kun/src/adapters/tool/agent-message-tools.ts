import type { AgentMessageBus, AgentMessageType } from '../../delegation/agent-message-bus.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'

export function buildAgentMessageToolProviders(bus: AgentMessageBus | undefined): CapabilityToolProvider[] {
  if (!bus) return []
  return [
    {
      id: 'agent-message',
      kind: 'agent-message',
      enabled: true,
      available: true,
      tools: [
        LocalToolHost.defineTool({
          name: 'send_agent_message',
          description:
            'Send a message to another agent or broadcast to all agents in this session. Use this to share findings, request information, or coordinate work with other agents running in parallel.',
          inputSchema: {
            type: 'object',
            properties: {
              to: {
                type: 'string',
                description: 'Target child agent id, or "*" to broadcast to all agents in this thread.'
              },
              type: {
                type: 'string',
                enum: ['finding', 'request', 'context', 'result', 'status'],
                description: 'Message type: finding (discovered info), request (ask for help), context (background info), result (completed work), status (progress update).'
              },
              title: {
                type: 'string',
                description: 'Short title for the message (max 200 chars).'
              },
              content: {
                type: 'string',
                description: 'Markdown message body (max 10000 chars).'
              },
              fileRefs: {
                type: 'array',
                items: { type: 'string' },
                description: 'File paths relevant to this message.'
              }
            },
            required: ['to', 'type', 'title', 'content'],
            additionalProperties: false
          },
          policy: 'auto',
          execute: async (args, context) => {
            const to = typeof args.to === 'string' ? args.to.trim() : ''
            const type = typeof args.type === 'string' ? args.type.trim() : ''
            const title = typeof args.title === 'string' ? args.title.trim() : ''
            const content = typeof args.content === 'string' ? args.content.trim() : ''

            if (!to) return { output: { error: 'to is required' }, isError: true }
            if (!type) return { output: { error: 'type is required' }, isError: true }
            if (!title) return { output: { error: 'title is required' }, isError: true }
            if (!content) return { output: { error: 'content is required' }, isError: true }

            const validTypes = ['finding', 'request', 'context', 'result', 'status']
            if (!validTypes.includes(type)) {
              return { output: { error: `type must be one of: ${validTypes.join(', ')}` }, isError: true }
            }

            const senderId = context.threadId
            const fileRefs = Array.isArray(args.fileRefs)
              ? args.fileRefs.filter((r): r is string => typeof r === 'string')
              : undefined

            const msg = bus.publish({
              from: senderId,
              to,
              type: type as AgentMessageType,
              threadId: context.threadId,
              payload: {
                title,
                content,
                ...(fileRefs && fileRefs.length > 0 ? { fileRefs } : {})
              }
            })

            return {
              output: {
                messageId: msg.id,
                delivered: true,
                to,
                type,
                title
              },
              isError: false
            }
          }
        }),
        LocalToolHost.defineTool({
          name: 'read_agent_messages',
          description:
            'Read messages addressed to this agent from other agents in the session. Use this to check for findings, requests, or context shared by parallel agents.',
          inputSchema: {
            type: 'object',
            properties: {
              from: {
                type: 'string',
                description: 'Filter by sender child id.'
              },
              type: {
                type: 'string',
                enum: ['finding', 'request', 'context', 'result', 'status'],
                description: 'Filter by message type.'
              },
              limit: {
                type: 'integer',
                minimum: 1,
                maximum: 100,
                description: 'Max messages to return (default 20).'
              }
            },
            additionalProperties: false
          },
          policy: 'auto',
          execute: async (args, context) => {
            const readerId = context.threadId
            const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(args.limit, 100) : 20

            const filter: { from?: string; type?: AgentMessageType } = {}
            if (typeof args.from === 'string' && args.from.trim()) {
              filter.from = args.from.trim()
            }
            if (typeof args.type === 'string' && args.type.trim()) {
              filter.type = args.type.trim() as AgentMessageType
            }

            const all = bus.getHistory(context.threadId, filter)
            const inbox = all.filter((m) => m.to === readerId || m.to === '*')
            const recent = inbox.slice(-limit)

            return {
              output: {
                messages: recent.map((m) => ({
                  id: m.id,
                  from: m.from,
                  type: m.type,
                  title: m.payload.title,
                  content: m.payload.content,
                  fileRefs: m.payload.fileRefs,
                  timestamp: m.timestamp
                })),
                total: inbox.length
              },
              isError: false
            }
          }
        })
      ]
    }
  ]
}
