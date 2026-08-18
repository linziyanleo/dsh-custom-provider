import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import CredentialProvider from '@deepseek-ai/dsh-credentials'
import type { CredentialInfo, CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { FinishReason, GenerateOptions, Message, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { ConfigShape } from '../src/config.js'

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
export function routeConfig(baseURL: string): ConfigShape {
  return {
    providers: {
      routify: {
        displayName: 'Routify',
        apiKeyEnv: TEST_CREDENTIAL_REF,
        api: 'openai-completions',
        baseURL,
        compat: {
          supportsStore: false,
          supportsDeveloperRole: false,
          thinkingFormat: 'deepseek',
          supportsReasoningEffort: true,
          maxTokensField: 'max_tokens',
          requiresReasoningContentOnAssistantMessages: true,
        },
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
        response.write(`data: ${event}\n\n`)
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

