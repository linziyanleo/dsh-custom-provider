import { Button, DisclosureRow, Input, IconSettingsOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconAction } from './icon-action'
import type { Translate } from './host'
import type { CompatDraft, ModelDraft, ProviderDraft, ReasoningEffortDraft, ReasoningMode, ThinkingLevel } from './ops'
import { emptyCompatDraft, THINKING_FORMATS, THINKING_LEVELS } from './ops'

const labelStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
  color: 'var(--dsw-alias-label-secondary, inherit)',
} as const

const fieldNameStyle = { fontSize: 12, color: 'var(--dsw-alias-label-primary, inherit)' } as const

const hintStyle = {
  margin: 0,
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-tertiary, inherit)',
} as const

const selectStyle = {
  width: '100%',
  padding: '7px 8px',
  borderRadius: 8,
  border: '1px solid var(--dsw-alias-border-secondary, rgba(127, 127, 127, 0.25))',
  background: 'var(--dsw-alias-surface, transparent)',
  color: 'var(--dsw-alias-label-primary, inherit)',
  fontSize: 13,
} as const

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: 12,
} as const

function TriField(props: {
  label: string
  hint: string
  value: CompatDraft['supportsStore']
  disabled: boolean
  unsetLabel: string
  trueLabel: string
  falseLabel: string
  onChange(value: CompatDraft['supportsStore']): void
}) {
  return (
    <label style={labelStyle}>
      <span style={fieldNameStyle}>{props.label}</span>
      <span style={hintStyle}>{props.hint}</span>
      <select
        style={selectStyle}
        value={props.value}
        disabled={props.disabled}
        onChange={event => props.onChange(event.target.value as CompatDraft['supportsStore'])}
      >
        <option value="">{props.unsetLabel}</option>
        <option value="true">{props.trueLabel}</option>
        <option value="false">{props.falseLabel}</option>
      </select>
    </label>
  )
}

function CompatFields(props: {
  t: Translate
  value: CompatDraft
  disabled: boolean
  onChange(patch: Partial<CompatDraft>): void
}) {
  const { t, value, disabled, onChange } = props
  const triProps = {
    disabled,
    unsetLabel: t('advancedUnset'),
    trueLabel: t('booleanTrue'),
    falseLabel: t('booleanFalse'),
  }
  return (
    <div style={gridStyle}>
      <TriField
        {...triProps}
        label={t('compatSupportsStore')}
        hint={t('compatSupportsStoreHint')}
        value={value.supportsStore}
        onChange={next => onChange({ supportsStore: next })}
      />
      <TriField
        {...triProps}
        label={t('compatSupportsDeveloperRole')}
        hint={t('compatSupportsDeveloperRoleHint')}
        value={value.supportsDeveloperRole}
        onChange={next => onChange({ supportsDeveloperRole: next })}
      />
      <TriField
        {...triProps}
        label={t('compatSupportsReasoningEffort')}
        hint={t('compatSupportsReasoningEffortHint')}
        value={value.supportsReasoningEffort}
        onChange={next => onChange({ supportsReasoningEffort: next })}
      />
      <TriField
        {...triProps}
        label={t('compatRequiresReasoningContent')}
        hint={t('compatRequiresReasoningContentHint')}
        value={value.requiresReasoningContentOnAssistantMessages}
        onChange={next => onChange({ requiresReasoningContentOnAssistantMessages: next })}
      />
      <label style={labelStyle}>
        <span style={fieldNameStyle}>{t('compatThinkingFormat')}</span>
        <span style={hintStyle}>{t('compatThinkingFormatHint')}</span>
        <select
          style={selectStyle}
          value={value.thinkingFormat}
          disabled={disabled}
          onChange={event => onChange({ thinkingFormat: event.target.value as CompatDraft['thinkingFormat'] })}
        >
          <option value="">{t('advancedUnset')}</option>
          {THINKING_FORMATS.map(format => <option key={format} value={format}>{format}</option>)}
        </select>
      </label>
      <label style={labelStyle}>
        <span style={fieldNameStyle}>{t('compatMaxTokensField')}</span>
        <span style={hintStyle}>{t('compatMaxTokensFieldHint')}</span>
        <select
          style={selectStyle}
          value={value.maxTokensField}
          disabled={disabled}
          onChange={event => onChange({ maxTokensField: event.target.value as CompatDraft['maxTokensField'] })}
        >
          <option value="">{t('advancedUnset')}</option>
          <option value="max_completion_tokens">max_completion_tokens</option>
          <option value="max_tokens">max_tokens</option>
        </select>
      </label>
    </div>
  )
}

