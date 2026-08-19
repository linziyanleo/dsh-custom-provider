# dsh-custom-provider

[English](README.md) | [简体中文](README.zh.md)

A DSH plugin for configuring static OpenAI-compatible providers and model catalogs from the Web settings UI or `settings.yaml`.

## The problem it solves

An OpenAI-compatible endpoint may need more than a base URL and an API key: its model catalog may be known in advance, model capacities may need to be declared explicitly, and request fields for reasoning or message replay may differ between providers.

`dsh-custom-provider` turns that information into provider routes that DeepSeek Harness (DSH) can use directly. Configured models appear in DSH's native model picker and continue through its standard streaming, tool-call, usage, finish-reason, cancellation, and reasoning-effort flows.

## What the plugin provides

- A bilingual Web settings page for adding, editing, and removing custom providers.
- A declarative `llm-custom.providers` configuration for `settings.yaml`.
- A static model catalog; the plugin does not depend on a provider's `/models` endpoint.
- Per-request credential resolution through the DSH credentials service. API keys are not stored in `settings.yaml`.
- Provider-level defaults and per-model overrides for OpenAI Chat Completions compatibility fields.
- Full-config validation before route registrations are replaced, so an invalid edit does not partially activate.

## Screenshots

### Web settings

Provider credentials, endpoints, models, capacities, and advanced compatibility fields can be managed in DSH Web.

![Custom Providers settings page](docs/images/custom-providers-settings.png)

### YAML configuration

The same provider and model catalog can be managed directly in `settings.yaml`.

![llm-custom configuration in settings.yaml](docs/images/settings-yaml.png)

## Requirements

- Node.js `^22.19.0` or `>=24.0.0`
- DeepSeek Harness with the Web profile
- DSH `0.1.0-rc.7` compatible packages; see [`peerDependencies`](package.json) for the complete contract

## Installation

Build and install a package from a local checkout:

```sh
git clone https://github.com/linziyanleo/dsh-custom-provider.git
cd dsh-custom-provider
pnpm install --frozen-lockfile
pnpm check
pnpm pack --pack-destination /tmp
npx @deepseek-ai/dsh plugin --profile web add /tmp/dsh-custom-provider-0.1.0.tgz
```

Verify that DSH loads the bundle and its configuration namespace:

```sh
npx @deepseek-ai/dsh --profile web --dump-config
```

When installing directly from Git, pin a commit and allow the package's `prepare` build script if your package-manager policy blocks dependency build scripts.

## Configuration

### Web settings

Open **Settings → Custom Providers** in DSH Web, then:

1. Add a provider ID, display name, API base URL, and credential reference.
2. Enter the API key. The field is write-only and stores the value through the DSH credentials service.
3. Add one or more models with their model IDs, display names, context windows, and maximum outputs. Capacity inputs accept integers and `K`/`M` suffixes such as `200K` or `1m`.
4. Expand **Advanced** only when the endpoint requires compatibility overrides or custom reasoning-effort mappings.
5. Save the provider. Its models become available to the model picker immediately after the settings change is applied.

### `settings.yaml`

```yaml
llm-custom:
  providers:
    example:
      displayName: Example Provider
      apiKeyEnv: EXAMPLE_API_KEY
      api: openai-completions
      baseURL: https://api.example.com/v1
      compat:
        supportsStore: false
        supportsDeveloperRole: false
        thinkingFormat: deepseek
        supportsReasoningEffort: true
        maxTokensField: max_tokens
        requiresReasoningContentOnAssistantMessages: true
      models:
        - id: example-model
          name: Example Model
          contextWindow: 262144
          maxTokens: 32768
          reasoningEfforts:
            off:
            high: high
            max: max
```

`apiKeyEnv` is a credential reference, not the secret itself. Configure its value through DSH's credentials service or the Web settings page.

## Configuration reference

Each key below is relative to `llm-custom.providers.<provider-id>`.

In the Web UI, a provider ID must start with a lowercase letter and contain only lowercase letters, digits, and dashes.

### Provider fields

| Field | Required | Description |
| --- | --- | --- |
| `displayName` | No | Name shown in the model picker. Defaults to the provider ID. |
| `apiKeyEnv` | Yes | DSH credential reference resolved before every request. |
| `api` | Yes | Wire protocol. The supported value is `openai-completions`. |
| `baseURL` | Yes | Absolute HTTP(S) base URL of the OpenAI-compatible endpoint. Trailing slashes are normalized. |
| `compat` | No | Compatibility defaults inherited by every model on the route. |
| `models` | Yes | Static model catalog containing at least one model. Model IDs must be unique within the provider. |

### Model fields

| Field | Required | Description |
| --- | --- | --- |
| `id` | Yes | Model ID sent to the provider. |
| `name` | No | Name shown in the model picker. Defaults to `id`. |
| `contextWindow` | Yes | Positive integer context-window size in tokens. |
| `maxTokens` | Yes | Positive integer maximum output size in tokens. |
| `reasoningEfforts` | No | Selectable DSH reasoning levels mapped to provider wire values. Set to `false` to disable the reasoning control. |
| `compat` | No | Per-model compatibility values. Each declared field overrides the provider-level value. |

### Compatibility fields

`compat` accepts the same fields at provider and model level:

| Field | Values | Effect |
| --- | --- | --- |
| `supportsStore` | `true` / `false` | Whether the request may send the OpenAI `store` parameter. |
| `supportsDeveloperRole` | `true` / `false` | Whether system prompts may use the `developer` role. |
| `thinkingFormat` | `openai`, `deepseek`, `openrouter`, `together`, `zai`, `qwen`, `string-thinking`, `ant-ling` | Reasoning-content format understood by the endpoint. |
| `supportsReasoningEffort` | `true` / `false` | Whether the request may send a reasoning-effort parameter. |
| `maxTokensField` | `max_completion_tokens` / `max_tokens` | Request field used for the maximum output limit. |
| `requiresReasoningContentOnAssistantMessages` | `true` / `false` | Whether replayed assistant messages retain `reasoning_content`. |

Only declare compatibility fields required by the endpoint; omitted model fields inherit the provider-level values.

### Reasoning-effort mappings

The supported DSH levels are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`. A mapping value is the exact string expected by the provider. Only `off` may be empty (`null` in YAML), and a mapping must expose at least one non-`off` level. Omitted levels are unavailable in the picker.

```yaml
reasoningEfforts:
  off:
  medium: medium
  high: high
```

Use `reasoningEfforts: false` when the model does not provide a reasoning control.

## Security and lifecycle notes

- API keys are resolved for each request and are never written into the `llm-custom` settings section.
- Replacing a key in the Web UI updates the referenced credential without displaying the stored value.
- Deleting a provider or uninstalling the plugin does not delete its credential or the `llm-custom` section. Remove those separately when they are no longer needed.

## Current scope

- OpenAI Chat Completions-compatible endpoints only
- Static, text-input model catalogs only
- No remote model discovery
- No automatic provider-specific defaults; compatibility fields are explicit configuration

## Uninstall

```sh
npx @deepseek-ai/dsh plugin --profile web remove dsh-custom-provider
```

The uninstall command removes the plugin bundle only. See the lifecycle notes above for settings and credential cleanup.

## Development

```sh
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` runs the offline test suite, server and client type checks, the production build, and a client-bundle assertion. Live-provider acceptance is intentionally opt-in and is not part of the default check.

## License

[MIT](LICENSE)
