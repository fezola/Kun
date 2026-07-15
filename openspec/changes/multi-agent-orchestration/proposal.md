# Multi-Agent Orchestration

## What

Add a **Multi-Agent Orchestration Dashboard** and **Agent Communication Protocol** to Kun, enabling users to:

1. **Spawn and manage multiple agents** working on different parts of the codebase simultaneously
2. **Visualize agent activity** in real-time with a dedicated orchestration panel
3. **Enable inter-agent communication** so agents can share context and results
4. **Merge and review** the collective output from multiple agents

## Why

Kun already has a powerful delegation system (`delegate_task` tool, `DelegationRuntime`, subagent profiles). However, the current system has key limitations:

- **No visibility**: Users can't see what all agents are doing simultaneously
- **No communication**: Agents work in isolation, unable to share findings
- **No coordination**: No way to express dependencies between agent tasks
- **No merge step**: Parent must manually synthesize results

This feature transforms Kun from "one agent with helpers" into a **true multi-agent workbench** where teams of AI agents collaborate on complex tasks.

## Goals

1. **Orchestration Dashboard**: A new panel in the right sidebar showing all active agents, their status, progress, and outputs
2. **Agent-to-Agent Messaging**: A lightweight pub/sub system letting agents broadcast findings to each other
3. **Task Graph Visualization**: Visual representation of agent dependencies and data flow
4. **Result Aggregation**: Automated merge/summary of multi-agent outputs with diff visualization

## Non-Goals (for MVP)

- Distributed execution across multiple machines
- Agent spawning from external triggers (webhooks, APIs)
- Custom agent programming languages or DSLs
- Agent marketplace or community profiles

## Success Criteria

- User can spawn 3+ agents on related tasks and see all their progress in one view
- Agents can share code snippets, file paths, and analysis results via message bus
- Parent agent receives a unified summary with links to each child's work
- Dashboard shows real-time updates via SSE without page refresh
- No performance degradation when running 5+ concurrent agents
