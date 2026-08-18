/** Opt-in live acceptance; ordinary `pnpm test` excludes this file. */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import CredentialsLocal from '@deepseek-ai/dsh-credentials-local'
import LlmRuntime, { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import * as CustomProvider from '../src/index.js'
import type { ConfigShape } from '../src/index.js'
import { assemble } from './helpers.js'

const live = process.env.DSH_CUSTOM_ROUTIFY_LIVE === '1'
const baseURL = process.env.DSH_CUSTOM_LIVE_BASE_URL
  ?? 'https://routify.alibaba-inc.com/protocol/openai/v1'
const credentialName = process.env.DSH_CUSTOM_LIVE_CREDENTIAL_REF ?? 'NEWAPI_API_KEY'
const model = process.env.DSH_CUSTOM_LIVE_MODEL ?? 'ds.deepseek-v4-pro'

function liveConfig(): ConfigShape {
  return {
    providers: {
      routify: {
        displayName: 'Routify',
        apiKeyEnv: credentialName,
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
          id: model,
          name: model,
          contextWindow: 900_000,
          maxTokens: 319_986,
          reasoningEfforts: { high: 'high', max: 'max' },
        }],
      },
    },
  }
}

async function liveHarness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(CredentialsLocal, { watch: false })
  const info = await ctx.credentials.describe(credentialRef(credentialName))
  expect(info.configured).toBe(true)
  await ctx.plugin(CustomProvider, liveConfig())
  return ctx
}

describe.runIf(live)('Routify live acceptance', () => {
  it('streams one text response through the stored credential ref', async () => {
    const ctx = await liveHarness()
    const result = await assemble(ctx, {
      provider: 'routify',
      model,
      reasoningEffort: ReasoningEffortId('high'),
      maxTokens: 128,
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'Reply with exactly: routify text ok' }],
        source: { kind: 'plugin', plugin: 'routify-e2e' },
      })],
    })

    expect(result.message.content.some(block => block.type === 'text' && block.text.length > 0)).toBe(true)
    expect(result.usage?.outputTokens).toBeGreaterThan(0)
    expect(result.finish.kind).toBe('stop')
  }, 120_000)

  it('streams one tool call with raw JSON arguments', async () => {
    const ctx = await liveHarness()
    const result = await assemble(ctx, {
      provider: 'routify',
      model,
      reasoningEffort: ReasoningEffortId('high'),
      maxTokens: 256,
      messages: [createUserMessage({
        content: [{
          type: 'text',
          text: 'Call the lookup tool exactly once with city set to Hangzhou. Do not answer in text.',
        }],
        source: { kind: 'plugin', plugin: 'routify-e2e' },
      })],
      tools: [{
        name: 'lookup',
        description: 'Look up a city.',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      }],
    })

    const call = result.message.content.find(block => block.type === 'tool-call')
    expect(call).toMatchObject({ type: 'tool-call', name: 'lookup' })
    expect(call?.type === 'tool-call' ? JSON.parse(call.arguments) : undefined).toEqual({ city: 'Hangzhou' })
    expect(result.usage?.outputTokens).toBeGreaterThan(0)
    expect(result.finish.kind).toBe('tool-calls')
  }, 120_000)
})
