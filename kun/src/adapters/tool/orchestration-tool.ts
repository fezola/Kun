import type { DelegationRuntime } from '../../delegation/delegation-runtime.js'
import type { AgentMessageBus } from '../../delegation/agent-message-bus.js'
import { TaskGraph } from '../../tasks/task-graph.js'
import { TaskGraphExecutor } from '../../delegation/task-graph-executor.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'
import type { OrchestrationRegistry } from '../../delegation/orchestration-registry.js'

export function buildOrchestrationToolProviders(
  runtime: DelegationRuntime | undefined,
  messageBus: AgentMessageBus | undefined,
  registry?: OrchestrationRegistry
): CapabilityToolProvider[] {
  if (!runtime) return []
  if (!runtime.enabled()) return []

  const profiles = runtime.listProfiles().filter((p) => p.mode !== 'primary')
  const profileNames = profiles.map((p) => p.name)

  return [
    {
      id: 'orchestration',
      kind: 'delegation',
      enabled: true,
      available: true,
      tools: [
        LocalToolHost.defineTool({
          name: 'orchestrate_agents',
          description:
            'Define and execute a task graph with multiple agents. Each task runs as a child agent with a specific profile. Tasks can depend on each other — dependents receive the results of their dependencies as context. The graph executes respecting dependencies and concurrency limits.',
          inputSchema: {
            type: 'object',
            properties: {
              tasks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: 'Unique task identifier.' },
                    title: { type: 'string', description: 'Short label for the task.' },
                    prompt: { type: 'string', description: 'Instructions for the child agent.' },
                    profile: profileNames.length
                      ? { type: 'string', enum: profileNames, description: 'Subagent profile to use.' }
                      : { type: 'string', description: 'Subagent profile to use.' },
                    dependsOn: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Task ids that must complete before this one starts.'
                    },
                    priority: { type: 'number', description: 'Higher priority runs first. Default 0.' }
                  },
                  required: ['id', 'title', 'prompt'],
                  additionalProperties: false
                },
                description: 'Tasks to execute as a dependency graph.',
                minItems: 1,
                maxItems: 20
              },
              maxConcurrency: {
                type: 'integer',
                minimum: 1,
                maximum: 10,
                description: 'Max tasks running in parallel. Default 3.'
              }
            },
            required: ['tasks'],
            additionalProperties: false
          },
          policy: 'auto',
          execute: async (args, context, onUpdate) => {
            const tasks = Array.isArray(args.tasks) ? args.tasks : []
            if (tasks.length === 0) {
              return { output: { error: 'at least one task is required' }, isError: true }
            }

            const maxConcurrency =
              typeof args.maxConcurrency === 'number' && args.maxConcurrency > 0
                ? Math.min(args.maxConcurrency, 10)
                : 3

            const graph = new TaskGraph({ concurrency: maxConcurrency })

            for (const task of tasks) {
              if (typeof task.id !== 'string' || !task.id.trim()) {
                return { output: { error: 'each task needs a non-empty id' }, isError: true }
              }
              if (typeof task.prompt !== 'string' || !task.prompt.trim()) {
                return { output: { error: `task "${task.id}" needs a prompt` }, isError: true }
              }
              try {
                graph.add({
                  id: task.id.trim(),
                  title: typeof task.title === 'string' ? task.title.trim() : task.id.trim(),
                  prompt: task.prompt.trim(),
                  ...(typeof task.profile === 'string' ? { profile: task.profile.trim() } : {}),
                  ...(Array.isArray(task.dependsOn)
                    ? { dependsOn: task.dependsOn.filter((d: unknown): d is string => typeof d === 'string') }
                    : {}),
                  ...(typeof task.priority === 'number' ? { priority: task.priority } : {})
                })
              } catch (error) {
                return {
                  output: { error: `failed to add task "${task.id}": ${error instanceof Error ? error.message : String(error)}` },
                  isError: true
                }
              }
            }

            const cycle = graph.detectCycle()
            if (cycle) {
              return { output: { error: `dependency cycle detected: ${cycle.join(' -> ')}` }, isError: true }
            }

            const graphId = `graph_${Date.now().toString(36)}`
            void onUpdate?.({
              output: {
                graphId,
                status: 'running',
                taskCount: graph.list().length,
                maxConcurrency
              },
              isError: false
            })

            const executor = new TaskGraphExecutor({
              runtime,
              messageBus,
              registry,
              maxConcurrency,
              signal: context.abortSignal
            })

            const result = await executor.execute(graph, context.threadId, context.turnId)

            const taskResults: Record<string, { status: string; result?: string; error?: string; childId?: string }> = {}
            for (const node of graph.list()) {
              taskResults[node.id] = {
                status: node.state,
                ...(node.result ? { result: node.result } : {}),
                ...(node.lastError ? { error: node.lastError } : {}),
                ...(node.childId ? { childId: node.childId } : {})
              }
            }

            return {
              output: {
                graphId: result.graphId,
                status: result.status,
                totalDurationMs: result.totalDurationMs,
                tasks: taskResults
              },
              isError: result.status !== 'completed'
            }
          }
        }),
        LocalToolHost.defineTool({
          name: 'merge_agent_results',
          description:
            'Merge results from a completed orchestration graph into a unified summary. Use after orchestrate_agents completes to synthesize all agent outputs.',
          inputSchema: {
            type: 'object',
            properties: {
              graphResults: {
                type: 'object',
                description: 'The tasks object from orchestrate_agents output.',
                additionalProperties: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    result: { type: 'string' },
                    error: { type: 'string' }
                  }
                }
              },
              format: {
                type: 'string',
                enum: ['summary', 'structured'],
                description: 'Output format. "summary" (default) returns a markdown summary. "structured" returns JSON.'
              }
            },
            required: ['graphResults'],
            additionalProperties: false
          },
          policy: 'auto',
          execute: async (args) => {
            const tasks = args.graphResults as Record<string, { status: string; result?: string; error?: string }> | undefined
            if (!tasks || typeof tasks !== 'object') {
              return { output: { error: 'graphResults is required' }, isError: true }
            }

            const format = args.format === 'structured' ? 'structured' : 'summary'
            const succeeded = Object.entries(tasks).filter(([, t]) => t.status === 'succeeded')
            const failed = Object.entries(tasks).filter(([, t]) => t.status === 'failed' || t.status === 'blocked')

            if (format === 'structured') {
              return {
                output: {
                  succeeded: succeeded.map(([id, t]) => ({ id, result: t.result })),
                  failed: failed.map(([id, t]) => ({ id, error: t.error })),
                  totalTasks: Object.keys(tasks).length,
                  successRate: `${succeeded.length}/${Object.keys(tasks).length}`
                },
                isError: false
              }
            }

            const lines: string[] = ['# Orchestration Results\n']
            lines.push(`**${succeeded.length}/${Object.keys(tasks).length} tasks succeeded**\n`)

            if (succeeded.length > 0) {
              lines.push('## Completed Tasks\n')
              for (const [id, t] of succeeded) {
                lines.push(`### ${id}`)
                lines.push(t.result ?? '(no result)')
                lines.push('')
              }
            }

            if (failed.length > 0) {
              lines.push('## Failed Tasks\n')
              for (const [id, t] of failed) {
                lines.push(`### ${id}`)
                lines.push(`Error: ${t.error ?? 'unknown'}`)
                lines.push('')
              }
            }

            return { output: { summary: lines.join('\n') }, isError: false }
          }
        })
      ]
    }
  ]
}
