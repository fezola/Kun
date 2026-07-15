# Multi-Agent Orchestration - Implementation Tasks

## Completed

### ✅ Phase 1: Core Infrastructure

- **Task 1.1**: Agent Message Bus → `kun/src/delegation/agent-message-bus.ts` (10 tests passing)
- **Task 1.2**: Agent Message Tools → `kun/src/adapters/tool/agent-message-tools.ts` (send + read tools)
- **Task 1.3**: SSE Events → `agent_message` kind added to `RuntimeEventKind`, `AgentMessageEvent` schema, reducer case

### ✅ Phase 2: Task Graph System

- **Task 2.1**: Task Graph Data Model → `kun/src/tasks/task-graph.ts` (extended with profile/prompt/childId/result)
- **Task 2.2**: `orchestrate_agents` + `merge_agent_results` tools → `kun/src/adapters/tool/orchestration-tool.ts`
- **Task 2.3**: Task Graph Executor → `kun/src/delegation/task-graph-executor.ts` (6 tests passing)

### ✅ Phase 3: Result Aggregation

- **Task 3.1 + 3.2**: Merge tool integrated into `orchestration-tool.ts` as `merge_agent_results`

### ✅ Phase 5 (partial): Runtime Wiring

- **Task 5.1**: All components wired in `kun/src/server/runtime-factory.ts` (main + child registries + config sync)

---

## Remaining: Phase 4 — Dashboard UI

### Task 4.1: Orchestration SSE Events (Runtime → Renderer Pipeline)

**Priority**: High | **Estimate**: 1 day | **Dependencies**: None (builds on completed Phase 1-3)

Extend the SSE event pipeline so per-task status changes flow from the Kun runtime to the renderer.

**Files to modify** (in order):

| Step | File | Change |
|------|------|--------|
| 1 | `kun/src/contracts/events.ts` | Add `orchestration_updated` kind to `RuntimeEventKind`, define `OrchestrationEvent` Zod schema, add to `RuntimeEvent` union |
| 2 | `kun/src/delegation/task-graph-executor.ts` | Emit `orchestration_updated` events on task state transitions (pending→running→completed/failed) and graph completion |
| 3 | `src/renderer/src/agent/kun-contract.ts` | Add optional fields to `CoreRuntimeEventJson`: `graphId?`, `taskId?`, `taskStatus?`, `taskResult?`, `taskError?`, `taskProfile?` |
| 4 | `src/renderer/src/agent/types.ts` | Define `OrchestrationEventPayload` type, add `onOrchestration?` callback to `ThreadEventSink` |
| 5 | `src/renderer/src/agent/runtime-projection-actions.ts` | Add `{ type: 'orchestration_changed'; payload: OrchestrationEventPayload }` to union |
| 6 | `src/renderer/src/agent/kun-event-normalizer.ts` | Add `orchestrationFromEvent` dep to `KunEventNormalizerDeps`, add `case 'orchestration_updated'` in switch |
| 7 | `src/renderer/src/agent/kun-mapper.ts` | Implement `orchestrationFromEvent` dep, add `case 'orchestration_changed'` in `applyRuntimeProjectionAction` |
| 8 | `src/renderer/src/store/chat-store-runtime.ts` | Add `onOrchestration` callback in `buildThreadEventSink` |
| 9 | `src/renderer/src/store/chat-projection-reducer.ts` | Add `case 'orchestration_changed'` — store in state (not as timeline block) |

**Event payload schema**:
```typescript
{
  graphId: string
  taskId?: string
  taskTitle?: string
  status: 'graph_started' | 'task_started' | 'task_completed' | 'task_failed' | 'graph_completed' | 'graph_failed'
  profile?: string
  result?: string
  error?: string
  dependencyResults?: Record<string, string>
}
```

**Acceptance Criteria**:
- Task state transitions emit SSE events
- Events flow through the full pipeline to the renderer
- Renderer receives structured orchestration payloads

---

### Task 4.2: Orchestration Zustand Store

**Priority**: High | **Estimate**: 0.5 day | **Dependencies**: Task 4.1

Create a Zustand store for orchestration dashboard state.

**Files to create**:
- `src/renderer/src/stores/orchestration-store.ts`

**Store shape**:
```typescript
interface OrchestrationState {
  graphs: Map<string, {
    graphId: string
    status: string
    tasks: Map<string, {
      id: string
      title: string
      profile?: string
      status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked'
      result?: string
      error?: string
      childId?: string
      startedAt?: string
      completedAt?: string
    }>
    edges: Array<{ from: string; to: string }>
    createdAt: string
    completedAt?: string
  }>
  
  // Actions
  onOrchestrationEvent: (payload: OrchestrationEventPayload) => void
  getActiveGraph: () => OrchestrationGraph | null
  clearCompleted: () => void
}
```

**Acceptance Criteria**:
- Store tracks all active graphs with per-task state
- Edges derived from dependency relationships
- Active graph is the most recent non-completed graph

---

### Task 4.3: Right Panel Integration

**Priority**: High | **Estimate**: 0.5 day | **Dependencies**: Task 4.2

Wire the orchestration dashboard into the workbench right panel system.

**Files to modify** (exact integration points):

