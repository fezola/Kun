# Multi-Agent Orchestration - Technical Design

## Architecture Overview

Build on top of the existing `DelegationRuntime` and `delegate_task` tool infrastructure. Add three new subsystems:

```
┌─────────────────────────────────────────────────────────┐
│                    GUI (Renderer)                        │
│  ┌──────────────────┐  ┌─────────────────────────────┐ │
│  │ Orchestration    │  │ Task Graph                   │ │
│  │ Dashboard        │  │ Visualization                │ │
│  │ (Right Panel)    │  │ (XYFlow Canvas)              │ │
│  └────────┬─────────┘  └──────────┬──────────────────┘ │
│           │                       │                     │
│  ┌────────▼───────────────────────▼──────────────────┐ │
│  │           SSE Event Stream (existing)              │ │
│  └────────────────────┬──────────────────────────────┘ │
└───────────────────────┼────────────────────────────────┘
                        │
┌───────────────────────┼────────────────────────────────┐
│                 Kun Runtime                             │
│  ┌────────────────────▼──────────────────────────────┐ │
│  │              DelegationRuntime (existing)          │ │
│  └──┬──────────┬──────────┬──────────┬───────────────┘ │
│     │          │          │          │                  │
│  ┌──▼───┐  ┌──▼───┐  ┌──▼───┐  ┌──▼───┐              │
│  │Child │  │Child │  │Child │  │Child │              │
│  │  1   │  │  2   │  │  3   │  │  N   │              │
│  └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘              │
│     │         │         │         │                    │
│  ┌──▼─────────▼─────────▼─────────▼────────────────┐  │
│  │         Agent Message Bus (NEW)                  │  │
│  │    pub/sub, broadcasts, result aggregation       │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Component 1: Agent Message Bus

**Location**: `kun/src/delegation/agent-message-bus.ts`

A lightweight in-process pub/sub system for inter-agent communication.

### Data Model

```typescript
interface AgentMessage {
  id: string
  from: string           // childId of sender
  to: string | '*'       // childId or '*' for broadcast
  type: 'finding' | 'request' | 'context' | 'result' | 'status'
  payload: {
    title: string
    content: string      // markdown text
    fileRefs?: string[]  // referenced file paths
    codeSnippets?: Array<{ path: string; start: number; end: number; content: string }>
    timestamp: number
  }
  threadId: string       // parent thread for routing
}

interface MessageBusConfig {
  maxMessagesPerThread: number    // default: 500
  maxMessageSize: number          // default: 10KB
  retentionMs: number             // default: 1 hour
}
```

### API

```typescript
class AgentMessageBus {
  publish(msg: Omit<AgentMessage, 'id' | 'timestamp'>): void
  subscribe(childId: string, handler: (msg: AgentMessage) => void): () => void
  getHistory(threadId: string, filter?: Partial<AgentMessage>): AgentMessage[]
  getChildSummaries(threadId: string): Map<string, string[]>
}
```

### Integration Points

1. **Tool: `send_agent_message`** - New tool available to child agents with `toolPolicy: 'inherit'`
   - Schema: `{ to: string, type: string, title: string, content: string, fileRefs?: string[] }`
   - Validates against `MessageBusConfig` limits
   - Publishes to bus, delivers to target subscribers

2. **Tool: `read_agent_messages`** - New tool for children to read messages addressed to them
   - Schema: `{ from?: string, type?: string, limit?: number }`
   - Returns filtered message history for the child's inbox

3. **Runtime Events** - New event type `agent_message` emitted on publish
   - Flows through existing SSE infrastructure to dashboard

## Component 2: Orchestration Dashboard

**Location**: `src/renderer/src/components/orchestration/`

A dedicated right-panel view showing all active multi-agent sessions.

### Layout

```
┌─────────────────────────────────────┐
│ Multi-Agent Session          ⚙️ 🔄  │
├─────────────────────────────────────┤
│ ▼ Active Agents (3)                 │
│ ┌─────────────────────────────────┐ │
│ │ 🔵 Explore   | deepseek-v4-flash│ │
│ │    Scanning src/components/      │ │
│ │    ████████░░░░ 67% | 2.3s      │ │
│ ├─────────────────────────────────┤ │
│ │ 🟢 Implement | deepseek-v4-pro  │ │
│ │    Writing UserService.ts        │ │
│ │    ████████████░ 85% | 8.1s     │ │
│ ├─────────────────────────────────┤ │
│ │ 🟡 Review    | deepseek-v4-flash│ │
│ │    Queued...                     │ │
│ │    ░░░░░░░░░░░░ 0% | waiting   │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ▼ Message Feed                      │
│ ┌─────────────────────────────────┐ │
│ │ [Explore → *] Found 3 files     │ │
│ │ matching auth pattern            │ │
│ │                                  │ │
│ │ [Implement → Parent] Draft      │ │
│ │ complete, needs review           │ │
│ │                                  │ │
│ │ [Review → Implement] Check      │ │
│ │ line 42 of UserService.ts       │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ▼ Task Graph                        │
│ ┌─────────────────────────────────┐ │
│ │  [Explore] ──→ [Implement]      │ │
│ │                    │             │ │
│ │                    ▼             │ │
│ │               [Review]           │ │
│ └─────────────────────────────────┘ │
│                                     │
│ [Abort All] [Merge Results] [Export]│
└─────────────────────────────────────┘
```

### Components

| Component | File | Purpose |
|-----------|------|---------|
| `OrchestrationDashboard.tsx` | Main container | Tabbed layout for agents/messages/graph |
| `AgentStatusCard.tsx` | Per-agent card | Avatar, profile, model, progress bar, status |
| `MessageFeed.tsx` | Message timeline | Chronological view of inter-agent messages |
| `TaskGraphCanvas.tsx` | XYFlow canvas | DAG visualization of agent dependencies |
| `MergeResultsModal.tsx` | Merge dialog | Unified output with per-agent diffs |

### Data Flow

1. **SSE Events** → `runtime-event-reducer.ts` reduces child events and `agent_message` events
2. **Zustand Store** → New `orchestration-store.ts` holds dashboard state
3. **Dashboard Components** subscribe to store, render in real-time

## Component 3: Task Graph System

**Location**: `kun/src/delegation/task-graph.ts`

Extends the existing `delegate_task` tool with dependency tracking.

### Data Model

```typescript
interface TaskNode {
  id: string
  label: string
  profile: string        // subagent profile to use
  prompt: string         // task description
  dependsOn: string[]    // IDs of tasks that must complete first
  status: 'pending' | 'queued' | 'running' | 'completed' | 'failed'
  result?: string
  childId?: string       // assigned when running
}

