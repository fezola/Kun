import type { ModelClient, ModelRequest, ModelStreamChunk, ModelToolSpec } from '../../ports/model-client.js'
import type { UsageSnapshot } from '../../contracts/usage.js'
import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import type { LlmDebugRound, LlmDebugSink } from '../../services/llm-debug-recorder.js'
import { repairToolArguments } from './tool-argument-repair.js'
import { isDeepSeekHost } from './model-error-probe.js'
import type { ModelRequestRetryConfig } from '../../config/kun-config.js'
import {
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  isCustomModelEndpointFormat,
  modelEndpointPath,
  normalizeModelEndpointFormat,
  resolveModelEndpointFormat,
  usesChatCompletionsShape,
  type ModelEndpointFormat
} from '../../contracts/model-endpoint-format.js'
import { createProxyFetch } from './proxy-fetch.js'
import { resolveCompatModelCapabilities } from './compat-capabilities.js'
import {
  DEFAULT_MODEL_STREAM_LIMITS,
  ModelStreamResourceBudget,
  ModelStreamResourceLimitError,
  type ModelStreamLimits,
  type PendingToolCall
} from './model-stream-resource-budget.js'
import { normalizeCompatUsage } from './compat-usage-normalizer.js'
import {
  normalizeModelRequestRetryConfig,
  retryDelayMs,
  sleepWithAbort
} from './compat-retry-policy.js'
import {
  buildCompatRequestHeaders,
  classifyCompatHttpError,
  compatHttpFailureLog,
  redactUrlForLog
} from './compat-http-diagnostics.js'
import {
  CompatRequestCodecs,
  type CompatChatMessage,
  type CompatChatMessageContentPart
} from './compat-request-codecs.js'
import { projectCompatMessages } from './compat-message-projector.js'
import { decodeChatCompletionsStreamPayload } from './chat-completions-stream-decoder.js'
import { decodeResponsesStreamPayload } from './responses-stream-decoder.js'
import { decodeAnthropicMessagesStreamPayload } from './anthropic-messages-stream-decoder.js'
import { decodeCompatNonStreamingResponse } from './compat-non-streaming-decoder.js'

export { redactUrlForLog } from './compat-http-diagnostics.js'

export {
  DEFAULT_MODEL_STREAM_LIMITS,
  type ModelStreamLimits
} from './model-stream-resource-budget.js'

/**
 * Configuration for the compatible HTTP model client. Chat
 * completions remains the default, while custom providers can opt into
 * OpenAI Responses or Anthropic Messages request/response shapes.
 */
export type CompatModelClientConfig = {
  baseUrl: string
  apiKey: string
  model: string
  /** Compatible request/response protocol to use for custom providers. */
  endpointFormat?: ModelEndpointFormat
  /** Optional extra headers, e.g. project or session ids. */
  headers?: Record<string, string>
  /** HTTP fetch implementation. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch
  /** Optional proxy URL used only for model HTTP requests. */
  modelProxyUrl?: string
  /** Maximum number of messages to send. Defaults to the entire history. */
  historyLimit?: number
  /** When true, the client requests a non-streaming response. */
  nonStreaming?: boolean
  /** Maximum idle time between streaming chunks before the turn fails. */
  streamIdleTimeoutMs?: number
  /** Resource ceilings for one provider SSE response. */
  streamLimits?: Partial<ModelStreamLimits>
  /** 流式响应开始前,遇到临时失败或限流响应时使用的 HTTP 重试策略。 */
  retry?: ModelRequestRetryConfig
  /** Optional model capability resolver used for provider-specific reasoning translation. */
  modelCapabilities?: (model: string) => ModelCapabilityMetadata
  /** Optional troubleshooting sink that captures each request body + raw output. */
  debugSink?: LlmDebugSink
}

type ChatMessage = CompatChatMessage
type ChatMessageContentPart = CompatChatMessageContentPart
type ModelStopReason = Extract<ModelStreamChunk, { kind: 'completed' }>['stopReason']

type AnthropicCacheControl = { type: 'ephemeral' }

type AnthropicImageSource = { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string }

type AnthropicContentBlock = (
  | { type: 'text'; text: string }
  | { type: 'image'; source: AnthropicImageSource }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }
) & { cache_control?: AnthropicCacheControl }

type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

const CODEX_NATIVE_IMAGE_GENERATION_MODELS = new Set(['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'])

type ChatCompletionResponse = {
  id: string
  model: string
  choices: {
    index: number
    finish_reason: string
    message: ChatMessage & {
      tool_calls?: {
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }[]
    }
  }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    prompt_eval_count?: number
    eval_count?: number
    prompt_cache_hit_tokens?: number
    prompt_cache_miss_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}

type StreamReadResult =
  | { kind: 'chunk'; value?: Uint8Array; done: boolean }
  | { kind: 'timeout' }
  | { kind: 'aborted' }
  | { kind: 'error'; message: string }
type StreamPayloadResult = {
  chunks: ModelStreamChunk[]
  sawTextDelta: boolean
  finishReason: string | null
  usage: UsageSnapshot | null
}

const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 45_000

/**
 * Multi-provider HTTP model client.
 *
 * Speaks the streaming chat completions shape by default, and can switch
 * to OpenAI Responses or Anthropic Messages request/response shapes per
 * provider via `endpointFormat`. It supports tool calls, cache hit/miss
 * counters (when the provider reports them), and abort-signal
 * cancellation. The client is deliberately small so the rest of the
 * runtime can be built around the `ModelClient` port.
 */
export class CompatModelClient implements ModelClient {
  readonly provider = 'compat'
  readonly model: string

  private readonly config: CompatModelClientConfig
  private readonly fetchImpl: typeof fetch

  constructor(config: CompatModelClientConfig) {
    this.config = config
    this.model = config.model
    this.fetchImpl = config.fetchImpl ?? createProxyFetch(config.modelProxyUrl ?? '') ?? fetch
  }

