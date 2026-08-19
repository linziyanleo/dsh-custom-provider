/**
 * Pure form-model helpers for the llm-custom settings section. No host or
 * React imports: this module is unit-tested from the Node side and bundled
 * into the browser client unchanged.
 */

/** Thinking formats accepted by the server compat schema. */
export const THINKING_FORMATS = [
  'openai',
  'deepseek',
  'openrouter',
  'together',
  'zai',
  'qwen',
  'string-thinking',
  'ant-ling',
] as const

export type ThinkingFormat = typeof THINKING_FORMATS[number]

/** Provider wire protocols exposed by the server configuration schema. */
export const PROVIDER_APIS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
] as const

export type ProviderApi = typeof PROVIDER_APIS[number]

/** Pi-ai reasoning levels in selector order. */
export const THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

export type ThinkingLevel = typeof THINKING_LEVELS[number]

/** A tri-state select value: unset, explicit true, or explicit false. */
export type BoolChoice = '' | 'true' | 'false'

/** Form representation of the six compat fields on a route or model. */
export interface CompatDraft {
  supportsStore: BoolChoice
  supportsDeveloperRole: BoolChoice
  thinkingFormat: '' | ThinkingFormat
  supportsReasoningEffort: BoolChoice
  maxTokensField: '' | 'max_completion_tokens' | 'max_tokens'
  requiresReasoningContentOnAssistantMessages: BoolChoice
}

export interface ReasoningEffortDraft {
  level: ThinkingLevel
  wire: string
}

export type ReasoningMode = 'unset' | 'false' | 'custom'

/** One model row as edited in the form; capacities stay raw text until save. */
export interface ModelDraft {
  id: string
  name: string
  contextWindow: string
  maxTokens: string
  /**
   * Optional so pre-advanced callers/tests can still build minimal drafts;
   * omitted fields preserve whatever the committed model already has.
   */
  reasoningMode?: ReasoningMode
  reasoningEfforts?: ReasoningEffortDraft[]
  compat?: CompatDraft
}

/** The editable subset of one provider route. */
export interface ProviderDraft {
  displayName: string
  apiKeyEnv: string
  /** Optional so callers predating protocol selection keep the original default. */
  api?: ProviderApi
  baseURL: string
  models: ModelDraft[]
  /** Optional for the same backward-compatible reason as {@link ModelDraft.compat}. */
  compat?: CompatDraft
}

/** One path-addressed settings write, mirroring the host's settings.mutate wire shape. */
export type PathOp =
  | { op: 'set'; path: readonly string[]; value: unknown }
  | { op: 'unset'; path: readonly string[] }

/** Route ids double as settings keys and provider ids; keep the dsh kebab-case convention. */
export const ROUTE_PATTERN = /^[a-z][a-z0-9-]*$/

export function emptyCompatDraft(): CompatDraft {
  return {
    supportsStore: '',
    supportsDeveloperRole: '',
    thinkingFormat: '',
    supportsReasoningEffort: '',
    maxTokensField: '',
    requiresReasoningContentOnAssistantMessages: '',
  }
}

export function emptyModelDraft(): ModelDraft {
  return {
    id: '',
    name: '',
    contextWindow: '',
    maxTokens: '',
    reasoningMode: 'unset',
    reasoningEfforts: [],
    compat: emptyCompatDraft(),
  }
}

export function emptyProviderDraft(): ProviderDraft {
  return {
    displayName: '',
    apiKeyEnv: '',
    api: 'openai-completions',
    baseURL: '',
    models: [],
    compat: emptyCompatDraft(),
  }
}

function compatHasValue(compat: CompatDraft | undefined): boolean {
  return compat !== undefined && (
    compat.supportsStore !== ''
    || compat.supportsDeveloperRole !== ''
    || compat.thinkingFormat !== ''
    || compat.supportsReasoningEffort !== ''
    || compat.maxTokensField !== ''
    || compat.requiresReasoningContentOnAssistantMessages !== ''
  )
}

/** Whether the advanced part of a draft differs from the untouched defaults. */
export function isAdvancedDirty(draft: ProviderDraft): boolean {
  if (compatHasValue(draft.compat)) return true
  return draft.models.some(model =>
    (model.reasoningMode ?? 'unset') !== 'unset'
    || (model.reasoningEfforts?.length ?? 0) > 0
    || compatHasValue(model.compat))
}

/**
 * Parse a positive integer capacity, accepting case-insensitive K/M suffixes
 * (K = 1024, M = 1024²). Returns undefined for anything else.
 */
export function parseCapacity(raw: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)([kKmM])?$/.exec(raw.trim())
  if (match === null) return undefined
  const suffix = match[2]?.toLowerCase()
  const value = Number(match[1]) * (suffix === 'k' ? 1024 : suffix === 'm' ? 1024 * 1024 : 1)
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

/** Judge a route id for a new provider: required, kebab-case, and not already taken. */
export function validateRoute(route: string, taken: readonly string[]): 'routeRequired' | 'routeInvalid' | 'routeTaken' | undefined {
  if (route.trim().length === 0) return 'routeRequired'
  if (!ROUTE_PATTERN.test(route.trim())) return 'routeInvalid'
  if (taken.includes(route.trim())) return 'routeTaken'
  return undefined
}

