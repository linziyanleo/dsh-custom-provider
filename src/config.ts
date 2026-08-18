import z from '@deepseek-ai/schemastery'
import type { ModelThinkingLevel, OpenAICompletionsCompat } from '@earendil-works/pi-ai'

/** The only wire protocol supported by the first bundle release. */
export const OPENAI_COMPLETIONS_API = 'openai-completions' as const

/** Pi-ai reasoning levels in selector order. */
export const THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly ModelThinkingLevel[]

/** Pi-ai thinking formats usable without chat-template kwargs. */
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

/** The six private-route fields introduced by DeepSeek Harness commit 9c9b2d47. */
export interface CompatConfig {
  supportsStore?: boolean
  supportsDeveloperRole?: boolean
  thinkingFormat?: typeof THINKING_FORMATS[number]
  supportsReasoningEffort?: boolean
  maxTokensField?: NonNullable<OpenAICompletionsCompat['maxTokensField']>
  requiresReasoningContentOnAssistantMessages?: boolean
}

/** Selectable pi-ai level to provider wire spelling; only `off` may be null. */
export type ReasoningEfforts = Partial<Record<ModelThinkingLevel, string | null>>

/** One model in a provider's static catalog. */
export interface ModelConfig {
  id: string
  name?: string
  contextWindow: number
  maxTokens: number
  reasoningEfforts?: false | ReasoningEfforts
  compat?: CompatConfig
}

/** One OpenAI-compatible provider route. */
export interface ProviderConfig {
  displayName?: string
  apiKeyEnv: string
  api: typeof OPENAI_COMPLETIONS_API
  baseURL: string
  compat?: CompatConfig
  models: ModelConfig[]
}

/** Settings section stored under `llm-custom`. */
export interface ConfigShape {
  providers?: Record<string, ProviderConfig>
}

const compatSchema: z<CompatConfig> = z.object({
  supportsStore: z.boolean(),
  supportsDeveloperRole: z.boolean(),
  thinkingFormat: z.union(THINKING_FORMATS),
  supportsReasoningEffort: z.boolean(),
  maxTokensField: z.union(['max_completion_tokens', 'max_tokens']),
  requiresReasoningContentOnAssistantMessages: z.boolean(),
})

const reasoningEffortsSchema = z.dict(
  z.union([z.string(), z.const(null)]),
  z.union(THINKING_LEVELS),
) as unknown as z<ReasoningEfforts>

const modelSchema: z<ModelConfig> = z.object({
  id: z.string().required(),
  name: z.string(),
  contextWindow: z.number().step(1).min(1).required(),
  maxTokens: z.number().step(1).min(1).required(),
  reasoningEfforts: z.union([z.const(false), reasoningEffortsSchema]),
  compat: compatSchema,
})

const providerSchema: z<ProviderConfig> = z.object({
  displayName: z.string(),
  apiKeyEnv: z.string().role('credential-ref').required(),
  api: z.union([OPENAI_COMPLETIONS_API]).required(),
  baseURL: z.string().required(),
  compat: compatSchema,
  models: z.array(modelSchema).required(),
})

/** Runtime schema for the `llm-custom` settings namespace and Cordis row. */
export const Config: z<ConfigShape> = z.object({
  providers: z.dict(providerSchema).default({}),
})
