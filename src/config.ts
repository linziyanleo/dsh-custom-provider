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

/**
 * Attach the English default and zh-CN translation rendered by the DSH Web
 * settings form (descriptions are display metadata; validation is unchanged).
 */
function bilingual<S extends z>(schema: S, en: string, zhCN: string): S {
  return schema.description(en).i18n({ 'zh-CN': zhCN }) as S
}

const compatSchema: z<CompatConfig> = bilingual(z.object({
  supportsStore: bilingual(z.boolean(),
    'Send the store parameter',
    '发送 store 参数'),
  supportsDeveloperRole: bilingual(z.boolean(),
    'Use the developer role for system prompts',
    '系统提示使用 developer 角色'),
  thinkingFormat: bilingual(z.union(THINKING_FORMATS),
    'Thinking format the provider understands',
    '提供方识别的思考格式'),
  supportsReasoningEffort: bilingual(z.boolean(),
    'Send the reasoning effort parameter',
    '发送 reasoning effort 参数'),
  maxTokensField: bilingual(z.union(['max_completion_tokens', 'max_tokens']),
    'Wire field carrying the max tokens limit',
    '承载 max tokens 上限的线字段'),
  requiresReasoningContentOnAssistantMessages: bilingual(z.boolean(),
    'Keep reasoning_content on replayed assistant messages',
    '回放助手消息时保留 reasoning_content'),
}),
  'Request compatibility overrides for this provider',
  '该提供方的请求兼容性覆盖').collapse()

const reasoningEffortsSchema = bilingual(
  z.dict(
    z.union([z.string(), z.const(null)]),
    z.union(THINKING_LEVELS),
  ) as unknown as z<ReasoningEfforts>,
  'Wire spelling per reasoning level; only off may be empty',
  '各推理档位对应的线值；仅 off 可为空',
)

const modelSchema: z<ModelConfig> = z.object({
  id: bilingual(z.string().required(),
    'Model id sent to the provider',
    '发送给提供方的模型 ID'),
  name: bilingual(z.string(),
    'Display name in the model picker (defaults to the model id)',
    '模型选择器中的显示名称（默认为模型 ID）'),
  contextWindow: bilingual(z.number().step(1).min(1).required(),
    'Context window size in tokens',
    '上下文窗口大小（token 数）'),
  maxTokens: bilingual(z.number().step(1).min(1).required(),
    'Maximum output tokens per response',
    '单次响应的最大输出 token 数'),
  reasoningEfforts: bilingual(z.union([z.const(false), reasoningEffortsSchema]),
    'Selectable reasoning levels; set to false to hide the reasoning control',
    '可选推理档位；设为 false 则不提供推理控件'),
  compat: bilingual(compatSchema,
    'Per-model overrides of the provider compatibility settings',
    '按模型覆盖提供方兼容性设置').collapse(),
})

const providerSchema: z<ProviderConfig> = z.object({
  displayName: bilingual(z.string(),
    'Display name in the model picker (defaults to the route id)',
    '模型选择器中的显示名称（默认为路由 ID）'),
  apiKeyEnv: bilingual(z.string().role('credential-ref').required(),
    'Credential reference resolved per request, e.g. ROUTIFY_API_KEY',
    '凭据引用，每次请求时解析，例如 ROUTIFY_API_KEY'),
  api: bilingual(z.union([OPENAI_COMPLETIONS_API]).required(),
    'Wire protocol (only openai-completions is supported)',
    '线协议（当前仅支持 openai-completions）'),
  baseURL: bilingual(z.string().required(),
    'Absolute http(s) endpoint of the OpenAI-compatible API',
    'OpenAI 兼容接口的绝对 http(s) 地址'),
  compat: bilingual(compatSchema,
    'Compatibility defaults inherited by every model on this route',
    '该路由下所有模型继承的兼容性默认值').collapse(),
  models: bilingual(z.array(modelSchema).required(),
    'Static model catalog served by this provider (at least one)',
    '该提供方提供的静态模型目录（至少一个）'),
})

/** Runtime schema for the `llm-custom` settings namespace and Cordis row. */
export const Config: z<ConfigShape> = bilingual(z.object({
  providers: bilingual(z.dict(providerSchema).default({}),
    'Custom provider routes keyed by route id',
    '以路由 ID 为键的自定义提供方路由'),
}),
  'Static OpenAI-compatible providers',
  '静态 OpenAI 兼容提供方')
