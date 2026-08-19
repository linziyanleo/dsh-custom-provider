import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  Button,
  Input,
  Modal,
  StateDot,
  IconChevronDownOutline14,
  IconChevronUpOutline14,
  IconEditOutline16,
  IconTrashOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { AdvancedEditor, ModelAdvancedFields } from './advanced'
import { IconAction } from './icon-action'
import type { HostApi, Translate } from './host'
import type { CustomProvidersStore } from './store'
import { buildSaveOps, draftFromConfig, emptyModelDraft, isAdvancedDirty, PROVIDER_APIS, validateDraft, validateRoute } from './ops'
import type { ModelDraft, ProviderApi, ProviderDraft } from './ops'

const NS = 'llm-custom'

const cardStyle = {
  border: '1px solid var(--dsw-alias-border-secondary, rgba(127, 127, 127, 0.25))',
  borderRadius: 12,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
} as const

const labelStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
  color: 'var(--dsw-alias-label-secondary, inherit)',
} as const

const hintStyle = {
  margin: 0,
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-tertiary, inherit)',
} as const

const errorStyle = { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-error, #d4351c)' } as const

const successStyle = { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-positive, #1a7f37)' } as const

const selectStyle = {
  width: '100%',
  padding: '7px 8px',
  borderRadius: 8,
  border: '1px solid var(--dsw-alias-border-secondary, rgba(127, 127, 127, 0.25))',
  background: 'var(--dsw-alias-surface, transparent)',
  color: 'var(--dsw-alias-label-primary, inherit)',
  fontSize: 13,
} as const

function displayNameOf(config: Record<string, unknown>, route: string): string {
  return typeof config.displayName === 'string' && config.displayName.trim().length > 0
    ? config.displayName.trim()
    : route
}

function modelCountOf(config: Record<string, unknown>): number {
  return Array.isArray(config.models) ? config.models.length : 0
}

type ValidationError =
  | { field: 'route' | 'baseURL' | 'apiKeyEnv' | 'models'; message: string }
  | { field: 'model'; index: number; message: string }

function errorFor(validation: ValidationError | undefined, field: ValidationError['field']): string | undefined {
  return validation !== undefined && validation.field === field ? validation.message : undefined
}

interface EditorProps {
  api: HostApi
  t: Translate
  writable: boolean
  revision: number
  /** Existing routes, for the taken check when adding. */
  taken: readonly string[]
  /** Set when editing; undefined = adding a new provider. */
  editing?: { route: string; config: Record<string, unknown>; credentialConfigured: boolean }
  onClose: (saved: boolean, label?: string) => void
}

function ProviderEditor(props: EditorProps) {
  const { t, api } = props
  const [route, setRoute] = useState(props.editing?.route ?? '')
  const [draft, setDraft] = useState<ProviderDraft>(() => draftFromConfig(props.editing?.config))
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [openModels, setOpenModels] = useState<ReadonlySet<number>>(new Set())
  const [keyValue, setKeyValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [validation, setValidation] = useState<ValidationError | undefined>(undefined)

  const clearFeedback = (): void => {
    setFailure(undefined)
    setValidation(undefined)
  }

  const patch = (part: Partial<ProviderDraft>): void => {
    setDraft(current => ({ ...current, ...part }))
    clearFeedback()
  }

  const patchModel = (index: number, part: Partial<ModelDraft>): void => {
    setDraft(current => ({
      ...current,
      models: current.models.map((model, at) => (at === index ? { ...model, ...part } : model)),
    }))
    clearFeedback()
  }

  const toggleModel = (index: number): void => {
    setOpenModels(current => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const removeModel = (index: number): void => {
    patch({ models: draft.models.filter((_, at) => at !== index) })
    // Indices shift after removal; close all model panels to avoid pointing at the wrong entry.
    setOpenModels(new Set())
  }

  const creating = props.editing === undefined
  const trimmedRoute = route.trim()
  const trimmedKey = keyValue.trim()
  const hasUserInput = trimmedRoute.length > 0
    || draft.displayName.trim().length > 0
    || draft.baseURL.trim().length > 0
    || draft.apiKeyEnv.trim().length > 0
    || trimmedKey.length > 0
    || draft.models.some(model => model.id.trim().length > 0
      || model.name.trim().length > 0
      || model.contextWindow.trim().length > 0
      || model.maxTokens.trim().length > 0)
    || isAdvancedDirty(draft)
  const dirty = props.editing === undefined
    ? hasUserInput
    : trimmedKey.length > 0 || buildSaveOps(props.editing.route, props.editing.config, draft).length > 0

  const cancel = (): void => {
    if (dirty && !window.confirm(t('discardChanges'))) return
    props.onClose(false)
  }

  const save = async (): Promise<void> => {
    clearFeedback()
    if (props.editing === undefined) {
      const routeError = validateRoute(trimmedRoute, props.taken)
      if (routeError !== undefined) {
        setValidation({ field: 'route', message: t(routeError) })
        return
      }
    }
    const draftError = validateDraft(draft)
    if (draftError !== undefined) {
      if (draftError.field === 'model') {
        setValidation({ field: 'model', index: draftError.index, message: t(draftError.key) })
        if (draftError.key.startsWith('reasoning')) setOpenModels(current => new Set(current).add(draftError.index))
      } else {
        setValidation({ field: draftError.field, message: t(draftError.key) })
      }
      return
    }
    setBusy(true)
    let savedName: string | undefined
    try {
      const target = props.editing?.route ?? trimmedRoute
      const ops = buildSaveOps(target, props.editing?.config, draft)
      if (ops.length > 0) {
        const response = await api.settings.mutate({
          ns: NS,
          ops,
          expectedRevision: props.revision,
        })
        if (!response.result.ok) {
          setFailure(response.result.error.code === 'settings-conflict' ? t('conflict') : response.result.error.message)
          return
        }
      }
      if (trimmedKey.length > 0) {
        const stored = await api.credentials.set({ ref: draft.apiKeyEnv.trim(), value: trimmedKey })
        if (!stored.result.ok) {
          setFailure(stored.result.error.message)
          return
        }
      }
      savedName = draft.displayName.trim().length > 0 ? draft.displayName.trim() : target
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
    if (savedName !== undefined) props.onClose(true, savedName)
  }

  const routeError = errorFor(validation, 'route')
  const baseUrlError = errorFor(validation, 'baseURL')
  const credentialRefError = errorFor(validation, 'apiKeyEnv')
  const modelsError = errorFor(validation, 'models')

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={labelStyle}>
            {t('providerId')}
            <Input
              value={route}
              placeholder={t('providerIdPlaceholder')}
              disabled={!props.writable || busy || !creating}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={routeError === undefined ? undefined : true}
              onChange={event => { setRoute(event.target.value); clearFeedback() }}
            />
          </label>
          {routeError === undefined ? null : <p style={errorStyle}>{routeError}</p>}
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={labelStyle}>
            {t('displayName')}
            <Input
              value={draft.displayName}
              placeholder={t('displayNamePlaceholder')}
              disabled={!props.writable || busy}
              onChange={event => patch({ displayName: event.target.value })}
            />
          </label>
        </div>
      </div>
      <label style={labelStyle}>
        {t('protocol')}
        <select
          style={selectStyle}
          value={draft.api ?? 'openai-completions'}
          disabled={!props.writable || busy}
          onChange={event => patch({ api: event.target.value as ProviderApi })}
        >
          {PROVIDER_APIS.map(api => <option key={api} value={api}>{api}</option>)}
        </select>
        <span style={hintStyle}>{t(`protocolHint.${draft.api ?? 'openai-completions'}`)}</span>
      </label>
      <div>
        <label style={labelStyle}>
          {t('baseUrl')}
          <Input
            type="url"
            value={draft.baseURL}
            placeholder={t('baseUrlPlaceholder')}
            disabled={!props.writable || busy}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={baseUrlError === undefined ? undefined : true}
            onChange={event => patch({ baseURL: event.target.value })}
          />
        </label>
        {baseUrlError === undefined ? null : <p style={errorStyle}>{baseUrlError}</p>}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={labelStyle}>
            {t('credentialRef')}
            <Input
              value={draft.apiKeyEnv}
              placeholder={t('credentialRefPlaceholder')}
              disabled={!props.writable || busy}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={credentialRefError === undefined ? undefined : true}
              onChange={event => patch({ apiKeyEnv: event.target.value })}
            />
          </label>
          {credentialRefError === undefined ? null : <p style={errorStyle}>{credentialRefError}</p>}
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={labelStyle}>
            {t('apiKey')}
            <Input
              type="password"
              value={keyValue}
              placeholder={props.editing?.credentialConfigured === true ? t('keyStored') : t('keyPlaceholder')}
              disabled={!props.writable || busy}
              autoComplete="new-password"
              onChange={event => { setKeyValue(event.target.value); clearFeedback() }}
            />
          </label>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, color: labelStyle.color }}>{t('models')}</span>
        {draft.models.map((model, index) => {
          const modelError = validation?.field === 'model' && validation.index === index
            ? validation.message
            : undefined
          const modelOpen = openModels.has(index)
          return (
            <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={labelStyle}>
                {t('modelId')}
                <Input
                  value={model.id}
                  placeholder={t('modelId')}
                  disabled={!props.writable || busy}
                  aria-invalid={modelError === undefined ? undefined : true}
                  onChange={event => patchModel(index, { id: event.target.value })}
                />
              </label>
              <label style={labelStyle}>
                {t('modelName')}
                <Input
                  value={model.name}
                  placeholder={t('modelNamePlaceholder')}
                  disabled={!props.writable || busy}
                  onChange={event => patchModel(index, { name: event.target.value })}
                />
              </label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <label style={{ ...labelStyle, flex: 1, minWidth: 120 }}>
                  {t('contextWindow')}
                  <Input
                    value={model.contextWindow}
                    placeholder={t('contextWindow')}
                    title={t('capacityPlaceholder')}
                    disabled={!props.writable || busy}
                    aria-invalid={modelError === undefined ? undefined : true}
                    onChange={event => patchModel(index, { contextWindow: event.target.value })}
                  />
                </label>
                <label style={{ ...labelStyle, flex: 1, minWidth: 120 }}>
                  {t('maxTokens')}
                  <Input
                    value={model.maxTokens}
                    placeholder={t('maxTokens')}
                    title={t('capacityPlaceholder')}
                    disabled={!props.writable || busy}
                    aria-invalid={modelError === undefined ? undefined : true}
                    onChange={event => patchModel(index, { maxTokens: event.target.value })}
                  />
                </label>
                <IconAction
                  label={t('removeModel')}
                  icon={<IconTrashOutline16 size={16} />}
                  danger
                  disabled={!props.writable || busy}
                  onClick={() => removeModel(index)}
                />
              </div>
              <div>
                <IconAction
                  label={t('modelAdvancedToggle')}
                  icon={modelOpen ? <IconChevronUpOutline14 size={14} /> : <IconChevronDownOutline14 size={14} />}
                  onClick={() => toggleModel(index)}
                />
              </div>
              {modelOpen ? (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  padding: 12,
                  borderRadius: 10,
                  border: '1px solid var(--dsw-alias-border-secondary, rgba(127, 127, 127, 0.25))',
                }}>
                  <ModelAdvancedFields
                    t={t}
                    api={draft.api ?? 'openai-completions'}
                    model={model}
                    disabled={!props.writable || busy}
                    onChange={part => patchModel(index, part)}
                  />
                </div>
              ) : null}
              {modelError === undefined ? null : <p style={errorStyle}>{modelError}</p>}
            </div>
          )
        })}
        <div>
          <Button
            size="sm"
            disabled={!props.writable || busy}
            onClick={() => patch({ models: [...draft.models, emptyModelDraft()] })}
          >
            {t('addModel')}
          </Button>
        </div>
        {modelsError === undefined ? null : <p style={errorStyle}>{modelsError}</p>}
      </div>
      {(draft.api ?? 'openai-completions') === 'openai-completions' ? (
        <AdvancedEditor
          t={t}
          draft={draft}
          writable={props.writable}
          busy={busy}
          open={advancedOpen}
          onToggle={setAdvancedOpen}
          onPatch={patch}
        />
      ) : null}
      {failure === undefined ? null : <p role="alert" style={errorStyle}>{failure}</p>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button disabled={busy} onClick={cancel}>{t('cancel')}</Button>
        <Button variant="primary" disabled={!props.writable || busy} onClick={() => void save()}>
          {busy ? t(creating ? 'creating' : 'saving') : t(creating ? 'create' : 'save')}
        </Button>
      </div>
    </div>
  )
}

export interface SectionProps {
  api: HostApi
  t: Translate
  store: CustomProvidersStore
}

/** The llm-custom settings page: provider list plus add/edit/delete flows. */
export function CustomProvidersSection(props: SectionProps) {
  const { t, api, store } = props
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | undefined>(undefined)
  const [deleting, setDeleting] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (snapshot.status !== 'ready') return
    if (editing !== undefined && !snapshot.rows.some(row => row.route === editing)) setEditing(undefined)
    if (deleting !== undefined && !snapshot.rows.some(row => row.route === deleting)) setDeleting(undefined)
  }, [snapshot, editing, deleting])

  const refresh = (): void => { void store.load() }
  const closeEditor = (saved: boolean, label?: string): void => {
    setAdding(false)
    setEditing(undefined)
    setFailure(undefined)
    if (saved) {
      refresh()
      if (label !== undefined) setNotice(t('saved', { name: label }))
    }
  }

  const startAdding = (): void => {
    setEditing(undefined)
    setDeleting(undefined)
    setFailure(undefined)
    setNotice(undefined)
    setAdding(true)
  }

  const startEditing = (route: string): void => {
    setAdding(false)
    setDeleting(undefined)
    setFailure(undefined)
    setNotice(undefined)
    setEditing(route)
  }

  const startDeleting = (route: string): void => {
    setAdding(false)
    setEditing(undefined)
    setFailure(undefined)
    setNotice(undefined)
    setDeleting(route)
  }

  const remove = async (route: string): Promise<void> => {
    if (snapshot.status !== 'ready') return
    const row = snapshot.rows.find(candidate => candidate.route === route)
    setBusy(true)
    setFailure(undefined)
    setNotice(undefined)
    try {
      const response = await api.settings.mutate({
        ns: NS,
        ops: [{ op: 'unset', path: ['providers', route] }],
        expectedRevision: snapshot.revision,
      })
      if (!response.result.ok) {
        setDeleting(undefined)
        setFailure(response.result.error.code === 'settings-conflict' ? t('conflict') : response.result.error.message)
        return
      }
      setDeleting(undefined)
      setNotice(t('deleted', { name: row === undefined ? route : displayNameOf(row.config, row.route) }))
      refresh()
    } catch (error) {
      setDeleting(undefined)
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const ready = snapshot.status === 'ready'
  const panelOpen = adding || editing !== undefined || deleting !== undefined
  const addDisabled = !ready || !snapshot.writable || busy || panelOpen

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>{t('heading')}</h2>
          <p style={{ ...hintStyle, marginTop: 4 }}>{t('blurb')}</p>
        </div>
        <Button disabled={addDisabled} onClick={startAdding}>{t('add')}</Button>
      </div>
      {snapshot.status === 'loading' ? (
        <p style={hintStyle}>{t('loading')}</p>
      ) : snapshot.status === 'error' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
          <p style={errorStyle}>{t('loadFailed')}: {snapshot.error}</p>
          <Button size="sm" onClick={refresh}>{t('retry')}</Button>
        </div>
      ) : (
        <>
          {snapshot.writable ? null : <p style={hintStyle}>{t('readOnly')}</p>}
          {notice === undefined ? null : <p role="status" style={successStyle}>{notice}</p>}
          {failure === undefined ? null : <p role="alert" style={errorStyle}>{failure}</p>}
          {snapshot.rows.length === 0 ? <p style={hintStyle}>{t('empty')}</p> : null}
          {snapshot.rows.map((row) => {
            const name = displayNameOf(row.config, row.route)
            const isEditing = editing === row.route
            const isDeleting = deleting === row.route
            return (
              <div key={row.route} style={cardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{name}</span>
                  <span style={hintStyle}>{row.route}</span>
                  <span style={hintStyle}>{typeof row.config.api === 'string' ? row.config.api : 'openai-completions'}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <StateDot state={row.credentialConfigured ? 'done' : 'warning'} size={8} />
                    <span style={hintStyle}>{row.credentialConfigured ? t('credentialConfigured') : t('keyMissing')}</span>
                  </span>
                  <span style={{ ...hintStyle, marginLeft: 'auto' }}>
                    {t('modelCount', { count: modelCountOf(row.config) })}
                  </span>
                  <IconAction
                    label={t('edit')}
                    icon={<IconEditOutline16 size={16} />}
                    disabled={busy || adding || deleting !== undefined || (editing !== undefined && !isEditing)}
                    onClick={() => startEditing(row.route)}
                  />
                  {row.removable ? (
                    <IconAction
                      label={t('delete')}
                      icon={<IconTrashOutline16 size={16} />}
                      disabled={!snapshot.writable || busy || adding || editing !== undefined || (deleting !== undefined && !isDeleting)}
                      onClick={() => startDeleting(row.route)}
                    />
                  ) : null}
                </div>
                {isEditing ? (
                  <ProviderEditor
                    api={api}
                    t={t}
                    writable={snapshot.writable}
                    revision={snapshot.revision}
                    taken={snapshot.rows.map(candidate => candidate.route)}
                    editing={{ route: row.route, config: row.config, credentialConfigured: row.credentialConfigured }}
                    onClose={closeEditor}
                  />
                ) : null}
              </div>
            )
          })}
          {adding ? (
            <ProviderEditor
              api={api}
              t={t}
              writable={snapshot.writable}
              revision={snapshot.revision}
              taken={snapshot.rows.map(candidate => candidate.route)}
              onClose={closeEditor}
            />
          ) : null}
        </>
      )}
      {(() => {
        if (snapshot.status !== 'ready') return null
        const row = snapshot.rows.find(candidate => candidate.route === deleting)
        if (row === undefined) return null
        return (
          <Modal
            open
            onClose={() => { if (!busy) setDeleting(undefined) }}
            title={t('deleteTitle')}
            closeLabel={t('cancel')}
            description={t('deleteConfirm', {
              name: displayNameOf(row.config, row.route),
              ref: row.credentialRef ?? '-',
            })}
            footer={(
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Button size="sm" disabled={busy} onClick={() => setDeleting(undefined)}>{t('cancel')}</Button>
                <Button size="sm" variant="primary" disabled={busy || !snapshot.writable} onClick={() => void remove(row.route)}>
                  {t('delete')}
                </Button>
              </div>
            )}
          />
        )
      })()}
    </div>
  )
}
