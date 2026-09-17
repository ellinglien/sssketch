// src/shared/audiosetClasses.ts
import type { ArrangeRole } from './stemRole'

/** A small, deliberately narrow subset of YAMNet's real 521-class AudioSet
 * ontology (Google's own official `yamnet_class_map.csv` -- see below,
 * NOT the more commonly-linked 527-class PANNs ontology, which has a
 * different class order and was wrongly assumed to match here on a first
 * pass, caught by this task's own real-model verification gate) mapped to
 * sssketch's own ArrangeRole taxonomy. Only classes confidently,
 * unambiguously implying ONE ArrangeRole are included -- "Music"/
 * "Musical instrument"/"Synthesizer"/"Electronic music" and similar broad
 * classes are deliberately left OUT rather than force-mapped to a guess,
 * same "decline rather than force a close call" discipline as
 * categoryCentroids.ts's own CONFIDENCE_RATIO and embeddingMatch.ts's own
 * SIMILARITY_MARGIN.
 *
 * "Speech" (index 0) is deliberately NOT mapped to vocal -- this
 * codebase's own SOUND_TYPE_TO_ARRANGE_ROLE audioIn->vocal mapping is
 * already documented (stemRole.ts) as an overconfident guess for exactly
 * this reason: live-recorded audio is very often spoken commentary, not a
 * sung take. "Singing"/"Choir"/"Vocal music"/"A capella" are much more
 * specific to an actual musical vocal performance.
 *
 * Indices verified against Google's own official YAMNet class map
 * (fetched from https://raw.githubusercontent.com/tensorflow/models/master/research/audioset/yamnet/yamnet_class_map.csv,
 * 522 lines: 521 classes + header) AND cross-checked against this
 * specific vendored model's own real output_0 dimension -- confirmed 521
 * via BOTH the ONNX graph's own declared output metadata and a real local
 * inference run (onnxruntime-node against noise input). Do not add a new
 * entry here without the same real-model verification against THIS exact
 * class map -- index numbers are not something to guess from memory or
 * copy from a different, differently-ordered AudioSet variant (a mistake
 * this exact table already made once). */
const AUDIOSET_CLASS_TO_ARRANGE_ROLE: Partial<Record<number, ArrangeRole>> = {
  24: 'vocal', // Singing
  25: 'vocal', // Choir
  137: 'bass', // Bass guitar
  157: 'drums', // Drum kit
  158: 'drums', // Drum machine
  159: 'drums', // Drum
  160: 'drums', // Snare drum
  161: 'drums', // Rimshot
  162: 'drums', // Drum roll
  163: 'drums', // Bass drum
  166: 'drums', // Cymbal
  167: 'drums', // Hi-hat
  249: 'vocal', // Vocal music
  250: 'vocal' // A capella
}

/** Looks up a YAMNet AudioSet class index in AUDIOSET_CLASS_TO_ARRANGE_ROLE
 * above, returning null for any class deliberately left unmapped (either
 * genuinely absent from AudioSet, or one of the broad/ambiguous classes
 * the table above intentionally declines to force-map). */
export function arrangeRoleForAudiosetClass(classIndex: number): ArrangeRole | null {
  return AUDIOSET_CLASS_TO_ARRANGE_ROLE[classIndex] ?? null
}
