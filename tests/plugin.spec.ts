import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import * as CustomProvider from '../src/index.js'
import type { ConfigShape } from '../src/index.js'
import { MemoryCredentials, routeConfig, TEST_CREDENTIAL_REF } from './helpers.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function settingsFile(contents: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-custom-provider-settings-'))
  tempDirs.push(dir)
  const path = join(dir, 'settings.yaml')
  await writeFile(path, contents)
  return path
}

async function boot(config: ConfigShape): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(MemoryCredentials, { [TEST_CREDENTIAL_REF]: 'test-key' })
  await ctx.plugin(CustomProvider, config)
  return ctx
}

describe('DSH registration seams', () => {
  it('registers the adapter, native model catalog, and configurable-provider directory', async () => {
    const ctx = await boot(routeConfig('https://gateway.example/v1'))

    expect(ctx.llm.listProviders()).toEqual([{ id: 'routify', name: 'Routify' }])
    expect(ctx.llm.listConfigurableProviders()).toEqual([{
      provider: 'routify',
      displayName: 'Routify',
      settingsNs: 'llm-custom',
      settingsPath: ['providers', 'routify'],
      declared: true,
    }])
    expect(await ctx.llm.listModels('routify')).toEqual([{
      provider: 'routify',
      id: 'routify-model',
      name: 'Routify Model',
      inputModalities: ['text'],
    }])
    expect(await ctx.llm.resolveModelInfo('routify', 'routify-model')).toMatchObject({
      provider: 'routify',
      id: 'routify-model',
      context: { contextWindow: 262_144 },
      defaultMaxTokens: 32_768,
      reasoning: {
        efforts: [
          { id: 'off', name: 'Off' },
          { id: 'high', name: 'High' },
          { id: 'max', name: 'Max' },
        ],
      },
    })
  })

  it('fails an invalid composition config while the plugin loads', async () => {
    const config = routeConfig('https://gateway.example/v1')
    config.providers!.routify!.models[0]!.contextWindow = 0
    await expect(boot(config)).rejects.toThrow(/contextWindow expected number >= 1/)
  })

  it('mounts dormant when no settings section or composition routes exist', async () => {
    const ctx = await boot({})
    expect(ctx.llm.listProviders()).toEqual([])
    expect(ctx.llm.listConfigurableProviders()).toEqual([])
  })

  it('activates a static route from the llm-custom settings namespace', async () => {
    const path = await settingsFile(`
llm-custom:
  providers:
    settings-route:
      displayName: Settings Route
      apiKeyEnv: SETTINGS_ROUTE_KEY
      api: openai-completions
      baseURL: https://gateway.example/v1
      models:
        - id: settings-model
          contextWindow: 65536
          maxTokens: 4096
`)
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(FileSettingsProvider, { path, watch: false })
    await ctx.plugin(CustomProvider, {})

    expect(ctx.llm.listProviders()).toEqual([{ id: 'settings-route', name: 'Settings Route' }])
    expect(await ctx.llm.listModels('settings-route')).toEqual([{
      provider: 'settings-route',
      id: 'settings-model',
      name: 'settings-model',
      inputModalities: ['text'],
    }])
  })
})