interface TaskGraph {
  id: string
  threadId: string
  nodes: TaskNode[]
  maxConcurrency: number  // default: from config.maxParallel
}
```

### Tool: `orchestrate_agents`

A high-level tool that lets the parent agent define a task graph:

```json
{
  "name": "orchestrate_agents",
  "parameters": {
    "tasks": [
      {
        "id": "explore-auth",
        "label": "Explore auth system",
        "profile": "explore",
        "prompt": "Find all authentication-related code in src/"
      },
      {
        "id": "implement-fix",
        "label": "Fix auth bug",
        "profile": "general",
        "prompt": "Fix the token refresh race condition",
        "dependsOn": ["explore-auth"]
      },
      {
        "id": "review-fix",
        "label": "Review fix",
        "profile": "design-reviewer",
        "prompt": "Review the auth fix for correctness",
        "dependsOn": ["implement-fix"]
      }
    ],
    "maxConcurrency": 2
  }
}
```

### Execution Engine

```typescript
class TaskGraphExecutor {
  private bus: AgentMessageBus
  private runtime: DelegationRuntime

  async execute(graph: TaskGraph): Promise<Map<string, string>> {
    // Topological sort, respect maxConcurrency
    // For each ready node:
    //   1. Build prompt with context from dependency results
    //   2. Spawn child via runtime.runChild()
    //   3. On completion, store result and unblock dependents
    //   4. Emit SSE events for dashboard
    // Return map of taskId -> result summary
  }
}
```

## Component 4: Result Aggregation

**Location**: `kun/src/delegation/result-aggregator.ts`

### Tool: `merge_agent_results`

```json
{
  "name": "merge_agent_results",
  "parameters": {
    "format": "summary | diff | structured",
    "includePerAgent": true,
    "includeFileChanges": true
  }
}
```

Returns a structured merge:
- Per-agent summary with key findings
- Unified file change list with conflict detection
- Overall task completion status
- Cost and token usage breakdown

## SSE Event Pipeline (Renderer Integration)

The orchestration events flow through the existing 6-layer SSE pipeline:

```
TaskGraphExecutor (kun runtime)
  │  recorder.record({ kind: 'orchestration_updated', ... })
  ▼
RuntimeEventRecorder → EventBus → SSE Route
  │
  ▼
Renderer: kun-runtime.ts → dispatchKunRuntimeEvents()
  │  normalizeKunRuntimeEvent() → RuntimeProjectionAction[]
  ▼
chat-store-runtime.ts → buildThreadEventSink()
  │  reduceChatProjection() → Partial<ChatState>
  ▼
orchestration-store.ts (Zustand)
  │  onOrchestrationEvent()
  ▼
