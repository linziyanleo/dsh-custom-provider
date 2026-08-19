import type { ReactNode } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'

const errorColor = 'var(--dsw-alias-label-error, #d4351c)'

/**
 * Icon-only action button with a transparent background; the action name shows
 * on hover/focus via Tooltip. `danger` adds a red outline for destructive actions.
 */
export function IconAction(props: {
  label: string
  icon: ReactNode
  danger?: boolean
  disabled?: boolean
  onClick(): void
}) {
  const danger = props.danger === true
  return (
    <Tooltip label={props.label} side="top">
      <button
        type="button"
        aria-label={props.label}
        disabled={props.disabled}
        onClick={props.onClick}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          padding: 0,
          borderRadius: 8,
          background: 'transparent',
          border: danger ? `1px solid ${errorColor}` : '1px solid transparent',
          color: danger ? errorColor : 'var(--dsw-alias-label-secondary, inherit)',
          cursor: props.disabled === true ? 'default' : 'pointer',
          opacity: props.disabled === true ? 0.5 : 1,
        }}
      >
        {props.icon}
      </button>
    </Tooltip>
  )
}
