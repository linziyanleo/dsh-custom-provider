import { describe, expect, it } from 'vitest'
import {
  buildSaveOps,
  diffOps,
  mergeProvider,
  parseCapacity,
  validateDraft,
  validateRoute,
} from '../client/ops.js'
import type { ProviderDraft } from '../client/ops.js'

function draft(overrides: Partial<ProviderDraft> = {}): ProviderDraft {
  return {
    displayName: 'Routify',
    apiKeyEnv: 'ROUTIFY_API_KEY',
    baseURL: 'https://routify.alibaba-inc.com/protocol/openai/v1',
    models: [{ id: 'model-a', name: '', contextWindow: '256K', maxTokens: '32768' }],
    ...overrides,
  }
}

describe('parseCapacity', () => {
  it('accepts plain integers and K/M suffixes', () => {
    expect(parseCapacity('32768')).toBe(32_768)
    expect(parseCapacity(' 256K ')).toBe(262_144)
    expect(parseCapacity('1m')).toBe(1_048_576)
    expect(parseCapacity('1.5K')).toBe(1536)
  })

  it('rejects zero, negatives, and non-numeric input', () => {
    expect(parseCapacity('0')).toBeUndefined()
    expect(parseCapacity('-4')).toBeUndefined()
    expect(parseCapacity('abc')).toBeUndefined()
    expect(parseCapacity('')).toBeUndefined()
    expect(parseCapacity('10G')).toBeUndefined()
    expect(parseCapacity('0.4')).toBeUndefined()
  })
})

describe('validateRoute', () => {
  it('requires a fresh kebab-case id', () => {
    expect(validateRoute('', [])).toBe('routeRequired')
    expect(validateRoute('Routify', [])).toBe('routeInvalid')
    expect(validateRoute('my.route', [])).toBe('routeInvalid')
    expect(validateRoute('routify', ['routify'])).toBe('routeTaken')
    expect(validateRoute('routify-2', ['routify'])).toBeUndefined()
  })
})

describe('validateDraft', () => {
  it('accepts a complete draft', () => {
    expect(validateDraft(draft())).toBeUndefined()
  })

  it('rejects a non-absolute baseURL', () => {
    expect(validateDraft(draft({ baseURL: '/v1' }))).toEqual({ field: 'baseURL', key: 'baseUrlInvalid' })
    expect(validateDraft(draft({ baseURL: 'ftp://x' }))).toEqual({ field: 'baseURL', key: 'baseUrlInvalid' })
  })

  it('requires a credential reference and at least one model', () => {
    expect(validateDraft(draft({ apiKeyEnv: ' ' }))).toEqual({ field: 'apiKeyEnv', key: 'credentialRefRequired' })
    expect(validateDraft(draft({ models: [] }))).toEqual({ field: 'models', key: 'modelsEmpty' })
  })

  it('rejects blank, duplicate, or badly-sized models', () => {
    expect(validateDraft(draft({ models: [{ id: ' ', name: '', contextWindow: '1K', maxTokens: '1K' }] })))
      .toEqual({ field: 'model', index: 0, key: 'modelIdRequired' })
    expect(validateDraft(draft({
      models: [
        { id: 'a', name: '', contextWindow: '1K', maxTokens: '1K' },
        { id: 'a', name: '', contextWindow: '1K', maxTokens: '1K' },
      ],
    }))).toEqual({ field: 'model', index: 1, key: 'modelIdDuplicate' })
    expect(validateDraft(draft({ models: [{ id: 'a', name: '', contextWindow: 'x', maxTokens: '1K' }] })))
      .toEqual({ field: 'model', index: 0, key: 'capacityInvalid' })
  })
})

describe('mergeProvider', () => {
  it('materializes the wire profile and normalizes the baseURL', () => {
    expect(mergeProvider(undefined, draft({ baseURL: 'https://gateway.example/v1/' }))).toEqual({
      displayName: 'Routify',
      apiKeyEnv: 'ROUTIFY_API_KEY',
      api: 'openai-completions',
      baseURL: 'https://gateway.example/v1',
      models: [{ id: 'model-a', contextWindow: 262_144, maxTokens: 32_768 }],
    })
  })

  it('preserves route compat and per-model reasoning maps the form never edits', () => {
    const committed = {
      displayName: 'Old',
      apiKeyEnv: 'OLD_KEY',
      api: 'openai-completions',
      baseURL: 'https://old.example/v1',
      compat: { supportsStore: false },
      models: [{ id: 'model-a', reasoningEfforts: { high: 'high' }, contextWindow: 1, maxTokens: 1 }],
    }
    expect(mergeProvider(committed, draft())).toEqual({
      displayName: 'Routify',
      apiKeyEnv: 'ROUTIFY_API_KEY',
      api: 'openai-completions',
      baseURL: 'https://routify.alibaba-inc.com/protocol/openai/v1',
      compat: { supportsStore: false },
      models: [{
        id: 'model-a',
        reasoningEfforts: { high: 'high' },
        contextWindow: 262_144,
        maxTokens: 32_768,
      }],
    })
  })

  it('drops committed models the draft removed and clears emptied optional fields', () => {
    const committed = {
      displayName: 'Old',
      apiKeyEnv: 'OLD_KEY',
      baseURL: 'https://old.example/v1',
      models: [
        { id: 'model-a', name: 'A', contextWindow: 1, maxTokens: 1 },
        { id: 'model-b', contextWindow: 2, maxTokens: 2 },
      ],
    }
    const merged = mergeProvider(committed, draft({ displayName: '' }))
    expect(merged.displayName).toBeUndefined()
    const models = merged.models as Record<string, unknown>[]
    expect(models).toHaveLength(1)
    expect(models[0]).not.toHaveProperty('name')
  })
})

describe('diffOps / buildSaveOps', () => {
  it('emits nothing when nothing changed', () => {
    const committed = mergeProvider(undefined, draft())
    expect(diffOps(['providers', 'routify'], committed, mergeProvider(committed, draft()))).toEqual([])
  })

  it('emits leaf set/unset ops only for touched fields', () => {
    const committed = mergeProvider(undefined, draft())
    const next = draft({
      displayName: '',
      baseURL: 'https://new.example/v1',
      models: [{ id: 'model-a', name: '', contextWindow: '256K', maxTokens: '64K' }],
    })
    expect(buildSaveOps('routify', committed, next)).toEqual([
      { op: 'unset', path: ['providers', 'routify', 'displayName'] },
      { op: 'set', path: ['providers', 'routify', 'baseURL'], value: 'https://new.example/v1' },
      { op: 'set', path: ['providers', 'routify', 'models'], value: [
        { id: 'model-a', contextWindow: 262_144, maxTokens: 65_536 },
      ] },
    ])
  })

  it('creates a new route with a single set op', () => {
    expect(buildSaveOps('routify', undefined, draft())).toEqual([
      { op: 'set', path: ['providers', 'routify'], value: mergeProvider(undefined, draft()) },
    ])
  })
})
