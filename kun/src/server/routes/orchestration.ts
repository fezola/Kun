import type { OrchestrationRegistry } from '../../delegation/orchestration-registry.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'

/**
 * GET /v1/orchestration/graphs
 *
 * List all active orchestration graphs with their control state.
 */
export async function orchestrationGraphs(
  registry: OrchestrationRegistry | undefined
): Promise<JsonResponse> {
  if (!registry) {
    return jsonResponse({ graphs: [] })
  }
  return jsonResponse({ graphs: registry.snapshot() })
}

/**
 * POST /v1/orchestration/graphs/:graphId/abort
 *
 * Abort a running orchestration graph. All active child agents are cancelled.
 */
export async function orchestrationAbort(
  registry: OrchestrationRegistry | undefined,
  graphId: string
): Promise<JsonResponse> {
  if (!registry) return ERRORS.unavailable('orchestration registry is unavailable')
  if (!graphId.trim()) return ERRORS.validation('graphId is required', [])
  const aborted = registry.abort(graphId)
  return jsonResponse({ graphId, aborted })
}

/**
 * POST /v1/orchestration/graphs/:graphId/pause
 *
 * Pause a running orchestration graph. The executor's main loop will wait
 * until the graph is resumed before scheduling new tasks.
 */
export async function orchestrationPause(
  registry: OrchestrationRegistry | undefined,
  graphId: string
): Promise<JsonResponse> {
  if (!registry) return ERRORS.unavailable('orchestration registry is unavailable')
  if (!graphId.trim()) return ERRORS.validation('graphId is required', [])
  const paused = registry.pause(graphId)
  return jsonResponse({ graphId, paused })
}

/**
 * POST /v1/orchestration/graphs/:graphId/resume
 *
 * Resume a paused orchestration graph.
 */
export async function orchestrationResume(
  registry: OrchestrationRegistry | undefined,
  graphId: string
): Promise<JsonResponse> {
  if (!registry) return ERRORS.unavailable('orchestration registry is unavailable')
  if (!graphId.trim()) return ERRORS.validation('graphId is required', [])
  const resumed = registry.resume(graphId)
  return jsonResponse({ graphId, resumed })
}
