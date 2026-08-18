import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  assertUsableApiKey,
  LlmError,
} from '@deepseek-ai/dsh-llm'
import type {
  AdapterRegistrationHandle,
  DirectoryRegistrationHandle,
  LlmConfigurableProvider,
} from '@deepseek-ai/dsh-llm'
import {
  PiAiAdapter,
} from '@deepseek-ai/dsh-llm-pi-ai'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import {
  installSettingsSection,
  settingsNamespace,
} from '@deepseek-ai/dsh-settings'
import { Config } from './config.js'
import type { ConfigShape } from './config.js'
import { resolveProviders } from './provider.js'

export { Config } from './config.js'
export type {
  CompatConfig,
  ConfigShape,
  ModelConfig,
  ProviderConfig,
  ReasoningEfforts,
} from './config.js'

export const name = 'llm-custom'
export const inject = ['llm']

const NS = settingsNamespace('llm-custom')

/** Directory entries for exactly the statically configured routes. */
function directoryEntries(
  profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>,
): LlmConfigurableProvider[] {
  return [...profiles.entries()].map(([provider, profile]) => ({
    provider,
    displayName: profile.displayName,
    settingsNs: NS,
    settingsPath: ['providers', provider],
    declared: true,
  }))
}

/** Register the settings-driven static routes through the public DSH seams. */
export function apply(ctx: Context, config: ConfigShape): void {
  let activeProfiles = resolveProviders(config)
  let source: () => ConfigShape = () => config
  let registration: AdapterRegistrationHandle | undefined
  let directory: DirectoryRegistrationHandle | undefined

  const adapter = new PiAiAdapter({
    profiles: () => activeProfiles,
    resolveApiKey: async (provider, profile) => {
      const ref = profile.apiKeyEnv
      if (ref === undefined) {
        throw new LlmError(`llm-custom: provider route "${provider}" has no credential reference`, 'MISSING_CREDENTIAL')
      }
      const credentials = ctx.get('credentials')
      if (credentials === undefined) {
        throw new LlmError('llm-custom: the credentials service is unavailable', 'MISSING_CREDENTIAL')
      }
      const hit = await credentials.resolve(credentialRef(ref))
      if (hit === undefined || hit.value.length === 0) {
        throw new LlmError(
          `llm-custom: no credential is configured for provider route "${provider}" reference ${ref}`,
          'MISSING_CREDENTIAL',
        )
      }
      return assertUsableApiKey(hit.value, 'llm-custom', ref)
    },
    onReplayDegrade: ({ provider, model, reason }) => {
      ctx.logger.warn(
        `llm-custom: unusable replay state for "${provider}/${model}"; sending provider-neutral history (${reason})`,
      )
    },
  })

  /** Atomically replace route ownership and its configurable-provider directory. */
  const activate = (nextConfig: ConfigShape): void => {
    const nextProfiles = resolveProviders(nextConfig)
    const previousProfiles = activeProfiles
    const previousRoutes = [...previousProfiles.keys()]
    const nextRoutes = [...nextProfiles.keys()]
    const nextDirectory = directoryEntries(nextProfiles)
    let createdRegistration = false
    let replacedRegistration = false

    activeProfiles = nextProfiles
    try {
      if (registration === undefined) {
        if (nextRoutes.length > 0) {
          registration = ctx.llm.registerAdapter(nextRoutes, adapter)
          createdRegistration = true
        }
      } else {
        registration.replace(nextRoutes)
        replacedRegistration = true
      }

      if (directory === undefined) {
        if (nextDirectory.length > 0) directory = ctx.llm.registerConfigurableProviders(nextDirectory)
      } else {
        directory.replace(nextDirectory)
      }
    } catch (error) {
      activeProfiles = previousProfiles
      if (createdRegistration) {
        registration?.()
        registration = undefined
      } else if (replacedRegistration) {
        registration?.replace(previousRoutes)
      }
      throw error
    }
  }

  if (activeProfiles.size > 0) activate(config)

  installSettingsSection(ctx, NS, Config, config, {
    validate: value => { resolveProviders(value) },
    setSource: (next) => { source = next },
    onChange: () => { activate(source()) },
  })
}
