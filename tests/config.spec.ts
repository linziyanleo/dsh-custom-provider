import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.js'
import type { ConfigShape } from '../src/config.js'
import { resolveProviders } from '../src/provider.js'
import { routeConfig } from './helpers.js'

/** Assert one schema node carries both the English default and zh-CN translation. */
function expectBilingual(schema: { meta: { description?: unknown } }, path: string): void {
  expect(schema.meta.description, path).toMatchObject({
    '': expect.any(String),
    'zh-CN': expect.any(String),
  })
}

describe('configuration boundary', () => {
  it('accepts the complete static route through the Cordis schema', () => {
    expect(Config(routeConfig('https://gateway.example/v1'))).toMatchObject({
      providers: { routify: { api: 'openai-completions' } },
    })
  })

  it('accepts all supported protocols and rejects unknown protocols', () => {
    for (const api of ['openai-completions', 'openai-responses', 'anthropic-messages'] as const) {
      expect(Config(routeConfig('https://gateway.example/v1', api))).toMatchObject({
        providers: { routify: { api } },
      })
    }
    const source = routeConfig('https://gateway.example/v1') as unknown as {
      providers: { routify: Record<string, unknown> }
    }
    source.providers.routify.api = 'unknown-protocol'
    expect(() => Config(source as unknown as ConfigShape)).toThrow()
  })

  it('rejects invalid or protocol-inapplicable compat fields', () => {
    const compat = routeConfig('https://gateway.example/v1') as unknown as {
      providers: { routify: { compat: Record<string, unknown> } }
    }
    compat.providers.routify.compat.maxTokensField = 'output_tokens'
    expect(() => Config(compat as unknown as ConfigShape)).toThrow()

    const responses = routeConfig('https://gateway.example/v1', 'openai-responses')
    responses.providers!.routify!.compat = { supportsStore: false }
    expect(() => resolveProviders(responses)).toThrow(/only supported by openai-completions/)
  })

  it('fails semantic errors before registration', () => {
    const empty = routeConfig('https://gateway.example/v1')
    empty.providers!.routify!.models = []
    expect(() => resolveProviders(empty)).toThrow(/at least one static model/)

    const duplicate = routeConfig('https://gateway.example/v1')
    duplicate.providers!.routify!.models.push({ ...duplicate.providers!.routify!.models[0]! })
    expect(() => resolveProviders(duplicate)).toThrow(/more than once/)

    const invalidEffort = routeConfig('https://gateway.example/v1')
    invalidEffort.providers!.routify!.models[0]!.reasoningEfforts = { high: null }
    expect(() => resolveProviders(invalidEffort)).toThrow(/only off may be null/)

    const relative = routeConfig('/protocol/openai/v1')
    expect(() => resolveProviders(relative)).toThrow(/absolute URL/)
  })
})

describe('settings form metadata', () => {
  it('carries English and zh-CN descriptions for every interactive field', () => {
    expectBilingual(Config, 'llm-custom')
    const providers = Config.dict!.providers!
    expectBilingual(providers, 'providers')
    const provider = providers.inner!
    expect(provider.type).toBe('object')
    for (const field of ['displayName', 'apiKeyEnv', 'api', 'baseURL', 'compat', 'models']) {
      expectBilingual(provider.dict![field]!, `providers.*.${field}`)
    }
    expect(provider.dict!.apiKeyEnv!.meta.role).toBe('credential-ref')
    expect(provider.dict!.compat!.meta.collapse).toBe(true)

    const model = provider.dict!.models!.inner!
    for (const field of ['id', 'name', 'contextWindow', 'maxTokens', 'reasoningEfforts', 'compat']) {
      expectBilingual(model.dict![field]!, `models[].${field}`)
    }

    const efforts = model.dict!.reasoningEfforts!.list![1]!
    expect(efforts.type).toBe('dict')
    expectBilingual(efforts, 'reasoningEfforts dict')

    const compat = provider.dict!.compat!
    for (const field of [
      'supportsStore',
      'supportsDeveloperRole',
      'thinkingFormat',
      'supportsReasoningEffort',
      'maxTokensField',
      'requiresReasoningContentOnAssistantMessages',
    ]) {
      expectBilingual(compat.dict![field]!, `compat.${field}`)
    }
  })

  it('keeps the bilingual metadata in the serialized wire schema', () => {
    const serialized = JSON.parse(JSON.stringify(Config.toJSON())) as {
      refs: Record<string, { meta?: { description?: unknown } }>
    }
    const described = Object.values(serialized.refs)
      .filter(node => node.meta?.description !== undefined)
    expect(described.length).toBeGreaterThan(0)
    for (const node of described) {
      expect(node.meta!.description).toMatchObject({
        '': expect.any(String),
        'zh-CN': expect.any(String),
      })
    }
  })
})

describe('static provider materialization', () => {
  it('pins the static catalog, six compat fields, and effort wire mappings', () => {
    const config = routeConfig('https://gateway.example/v1/')
    config.providers!.routify!.models[0]!.compat = { supportsReasoningEffort: false }
    const profile = resolveProviders(config).get('routify')
    const model = profile?.piProvider.getModels()[0]

    expect(profile?.baseURL).toBe('https://gateway.example/v1')
    expect(model).toMatchObject({
      id: 'routify-model',
      api: 'openai-completions',
      baseUrl: 'https://gateway.example/v1',
      reasoning: true,
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        thinkingFormat: 'deepseek',
        supportsReasoningEffort: false,
        maxTokensField: 'max_tokens',
        requiresReasoningContentOnAssistantMessages: true,
      },
    })
    expect(model?.thinkingLevelMap).toEqual({
      minimal: null,
      low: null,
      medium: null,
      high: 'high',
      xhigh: null,
      max: 'ultra',
    })
  })

  it('materializes each protocol through the same provider interface', () => {
    for (const api of ['openai-completions', 'openai-responses', 'anthropic-messages'] as const) {
      const profile = resolveProviders(routeConfig('https://gateway.example/v1', api)).get('routify')
      expect(profile?.api).toBe(api)
      expect(profile?.piProvider.getModels()[0]).toMatchObject({ api })
    }
  })
})
