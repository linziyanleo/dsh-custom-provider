import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.js'
import type { ConfigShape } from '../src/config.js'
import { resolveProviders } from '../src/provider.js'
import { routeConfig } from './helpers.js'

describe('configuration boundary', () => {
  it('accepts the complete static route through the Cordis schema', () => {
    expect(Config(routeConfig('https://gateway.example/v1'))).toMatchObject({
      providers: { routify: { api: 'openai-completions' } },
    })
  })

  it('rejects unsupported protocols and invalid compat fields in the schema', () => {
    const source = routeConfig('https://gateway.example/v1') as unknown as {
      providers: { routify: Record<string, unknown> }
    }
    source.providers.routify.api = 'openai-responses'
    expect(() => Config(source as unknown as ConfigShape)).toThrow()

    const compat = routeConfig('https://gateway.example/v1') as unknown as {
      providers: { routify: { compat: Record<string, unknown> } }
    }
    compat.providers.routify.compat.maxTokensField = 'output_tokens'
    expect(() => Config(compat as unknown as ConfigShape)).toThrow()
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
})