  /**
   * Streams the model response for a turn. Each yielded chunk is one
   * of the kinds defined by `ModelStreamChunk`. The stream respects
   * the request's `abortSignal` between chunks.
   */
  /**
   * Public entry point. When a `debugSink` is configured, captures the
   * literal request body and accumulates the raw output for the
   * troubleshooting view; otherwise forwards with zero overhead.
   */
  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const sink = this.config.debugSink
    if (!sink) {
      yield* this.streamInner(request, null)
      return
    }
    const round = sink.start({
      threadId: request.threadId,
      turnId: request.turnId,
      provider: this.provider,
      model: request.model?.trim() || this.config.model
    })
    try {
      for await (const chunk of this.streamInner(request, round)) {
        this.captureChunk(round, chunk)
        yield chunk
      }
    } finally {
      sink.finish(round)
    }
  }

  private captureChunk(round: LlmDebugRound, chunk: ModelStreamChunk): void {
    const out = round.output
    switch (chunk.kind) {
      case 'assistant_text_delta':
        out.text += chunk.text
        break
      case 'assistant_reasoning_delta':
        out.reasoning += chunk.text
        break
      case 'tool_call_complete':
        out.toolCalls.push({
          callId: chunk.callId,
          toolName: chunk.toolName,
          arguments: chunk.arguments
        })
        break
      case 'usage':
        out.usage = chunk.usage
        break
      case 'completed':
        out.stopReason = chunk.stopReason
        break
      case 'error':
        out.error = chunk.message
        break
    }
  }

  private async *streamInner(
    request: ModelRequest,
    round: LlmDebugRound | null
  ): AsyncIterable<ModelStreamChunk> {
    if (request.abortSignal.aborted) {
      yield { kind: 'error', message: 'request was aborted before start' }
      return
    }
    const requestModel = request.model?.trim() || this.config.model
    // Resolve the wire format per request model: a single provider (e.g.
    // OpenCode Go) can route some models to chat completions and others to
    // Anthropic Messages. Falls back to the provider/runtime format.
    const configuredEndpointFormat = this.endpointFormatForModel(requestModel)
    const endpointFormat = resolveModelEndpointFormat(configuredEndpointFormat, this.config.baseUrl)
    if (!endpointFormat) {
      yield {
        kind: 'error',
        message: 'custom full endpoint URL must end with /chat/completions, /completions, /responses, or /messages'
      }
      return
    }
    const url = buildModelEndpointUrl(this.config.baseUrl, configuredEndpointFormat)
    const stream = request.stream ?? !this.config.nonStreaming
    const body = this.buildRequestBody(request, stream, { endpointFormat })
    if (round) {
      round.requestBody = body
      round.url = redactUrlForLog(url)
    }
    const headers = this.buildHeaders(
      stream,
      endpointFormat,
      this.config.baseUrl.includes('chatgpt.com/backend-api/codex') &&
        this.capabilitiesForModel(requestModel).responsesMode === 'lite'
    )
    const retry = normalizeModelRequestRetryConfig(this.config.retry)
    const modelStreamLimits = normalizeModelStreamLimits(this.config.streamLimits)
    const maxErrorBodyBytes = Math.min(modelStreamLimits.maxTotalBytes, 1 * 1024 * 1024)
    const retryStatuses = new Set(retry.httpStatusCodes)
    let result = await this.postChatCompletion(url, headers, body, request.abortSignal)
    for (let attempt = 0; attempt < retry.maxAttempts; attempt += 1) {
      if (result.kind === 'error') break
      if (result.response.ok || !retryStatuses.has(result.response.status)) break
      const delayMs = retryDelayMs(result.response, retry.initialDelayMs, attempt)
      const status = result.response.status
      await result.response.body?.cancel().catch(() => {})
      yield {
        kind: 'retrying',
        status,
        attempt: attempt + 1,
        maxAttempts: retry.maxAttempts,
        delayMs
      }
      const aborted = await sleepWithAbort(delayMs, request.abortSignal)
      if (aborted || request.abortSignal.aborted) {
        yield { kind: 'error', message: 'request was aborted during retry backoff' }
        return
      }
      result = await this.postChatCompletion(url, headers, body, request.abortSignal)
    }
    if (result.kind === 'error') {
      yield { kind: 'error', message: result.message }
      return
    }
    let response = result.response
    if (!response.ok) {
      const errorBody = await readLimitedResponseText(response, maxErrorBodyBytes)
      if (errorBody.exceeded) {
        yield {
          kind: 'error',
          message: `model error response exceeded ${maxErrorBodyBytes} bytes`,
          code: 'response_body_too_large'
        }
        return
      }
      const text = errorBody.text
      if (usesChatCompletionsShape(endpointFormat) && shouldRetryWithoutStreamUsage(response.status, text, body)) {
        const retryBody = this.buildRequestBody(request, stream, { endpointFormat, includeStreamUsage: false })
        if (round) round.requestBody = retryBody
        const retry = await this.postChatCompletion(url, headers, retryBody, request.abortSignal)
        if (retry.kind === 'error') {
          yield { kind: 'error', message: retry.message }
          return
        }
        response = retry.response
        if (response.ok) {
          if (this.config.nonStreaming || response.headers.get('content-type')?.includes('application/json')) {
            const json = await readLimitedResponseJson(response, modelStreamLimits.maxTotalBytes)
            if (json.kind === 'limit') {
              yield {
                kind: 'error',
                message: `model response exceeded ${json.maxBytes} bytes`,
                code: 'stream_resource_limit'
              }
              return
            }
            if (json.kind === 'invalid_json') {
              yield { kind: 'error', message: `model response contained invalid JSON: ${json.message}` }
              return
            }
            yield* this.materializeNonStreaming(
              json.value as ChatCompletionResponse,
              endpointFormat,
              requestModel,
              modelStreamLimits
            )
            return
          }
          if (!response.body) {
            yield { kind: 'error', message: 'model response had no body' }
            return
          }
          yield* this.streamSse(response.body, request.abortSignal, endpointFormat, requestModel)
          return
        }
        const retryErrorBody = await readLimitedResponseText(response, maxErrorBodyBytes)
        if (retryErrorBody.exceeded) {
          yield {
            kind: 'error',
            message: `model error response exceeded ${maxErrorBodyBytes} bytes`,
            code: 'response_body_too_large'
          }
          return
        }
        const retryText = retryErrorBody.text
        this.logHttpFailure({
          url,
          status: response.status,
          body: retryText,
          endpointFormat,
          configuredEndpointFormat,
          model: requestModel
        })
        const retryClassified = await this.classifyHttpError(response.status, retryText)
        yield {
          kind: 'error',
          message: retryClassified.message,
          code: retryClassified.code
        }
        return
      }
      this.logHttpFailure({
        url,
        status: response.status,
        body: text,
        endpointFormat,
        configuredEndpointFormat,
        model: requestModel
      })
      const classified = await this.classifyHttpError(response.status, text)
      yield {
        kind: 'error',
        message: classified.message,
        code: classified.code
      }
      return
    }
    if (this.config.nonStreaming || response.headers.get('content-type')?.includes('application/json')) {
      const json = await readLimitedResponseJson(response, modelStreamLimits.maxTotalBytes)
      if (json.kind === 'limit') {
        yield {
          kind: 'error',
          message: `model response exceeded ${json.maxBytes} bytes`,
          code: 'stream_resource_limit'
        }
        return
      }
      if (json.kind === 'invalid_json') {
        yield { kind: 'error', message: `model response contained invalid JSON: ${json.message}` }
        return
      }
      yield* this.materializeNonStreaming(
        json.value as ChatCompletionResponse,
        endpointFormat,
        requestModel,
        modelStreamLimits
      )
      return
    }
    if (!response.body) {
      yield { kind: 'error', message: 'model response had no body' }
      return
    }
    yield* this.streamSse(response.body, request.abortSignal, endpointFormat, requestModel)
  }

  private endpointFormat(): ModelEndpointFormat {
    return normalizeModelEndpointFormat(this.config.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT)
  }

  /**
   * The wire format for a specific model: a per-model override (carried on
   * the model's capability metadata) takes precedence over the
   * provider/runtime format. Lets one provider mix chat completions and
   * Anthropic Messages models (e.g. OpenCode Go's minimax/qwen entries).
   */
  private endpointFormatForModel(model: string): ModelEndpointFormat {
    return this.capabilitiesForModel(model).endpointFormat
  }

  private modelReasoningFor(model: string): ModelCapabilityMetadata['reasoning'] | undefined {
    return this.capabilitiesForModel(model).reasoning
  }

  /** Per-model output-token cap from capability metadata, if declared. */
  private maxOutputTokensFor(model: string): number | undefined {
    return this.capabilitiesForModel(model).maxOutputTokens
  }

  private capabilitiesForModel(model: string) {
    return resolveCompatModelCapabilities({
      model,
      providerEndpointFormat: this.config.endpointFormat,
      modelCapabilities: this.config.modelCapabilities
    })
  }

  /**
   * Resolves the output-token cap for a request: an explicit request value
   * wins, then the per-model capability override, then the supplied default.
   */
  private resolveMaxTokens(
    request: ModelRequest,
    model: string,
    fallback?: number
  ): number | undefined {
    return request.maxTokens ?? this.maxOutputTokensFor(model) ?? fallback
  }

  private async postChatCompletion(
    url: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<{ kind: 'response'; response: Response } | { kind: 'error'; message: string }> {
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal
      })
      return { kind: 'response', response }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Only blame the proxy for genuine transport failures. A user-initiated
      // abort (turn cancelled, idle-timeout watchdog) also surfaces here as an
      // AbortError but has nothing to do with the proxy — don't send the user
      // chasing a proxy that is working fine.
      const aborted = error instanceof Error && error.name === 'AbortError'
      const proxyHint = !aborted && this.config.modelProxyUrl?.trim()
        ? '. Check the configured model-request proxy in Settings > Providers.'
        : ''
      return { kind: 'error', message: `model request failed: ${message}${proxyHint}` }
    }
  }

  private buildHeaders(
    stream: boolean,
    endpointFormat: ModelEndpointFormat,
    responsesLite = false
  ): Record<string, string> {
    return buildCompatRequestHeaders({
      apiKey: this.config.apiKey,
      configuredHeaders: this.config.headers,
      stream,
      endpointFormat,
      responsesLite
    })
  }

  private async classifyHttpError(status: number, text: string): Promise<{ message: string; code: string }> {
    return classifyCompatHttpError({
      status,
      text,
      baseUrl: this.config.baseUrl,
      fetchImpl: this.fetchImpl
    })
  }

  private logHttpFailure(input: {
    url: string
    status: number
    body: string
    endpointFormat: ModelEndpointFormat
    configuredEndpointFormat: ModelEndpointFormat
    model: string
  }): void {
    console.warn('[kun:model] model HTTP request failed', compatHttpFailureLog({
      provider: this.provider,
      status: input.status,
      model: input.model,
      configuredModel: this.config.model,
      baseUrl: this.config.baseUrl,
      requestUrl: input.url,
      endpointFormat: input.endpointFormat,
      configuredEndpointFormat: input.configuredEndpointFormat,
      body: input.body
    }))
  }

  private buildRequestBody(
    request: ModelRequest,
    stream: boolean,
    options: { endpointFormat?: ModelEndpointFormat; includeStreamUsage?: boolean } = {}
  ): Record<string, unknown> {
    const requestModel = request.model?.trim()
    const model = requestModel || this.config.model
    const messages = this.collectMessages(request, model)
    const endpointFormat = options.endpointFormat ?? this.endpointFormat()
    const tools = normalizeToolSpecs(request.tools)
    const reasoning = this.modelReasoningFor(model)
    const isCodex = this.config.baseUrl.includes('chatgpt.com/backend-api/codex')
    const isCodexLite = isCodex && this.capabilitiesForModel(model).responsesMode === 'lite'
    const codecs = new CompatRequestCodecs({
      splitOpenAiMessages: (value) => splitToolImageMessagesForOpenAi(value as ChatMessage[]) as CompatChatMessage[],
      responsesInput: (value) => messagesToResponsesInput(value as ChatMessage[]),
      toAnthropic: (value, thinkingMode) => messagesToAnthropic(value as ChatMessage[], thinkingMode),
      applyAnthropicCacheControl: (value) => applyAnthropicCacheControl(value as AnthropicMessage[]),
      plainText: (value) => chatContentToPlainText(value as ChatMessage['content']),
      applyChatReasoning: (body, effort, input) => applyReasoningEffort(body, effort, {
        ...input,
        maxReasoningEffort: input.nativeDeepSeekHost ? 'max' : 'high'
      }),
      responsesReasoning: (effort, capability, codecOptions) =>
        responsesReasoningForEffort(effort, capability, codecOptions),
      applyAnthropicReasoning: (body, effort, capability) =>
        applyAnthropicReasoningEffort(body, effort, capability),
      resolveReasoning: (effort, capability) => resolveReasoningEffort(effort, capability)
    })
    return codecs.build({
      request,
      model,
      messages,
      tools,
      stream,
      endpointFormat,
      includeStreamUsage: options.includeStreamUsage,
      baseUrl: this.config.baseUrl,
      reasoning,
      maxTokens: this.resolveMaxTokens(request, model),
      isCodex,
      isCodexLite,
      codexNativeImageGeneration: codexModelSupportsNativeImageGeneration(model)
    })
  }

  private collectMessages(request: ModelRequest, model: string): ChatMessage[] {
    return projectCompatMessages(request, {
      historyLimit: this.config.historyLimit,
      thinkingMode: requiresReasoningRoundTrip(
        request.reasoningEffort,
        model,
        this.config.baseUrl,
        this.modelReasoningFor(model)
      ),
      supportsImages: this.modelSupportsImageInput(model)
    })
  }

  /**
   * Whether the resolved model accepts image input. Tool-result images are
   * only forwarded as real image parts to vision models; text-only models
   * get a text summary instead. Defaults to true when no capability
   * resolver is configured (the runtime always sets one).
   */
  private modelSupportsImageInput(model: string): boolean {
    if (!this.config.modelCapabilities) return true
    return this.capabilitiesForModel(model).supportsVision
  }

  private async *streamSse(
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
    endpointFormat: ModelEndpointFormat,
    model: string
  ): AsyncIterable<ModelStreamChunk> {
    const decoder = new TextDecoder('utf-8')
    const reader = body.getReader()
    let buffer = ''
    const pendingArguments = new Map<string, PendingToolCall>()
    const pendingByIndex = new Map<number, string>()
    const completedToolCalls = new Set<string>()
    let usage: UsageSnapshot | null = null
    // The Responses protocol may repeat final output in response.completed;
    // a boolean is sufficient to suppress that duplicate. Retaining the full
    // streamed text/reasoning here used quadratic concatenation and a second
    // unbounded copy of an already-emitted response.
    let sawTextDelta = false
    let stopReason: ModelStopReason = 'stop'
    let finishReason: string | null = null
    let sawDone = false
    let readerFinished = false
    let bufferBytes = 0
    const idleTimeoutMs = normalizeStreamIdleTimeoutMs(this.config.streamIdleTimeoutMs)
    const limits = normalizeModelStreamLimits(this.config.streamLimits)
    const budget = new ModelStreamResourceBudget(limits)
    const cancelReader = (reason: string): void => {
      // Never await cancellation here: a broken/custom ReadableStream can
      // make its cancel promise hang, defeating the very timeout/limit that
      // is trying to stop it.
      void reader.cancel(reason).catch(() => {})
    }
    try {
      while (!signal.aborted) {
        const read = await readStreamChunk(reader, signal, idleTimeoutMs)
        if (read.kind === 'timeout') {
          yield {
            kind: 'error',
            message: `model stream stalled for ${idleTimeoutMs}ms without data`,
            code: 'stream_idle_timeout'
          }
          return
        }
        if (read.kind === 'aborted') break
        if (read.kind === 'error') {
          yield { kind: 'error', message: read.message, code: 'stream_read_error' }
          return
        }
        const { value, done } = read
        if (done) {
          readerFinished = true
          break
        }
        if (!value) {
          readerFinished = true
          break
        }
        budget.addInboundBytes(value.byteLength)
        bufferBytes += value.byteLength
        if (bufferBytes > limits.maxBufferBytes) {
          throw new ModelStreamResourceLimitError(
            `model stream exceeded ${limits.maxBufferBytes} buffered SSE bytes`
          )
        }
        buffer += decoder.decode(value, { stream: true })
        let boundary: RegExpExecArray | null
        while ((boundary = /\r?\n\r?\n/.exec(buffer)) !== null) {
          const frame = buffer.slice(0, boundary.index)
          buffer = buffer.slice(boundary.index + boundary[0].length)
          const consumedBytes = Buffer.byteLength(frame, 'utf8') + Buffer.byteLength(boundary[0], 'utf8')
          bufferBytes = Math.max(0, bufferBytes - consumedBytes)
          budget.addFrame(Buffer.byteLength(frame, 'utf8'))
          const dataLines = frame
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
            .join('')
          if (!dataLines) continue
          if (dataLines === '[DONE]') {
            finishReason = finishReason ?? 'stop'
            sawDone = true
            break
          }
          let payload: unknown
          try {
            payload = JSON.parse(dataLines)
          } catch {
            yield { kind: 'error', message: 'model stream contained invalid SSE JSON', code: 'stream_invalid_frame' }
            return
          }
          const result = this.consumeStreamPayload(
            payload as Record<string, unknown>,
            pendingArguments,
            pendingByIndex,
            completedToolCalls,
            sawTextDelta,
            endpointFormat,
            model,
            budget
          )
          budget.addOutput(result.chunks)
          sawTextDelta = result.sawTextDelta
          if (result.usage) usage = mergeUsageSnapshots(usage, result.usage)
          if (result.finishReason) finishReason = result.finishReason
          for (const chunk of result.chunks) yield chunk
        }
        if (sawDone) break
      }
    } catch (error) {
      if (error instanceof ModelStreamResourceLimitError) {
        buffer = ''
        budget.clearPendingCalls(pendingArguments)
        pendingByIndex.clear()
        completedToolCalls.clear()
        cancelReader('model stream resource limit exceeded')
        yield { kind: 'error', message: error.message, code: 'stream_resource_limit' }
        return
      }
      throw error
    } finally {
      if (!readerFinished) cancelReader('model stream closed before body completion')
      try {
        reader.releaseLock()
      } catch {
        // The stream may already be released; ignore.
      }
    }
    if (signal.aborted) {
      yield { kind: 'error', message: 'request was aborted' }
      return
    }
    if (!sawDone && !finishReason) {
      yield {
        kind: 'error',
        message: 'model stream ended before a terminal frame',
        code: 'stream_truncated'
      }
      return
    }
    // Safety net: finalize any tool call whose arguments finished streaming but
    // was never emitted because the stream ended without a per-call "done"
    // signal. The chat_completions branch only finalizes on
    // `finish_reason === 'tool_calls'`, so a provider that ends with 'stop',
    // 'length', or a bare `[DONE]` while a tool call is still pending would
    // otherwise DROP the call silently. Truncated arguments surface here as
    // `{ __raw }` (a tool error the model can react to) instead of vanishing.
    let flushedPendingToolCall = false
    try {
      for (const [callId, pending] of pendingArguments) {
        if (!pending.name) continue
        if (completedToolCalls.has(callId)) continue
        const argumentsRaw = budget.pendingArguments(pending)
        budget.completeToolCall(argumentsRaw)
        flushedPendingToolCall = true
        completedToolCalls.add(callId)
        yield {
          kind: 'tool_call_complete',
          callId,
          toolName: pending.name,
          arguments: this.parseToolArguments(argumentsRaw || '{}')
        }
      }
    } catch (error) {
      if (error instanceof ModelStreamResourceLimitError) {
        yield { kind: 'error', message: error.message, code: 'stream_resource_limit' }
        return
      }
      throw error
    }
    budget.clearPendingCalls(pendingArguments)
    if (usage) yield { kind: 'usage', usage }
    stopReason = ((): ModelStopReason => {
      switch (finishReason) {
        case 'tool_calls':
          return 'tool_calls'
        case 'length':
          return 'length'
        case 'error':
          return 'error'
        default:
          // A recovered tool call means this was really a tool-call turn the
          // provider mislabeled (e.g. finish_reason 'stop' or bare `[DONE]`).
          return flushedPendingToolCall ? 'tool_calls' : 'stop'
      }
    })()
    yield { kind: 'completed', stopReason }
  }

  private consumeStreamPayload(
    payload: Record<string, unknown>,
    pendingArguments: Map<string, PendingToolCall>,
    pendingByIndex: Map<number, string>,
    completedToolCalls: Set<string>,
    sawTextDelta: boolean,
    endpointFormat: ModelEndpointFormat,
    model: string,
    budget: ModelStreamResourceBudget
  ): StreamPayloadResult {
    const payloadError = modelPayloadError(payload)
    if (payloadError) {
      return {
        chunks: [{
          kind: 'error',
          message: payloadError.message,
          ...(payloadError.code ? { code: payloadError.code } : {})
        }],
        sawTextDelta,
        finishReason: 'error',
        usage: null
      }
    }
    if (endpointFormat === 'responses') {
      return this.consumeResponsesStreamPayload(
        payload,
        pendingArguments,
        pendingByIndex,
        completedToolCalls,
        sawTextDelta,
        model,
        budget
      )
    }
    if (endpointFormat === 'messages') {
      return this.consumeAnthropicMessagesStreamPayload(
        payload,
        pendingArguments,
        pendingByIndex,
        completedToolCalls,
        sawTextDelta,
        model,
        budget
      )
    }
    return decodeChatCompletionsStreamPayload({
      payload,
      pendingArguments,
      pendingByIndex,
      sawTextDelta,
      budget,
      normalizeUsage: (usage) => this.mapUsage(usage, model),
      parseToolArguments: (raw) => this.parseToolArguments(raw)
    })
  }

  private consumeResponsesStreamPayload(
    payload: Record<string, unknown>,
    pendingArguments: Map<string, PendingToolCall>,
    pendingByIndex: Map<number, string>,
    completedToolCalls: Set<string>,
    sawTextDelta: boolean,
    model: string,
    budget: ModelStreamResourceBudget
  ): StreamPayloadResult {
    return decodeResponsesStreamPayload({
      payload,
      pendingArguments,
      pendingByIndex,
      completedToolCalls,
      sawTextDelta,
      budget,
      parseToolArguments: (raw) => this.parseToolArguments(raw),
      normalizeUsage: (usage) => this.mapUsage(usage, model)
    })
  }
  private consumeAnthropicMessagesStreamPayload(
    payload: Record<string, unknown>,
    pendingArguments: Map<string, PendingToolCall>,
    pendingByIndex: Map<number, string>,
    completedToolCalls: Set<string>,
    sawTextDelta: boolean,
    model: string,
    budget: ModelStreamResourceBudget
  ): StreamPayloadResult {
    return decodeAnthropicMessagesStreamPayload({
      payload,
      pendingArguments,
      pendingByIndex,
      completedToolCalls,
      sawTextDelta,
      budget,
      normalizeUsage: (usage) => this.mapUsage(usage, model),
      parseToolArguments: (raw) => this.parseToolArguments(raw)
    })
  }

  private *materializeNonStreaming(
    payload: ChatCompletionResponse,
    endpointFormat: ModelEndpointFormat,
    model: string,
    limits: ModelStreamLimits
  ): Generator<ModelStreamChunk> {
    yield* enforceNonStreamingLimits(
      decodeCompatNonStreamingResponse(
        payload as unknown as Record<string, unknown>,
        endpointFormat,
        {
          normalizeUsage: (usage) => this.mapUsage(usage, model),
          parseToolArguments: (raw) => this.parseToolArguments(raw),
          payloadError: modelPayloadError
        }
      ),
      limits
    )
  }

  private mapUsage(usage: Record<string, unknown>, model = this.config.model): UsageSnapshot {
    return normalizeCompatUsage({
      usage,
      model,
      providerBaseUrl: this.config.baseUrl
    })
  }

  private parseToolArguments(raw: string): Record<string, unknown> {
    return repairToolArguments(raw).arguments
  }
}

