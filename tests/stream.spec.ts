import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LlmRuntime, { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import * as CustomProvider from '../src/index.js'
import {
  assemble,
  MemoryCredentials,
  mockServer,
  routeConfig,
  TEST_CREDENTIAL_REF,
  TEXT_EVENTS,
  TOOL_EVENTS,
} from './helpers.js'
import type { MockServer } from './helpers.js'

const servers: MockServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()))
})

async function boot(server: MockServer, key = 'first-key'): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(MemoryCredentials, { [TEST_CREDENTIAL_REF]: key })
  await ctx.plugin(CustomProvider, routeConfig(`${server.url}/v1`))
  return ctx
}

describe('PiAiAdapter reuse', () => {
  it('streams text with DeepSeek compat, usage/finish, and no model discovery request', async () => {
    const server = await mockServer([{ events: TEXT_EVENTS }])
    servers.push(server)
    const ctx = await boot(server)

    const result = await assemble(ctx, {
      provider: 'routify',
      model: 'routify-model',
      reasoningEffort: ReasoningEffortId('high'),
      system: 'Be concise.',
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'hello' }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })

    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 1 })
    expect(result.finish).toEqual({ kind: 'stop' })
    expect(server.paths).toEqual(['/v1/chat/completions'])
    expect(server.requests[0]).toMatchObject({
      max_tokens: 32_768,
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
    })
    expect(server.requests[0]).not.toHaveProperty('store')
    expect(server.requests[0]).not.toHaveProperty('max_completion_tokens')
    expect((server.requests[0]?.messages as Array<{ role: string }> | undefined)?.[0]?.role).toBe('system')
  })

  it('preserves streamed tool-call arguments and sends the tool schema', async () => {
    const server = await mockServer([{ events: TOOL_EVENTS }])
    servers.push(server)
    const ctx = await boot(server)

    const result = await assemble(ctx, {
      provider: 'routify',
      model: 'routify-model',
      messages: [],
      tools: [{
        name: 'lookup',
        description: 'Look up a city.',
        parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
      }],
    })

    expect(result.message.content).toEqual([{
      type: 'tool-call',
      id: 'call-1',
      name: 'lookup',
      arguments: '{"city":"Hangzhou"}',
    }])
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 2 })
    expect(result.finish).toEqual({ kind: 'tool-calls' })
    expect(server.requests[0]?.tools).toEqual([{
      type: 'function',
      function: {
        name: 'lookup',
        description: 'Look up a city.',
        parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
        strict: false,
      },
    }])
  })

  it('re-resolves the credential for each request without exposing it in configuration', async () => {
    const server = await mockServer([{ events: TEXT_EVENTS }, { events: TEXT_EVENTS }])
    servers.push(server)
    const ctx = await boot(server, 'first-key')

    const request: GenerateOptions = {
      provider: 'routify',
      model: 'routify-model',
      messages: [],
    }
    await assemble(ctx, request)
    await ctx.credentials.set(credentialRef(TEST_CREDENTIAL_REF), 'second-key')
    await assemble(ctx, request)

    expect(server.headers.map(headers => headers.authorization)).toEqual([
      'Bearer first-key',
      'Bearer second-key',
    ])
  })

  it('honors caller cancellation while streaming', async () => {
    const server = await mockServer([{ events: TEXT_EVENTS, delayMs: 30 }])
    servers.push(server)
    const ctx = await boot(server)
    const controller = new AbortController()
    const resultPromise = assemble(ctx, {
      provider: 'routify',
      model: 'routify-model',
      messages: [],
      signal: controller.signal,
    })
    setTimeout(() => { controller.abort('test cancellation') }, 10)

    expect((await resultPromise).finish.kind).toBe('aborted')
    expect(server.paths).toEqual(['/v1/chat/completions'])
  })
})
