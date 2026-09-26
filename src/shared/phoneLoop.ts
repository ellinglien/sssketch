// src/shared/phoneLoop.ts
import type { EngineProject, EngineMasterChainSlot, EngineStem } from './buildEngineProject'

const EMPTY_SLOT: EngineMasterChainSlot = { pluginId: '', path: '', stateBase64: '' }

/** The loop as the PHONE will hear it: the same stems, at the same gains, at
 * the same tempo, with no plugins anywhere.
 *
 * Stripping is not an optimisation. The Discover preview calls
 * buildEngineProject with THREE arguments (DiscoverPanel.tsx:858), so
 * pluginStates defaults to {} and every stateBase64 on the wire is empty. A
 * freshly spawned render engine would therefore instantiate the master chain
 * and every channel chain at its DEFAULT state -- a third sound belonging
 * neither to the Mac nor to the stems. exportToolkitAudio.ts:184 strips
 * channel plugins from a bake for a closely related reason. Dry is at least
 * honestly "the stems, at their gains, at the project tempo," which is what
 * a Discover judgement is about. Named as a known limit in the spec. */
export function phoneLoopProject(project: EngineProject): EngineProject {
  return {
    ...project,
    masterChain: [{ ...EMPTY_SLOT }, { ...EMPTY_SLOT }, { ...EMPTY_SLOT }, { ...EMPTY_SLOT }],
    channelChains: []
  }
}

/** ASCII unit separator, between fields of one stem's line.
 *
 * NOT the empty string. Joining these fields with nothing at all would let
 * two audibly DIFFERENT loops produce the same line -- a stem at
 * `resolvedPath: '/a1'` with `durationSec: 2` and one at `/a` with `12`
 * concatenate identically -- which is precisely the confusion this
 * fingerprint exists to prevent, and it would surface as the phone serving
 * the wrong audio for a loop, silently. A character no real field can
 * contain is the whole fix. */
const FIELD = ''

function stemLine(startBar: number, barLength: number, stem: EngineStem): string {
  // Deliberately NOT stem.stemKey: it embeds the rifff's groupId, which is a
  // fresh crypto.randomUUID() on every single rebuild (see
  // assembleDiscoverRifff). Everything listed here is something that changes
  // what the render sounds like; nothing listed here is an identifier.
  return [
    startBar,
    barLength,
    stem.resolvedPath,
    stem.durationSec,
    stem.barLength,
    stem.playedBars,
    stem.leftCropBars,
    stem.offsetSteps,
    stem.startBarOverride,
    stem.volume,
    stem.muted ? 1 : 0,
    stem.oneShot ? 1 : 0,
    stem.trimStartSec,
    stem.trimEndSec,
    stem.muteRegions.map((region) => `${region.startBar}-${region.endBar}`).join(','),
    stem.toolkit === undefined ? '' : JSON.stringify(stem.toolkit)
  ].join(FIELD)
}

/** A canonical string that is the same for two projects that would render to
 * the same audio, and different otherwise. Hashed by the main process into
 * the 16-character `loopId` the phone sees; kept as a plain string here so
 * this stays pure, framework-agnostic and testable, and so the one hard part
 * (deciding what "the same loop" means) lives where it can be read.
 *
 * TWO properties are load-bearing and both have tests:
 *
 * 1. IGNORES groupId / channelId / stemKey. Discover rebuilds its preview
 *    project on every slot resolution, every mute or solo toggle and every
 *    bpm change, and assembleDiscoverRifff mints a fresh UUID groupId each
 *    time. Hash the raw JSON and the id changes several times a second while
 *    nothing audible changes, and the phone refetches identical audio forever.
 *
 * 2. SORTS the stems. Summing is commutative; slot order is not audio.
 *
 * And it is deliberately NOT discoveredGroupKey, which is blind to gain by
 * design ("the same five stems balanced differently are the same discovery").
 * True of a discovery, false of a sound. */
export function phoneLoopFingerprint(project: EngineProject): string {
  const lines: string[] = []
  for (const rifff of project.rifffs) {
    for (const stem of rifff.stems) {
      lines.push(stemLine(rifff.startBar, rifff.barLength, stem))
    }
  }
  lines.sort()
  return [
    `bpm=${project.bpm}`,
    `snap=${project.snapDiv}`,
    `bars=${project.loopLengthBars}`,
    `reverb=${JSON.stringify(project.reverb)}`,
    `risers=${JSON.stringify(project.risers)}`,
    ...lines
  ].join('\n')
}