function normalizeToolSpecs(tools: ModelToolSpec[]): ModelToolSpec[] {
  return [...tools]
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: canonicalizeSchema(tool.inputSchema)
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function codexModelSupportsNativeImageGeneration(model: string): boolean {
  return CODEX_NATIVE_IMAGE_GENERATION_MODELS.has(normalizeModelId(model))
}

function messagesToResponsesInput(messages: ChatMessage[]): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = []
  for (const message of messages) {
    if (message.role === 'tool') {
      if (message.tool_call_id) {
        input.push({
          type: 'function_call_output',
          call_id: message.tool_call_id,
          output: chatContentToPlainText(message.content)
        })
      }
      continue
    }
    const content = chatContentToResponsesContent(message.content)
    if (content !== undefined && !(Array.isArray(content) && content.length === 0)) {
      input.push({
        role: message.role,
        content
      })
    }
    for (const call of message.tool_calls ?? []) {
      input.push({
        type: 'function_call',
        call_id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
        status: 'completed'
      })
    }
  }
  return input
}

function messagesToAnthropic(
  messages: ChatMessage[],
  includeThinkingBlocks = false
): { system: string; messages: AnthropicMessage[] } {
  const system: string[] = []
  const out: AnthropicMessage[] = []
  for (const message of messages) {
    if (message.role === 'system') {
      const text = chatContentToPlainText(message.content).trim()
      if (!text) continue
      // System messages that arrive after conversation turns are the
      // volatile per-turn context (goal budgets, memories, drift
      // warnings). Hoisting them into the top-level `system` block
      // would invalidate the provider's prompt cache for the whole
      // conversation on every counter tick, so they trail the history
      // inside a user turn instead — mirroring the chat_completions
      // ordering in collectMessages.
      if (out.length > 0) {
        appendTrailingInstruction(out, text)
        continue
      }
      system.push(text)
      continue
    }
    if (message.role === 'tool') {
      if (!message.tool_call_id) continue
      // Keep `tool_result` content as plain text. Anthropic's own API also
      // accepts an `image` block INSIDE tool_result (the computer-use beta
      // shape), but third-party Anthropic-compat providers (MiniMax, etc.)
      // often have not implemented that newer shape and return 502 / 4xx
      // when they see it. The image rides instead as a sibling `image`
      // block in the same user message — the older shape that every
      // compat layer accepts.
      const blocks: AnthropicContentBlock[] = [{
        type: 'tool_result',
        tool_use_id: message.tool_call_id,
        content: chatContentToTextOnly(message.content)
      }]
      if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type !== 'image_url') continue
          const image = anthropicImageSource(part.image_url.url)
          if (image) blocks.push({ type: 'image', source: image })
        }
      }
      // Parallel tool calls arrive as N consecutive `role: 'tool'` messages.
      // Anthropic requires every tool_use from a single assistant turn to be
      // answered by tool_result blocks inside ONE user message — emitting N
      // separate user messages trips "tool_use ids were found without
      // tool_result blocks immediately after" on compat providers. Real user
      // turns never carry a tool_result block, so its presence marks the run
      // we are still folding into.
      const last = out[out.length - 1]
      if (
        last &&
        last.role === 'user' &&
        Array.isArray(last.content) &&
        (last.content as AnthropicContentBlock[]).some((b) => b.type === 'tool_result')
      ) {
        last.content.push(...blocks)
      } else {
        out.push({ role: 'user', content: blocks })
      }
      continue
    }
    const content = chatContentToAnthropicContent(message.content)
    const blocks = Array.isArray(content)
      ? [...content]
      : content.trim()
        ? [{ type: 'text' as const, text: content }]
        : []
    if (includeThinkingBlocks && message.role === 'assistant') {
      const thinking = message.reasoning_content?.trim()
      if (thinking) blocks.unshift({ type: 'thinking', thinking })
    }
    for (const call of message.tool_calls ?? []) {
      blocks.push({
        type: 'tool_use',
        id: call.id,
        name: call.function.name,
        input: repairToolArguments(call.function.arguments).arguments
      })
    }
    if (blocks.length > 0) {
      out.push({ role: message.role, content: blocks })
      continue
    }
  }
  return { system: system.join('\n\n'), messages: out }
}

