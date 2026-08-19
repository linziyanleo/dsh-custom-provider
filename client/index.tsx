import { en, zh } from './locales'
import { CustomProvidersStore } from './store'
import { CustomProvidersSection } from './section'
import type { ClientCtx } from './host'

/** Locale namespace and settings namespace share the plugin's short name. */
const NS = 'llm-custom'

/** Browser fiber services this module needs (cordis inject, matched by name). */
export const inject = ['slots', 'locale', 'connection', 'remote']

/**
 * Register the llm-custom settings section into the settings shell once the
 * `settings.section` slot is declared, and keep its snapshot fresh on pushed
 * settings/credential invalidations.
 */
export function apply(ctx: ClientCtx): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'llm-custom: copy dictionaries')
  const connection = ctx.get('connection')
  if (connection === undefined) return
  const store = new CustomProvidersStore(connection.api)
  const t = ctx.locale.bind(NS)
  ctx.effect(() => {
    const refresh = (): void => { void store.load() }
    const disposers = [
      ctx.remote.$on('settings/document-updated', refresh),
      ctx.remote.$on('credentials/updated', refresh),
      ctx.on('connection/reset', refresh),
    ]
    refresh()
    return () => { for (const dispose of disposers) dispose() }
  }, 'llm-custom: pushed invalidations')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: NS,
    order: 20,
    label: () => t('nav'),
    inject: () => ({ api: connection.api, t, store }),
  }, CustomProvidersSection))
}
