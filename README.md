# dsh-custom-provider

`dsh-custom-provider` 是一个树外 DeepSeek Harness bundle。它把 `settings.yaml` 中的静态 OpenAI Chat Completions provider 注册到原生 `ctx.llm` seam，模型继续使用 DSH Web 的原生 picker、streaming、tool call、usage/finish、取消和 reasoning-effort 流程。

## 设计与配置 interface

插件只公开一个配置 interface：`llm-custom.providers.<route>`。每条 route 必须声明 credential ref、`openai-completions`、HTTP(S) `baseURL` 和至少一个静态模型；不会调用 `/models`，也不注册模型发现。加载时会先解析完整配置，再原子替换 adapter 路由与 configurable-provider directory；无效 URL、空目录、重复模型、非法 credential ref、容量或 reasoning 映射会直接失败。

```yaml
llm-custom:
  providers:
    routify:
      displayName: Routify
      apiKeyEnv: ROUTIFY_API_KEY
      api: openai-completions
      baseURL: https://routify.alibaba-inc.com/protocol/openai/v1
      compat:
        supportsStore: false
        supportsDeveloperRole: false
        thinkingFormat: deepseek
        supportsReasoningEffort: true
        maxTokensField: max_tokens
        requiresReasoningContentOnAssistantMessages: true
      models:
        - id: your-model-id
          name: Your Model
          contextWindow: 262144
          maxTokens: 32768
          reasoningEfforts:
            off:
            high: high
            max: max
          # 可选；逐字段覆盖 route compat。
          compat:
            supportsReasoningEffort: true
```

`reasoningEfforts` 的键是 DSH picker 展示的 pi-ai 档位，值是 provider 接收的 wire spelling。未声明的档位不支持；只有 `off:` 可以留空。设为 `false` 表示模型不提供 reasoning 控件。`contextWindow` 和 `maxTokens` 都是必填正整数；当前只声明文本输入。

密钥值不写入上述配置。`apiKeyEnv` 是 DSH credential ref，插件在每次请求时通过 `ctx.credentials.resolve()` 解析，因此凭据更新会在下一次请求生效；缺失或不可用的 ref 会在发请求前明确失败。

## 安装与验证

本地 checkout：

```sh
pnpm install
pnpm check
pnpm pack --pack-destination /tmp
npx @deepseek-ai/dsh plugin --profile web add /tmp/dsh-custom-provider-0.1.0.tgz
npx @deepseek-ai/dsh --profile web --dump-config
```

发布到 npm 后，安装命令可缩短为：

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-custom-provider
```

Git 安装需要信任并允许包的 `prepare` 构建脚本；建议固定 commit。pnpm 10+ 首次拒绝构建时，把它提示的精确包键加入该 profile 的 `pnpm-workspace.yaml` `allowBuilds`，再重试安装。

卸载：

```sh
npx @deepseek-ai/dsh plugin --profile web remove dsh-custom-provider
```

卸载 bundle 不会删除 `settings.yaml` 中的 `llm-custom` section 或 credential；需要时由用户分别清理。

## 兼容范围与限制

- 已针对 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-llm-pi-ai` `0.1.0-rc.7` 和 `@earendil-works/pi-ai` `0.82.1` 设计。要求官方包根导出 `PiAiAdapter`。
- 六个 compat 字段覆盖 deepseek-harness 提交 `9c9b2d47` 的私有 DeepSeek route 请求要求，绕开 `rc.7` 配置 schema 尚未公开完整字段的问题；没有导入 `@deepseek-ai/dsh-llm-pi-ai/src/*`。
- bundle patch 只插入独立的 `llm-custom` Cordis 行，不替换、禁用或 monkey-patch 官方 `llm-pi-ai`。
- 第一版仅支持 `openai-completions`、静态模型目录和文本模型；不含 Settings UI、自动发现、多协议或远端发布流程。