/**
 * Folds a trailing system instruction into the conversation as user
 * content. Appends to the final user message when one exists so the
 * request keeps strict user/assistant alternation.
 */
function appendTrailingInstruction(out: AnthropicMessage[], text: string): void {
  const block: AnthropicContentBlock = { type: 'text', text }
  const last = out[out.length - 1]
  if (last && last.role === 'user') {
    if (typeof last.content === 'string') {
      last.content = last.content.trim()
        ? [{ type: 'text', text: last.content }, block]
        : [block]
      return
    }
    last.content.push(block)
    return
  }
  out.push({ role: 'user', content: [block] })
}

/**
 * Marks the stable prefix for provider-side prompt caching. Anthropic
 * protocol caching is explicit: providers such as MiniMax only cache
 * content before `cache_control` breakpoints (up to 4 per request).
 * One breakpoint goes on the system block (which also covers the tool
 * definitions that precede it) and one on the final content block of
 * each of the last two messages, so consecutive agent steps re-hit the
 * prefix cached by the previous request.
 */
function applyAnthropicCacheControl(messages: AnthropicMessage[]): void {
  let breakpoints = 0
  for (let i = messages.length - 1; i >= 0 && breakpoints < 2; i -= 1) {
    const content = messages[i].content
    if (typeof content === 'string' || content.length === 0) continue
    content[content.length - 1].cache_control = { type: 'ephemeral' }
    breakpoints += 1
  }
}