/** Judge the whole draft; the first failure names its field for the form. */
export function validateDraft(draft: ProviderDraft):
  | { field: 'baseURL' | 'apiKeyEnv' | 'models'; key: string }
  | { field: 'model'; index: number; key: string }
  | undefined {
  const baseURL = draft.baseURL.trim()
  if (!/^https?:\/\/.+/.test(baseURL)) return { field: 'baseURL', key: 'baseUrlInvalid' }
  if (draft.apiKeyEnv.trim().length === 0) return { field: 'apiKeyEnv', key: 'credentialRefRequired' }
  if (draft.models.length === 0) return { field: 'models', key: 'modelsEmpty' }
  const seen = new Set<string>()
  for (const [index, model] of draft.models.entries()) {
    const id = model.id.trim()
    if (id.length === 0) return { field: 'model', index, key: 'modelIdRequired' }
    if (seen.has(id)) return { field: 'model', index, key: 'modelIdDuplicate' }
    seen.add(id)
    if (parseCapacity(model.contextWindow) === undefined) return { field: 'model', index, key: 'capacityInvalid' }
    if (parseCapacity(model.maxTokens) === undefined) return { field: 'model', index, key: 'capacityInvalid' }
    if ((model.reasoningMode ?? 'unset') !== 'custom') continue
    const levels = new Set<ThinkingLevel>()
    let hasReasoningLevel = false
    for (const effort of model.reasoningEfforts ?? []) {
      if (levels.has(effort.level)) return { field: 'model', index, key: 'reasoningLevelDuplicate' }
      levels.add(effort.level)
      if (effort.level !== 'off') {
        hasReasoningLevel = true
        if (effort.wire.trim().length === 0) return { field: 'model', index, key: 'reasoningWireRequired' }
      }
    }
    if (!hasReasoningLevel) return { field: 'model', index, key: 'reasoningLevelRequired' }
  }
  return undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boolChoice(value: unknown): BoolChoice {
  if (value === true) return 'true'
  if (value === false) return 'false'
  return ''
}

function compatDraftFrom(value: unknown): CompatDraft {
  const source = isPlainObject(value) ? value : {}
  const thinkingFormat = typeof source.thinkingFormat === 'string'
    && (THINKING_FORMATS as readonly string[]).includes(source.thinkingFormat)
    ? source.thinkingFormat as ThinkingFormat
    : ''
  const maxTokensField = source.maxTokensField === 'max_completion_tokens' || source.maxTokensField === 'max_tokens'
    ? source.maxTokensField
    : ''
  return {
    supportsStore: boolChoice(source.supportsStore),
    supportsDeveloperRole: boolChoice(source.supportsDeveloperRole),
    thinkingFormat,
    supportsReasoningEffort: boolChoice(source.supportsReasoningEffort),
    maxTokensField,
    requiresReasoningContentOnAssistantMessages: boolChoice(source.requiresReasoningContentOnAssistantMessages),
  }
}

function reasoningDraftFrom(value: unknown): { mode: ReasoningMode; efforts: ReasoningEffortDraft[] } {
  if (value === false) return { mode: 'false', efforts: [] }
  if (!isPlainObject(value)) return { mode: 'unset', efforts: [] }
  const source = value as Record<string, unknown>
  const efforts: ReasoningEffortDraft[] = []
  for (const level of THINKING_LEVELS) {
    const wire = source[level]
    if (wire === undefined) continue
    if (wire === null) efforts.push({ level, wire: '' })
    else if (typeof wire === 'string') efforts.push({ level, wire })
  }
  return { mode: 'custom', efforts }
}

/** Parse a committed provider section into the editable form draft. */
export function draftFromConfig(config: Record<string, unknown> | undefined): ProviderDraft {
  const models = Array.isArray(config?.models) ? config.models : []
  const api = typeof config?.api === 'string' && (PROVIDER_APIS as readonly string[]).includes(config.api)
    ? config.api as ProviderApi
    : 'openai-completions'
  return {
    displayName: typeof config?.displayName === 'string' ? config.displayName : '',
    apiKeyEnv: typeof config?.apiKeyEnv === 'string' ? config.apiKeyEnv : '',
    api,
    baseURL: typeof config?.baseURL === 'string' ? config.baseURL : '',
    compat: compatDraftFrom(config?.compat),
    models: models.map((model) => {
      const entry = isPlainObject(model) ? model : {}
      const reasoning = reasoningDraftFrom(entry.reasoningEfforts)
      return {
        id: typeof entry.id === 'string' ? entry.id : '',
        name: typeof entry.name === 'string' ? entry.name : '',
        contextWindow: typeof entry.contextWindow === 'number' ? String(entry.contextWindow) : '',
        maxTokens: typeof entry.maxTokens === 'number' ? String(entry.maxTokens) : '',
        reasoningMode: reasoning.mode,
        reasoningEfforts: reasoning.efforts,
        compat: compatDraftFrom(entry.compat),
      }
    }),
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    return aKeys.length === bKeys.length && aKeys.every(key => deepEqual(a[key], b[key]))
  }
  return false
}

/**
 * Diff two JSON-compatible trees into leaf-level path ops. Objects recurse;
 * arrays and scalars replace wholesale. Unchanged subtrees produce no ops, so
 * a save only writes what the form actually touched.
 */
export function diffOps(base: readonly string[], prev: unknown, next: unknown): PathOp[] {
  if (deepEqual(prev, next)) return []
  if (!isPlainObject(prev) || !isPlainObject(next)) {
    return next === undefined ? [{ op: 'unset', path: base }] : [{ op: 'set', path: base, value: next }]
  }
  const ops: PathOp[] = []
  for (const key of Object.keys(prev)) {
    if (!(key in next)) ops.push({ op: 'unset', path: [...base, key] })
  }
  for (const key of Object.keys(next)) {
    if (!(key in prev)) ops.push({ op: 'set', path: [...base, key], value: next[key] })
    else ops.push(...diffOps([...base, key], prev[key], next[key]))
  }
  return ops
}

function assign(target: Record<string, unknown>, key: string, value: string): void {
  const trimmed = value.trim()
  if (trimmed.length === 0) delete target[key]
  else target[key] = trimmed
}

function materializeCompat(draft: CompatDraft | undefined): Record<string, unknown> | undefined {
  if (draft === undefined) return undefined
  const compat: Record<string, unknown> = {}
  if (draft.supportsStore !== '') compat.supportsStore = draft.supportsStore === 'true'
  if (draft.supportsDeveloperRole !== '') compat.supportsDeveloperRole = draft.supportsDeveloperRole === 'true'
  if (draft.thinkingFormat !== '') compat.thinkingFormat = draft.thinkingFormat
  if (draft.supportsReasoningEffort !== '') compat.supportsReasoningEffort = draft.supportsReasoningEffort === 'true'
  if (draft.maxTokensField !== '') compat.maxTokensField = draft.maxTokensField
  if (draft.requiresReasoningContentOnAssistantMessages !== '') compat.requiresReasoningContentOnAssistantMessages = draft.requiresReasoningContentOnAssistantMessages === 'true'
  return Object.keys(compat).length === 0 ? undefined : compat
}

function materializeReasoning(model: ModelDraft): false | Record<string, string | null> | undefined {
  const mode = model.reasoningMode ?? 'unset'
  if (mode === 'unset') return undefined
  if (mode === 'false') return false
  const efforts: Record<string, string | null> = {}
  for (const effort of model.reasoningEfforts ?? []) {
    efforts[effort.level] = effort.level === 'off' && effort.wire.trim().length === 0 ? null : effort.wire.trim()
  }
  return efforts
}

/**
 * Materialize the wire profile for one route. Advanced fields are written from
 * their draft controls; omitted legacy draft fields preserve committed values.
 */
export function mergeProvider(
  committed: Record<string, unknown> | undefined,
  draft: ProviderDraft,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...committed }
  assign(merged, 'displayName', draft.displayName)
  assign(merged, 'apiKeyEnv', draft.apiKeyEnv)
  const api = draft.api ?? 'openai-completions'
  merged.api = api
  merged.baseURL = draft.baseURL.trim().replace(/\/+$/, '')
  if (api !== 'openai-completions') {
    delete merged.compat
  } else if (draft.compat !== undefined) {
    const compat = materializeCompat(draft.compat)
    if (compat === undefined) delete merged.compat
    else merged.compat = compat
  }
  const committedModels = Array.isArray(committed?.models) ? committed.models : []
  merged.models = draft.models.map((model) => {
    const previous = committedModels.find(
      (entry): entry is Record<string, unknown> => isPlainObject(entry) && entry.id === model.id.trim(),
    )
    const next: Record<string, unknown> = { ...previous, id: model.id.trim() }
    assign(next, 'name', model.name)
    next.contextWindow = parseCapacity(model.contextWindow)
    next.maxTokens = parseCapacity(model.maxTokens)
    if (model.reasoningMode !== undefined) {
      const reasoning = materializeReasoning(model)
      if (reasoning === undefined) delete next.reasoningEfforts
      else next.reasoningEfforts = reasoning
    }
    if (api !== 'openai-completions') {
      delete next.compat
    } else if (model.compat !== undefined) {
      const compat = materializeCompat(model.compat)
      if (compat === undefined) delete next.compat
      else next.compat = compat
    }
    return next
  })
  return merged
}

/**
 * Build the settings write for one provider save: a diff against the
 * committed section, or a single set for a route that does not exist yet.
 */
export function buildSaveOps(
  route: string,
  committed: Record<string, unknown> | undefined,
  draft: ProviderDraft,
): PathOp[] {
  const merged = mergeProvider(committed, draft)
  if (committed === undefined) return [{ op: 'set', path: ['providers', route], value: merged }]
  return diffOps(['providers', route], committed, merged)
}
