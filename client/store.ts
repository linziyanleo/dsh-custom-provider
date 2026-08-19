import type { HostApi } from './host'

/** Read one nested value by key path; undefined when any hop is missing. */
export function getPath(source: unknown, path: readonly string[]): unknown {
  let current = source
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/** Whether one key path exists (even with an undefined value) in a JSON tree. */
export function hasPath(source: unknown, path: readonly string[]): boolean {
  let current = source
  for (const key of path) {
    if (typeof current !== 'object' || current === null || !(key in current)) return false
    current = (current as Record<string, unknown>)[key]
  }
  return true
}

export interface ProviderRow {
  route: string
  /** Resolved provider section (schema defaults + base + user layers). */
  config: Record<string, unknown>
  credentialRef?: string
  credentialConfigured: boolean
  /** Only user-layer routes may be deleted from the page. */
  removable: boolean
}

export type SectionSnapshot =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; writable: boolean; revision: number; rows: ProviderRow[] }

const IDLE: SectionSnapshot = { status: 'loading' }

/** Snapshot store over the `llm-custom` settings namespace and its credentials. */
export class CustomProvidersStore {
  private readonly listeners = new Set<() => void>()
  private snapshot: SectionSnapshot = IDLE
  private generation = 0

  constructor(private readonly api: HostApi) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = (): SectionSnapshot => this.snapshot

  private set(snapshot: SectionSnapshot): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }

  async load(): Promise<void> {
    const generation = ++this.generation
    if (this.snapshot.status === 'ready' || this.snapshot.status === 'error') {
      // keep the last snapshot visible while refreshing
    } else {
      this.set(IDLE)
    }
    try {
      const settingsResponse = await this.api.settings.describe({})
      if (!settingsResponse.result.ok) throw new Error(settingsResponse.result.error.message)
      const { namespaces, writable } = settingsResponse.result.value
      const view = namespaces.find(candidate => candidate.ns === 'llm-custom')
      const providers = getPath(view?.value, ['providers'])
      const entries = typeof providers === 'object' && providers !== null && !Array.isArray(providers)
        ? Object.entries(providers as Record<string, unknown>)
        : []
      const refs = [...new Set(entries.flatMap(([, config]) => {
        const ref = getPath(config, ['apiKeyEnv'])
        return typeof ref === 'string' && ref.length > 0 ? [ref] : []
      }))]
      let credentials: Record<string, { configured: boolean }> = {}
      if (refs.length > 0) {
        const credentialsResponse = await this.api.credentials.describe({ refs })
        if (credentialsResponse.result.ok) credentials = credentialsResponse.result.value.credentials
      }
      if (generation !== this.generation) return
      const rows: ProviderRow[] = entries.map(([route, config]) => {
        const ref = getPath(config, ['apiKeyEnv'])
        const credentialRef = typeof ref === 'string' && ref.length > 0 ? ref : undefined
        const status = credentialRef === undefined ? undefined : credentials[credentialRef]
        return {
          route,
          config: typeof config === 'object' && config !== null ? config as Record<string, unknown> : {},
          ...credentialRef === undefined ? {} : { credentialRef },
          credentialConfigured: status?.configured === true,
          removable: hasPath(view?.user, ['providers', route]) && !hasPath(view?.base, ['providers', route]),
        }
      })
      this.set({ status: 'ready', writable, revision: view?.revision ?? 0, rows })
    } catch (error) {
      if (generation !== this.generation) return
      this.set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }
}