function chatContentToResponsesContent(
  content: ChatMessage['content']
): string | Array<Record<string, unknown>> | undefined {
  if (content === null || content === undefined) return undefined
  if (typeof content === 'string') return content
  const parts: Array<Record<string, unknown>> = []
  for (const part of content) {
    if (part.type === 'text') {
      parts.push({ type: 'input_text', text: part.text })
    } else if (part.type === 'image_url') {
      parts.push({ type: 'input_image', image_url: part.image_url.url })
    }
  }
  return parts
}

/**
 * OpenAI chat-completions and Responses APIs do not accept image parts
 * inside a `tool`/`function_call_output` message. When a tool result
 * carries images, keep the tool message text-only and re-emit the
 * image(s) in a following synthetic user message so vision models still
 * see them. Anthropic Messages handles images inline and skips this.
 */
function splitToolImageMessagesForOpenAi(messages: ChatMessage[]): ChatMessage[] {
  const hasToolImages = messages.some(
    (message) =>
      message.role === 'tool' &&
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === 'image_url')
  )
  if (!hasToolImages) return messages
  const out: ChatMessage[] = []
  let pendingImages: ChatMessageContentPart[] = []
  const flushImages = (): void => {
    if (pendingImages.length === 0) return
    out.push({
      role: 'user',
      content: [
        { type: 'text', text: '(Automated) The tool call(s) above returned the following image(s):' },
        ...pendingImages
      ]
    })
    pendingImages = []
  }
  for (const message of messages) {
    if (message.role === 'tool' && Array.isArray(message.content)) {
      const textParts: string[] = []
      const imageParts: ChatMessageContentPart[] = []
      for (const part of message.content) {
        if (part.type === 'text') textParts.push(part.text)
        else imageParts.push(part)
      }
      out.push({
        ...message,
        content: textParts.join('\n') || '(image returned; see the following message)'
      })
      pendingImages.push(...imageParts)
      continue
    }
    // Flush queued images once the run of tool results ends, so they land
    // after the whole tool batch but before the next assistant turn.
    if (message.role !== 'tool') flushImages()
    out.push(message)
  }
  flushImages()
  return out
}

