import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import CredentialProvider from '@deepseek-ai/dsh-credentials'
import type { CredentialInfo, CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { FinishReason, GenerateOptions, Message, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { ConfigShape } from '../src/config.js'
import type { ProviderApi } from '../src/config.js'

export const TEST_CREDENTIAL_REF = 'ROUTIFY_TEST_KEY'

/** In-memory credential seam used to prove request-time resolution. */
export class MemoryCredentials extends CredentialProvider {
  constructor(ctx: Context, private readonly values: Record<string, string> = {}) {
    super(ctx)
  }

  override resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = this.values[ref]
    return Promise.resolve(value === undefined || value.length === 0
      ? undefined
      : { value, source: 'memory' })
  }

  override describe(ref: CredentialRef): Promise<CredentialInfo> {
    const configured = (this.values[ref]?.length ?? 0) > 0
    return Promise.resolve({ configured, ...configured ? { source: 'memory' } : {}, writable: true })
  }

  override set(ref: CredentialRef, value: string): Promise<void> {
    if (value.length === 0) return Promise.reject(new Error('empty credential'))
    this.values[ref] = value
    this.notifyUpdated(ref)
    return Promise.resolve()
  }

  override unset(ref: CredentialRef): Promise<void> {
    delete this.values[ref]
    this.notifyUpdated(ref)
    return Promise.resolve()
  }
}

/** Complete private-DeepSeek route used by unit and stream tests. */
export function routeConfig(baseURL: string, api: ProviderApi = 'openai-completions'): ConfigShape {
  return {
    providers: {
      routify: {
        displayName: 'Routify',
        apiKeyEnv: TEST_CREDENTIAL_REF,
        api,
        baseURL,
        ...(api === 'openai-completions' ? { compat: {
          supportsStore: false,
          supportsDeveloperRole: false,
          thinkingFormat: 'deepseek',
          supportsReasoningEffort: true,
          maxTokensField: 'max_tokens',
          requiresReasoningContentOnAssistantMessages: true,
        } } : {}),
        models: [{
          id: 'routify-model',
          name: 'Routify Model',
          contextWindow: 262_144,
          maxTokens: 32_768,
          reasoningEfforts: { off: null, high: 'high', max: 'ultra' },
        }],
      },
    },
  }
}

export interface AssembledResult {
  message: Message
  usage?: TokenUsage
  finish: FinishReason
}

/** Drive the public LLM stream through the same assembler used by consumers. */
export async function assemble(ctx: Context, options: GenerateOptions): Promise<AssembledResult> {
  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk)
  return {
    message: assembler.message({
      kind: 'model',
      provider: options.provider,
      model: options.model,
      ...assembler.replayState === undefined ? {} : { replayState: assembler.replayState },
    }),
    ...assembler.usage === undefined ? {} : { usage: assembler.usage },
    finish: assembler.finish,
  }
}

export interface ServerBehavior {
  events?: readonly string[]
  /** SSE event names paired by index; required by Anthropic Messages streams. */
  eventNames?: readonly string[]
  delayMs?: number
  status?: number
  body?: string
}

export interface MockServer {
  url: string
  paths: string[]
  requests: Record<string, unknown>[]
  headers: IncomingMessage['headers'][]
  close(): Promise<void>
}

/** Minimal scripted OpenAI-compatible SSE server. */
export async function mockServer(script: ServerBehavior[]): Promise<MockServer> {
  const paths: string[] = []
  const requests: Record<string, unknown>[] = []
  const headers: IncomingMessage['headers'][] = []
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    request.on('end', () => {
      paths.push(request.url ?? '')
      requests.push(body.length === 0 ? {} : JSON.parse(body) as Record<string, unknown>)
      headers.push(request.headers)
      const behavior = script.shift() ?? { status: 500, body: 'script exhausted' }
      if (behavior.status !== undefined && behavior.status !== 200) {
        response.writeHead(behavior.status, { 'content-type': 'application/json' })
        response.end(behavior.body ?? '{}')
        return
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      let index = 0
      const writeNext = (): void => {
        const event = behavior.events?.[index]
        index += 1
        if (event === undefined) {
          response.end()
          return
        }
        const eventName = behavior.eventNames?.[index - 1]
        response.write(`${eventName === undefined ? '' : `event: ${eventName}\n`}data: ${event}\n\n`)
        if (behavior.delayMs === undefined) writeNext()
        else setTimeout(writeNext, behavior.delayMs)
      }
      writeNext()
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('mock server did not bind a TCP port')
  return {
    url: `http://127.0.0.1:${address.port}`,
    paths,
    requests,
    headers,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => { if (error === undefined) resolve(); else reject(error) })
    }),
  }
}

