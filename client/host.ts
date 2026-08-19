/**
 * Minimal structural types for the host browser services this module touches.
 * The real objects are the cordis client services (`slots`, `locale`,
 * `connection`, `remote`); declaring the used surface locally keeps the type
 * graph free of the host packages' client type trees.
 */
import type { PathOp } from './ops'

export interface RemoteError {
  code?: string
  message: string
}

export type RemoteResult<T> = Promise<{
  result: { ok: true; value: T } | { ok: false; error: RemoteError }
}>

export interface SettingsNamespaceView {
  ns: string
  value: unknown
  revision: number
  base?: unknown
  user?: unknown
}

export interface SettingsDescribeValue {
  namespaces: SettingsNamespaceView[]
  writable: boolean
}

export interface CredentialStatus {
  configured: boolean
  source?: string
  writable?: boolean
}

export interface HostApi {
  settings: {
    describe(input: Record<string, never>): RemoteResult<SettingsDescribeValue>
    mutate(input: {
      ns: string
      ops: readonly PathOp[]
      expectedRevision?: number
    }): RemoteResult<unknown>
  }
  credentials: {
    describe(input: { refs: readonly string[] }): RemoteResult<{ credentials: Record<string, CredentialStatus> }>
    set(input: { ref: string; value: string }): RemoteResult<unknown>
    unset(input: { ref: string }): RemoteResult<unknown>
  }
}

export type Translate = (key: string, params?: Record<string, unknown>) => string

export interface LocaleFace {
  register(ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): () => void
  bind(ns: string): Translate
}

export interface SlotRegistration {
  name: string
  id: string
  order?: number
  label?: () => string
  inject?: () => Record<string, unknown>
}

export interface SlotsFace {
  inject(key: string, callback: () => (() => void) | Iterable<() => void, void, void>): () => void
  register(options: SlotRegistration, component: unknown): () => void
}

export interface ConnectionService {
  api: HostApi
}

export interface RemoteEvents {
  $on(event: string, listener: (...args: any[]) => void): () => void
}

/** The cordis client context, narrowed to what this bundle uses. */
export interface ClientCtx {
  effect(fn: () => (() => void) | void, label?: string): void
  on(event: string, listener: (...args: any[]) => void): () => void
  get(name: 'connection'): ConnectionService | undefined
  locale: LocaleFace
  slots: SlotsFace
  remote: RemoteEvents
}