function chatContentToAnthropicContent(content: ChatMessage['content']): string | AnthropicContentBlock[] {
  if (content === null || content === undefined) return ''
  if (typeof content === 'string') return content
  const parts: AnthropicContentBlock[] = []
  for (const part of content) {
    if (part.type === 'text') {
      if (part.text) parts.push({ type: 'text', text: part.text })
      continue
    }
    const image = anthropicImageSource(part.image_url.url)
    if (image) parts.push({ type: 'image', source: image })
  }
  return parts
}

function anthropicImageSource(value: string): AnthropicImageSource | null {
  const data = parseDataUri(value)
  if (data) {
    return {
      type: 'base64',
      media_type: data.mimeType,
      data: data.base64
    }
  }
  if (/^https?:\/\//i.test(value)) {
    return { type: 'url', url: value }
  }
  return null
}

function parseDataUri(value: string): { mimeType: string; base64: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/is.exec(value)
  if (!match) return null
  return { mimeType: match[1], base64: match[2] }
}

function chatContentToPlainText(content: ChatMessage['content']): string {
  if (content === null || content === undefined) return ''
  if (typeof content === 'string') return content
  return content.map((part) => {
    if (part.type === 'text') return part.text
    return `[image: ${part.image_url.url}]`
  }).join('\n')
}

/**
 * Extract ONLY text parts from a chat-message content array — image parts
 * are dropped entirely (no `[image: data:...]` placeholder). Used when the
 * image rides separately (as a sibling block in the user message) so the
 * raw base64 does not leak back into the text channel.
 */