function ReasoningEffortRow(props: {
  t: Translate
  effort: ReasoningEffortDraft
  usedLevels: ReadonlySet<ThinkingLevel>
  disabled: boolean
  onChange(patch: Partial<ReasoningEffortDraft>): void
  onRemove(): void
}) {
  const { t, effort, usedLevels, disabled, onChange, onRemove } = props
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <label style={{ ...labelStyle, minWidth: 120, flex: 1 }}>
        {t('reasoningLevel')}
        <select
          style={selectStyle}
          value={effort.level}
          disabled={disabled}
          onChange={event => onChange({ level: event.target.value as ThinkingLevel })}
        >
          {THINKING_LEVELS.map(level => (
            <option key={level} value={level} disabled={level !== effort.level && usedLevels.has(level)}>
              {level}
            </option>
          ))}
        </select>
      </label>
      <label style={{ ...labelStyle, minWidth: 160, flex: 2 }}>
        {t('reasoningWire')}
        <Input
          value={effort.wire}
          placeholder={effort.level === 'off' ? t('reasoningOffPlaceholder') : t('reasoningWirePlaceholder')}
          disabled={disabled}
          onChange={event => onChange({ wire: event.target.value })}
        />
      </label>
      <IconAction
        label={t('removeReasoningLevel')}
        icon={<IconTrashOutline16 size={16} />}
        disabled={disabled}
        onClick={onRemove}
      />
    </div>
  )
}

export function ModelAdvancedFields(props: {
  t: Translate
  model: ModelDraft
  disabled: boolean
  onChange(patch: Partial<ModelDraft>): void
}) {
  const { t, model, disabled, onChange } = props
  const mode = model.reasoningMode ?? 'unset'
  const efforts = model.reasoningEfforts ?? []
  const usedLevels = new Set(efforts.map(effort => effort.level))
  const addLevel = (): void => {
    const next = THINKING_LEVELS.find(level => level !== 'off' && !usedLevels.has(level))
      ?? THINKING_LEVELS.find(level => !usedLevels.has(level))
    if (next === undefined) return
    onChange({ reasoningEfforts: [...efforts, { level: next, wire: '' }] })
  }
  const setMode = (next: ReasoningMode): void => {
    onChange({ reasoningMode: next })
  }
  const patchEffort = (at: number, patch: Partial<ReasoningEffortDraft>): void => {
    onChange({ reasoningEfforts: efforts.map((effort, index) => index === at ? { ...effort, ...patch } : effort) })
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label style={labelStyle}>
        <span style={fieldNameStyle}>{t('reasoningEfforts')}</span>
        <span style={hintStyle}>{t('reasoningEffortsHint')}</span>
        <select
          style={selectStyle}
          value={mode}
          disabled={disabled}
          onChange={event => setMode(event.target.value as ReasoningMode)}
        >
          <option value="unset">{t('reasoningUnset')}</option>
          <option value="false">{t('reasoningDisabled')}</option>
          <option value="custom">{t('reasoningCustom')}</option>
        </select>
      </label>
      {mode === 'custom' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {efforts.map((effort, at) => (
            <ReasoningEffortRow
              key={at}
              t={t}
              effort={effort}
              usedLevels={usedLevels}
              disabled={disabled}
              onChange={patch => patchEffort(at, patch)}
              onRemove={() => onChange({ reasoningEfforts: efforts.filter((_, index) => index !== at) })}
            />
          ))}
          <div>
            <Button size="sm" disabled={disabled || usedLevels.size >= THINKING_LEVELS.length} onClick={addLevel}>
              {t('addReasoningLevel')}
            </Button>
          </div>
        </div>
      ) : null}
      <CompatFields
        t={t}
        value={model.compat ?? emptyCompatDraft()}
        disabled={disabled}
        onChange={patch => onChange({ compat: { ...(model.compat ?? emptyCompatDraft()), ...patch } })}
      />
    </div>
  )
}

export function AdvancedEditor(props: {
  t: Translate
  draft: ProviderDraft
  writable: boolean
  busy: boolean
  open: boolean
  onToggle(open: boolean): void
  onPatch(patch: Partial<ProviderDraft>): void
}) {
  const { t, draft, writable, busy, open, onToggle, onPatch } = props
  const disabled = !writable || busy
  return (
    <DisclosureRow
      icon={<IconSettingsOutline16 size={16} />}
      title={t('advanced')}
      open={open}
      expandable
      expandOnRowClick
      previewChevron
      onToggle={() => onToggle(!open)}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
        <p style={hintStyle}>{t('advancedHint')}</p>
        <CompatFields
          t={t}
          value={draft.compat ?? emptyCompatDraft()}
          disabled={disabled}
          onChange={patch => onPatch({ compat: { ...(draft.compat ?? emptyCompatDraft()), ...patch } })}
        />
      </div>
    </DisclosureRow>
  )
}
