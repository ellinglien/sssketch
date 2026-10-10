import { describe, expect, it } from 'vitest'
import {
  ADVANCED_FEATURES_OFF,
  FEATURES,
  advancedFeaturesDefault,
  featureEnabled,
  heartsButtonShown,
  projectUsesPlugins,
  visibleForFeatures,
  type FeatureId
} from './features'

const ON = { advancedFeatures: true }
const OFF = { advancedFeatures: false }

describe('featureEnabled', () => {
  it('lists the features behind the switch, all advanced', () => {
    expect(FEATURES.map((f) => f.id)).toEqual([
      'phoneRemote',
      'recording',
      'plugins',
      'soundDefaults',
      'radioHeartsKey',
      'eeedit'
    ])
    expect(FEATURES.every((f) => f.advanced)).toBe(true)
  })

  it('turns every advanced feature on and off with the one switch', () => {
    for (const f of FEATURES) {
      expect(featureEnabled(f.id, ON)).toBe(true)
      expect(featureEnabled(f.id, OFF)).toBe(false)
    }
  })

  it('puts EEEDIT behind the switch: off for a new install, on with the switch', () => {
    expect(featureEnabled('eeedit', OFF)).toBe(false)
    expect(featureEnabled('eeedit', ON)).toBe(true)
    expect(featureEnabled('eeedit', null)).toBe(false)
  })

  it('reads unknown settings (main has not answered yet) as off', () => {
    expect(featureEnabled('plugins', null)).toBe(false)
  })

  it('is off for a new install', () => {
    expect(ADVANCED_FEATURES_OFF).toEqual({ advancedFeatures: false })
  })
})

describe('advancedFeaturesDefault (the migration rule)', () => {
  const none = {
    pluginsScanned: false,
    projectUsesPlugins: false,
    phoneRemoteUsed: false,
    heartsKeySet: false,
    recordingsMade: false,
    soundDefaultsSet: false
  }

  it('is off when nothing advanced was ever used', () => {
    expect(advancedFeaturesDefault(none)).toEqual({ on: false, because: [] })
  })

  it('is on when any one of them was used, and says which', () => {
    for (const key of Object.keys(none) as (keyof typeof none)[]) {
      const result = advancedFeaturesDefault({ ...none, [key]: true })
      expect(result.on, key).toBe(true)
      expect(result.because).toEqual([key])
    }
  })

  it('lists every reason that applies', () => {
    expect(
      advancedFeaturesDefault({ ...none, pluginsScanned: true, heartsKeySet: true }).because
    ).toEqual(['pluginsScanned', 'heartsKeySet'])
  })
})

describe('heartsButtonShown', () => {
  it('needs both a key and the switch', () => {
    expect(heartsButtonShown(ON, true)).toBe(true)
    expect(heartsButtonShown(ON, false)).toBe(false)
    expect(heartsButtonShown(OFF, true)).toBe(false)
    expect(heartsButtonShown(null, true)).toBe(false)
  })
})

describe('projectUsesPlugins', () => {
  it('is false for empty slots', () => {
    expect(projectUsesPlugins([null, null, null, null], {})).toBe(false)
    expect(projectUsesPlugins([null, null, null, null], { a: [null, null] })).toBe(false)
  })

  it('sees a master or a channel plugin', () => {
    expect(projectUsesPlugins([null, 'x', null, null], {})).toBe(true)
    expect(projectUsesPlugins([null, null, null, null], { a: [null, 'y'] })).toBe(true)
  })

  it('tolerates a project saved before either field existed', () => {
    expect(projectUsesPlugins(undefined, undefined)).toBe(false)
  })
})

describe('visibleForFeatures', () => {
  const items: { name: string; feature?: FeatureId }[] = [
    { name: 'play' },
    { name: 'record', feature: 'recording' },
    { name: 'scan', feature: 'plugins' }
  ]

  it('keeps everything while on', () => {
    expect(visibleForFeatures(items, ON).map((i) => i.name)).toEqual(['play', 'record', 'scan'])
  })

  it('leaves out what belongs to an advanced feature while off', () => {
    expect(visibleForFeatures(items, OFF).map((i) => i.name)).toEqual(['play'])
  })
})
