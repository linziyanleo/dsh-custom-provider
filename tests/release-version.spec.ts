import { describe, expect, it } from 'vitest'

import { selectReleaseVersion } from '../scripts/prepare-release.mjs'

describe('release version selection', () => {
  it('uses the declared version for the first registry publish', () => {
    expect(selectReleaseVersion('0.1.1', undefined)).toBe('0.1.1')
  })

  it('uses a newer explicitly declared version', () => {
    expect(selectReleaseVersion('0.2.0', '0.1.9')).toBe('0.2.0')
  })

  it('increments the published patch when the declared version is not newer', () => {
    expect(selectReleaseVersion('0.1.1', '0.1.1')).toBe('0.1.2')
    expect(selectReleaseVersion('0.1.1', '0.1.7')).toBe('0.1.8')
  })

  it('rejects prerelease and malformed versions', () => {
    expect(() => selectReleaseVersion('0.1.1-beta.1', undefined)).toThrow('stable semantic version')
    expect(() => selectReleaseVersion('0.1.1', 'latest')).toThrow('stable semantic version')
  })
})