export const TEXT_EVENTS = [
  '{"choices":[{"delta":{"role":"assistant","content":""},"index":0,"finish_reason":null}]}',
  '{"choices":[{"delta":{"content":"hello"},"index":0,"finish_reason":null}]}',
  '{"choices":[{"delta":{},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
  '[DONE]',
] as const

export const TOOL_EVENTS = [
  '{"choices":[{"delta":{"role":"assistant","content":"","tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"lookup","arguments":""}}]},"index":0,"finish_reason":null}]}',
  '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":\\"Hangzhou\\"}"}}]},"index":0,"finish_reason":null}]}',
  '{"choices":[{"delta":{},"index":0,"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}',
  '[DONE]',
] as const

export const RESPONSES_TEXT_EVENTS = [
  '{"type":"response.created","response":{"id":"resp-1","status":"in_progress","output":[]}}',
  '{"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"msg-1","role":"assistant","content":[],"status":"in_progress"}}',
  '{"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"hello"}',
  '{"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"msg-1","role":"assistant","content":[{"type":"output_text","text":"hello","annotations":[]}],"status":"completed"}}',
  '{"type":"response.completed","response":{"id":"resp-1","status":"completed","output":[],"usage":{"input_tokens":3,"output_tokens":1,"total_tokens":4,"input_tokens_details":{"cached_tokens":0},"output_tokens_details":{"reasoning_tokens":0}}}}',
  '[DONE]',
] as const

export const RESPONSES_TOOL_EVENTS = [
  '{"type":"response.created","response":{"id":"resp-2","status":"in_progress","output":[]}}',
  '{"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"fc-1","call_id":"call-1","name":"lookup","arguments":"","status":"in_progress"}}',
  '{"type":"response.function_call_arguments.delta","output_index":0,"delta":"{\\"city\\":\\"Hangzhou\\"}"}',
  '{"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","id":"fc-1","call_id":"call-1","name":"lookup","arguments":"{\\"city\\":\\"Hangzhou\\"}","status":"completed"}}',
  '{"type":"response.completed","response":{"id":"resp-2","status":"completed","output":[],"usage":{"input_tokens":5,"output_tokens":2,"total_tokens":7,"input_tokens_details":{"cached_tokens":0},"output_tokens_details":{"reasoning_tokens":0}}}}',
  '[DONE]',
] as const

export const ANTHROPIC_TEXT_EVENTS = [
  '{"type":"message_start","message":{"id":"msg-1","type":"message","role":"assistant","content":[],"model":"routify-model","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":3,"output_tokens":0}}}',
  '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}',
  '{"type":"content_block_stop","index":0}',
  '{"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}',
  '{"type":"message_stop"}',
] as const

export const ANTHROPIC_EVENT_NAMES = [
  'message_start',
  'content_block_start',
  'content_block_delta',
  'content_block_stop',
  'message_delta',
  'message_stop',
] as const

export const ANTHROPIC_TOOL_EVENTS = [
  '{"type":"message_start","message":{"id":"msg-2","type":"message","role":"assistant","content":[],"model":"routify-model","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":5,"output_tokens":0}}}',
  '{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu-1","name":"lookup","input":{}}}',
  '{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":\\"Hangzhou\\"}"}}',
  '{"type":"content_block_stop","index":0}',
  '{"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":2}}',
  '{"type":"message_stop"}',
] as const
