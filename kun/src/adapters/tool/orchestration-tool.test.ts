import { describe, it, expect, vi } from 'vitest'
import { buildOrchestrationToolProviders } from './orchestration-tool.js'
import { AgentMessageBus } from '../../delegation/agent-message-bus.js'
import type { DelegationRuntime, ChildRunRecord } from '../../delegation/delegation-runtime.js'

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

function makeBus(): AgentMessageBus {
  return new AgentMessageBus()
}

describe('buildOrchestrationToolProviders', () => {
  it('returns a single provider with two tools', () => {
    const providers = buildOrchestrationToolProviders(makeRuntime(), makeBus())
    expect(providers).toHaveLength(1)
    expect(providers[0].tools).toHaveLength(2)
  })

  it('provider has delegation kind and orchestration id', () => {
    const providers = buildOrchestrationToolProviders(makeRuntime(), makeBus())
    expect(providers[0].kind).toBe('delegation')
    expect(providers[0].id).toBe('orchestration')
  })

  it('first tool is orchestrate_agents', () => {
    const providers = buildOrchestrationToolProviders(makeRuntime(), makeBus())
    const tool = providers[0].tools[0]
    expect(tool.name).toBe('orchestrate_agents')
  })

  it('second tool is merge_agent_results', () => {
    const providers = buildOrchestrationToolProviders(makeRuntime(), makeBus())
    const tool = providers[0].tools[1]
    expect(tool.name).toBe('merge_agent_results')
  })

  it('returns empty when runtime is undefined', () => {
    expect(buildOrchestrationToolProviders(undefined, makeBus())).toHaveLength(0)
  })

  it('returns empty when runtime is disabled', () => {
    const runtime = makeRuntime({ enabled: () => false })
    expect(buildOrchestrationToolProviders(runtime, makeBus())).toHaveLength(0)
  })
})