function chatContentToTextOnly(content: ChatMessage['content']): string {
  if (content === null || content === undefined) return ''
  if (typeof content === 'string') return content
  return content
    .filter((part): part is Extract<ChatMessageContentPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

type ModelReasoningCapability = NonNullable<ModelCapabilityMetadata['reasoning']>
type NormalizedReasoningEffort = ModelReasoningCapability['defaultEffort']

function responsesReasoningForEffort(
  effort: string | undefined,
  reasoning?: ModelReasoningCapability,
  options: {
    maxEffort?: 'high' | 'xhigh'
    includeSummary?: boolean
  } = {}
): Record<string, unknown> | null {
  if (reasoning && reasoning.requestProtocol !== 'openai-responses') return null
  const resolved = reasoning
    ? resolveReasoningEffort(effort, reasoning)
    : normalizeReasoningEffortValue(effort)
  if (resolved === 'auto' || resolved === 'off' || !resolved) return null
  const normalized = resolved
  const payload = (wireEffort: string): Record<string, unknown> => ({
    effort: wireEffort,
    ...(options.includeSummary ? { summary: 'auto' } : {})
  })
  switch (normalized) {
    case 'low':
      return payload('low')
    case 'medium':
      return payload('medium')
    case 'high':
      return payload('high')
    case 'max':
      return payload(options.maxEffort ?? 'high')
    default:
      return null
  }
}

function buildModelEndpointUrl(baseUrl: string, endpointFormat: ModelEndpointFormat): string {
  if (isCustomModelEndpointFormat(endpointFormat)) return exactModelEndpointUrl(baseUrl)
  const path = modelEndpointPath(endpointFormat)
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (!normalized) return `/v1/${path}`
  const lastSegment = normalized.split('/').pop()?.toLowerCase() ?? ''
  if (lastSegment === 'beta') {
    return `${normalized.slice(0, -'/beta'.length)}/v1/${path}`
  }
  if (/^v\d+$/.test(lastSegment)) {
    return `${normalized}/${path}`
  }
  return `${normalized}/v1/${path}`
}

function exactModelEndpointUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  const query = trimmed.search(/[?#]/)
  if (query < 0) return trimmed.replace(/\/+$/, '')
  return `${trimmed.slice(0, query).replace(/\/+$/, '')}${trimmed.slice(query)}`
}


function buildChatCompletionsUrl(baseUrl: string): string {
  return buildModelEndpointUrl(baseUrl, 'chat_completions')
}

function modelPayloadError(payload: Record<string, unknown>): { message: string; code?: string } | null {
  const rawError = payload.error
  if (typeof rawError === 'string' && rawError.trim()) {
    return { message: rawError.trim() }
  }
  const directError = modelErrorObject(recordValue(payload, 'error'))
  if (directError) return directError
  const responseError = modelErrorObject(recordValue(recordValue(payload, 'response'), 'error'))
  if (responseError) return responseError
  const baseResp = recordValue(payload, 'base_resp') ?? recordValue(payload, 'baseResp')
  if (baseResp) {
    const code = errorCodeString(
      baseResp.status_code ?? baseResp.status ?? baseResp.code ?? baseResp.err_code
    )
    if (code && !successErrorCode(code)) {
      return {
        message:
          recordString(baseResp, 'status_msg') ||
          recordString(baseResp, 'message') ||
          recordString(baseResp, 'msg') ||
          `model provider error (${code})`,
        code
      }
    }
  }
  const topLevelCode = errorCodeString(payload.code ?? payload.type ?? payload.status_code ?? payload.err_code)
  const topLevelMessage =
    recordString(payload, 'message') ||
    recordString(payload, 'error_msg') ||
    recordString(payload, 'status_msg')
  if (topLevelCode && topLevelMessage && !successErrorCode(topLevelCode)) {
    return { message: topLevelMessage, code: topLevelCode }
  }
  return null
}

function modelErrorObject(error: Record<string, unknown> | null): { message: string; code?: string } | null {
  if (!error) return null
  const message =
    recordString(error, 'message') ||
    recordString(error, 'msg') ||
    recordString(error, 'status_msg') ||
    recordString(error, 'error_msg')
  const code = errorCodeString(error.code ?? error.type ?? error.status ?? error.status_code ?? error.err_code)
  if (message) return { message, ...(code ? { code } : {}) }
  if (code && !successErrorCode(code)) return { message: `model provider error (${code})`, code }
  return null
}

function errorCodeString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function successErrorCode(code: string): boolean {
  const normalized = code.trim().toLowerCase()
  return normalized === '0' || normalized === 'ok' || normalized === 'success'
}

function recordValue(value: unknown, key?: string): Record<string, unknown> | null {
  const target = key === undefined
    ? value
    : value && typeof value === 'object'
      ? (value as Record<string, unknown>)[key]
      : null
  return target && typeof target === 'object' && !Array.isArray(target)
    ? target as Record<string, unknown>
    : null
}

function recordString(value: unknown, key: string): string {
  const target = value && typeof value === 'object'
    ? (value as Record<string, unknown>)[key]
    : undefined
  return typeof target === 'string' ? target : ''
}

function mergeUsageSnapshots(current: UsageSnapshot | null, next: UsageSnapshot): UsageSnapshot {
  if (!current) return next
  const promptTokens = next.promptTokens || current.promptTokens
  const completionTokens = Math.max(next.completionTokens, current.completionTokens)
  const totalTokens = next.totalTokens > 0 && next.promptTokens > 0
    ? next.totalTokens
    : promptTokens + completionTokens
  return {
    ...current,
    ...next,
    promptTokens,
    completionTokens,
    totalTokens,
    cachedTokens: Math.max(current.cachedTokens ?? 0, next.cachedTokens ?? 0),
    cacheHitTokens: Math.max(current.cacheHitTokens ?? 0, next.cacheHitTokens ?? 0),
    cacheMissTokens: Math.max(current.cacheMissTokens ?? 0, next.cacheMissTokens ?? 0),
    cacheHitRate: next.cacheHitRate ?? current.cacheHitRate,
    costUsd: next.costUsd ?? current.costUsd,
    costCny: next.costCny ?? current.costCny
  }
}

function applyReasoningEffort(
  body: Record<string, unknown>,
  effort: string | undefined,
  options: {
    includeThinking?: boolean
    nativeDeepSeekHost?: boolean
    reasoning?: ModelReasoningCapability
    maxReasoningEffort?: 'high' | 'max'
  } = {}
): void {
  const normalized = options.reasoning
    ? resolveReasoningEffort(effort, options.reasoning)
    : normalizeReasoningEffortValue(effort)
  if (!normalized) return
  const includeThinking = options.includeThinking !== false
  // thinking field in DeepSeek format is only supported on the official DeepSeek API.
  // Third-party OpenAI-compat proxies (SiliconFlow, OpenRouter, llama.cpp, etc.) may
  // reject or mishandle it, causing 400 errors or empty responses. See issue #26.
  const nativeDeepSeek = options.nativeDeepSeekHost === true
  if (options.reasoning) {
    applyProfileReasoningEffort(body, normalized, options.reasoning, includeThinking, nativeDeepSeek)
    return
  }
  switch (normalized) {
    case 'off':
      if (includeThinking) body.thinking = { type: 'disabled' }
      break
    case 'low':
    case 'medium':
    case 'high':
      body.reasoning_effort = 'high'
      if (nativeDeepSeek) body.thinking = { type: 'enabled' }
      break
    case 'max':
      body.reasoning_effort = options.maxReasoningEffort ?? 'max'
      if (nativeDeepSeek) body.thinking = { type: 'enabled' }
      break
  }
}

function applyProfileReasoningEffort(
  body: Record<string, unknown>,
  effort: NormalizedReasoningEffort,
  reasoning: ModelReasoningCapability,
  includeThinking: boolean,
  nativeDeepSeekHost: boolean
): void {
  switch (reasoning.requestProtocol) {
    case 'none':
    case 'openai-responses':
    case 'anthropic-thinking':
      return
    case 'deepseek-chat-completions':
      applyDeepSeekChatReasoningEffort(body, effort, nativeDeepSeekHost)
      return
    case 'glm-chat-completions':
      applyGlmChatReasoningEffort(body, effort, includeThinking)
      return
    case 'mimo-chat-completions':
      applyMimoChatReasoningEffort(body, effort, includeThinking)
      return
  }
}

function applyDeepSeekChatReasoningEffort(
  body: Record<string, unknown>,
  effort: NormalizedReasoningEffort,
  includeThinking: boolean
): void {
  if (effort === 'off') {
    if (includeThinking) body.thinking = { type: 'disabled' }
    return
  }
  if (effort === 'max') {
    body.reasoning_effort = 'max'
  } else if (effort !== 'auto') {
    body.reasoning_effort = 'high'
  }
  if (includeThinking && effort !== 'auto') body.thinking = { type: 'enabled' }
}

function applyGlmChatReasoningEffort(
  body: Record<string, unknown>,
  effort: NormalizedReasoningEffort,
  includeThinking: boolean
): void {
  if (!includeThinking || effort === 'auto') return
  body.thinking = {
    type: effort === 'off' ? 'disabled' : 'enabled',
    clear_thinking: true
  }
}

function applyMimoChatReasoningEffort(
  body: Record<string, unknown>,
  effort: NormalizedReasoningEffort,
  includeThinking: boolean
): void {
  if (effort === 'off') {
    if (includeThinking) body.thinking = { type: 'disabled' }
    return
  }
  if (effort === 'low' || effort === 'medium' || effort === 'high') {
    body.reasoning_effort = effort
    if (includeThinking) body.thinking = { type: 'enabled' }
  }
}

function applyAnthropicReasoningEffort(
  body: Record<string, unknown>,
  effort: string | undefined,
  reasoning?: ModelReasoningCapability
): void {
  if (reasoning?.requestProtocol !== 'anthropic-thinking') return
  const resolved = resolveReasoningEffort(effort, reasoning)
  if (!resolved) return
  if (resolved === 'off') {
    body.thinking = { type: 'disabled' }
    return
  }
  body.thinking = { type: 'adaptive' }
  const outputEffort = anthropicOutputEffortForReasoningEffort(resolved)
  if (outputEffort) body.output_config = { effort: outputEffort }
}

function anthropicOutputEffortForReasoningEffort(
  effort: NormalizedReasoningEffort
): 'low' | 'medium' | 'high' | 'max' | null {
  switch (effort) {
    case 'low':
    case 'medium':
    case 'high':
    case 'max':
      return effort
    case 'auto':
    case 'off':
      return null
  }
}

function resolveReasoningEffort(
  effort: string | undefined,
  reasoning: ModelReasoningCapability
): NormalizedReasoningEffort | undefined {
  const normalized = normalizeReasoningEffortValue(effort)
  if (!normalized) return undefined
  if (reasoning.supportedEfforts.includes(normalized)) return normalized
  if (
    normalized === 'low' &&
    reasoning.supportedEfforts.includes('off') &&
    !reasoning.supportedEfforts.includes('low')
  ) {
    return 'off'
  }
  return reasoning.defaultEffort
}

function normalizeReasoningEffortValue(effort: string | undefined): NormalizedReasoningEffort | undefined {
  switch (effort?.trim().toLowerCase()) {
    case 'auto':
    case 'adaptive':
      return 'auto'
    case 'off':
    case 'disabled':
    case 'none':
    case 'false':
      return 'off'
    case 'low':
    case 'minimal':
      return 'low'
    case 'medium':
    case 'mid':
      return 'medium'
    case 'high':
      return 'high'
    case 'max':
    case 'maximum':
    case 'xhigh':
      return 'max'
    default:
      return undefined
  }
}


function shouldRetryWithoutStreamUsage(
  status: number,
  text: string,
  body: Record<string, unknown>
): boolean {
  if (status !== 400 && status !== 422) return false
  if (!Object.prototype.hasOwnProperty.call(body, 'stream_options')) return false
  return /\b(stream_options|include_usage)\b/i.test(text)
}

function isAzureOpenAiEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    const host = url.hostname.toLowerCase()
    return host.endsWith('.openai.azure.com') || host.endsWith('.cognitiveservices.azure.com')
  } catch {
    return /\.openai\.azure\.com\b|\.cognitiveservices\.azure\.com\b/i.test(baseUrl)
  }
}

function isThinkingMode(effort: string | undefined): boolean {
  const normalized = effort?.trim().toLowerCase()
  if (!normalized) return false
  return !['off', 'disabled', 'none', 'false'].includes(normalized)
}

function requiresReasoningRoundTrip(
  effort: string | undefined,
  model: string | undefined,
  baseUrl: string,
  reasoning?: ModelReasoningCapability
): boolean {
  if (reasoning) {
    const resolved = resolveReasoningEffort(effort, reasoning)
    if (resolved) {
      return resolved !== 'off' && reasoning.requestProtocol !== 'none'
    }
    return isDeepSeekHost(baseUrl) && isThinkingProducerModel(model)
  }
  // Thinking-mode round trip is a DeepSeek-specific protocol extension.
  // OpenAI-compat providers (OpenRouter, llama.cpp, etc.) may reject
  // or misinterpret the `thinking` field, so we only auto-enable it
  // on the official DeepSeek host. User-selected reasoningEffort still
  // forces the path (opt-in). See issue #26.
  return isThinkingMode(effort) || (isDeepSeekHost(baseUrl) && isThinkingProducerModel(model))
}

function isThinkingProducerModel(model: string | undefined): boolean {
  const normalized = normalizeModelId(model)
  if (!normalized) return false
  return normalized === 'deepseek-v4-pro' ||
    normalized === 'deepseek-v4-flash' ||
    normalized.includes('deepseek-reasoner') ||
    normalized.endsWith('/deepseek-v4-pro') ||
    normalized.endsWith('/deepseek-v4-flash')
}

function reasoningFromMessage(message: ChatCompletionResponse['choices'][number]['message'] | undefined): string {
  if (!message) return ''
  const value = message.reasoning_content ??
    (message as ChatMessage & { reasoning?: unknown }).reasoning
  return typeof value === 'string' ? value : ''
}

function canonicalizeSchema(value: unknown): Record<string, unknown> {
  const canonical = canonicalize(value)
  return canonical && typeof canonical === 'object' && !Array.isArray(canonical)
    ? canonical as Record<string, unknown>
    : {}
}

function normalizeModelId(model: string | undefined): string {
  return model?.trim().toLowerCase() ?? ''
}

function normalizeStreamIdleTimeoutMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_STREAM_IDLE_TIMEOUT_MS
  if (!Number.isFinite(value)) return DEFAULT_STREAM_IDLE_TIMEOUT_MS
  return Math.max(0, Math.floor(value))
}