OrchestrationDashboard → React Flow Canvas
```

### Event Schema

```typescript
// kun/src/contracts/events.ts
export const OrchestrationEvent = RuntimeEventBase.extend({
  kind: z.literal('orchestration_updated'),
  graphId: z.string(),
  taskId: z.string().optional(),
  taskTitle: z.string().optional(),
  status: z.enum([
    'graph_started', 'task_started', 'task_completed',
    'task_failed', 'graph_completed', 'graph_failed'
  ]),
  profile: z.string().optional(),
  result: z.string().optional(),
  error: z.string().optional(),
})
```

### Renderer Wire Type

```typescript
// src/renderer/src/agent/kun-contract.ts (add optional fields)
export type CoreRuntimeEventJson = {
  // ... existing fields ...
  graphId?: string
  taskId?: string
  taskTitle?: string
  taskStatus?: string
  taskResult?: string
  taskError?: string
  taskProfile?: string
}
```

### Projection Action

```typescript
// src/renderer/src/agent/runtime-projection-actions.ts
| { type: 'orchestration_changed'; payload: OrchestrationEventPayload }
```

### ThreadEventSink Callback

```typescript
// src/renderer/src/agent/types.ts
onOrchestration?(ev: OrchestrationEventPayload): void
```

## Right Panel Integration

The dashboard uses the existing right panel mode system (like plan/todo/changes):

### Panel Registration

1. **contribution-ids.ts**: Add `orchestration: 'builtin:right-panel-orchestration'`
2. **WorkbenchTopBar.tsx**: Add Network icon button to side rail `items` array
3. **WorkbenchRightPanel.tsx**: Add conditional branch for `orchestration` mode
4. **WorkbenchRightPanelHost.tsx**: Pass orchestration props
5. **useWorkbenchRightPanelElement.tsx**: Assemble props from store
6. **Workbench.tsx**: Wire orchestration-store data

### Toggle Behavior

```typescript
// workbench-layout.ts
const toggleRightPanelMode = (nextMode) => {
  const willOpen = rightPanelMode !== nextMode
  setRightPanelMode(current => current === nextMode ? null : nextMode)
}
```

## Settings Extensions

Add to `KunSubagentsSettingsV1`:

```typescript
interface OrchestrationSettings {
  enabled: boolean                    // default: true
  maxConcurrentGraphs: number         // default: 3
  messageBusSize: number              // default: 500
  showDashboard: boolean              // default: true
  autoMergeOnComplete: boolean        // default: false
}
```

## File Changes Summary

### Completed (Kun Runtime)
- `kun/src/delegation/agent-message-bus.ts` ✅ — Message bus implementation
- `kun/src/tasks/task-graph.ts` ✅ — Task graph data model (extended with profile/prompt/childId/result)
- `kun/src/delegation/task-graph-executor.ts` ✅ — Graph execution engine
- `kun/src/adapters/tool/orchestration-tool.ts` ✅ — orchestrate_agents + merge_agent_results tools
- `kun/src/server/runtime-factory.ts` ✅ — All components wired (main + child registries + config sync)

### Completed (Renderer SSE Pipeline)
- `kun/src/contracts/events.ts` ✅ — agent_message kind added
- `kun/src/domain/runtime-event-reducer.ts` ✅ — agent_message case added

### New Files (Renderer — Phase 4)
- `src/renderer/src/stores/orchestration-store.ts` — Zustand store for orchestration state
- `src/renderer/src/components/orchestration/OrchestrationDashboard.tsx` — Main dashboard container
- `src/renderer/src/components/orchestration/AgentStatusCard.tsx` — Per-agent status card
- `src/renderer/src/components/orchestration/TaskGraphCanvas.tsx` — React Flow DAG visualization
- `src/renderer/src/components/orchestration/MessageFeed.tsx` — Inter-agent message timeline

### Modified Files (Phase 4 — SSE Pipeline Extension)
- `kun/src/contracts/events.ts` — Add orchestration_updated kind + schema
- `kun/src/delegation/task-graph-executor.ts` — Emit orchestration events on state transitions
- `src/renderer/src/agent/kun-contract.ts` — Add orchestration fields to CoreRuntimeEventJson
- `src/renderer/src/agent/types.ts` — Add OrchestrationEventPayload + onOrchestration callback
- `src/renderer/src/agent/runtime-projection-actions.ts` — Add orchestration_changed action
- `src/renderer/src/agent/kun-event-normalizer.ts` — Add orchestration case + deps
- `src/renderer/src/agent/kun-mapper.ts` — Implement orchestration deps + apply action
- `src/renderer/src/store/chat-store-runtime.ts` — Add onOrchestration callback
- `src/renderer/src/store/chat-projection-reducer.ts` — Add orchestration_changed case

### Modified Files (Phase 4 — Panel Integration)
- `src/renderer/src/extensions/contribution-ids.ts` — Add orchestration panel ID
- `src/renderer/src/components/chat/WorkbenchTopBar.tsx` — Add Network icon button
- `src/renderer/src/components/workbench/WorkbenchRightPanel.tsx` — Add orchestration branch
- `src/renderer/src/components/workbench/WorkbenchRightPanelHost.tsx` — Pass orchestration props
- `src/renderer/src/components/workbench/useWorkbenchRightPanelElement.tsx` — Assemble props
- `src/renderer/src/components/Workbench.tsx` — Wire orchestration-store data