| Step | File | Change |
|------|------|--------|
| 1 | `src/renderer/src/extensions/contribution-ids.ts` | Add `orchestration: 'builtin:right-panel-orchestration'` to `BUILTIN_RIGHT_PANEL_IDS` |
| 2 | `src/renderer/src/components/chat/WorkbenchTopBar.tsx` | Add `{ mode: BUILTIN_RIGHT_PANEL_IDS.orchestration, label: t('rightPanelOrchestration'), icon: Network }` to `items` array in `WorkbenchSideRail` |
| 3 | `src/renderer/src/components/workbench/WorkbenchRightPanel.tsx` | Add `orchestration` prop to `WorkbenchRightPanelProps`, add conditional branch for the panel |
| 4 | `src/renderer/src/components/workbench/WorkbenchRightPanelHost.tsx` | Pass orchestration props through |
| 5 | `src/renderer/src/components/workbench/useWorkbenchRightPanelElement.tsx` | Assemble orchestration props from store |
| 6 | `src/renderer/src/components/Workbench.tsx` | Wire `orchestration-store` data into panel props |

**Acceptance Criteria**:
- Network icon appears in side rail
- Clicking toggles orchestration panel open/close
- Panel renders in right panel area with correct sizing

---

### Task 4.4: Orchestration Dashboard Component

**Priority**: High | **Estimate**: 2 days | **Dependencies**: Tasks 4.2, 4.3

Build the main dashboard UI with task graph visualization.

**Files to create**:
- `src/renderer/src/components/orchestration/OrchestrationDashboard.tsx` — main container with tabs
- `src/renderer/src/components/orchestration/AgentStatusCard.tsx` — per-agent status card
- `src/renderer/src/components/orchestration/TaskGraphCanvas.tsx` — React Flow DAG visualization
- `src/renderer/src/components/orchestration/MessageFeed.tsx` — inter-agent message timeline

**Layout** (from design.md):
```
┌─────────────────────────────────────┐
│ Orchestration              [x]      │
├─────────────────────────────────────┤
│ [Graph] [Agents] [Messages]         │
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────────────┐    │
│  │     React Flow Canvas       │    │
│  │                             │    │
│  │  [Explore] ──→ [Implement]  │    │
│  │                    │        │    │
│  │                    ▼        │    │
│  │               [Review]      │    │
│  │                             │    │
│  │  Nodes: color-coded by      │    │
│  │  status (pending/running/   │    │
│  │  completed/failed)          │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ Agent Status Cards          │    │
│  │ 🔵 Explore  ████░░ 67%     │    │
│  │ 🟢 Implement █████░ 85%    │    │
│  │ 🟡 Review   ░░░░░░ queued  │    │
│  └─────────────────────────────┘    │
│                                     │
│  [Abort All] [Merge Results]        │
└─────────────────────────────────────┘
```

**React Flow custom nodes** (reuse `@xyflow/react` already installed):
- `PendingNode` — gray, dashed border
- `RunningNode` — blue, pulsing glow animation
- `CompletedNode` — green, solid
- `FailedNode` — red, solid
- `BlockedNode` — yellow, muted

**Acceptance Criteria**:
- Graph renders with correct topology from task dependencies
- Nodes update in real-time as tasks progress
- Clicking a node shows task detail (prompt, result, error)
- Empty state shows "No active orchestration" message
- Dashboard is responsive within the right panel

---

### Task 4.5: Tests

**Priority**: High | **Estimate**: 1 day | **Dependencies**: Tasks 4.1-4.4

**Files to create/modify**:
- `kun/src/delegation/task-graph-executor.test.ts` — add tests for SSE event emission
- `src/renderer/src/store/chat-projection-reducer.test.ts` — add tests for orchestration_changed action
- `src/renderer/src/components/orchestration/OrchestrationDashboard.test.tsx` — component render tests

**Acceptance Criteria**:
- Event emission tests verify correct event kinds and payloads
- Reducer tests verify state updates
- Component tests verify rendering with mock data

---

## Total Remaining Estimate: ~5 days

### Critical Path
Task 4.1 → Task 4.2 → Task 4.3 → Task 4.4 → Task 4.5

### Files Summary

**New files (6)**:
- `src/renderer/src/stores/orchestration-store.ts`
- `src/renderer/src/components/orchestration/OrchestrationDashboard.tsx`
- `src/renderer/src/components/orchestration/AgentStatusCard.tsx`
- `src/renderer/src/components/orchestration/TaskGraphCanvas.tsx`
- `src/renderer/src/components/orchestration/MessageFeed.tsx`
- Component test files

**Modified files (9)**:
- `kun/src/contracts/events.ts`
- `kun/src/delegation/task-graph-executor.ts`
- `src/renderer/src/agent/kun-contract.ts`
- `src/renderer/src/agent/types.ts`
- `src/renderer/src/agent/runtime-projection-actions.ts`
- `src/renderer/src/agent/kun-event-normalizer.ts`
- `src/renderer/src/agent/kun-mapper.ts`
- `src/renderer/src/store/chat-store-runtime.ts`
- `src/renderer/src/store/chat-projection-reducer.ts`

**Modified files for panel integration (6)**:
- `src/renderer/src/extensions/contribution-ids.ts`
- `src/renderer/src/components/chat/WorkbenchTopBar.tsx`
- `src/renderer/src/components/workbench/WorkbenchRightPanel.tsx`
- `src/renderer/src/components/workbench/WorkbenchRightPanelHost.tsx`
- `src/renderer/src/components/workbench/useWorkbenchRightPanelElement.tsx`
- `src/renderer/src/components/Workbench.tsx`