function normalizeModelStreamLimits(input: Partial<ModelStreamLimits> | undefined): ModelStreamLimits {
  const normalize = (value: number | undefined, fallback: number): number => {
    if (value === undefined || !Number.isFinite(value)) return fallback
    return Math.max(1, Math.floor(value))
  }
  return {
    maxBufferBytes: normalize(input?.maxBufferBytes, DEFAULT_MODEL_STREAM_LIMITS.maxBufferBytes),
    maxFrameBytes: normalize(input?.maxFrameBytes, DEFAULT_MODEL_STREAM_LIMITS.maxFrameBytes),
    maxTotalBytes: normalize(input?.maxTotalBytes, DEFAULT_MODEL_STREAM_LIMITS.maxTotalBytes),
    maxFrames: normalize(input?.maxFrames, DEFAULT_MODEL_STREAM_LIMITS.maxFrames),
    maxOutputBytes: normalize(input?.maxOutputBytes, DEFAULT_MODEL_STREAM_LIMITS.maxOutputBytes),
    maxPendingToolCalls: normalize(input?.maxPendingToolCalls, DEFAULT_MODEL_STREAM_LIMITS.maxPendingToolCalls),
    maxPendingToolArgumentBytes: normalize(
      input?.maxPendingToolArgumentBytes,
      DEFAULT_MODEL_STREAM_LIMITS.maxPendingToolArgumentBytes
    ),
    maxTotalPendingToolArgumentBytes: normalize(
      input?.maxTotalPendingToolArgumentBytes,
      DEFAULT_MODEL_STREAM_LIMITS.maxTotalPendingToolArgumentBytes
    ),
    maxToolArgumentFragments: normalize(
      input?.maxToolArgumentFragments,
      DEFAULT_MODEL_STREAM_LIMITS.maxToolArgumentFragments
    ),
    maxTotalToolArgumentFragments: normalize(
      input?.maxTotalToolArgumentFragments,
      DEFAULT_MODEL_STREAM_LIMITS.maxTotalToolArgumentFragments
    ),
    maxCompletedToolCalls: normalize(input?.maxCompletedToolCalls, DEFAULT_MODEL_STREAM_LIMITS.maxCompletedToolCalls),
    maxCompletedToolArgumentBytes: normalize(
      input?.maxCompletedToolArgumentBytes,
      DEFAULT_MODEL_STREAM_LIMITS.maxCompletedToolArgumentBytes
    )
  }
}

type LimitedResponseJson =
  | { kind: 'ok'; value: unknown }
  | { kind: 'limit'; maxBytes: number }
  | { kind: 'invalid_json'; message: string }

/** Read an HTTP body without delegating an unbounded response to Response.text/json. */
async function readLimitedResponseText(response: Response, maxBytes: number): Promise<{ text: string; exceeded: boolean }> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    void response.body?.cancel('model response body limit exceeded').catch(() => {})
    return { text: '', exceeded: true }
  }
  if (!response.body) return { text: '', exceeded: false }
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  const parts: string[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (!value) continue
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        void reader.cancel('model response body limit exceeded').catch(() => {})
        return { text: parts.join(''), exceeded: true }
      }
      const text = decoder.decode(value, { stream: true })
      if (text) parts.push(text)
    }
    const tail = decoder.decode()
    if (tail) parts.push(tail)
    return { text: parts.join(''), exceeded: false }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // Best effort; cancellation or a completed reader may already release it.
    }
  }
}

async function readLimitedResponseJson(response: Response, maxBytes: number): Promise<LimitedResponseJson> {
  const body = await readLimitedResponseText(response, maxBytes)
  if (body.exceeded) return { kind: 'limit', maxBytes }
  try {
    return { kind: 'ok', value: JSON.parse(body.text) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { kind: 'invalid_json', message }
  }
}

function* enforceNonStreamingLimits(
  chunks: Iterable<ModelStreamChunk>,
  limits: ModelStreamLimits
): Generator<ModelStreamChunk> {
  const budget = new ModelStreamResourceBudget(limits)
  try {
    for (const chunk of chunks) {
      if (chunk.kind === 'tool_call_complete') {
        budget.completeToolCall(JSON.stringify(chunk.arguments) ?? '{}')
      }
      budget.addOutput([chunk])
      yield chunk
    }
  } catch (error) {
    if (error instanceof ModelStreamResourceLimitError) {
      yield { kind: 'error', message: error.message, code: 'stream_resource_limit' }
      return
    }
    throw error
  }
}

async function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
  idleTimeoutMs: number
): Promise<StreamReadResult> {
  if (signal.aborted) return { kind: 'aborted' }
  let timeout: ReturnType<typeof setTimeout> | undefined
  let cleanupAbort: (() => void) | undefined
  const readPromise = reader.read()
    .then((result): StreamReadResult => ({ kind: 'chunk', ...result }))
    .catch((error): StreamReadResult => {
      if (signal.aborted) return { kind: 'aborted' }
      const message = error instanceof Error ? error.message : String(error)
      return { kind: 'error', message: `model stream read failed: ${message}` }
    })
  const abortPromise = new Promise<StreamReadResult>((resolve) => {
    const onAbort = (): void => resolve({ kind: 'aborted' })
    if (signal.aborted) {
      resolve({ kind: 'aborted' })
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    cleanupAbort = () => signal.removeEventListener('abort', onAbort)
  })
  const candidates: Array<Promise<StreamReadResult>> = [readPromise, abortPromise]
  if (idleTimeoutMs > 0) {
    candidates.push(new Promise<StreamReadResult>((resolve) => {
      timeout = setTimeout(() => resolve({ kind: 'timeout' }), idleTimeoutMs)
    }))
  }
  const result = await Promise.race(candidates)
  if (timeout) clearTimeout(timeout)
  cleanupAbort?.()
  if (result.kind === 'timeout') {
    // A custom stream may never resolve `cancel()`. Fire-and-forget it so an
    // idle timeout remains a real deadline rather than another await point.
    void reader.cancel('model stream idle timeout').catch(() => {})
  }
  return result
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = canonicalize((value as Record<string, unknown>)[key])
  }
  return out
}
