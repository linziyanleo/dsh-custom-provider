/**
 * Pure form-model helpers for the llm-custom settings section. No host or
 * React imports: this module is unit-tested from the Node side and bundled
 * into the browser client unchanged.
 */

/** One model row as edited in the form; capacities stay raw text until save. */
export interface ModelDraft {
  id: string
  name: string
  contextWindow: string
  maxTokens: string
}

/** The editable subset of one provider route. */
export interface ProviderDraft {
  displayName: string
  apiKeyEnv: string
  baseURL: string
  models: ModelDraft[]
}

/** One path-addressed settings write, mirroring the host's settings.mutate wire shape. */
export type PathOp =
  | { op: 'set'; path: readonly string[]; value: unknown }
  | { op: 'unset'; path: readonly string[] }

/** Route ids double as settings keys and provider ids; keep the dsh kebab-case convention. */
export const ROUTE_PATTERN = /^[a-z][a-z0-9-]*$/

/**
 * Parse a positive integer capacity, accepting the host's K/M suffixes
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
  }
  return undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

/**
 * Materialize the wire profile for one route. Fields the form does not edit
 * (`compat`, per-model `reasoningEfforts`) survive by merging over the
 * committed provider and, per model id, over the committed model entry.
 */
export function mergeProvider(
  committed: Record<string, unknown> | undefined,
  draft: ProviderDraft,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...committed }
  assign(merged, 'displayName', draft.displayName)
  assign(merged, 'apiKeyEnv', draft.apiKeyEnv)
  merged.api = 'openai-completions'
  merged.baseURL = draft.baseURL.trim().replace(/\/+$/, '')
  const committedModels = Array.isArray(committed?.models) ? committed.models : []
  merged.models = draft.models.map((model) => {
    const previous = committedModels.find(
      (entry): entry is Record<string, unknown> => isPlainObject(entry) && entry.id === model.id.trim(),
    )
    const next: Record<string, unknown> = { ...previous, id: model.id.trim() }
    assign(next, 'name', model.name)
    next.contextWindow = parseCapacity(model.contextWindow)
    next.maxTokens = parseCapacity(model.maxTokens)
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
