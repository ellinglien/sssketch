// src/shared/phoneLoop.ts
import { createHash } from 'node:crypto'
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

/** Everything about one stem that changes what its own audio sounds like --
 * and nothing that identifies it, places it in a loop, or mixes it.
 *
 * NOT `stemKey`: it embeds the rifff's groupId, which is a fresh
 * crypto.randomUUID() on every rebuild (see assembleDiscoverRifff).
 * NOT `muted`: mute is a gain on the phone now, applied to a buffer it
 * already holds. Including it would mean a mute changed the id, which would
 * mean a download, which is precisely the thing per-stem audio exists to
 * stop.
 * `volume` IS here, because the gain is baked into the bytes the phone is
 * served -- so a gain change is genuinely different audio. */
export function stemAudioFields(stem: EngineStem): string {
  return [
    stem.resolvedPath,
    stem.durationSec,
    stem.barLength,
    stem.volume,
    stem.oneShot ? 1 : 0,
    stem.trimStartSec,
    stem.trimEndSec,
    stem.toolkit === undefined ? '' : JSON.stringify(stem.toolkit)
  ].join(FIELD)
}

/** The 16-character id ONE stem's audio is addressed by, over
 * GET /api/stem?id=. Same length and same derivation style as the loopId
 * below it, one level down.
 *
 * It is a lookup key into a map the main process builds from the loop it is
 * currently holding -- never a path, never concatenated into one, and
 * meaningless to anything that does not already hold that map. That is what
 * lets a per-stem audio route exist at all without widening the boundary
 * src/shared/remoteState.ts IS. */
export function phoneStemAudioId(stem: EngineStem): string {
  return createHash('sha256').update(stemAudioFields(stem)).digest('hex').slice(0, 16)
}

function stemLine(startBar: number, barLength: number, stem: EngineStem): string {
  // Deliberately NOT stem.stemKey: it embeds the rifff's groupId, which is a
  // fresh crypto.randomUUID() on every single rebuild (see
  // assembleDiscoverRifff). Everything listed here is something that changes
  // what the render sounds like; nothing listed here is an identifier.
  //
  // The audio-bearing fields come from stemAudioFields rather than being
  // listed again here, so the stem id and the loop fingerprint cannot drift
  // apart -- a field added to one is a field added to both.
  return [
    startBar,
    barLength,
    stemAudioFields(stem),
    stem.playedBars,
    stem.leftCropBars,
    stem.offsetSteps,
    stem.startBarOverride,
    stem.muted ? 1 : 0,
    stem.muteRegions.map((region) => `${region.startBar}-${region.endBar}`).join(',')
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
