import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { createProvider } from '@earendil-works/pi-ai'
import type {
  ApiKeyAuth,
  Model,
  ModelCost,
  OpenAICompletionsCompat,
  ThinkingLevelMap,
} from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import {
  OPENAI_COMPLETIONS_API,
  THINKING_LEVELS,
} from './config.js'
import type {
  CompatConfig,
  ConfigShape,
  ModelConfig,
  ProviderConfig,
  ReasoningEfforts,
} from './config.js'

const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000
const NO_COST: ModelCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
const THINKING_LEVEL_SET = new Set<string>(THINKING_LEVELS)

/** Return a non-empty string or fail with the exact configuration path. */
function nonEmpty(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`llm-custom: ${path} must be a non-empty string`)
  }
  return value
}

/** Validate and normalize an HTTP(S) provider endpoint without probing it. */
function endpoint(value: unknown, path: string): string {
  const raw = nonEmpty(value, path)
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch (cause) {
    throw new Error(`llm-custom: ${path} must be an absolute URL`, { cause })
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`llm-custom: ${path} must use http or https`)
  }
  return raw.replace(/\/+$/, '')
}

/** Validate a positive integer model capacity. */
function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`llm-custom: ${path} must be a positive safe integer`)
  }
  return value as number
}

/** Resolve one explicit effort declaration into pi-ai model metadata. */
function reasoning(
  efforts: false | ReasoningEfforts | undefined,
  path: string,
): Pick<Model<'openai-completions'>, 'reasoning' | 'thinkingLevelMap'> {
  if (efforts === undefined || efforts === false) return { reasoning: false }
  if (efforts === null || typeof efforts !== 'object' || Array.isArray(efforts)) {
    throw new Error(`llm-custom: ${path} must be false or a level-to-wire mapping`)
  }
  const declared = Object.entries(efforts)
  if (declared.length === 0) {
    throw new Error(`llm-custom: ${path} must declare at least one thinking level or be false`)
  }
  for (const [level, wire] of declared) {
    if (!THINKING_LEVEL_SET.has(level)) {
      throw new Error(`llm-custom: ${path}.${level} is not a supported reasoning level`)
    }
    if (wire === null) {
      if (level !== 'off') {
        throw new Error(`llm-custom: ${path}.${level} needs a non-empty wire spelling; only off may be null`)
      }
    } else if (typeof wire !== 'string' || wire.length === 0) {
      throw new Error(`llm-custom: ${path}.${level} must be a non-empty wire spelling`)
    }
  }
  if (!declared.some(([level]) => level !== 'off')) {
    throw new Error(`llm-custom: ${path} must offer a thinking level beyond off or be false`)
  }
  const thinkingLevelMap: ThinkingLevelMap = {}
  for (const level of THINKING_LEVELS) {
    const wire = efforts[level]
    if (wire === undefined) thinkingLevelMap[level] = null
    else if (wire !== null) thinkingLevelMap[level] = wire
  }
  return { reasoning: true, thinkingLevelMap }
}

/** Merge a route's compat defaults with one model's per-field overrides. */
function compat(
  route: CompatConfig | undefined,
  model: CompatConfig | undefined,
): Pick<Model<'openai-completions'>, 'compat'> | Record<string, never> {
  const merged: OpenAICompletionsCompat = { ...route, ...model }
  return Object.keys(merged).length === 0 ? {} : { compat: merged }
}

/** Auth descriptor that consumes the per-request key supplied by PiAiAdapter. */
function apiKeyAuth(displayName: string): ApiKeyAuth {
  return {
    name: displayName,
    resolve: ({ credential }) => Promise.resolve({
      auth: credential?.key === undefined ? {} : { apiKey: credential.key },
      source: displayName,
    }),
  }
}

/** Materialize one static model without endpoint discovery. */
function resolveModel(
  route: string,
  baseURL: string,
  routeCompat: CompatConfig | undefined,
  source: ModelConfig,
  index: number,
): Model<'openai-completions'> {
  const path = `providers.${route}.models[${index}]`
  const id = nonEmpty(source.id, `${path}.id`)
  const name = source.name === undefined ? id : nonEmpty(source.name, `${path}.name`)
  return {
    id,
    name,
    api: OPENAI_COMPLETIONS_API,
    provider: route,
    baseUrl: baseURL,
    input: ['text'],
    cost: NO_COST,
    contextWindow: positiveInteger(source.contextWindow, `${path}.contextWindow`),
    maxTokens: positiveInteger(source.maxTokens, `${path}.maxTokens`),
    ...reasoning(source.reasoningEfforts, `${path}.reasoningEfforts`),
    ...compat(routeCompat, source.compat),
  }
}

/** Resolve one configured route into the public PiAiAdapter constructor profile. */
function resolveProvider(route: string, source: ProviderConfig): ResolvedPiAiProviderProfile {
  nonEmpty(route, 'provider route')
  const path = `providers.${route}`
  const displayName = source.displayName === undefined ? route : nonEmpty(source.displayName, `${path}.displayName`)
  const apiKeyEnv = credentialRef(nonEmpty(source.apiKeyEnv, `${path}.apiKeyEnv`))
  if (source.api !== OPENAI_COMPLETIONS_API) {
    throw new Error(`llm-custom: ${path}.api must be ${OPENAI_COMPLETIONS_API}`)
  }
  const baseURL = endpoint(source.baseURL, `${path}.baseURL`)
  if (!Array.isArray(source.models) || source.models.length === 0) {
    throw new Error(`llm-custom: ${path}.models must contain at least one static model`)
  }
  const seen = new Set<string>()
  const models = source.models.map((model, index) => {
    const resolved = resolveModel(route, baseURL, source.compat, model, index)
    if (seen.has(resolved.id)) {
      throw new Error(`llm-custom: ${path}.models lists model "${resolved.id}" more than once`)
    }
    seen.add(resolved.id)
    return resolved
  })
  const configuredMaxTokens = new Map(models.map(model => [model.id, model.maxTokens]))
  return {
    provider: route,
    displayName,
    apiKeyEnv,
    api: OPENAI_COMPLETIONS_API,
    baseURL,
    streamIdleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    retryPolicy: resolveRetryPolicy(undefined, `llm-custom: ${path}.retryPolicy`),
    configuredMaxTokens,
    piProvider: createProvider({
      id: route,
      name: displayName,
      baseUrl: baseURL,
      auth: { apiKey: apiKeyAuth(displayName) },
      models,
      api: openAICompletionsApi(),
    }),
  }
}

/** Validate and resolve the complete settings snapshot before any registration. */
export function resolveProviders(config: ConfigShape): ReadonlyMap<string, ResolvedPiAiProviderProfile> {
  const providers = config.providers ?? {}
  if (Array.isArray(providers) || providers === null || typeof providers !== 'object') {
    throw new Error('llm-custom: providers must be a mapping keyed by provider route')
  }
  const resolved = new Map<string, ResolvedPiAiProviderProfile>()
  for (const [route, source] of Object.entries(providers)) {
    resolved.set(route, resolveProvider(route, source))
  }
  return resolved
}

