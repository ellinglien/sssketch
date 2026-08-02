// A LORE riff's own riffCID is a great unique key but a lousy thing to scan
// a list by -- every entry starts to look like "LORE riff <hex>". This
// derives a human-readable "adjective noun" pair FROM the riffCID itself
// (not randomly) so the same riff always gets the same friendly name across
// sessions/reopens, while the CID suffix stays in the display name as the
// exact, greppable identifier.

const ADJECTIVES = [
  'amber',
  'azure',
  'brisk',
  'coral',
  'crimson',
  'dusty',
  'ember',
  'feral',
  'frost',
  'gilded',
  'golden',
  'green',
  'hollow',
  'humble',
  'indigo',
  'ivory',
  'jade',
  'lucid',
  'misty',
  'mossy',
  'neon',
  'obsidian',
  'pale',
  'quiet',
  'rusty',
  'sable',
  'salty',
  'silver',
  'slate',
  'solar',
  'tidal',
  'violet'
]

const NOUNS = [
  'badger',
  'bison',
  'condor',
  'coyote',
  'cricket',
  'dolphin',
  'falcon',
  'ferret',
  'gecko',
  'heron',
  'hornet',
  'ibis',
  'jackal',
  'jaguar',
  'kestrel',
  'leopard',
  'lynx',
  'magpie',
  'mantis',
  'marten',
  'osprey',
  'otter',
  'panther',
  'phoenix',
  'raven',
  'sparrow',
  'stallion',
  'swallow',
  'tiger',
  'viper',
  'weasel',
  'wolverine'
]

// FNV-1a -- simple, fast, well-distributed enough for picking out of a
// 32-entry list; no cryptographic property needed, this is cosmetic.
function fnv1a(str: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Deterministic "adjective noun <cid> LORE" display name for a LORE riff,
 * e.g. "green leopard 2f29c140 lore" -- same riffCID always produces the
 * same adjective/noun pair. The adjective and noun are hashed with
 * different salts so they don't covary (a riffCID that picks "green"
 * shouldn't be more or less likely to also pick "leopard"). */
export function friendlyRiffName(riffCID: string): string {
  const adjective = ADJECTIVES[fnv1a(riffCID + '|adjective') % ADJECTIVES.length]
  const noun = NOUNS[fnv1a(riffCID + '|noun') % NOUNS.length]
  return `${adjective} ${noun} ${riffCID.slice(0, 8)} lore`
}
