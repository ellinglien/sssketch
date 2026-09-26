// src/shared/lanAddress.ts

/** One row of node's `networkInterfaces()`, flattened -- the interface name
 * carried alongside the address rather than as the key above it. Pure data,
 * so the choosing below is testable without a machine that has the network
 * being tested. `family` is 'IPv4'/'IPv6' on current node and was 4/6 on
 * older node; both are accepted. */
export interface NetworkAddress {
  name: string
  address: string
  family: string | number
  internal: boolean
}

/** Interfaces that are never the answer to "what does a phone on the same
 * wifi type in", matched as a case-insensitive prefix of the name:
 *
 *   utun, tun, tap  -- vpn and tunnel devices (tailscale lives on utun)
 *   ppp             -- point-to-point dial-up/pppoe links
 *   awdl, llw       -- apple's peer-to-peer link-local radios
 *   bridge          -- internet sharing / thunderbolt bridges
 *   vmnet, vboxnet, docker -- virtual machine and container host networks
 *
 * A bridge is the subtle one: it has a real private address (192.168.3.1 on
 * his machine) that looks exactly like a LAN, but it is the address of a
 * network he is serving, not the one his phone is on. */
const VIRTUAL_NAME_PREFIXES = [
  'utun',
  'tun',
  'tap',
  'awdl',
  'llw',
  'bridge',
  'vmnet',
  'vboxnet',
  'docker',
  'ppp'
]

function octets(address: string): number[] | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const values = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : -1))
  return values.every((value) => value >= 0 && value <= 255) ? values : null
}

/** 100.64.0.0/10 -- the carrier-grade NAT range tailscale hands out. Checked
 * by range as well as by interface name because a vpn can appear under a
 * name this file has never heard of, and the range is the more reliable
 * signal of the two. Its neighbours (100.63.x, 100.128.x) are ordinary
 * public addresses and are deliberately not swept up with it. */
function isCarrierGradeNat([a, b]: number[]): boolean {
  return a === 100 && b >= 64 && b <= 127
}

/** 169.254.0.0/16 -- what an interface self-assigns when it wanted DHCP and
 * got nothing. Never routable to a phone. */
function isLinkLocal([a, b]: number[]): boolean {
  return a === 169 && b === 254
}

/** RFC1918: 192.168/16, 10/8, 172.16/12. What a home LAN actually uses. */
function isPrivate([a, b]: number[]): boolean {
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  return a === 172 && b >= 16 && b <= 31
}

function isVirtualName(name: string): boolean {
  const lower = name.toLowerCase()
  return VIRTUAL_NAME_PREFIXES.some((prefix) => lower.startsWith(prefix))
}

function isIPv4(family: string | number): boolean {
  return family === 'IPv4' || family === 4
}

/** Splits a name into its text and its trailing number, so en2 sorts before
 * en10 rather than after it. Cosmetic, but it keeps the tie-break readable
 * as "the lowest-numbered interface" instead of an alphabetical accident. */
function compareNames(a: string, b: string): number {
  const split = /^(\D*)(\d*)$/
  const [, aText = a, aNum = ''] = split.exec(a) ?? []
  const [, bText = b, bNum = ''] = split.exec(b) ?? []
  if (aText !== bText) return aText < bText ? -1 : 1
  if (aNum !== bNum) return (Number(aNum) || 0) - (Number(bNum) || 0)
  return 0
}

/** Every address a phone on the same wifi has a real chance of reaching,
 * best first.
 *
 * Ranking, in order of priority:
 *   1. rfc1918 private beats anything else -- that is what a home LAN is.
 *   2. en* (wifi and ethernet on macos) beats any other surviving name.
 *   3. lowest interface number, then lowest address -- purely to be
 *      deterministic when two candidates are otherwise identical.
 *
 * Deliberately a rank and not a scan-for-the-first-match: node does not
 * guarantee the order `networkInterfaces()` enumerates in, and depending on
 * that order is exactly the bug this replaces -- a tailscale utun0 listed
 * ahead of en0 got advertised to a phone that could not reach it. */
export function rankLanAddresses(interfaces: NetworkAddress[]): string[] {
  const candidates = interfaces
    .map((entry) => ({ entry, parts: octets(entry.address) }))
    .filter(
      (candidate): candidate is { entry: NetworkAddress; parts: number[] } =>
        candidate.parts !== null &&
        !candidate.entry.internal &&
        isIPv4(candidate.entry.family) &&
        !isVirtualName(candidate.entry.name) &&
        !isCarrierGradeNat(candidate.parts) &&
        !isLinkLocal(candidate.parts) &&
        candidate.parts[0] !== 127
    )

  const sorted = [...candidates].sort((a, b) => {
    const aPrivate = isPrivate(a.parts) ? 0 : 1
    const bPrivate = isPrivate(b.parts) ? 0 : 1
    if (aPrivate !== bPrivate) return aPrivate - bPrivate

    const aEn = a.entry.name.toLowerCase().startsWith('en') ? 0 : 1
    const bEn = b.entry.name.toLowerCase().startsWith('en') ? 0 : 1
    if (aEn !== bEn) return aEn - bEn

    const byName = compareNames(a.entry.name.toLowerCase(), b.entry.name.toLowerCase())
    if (byName !== 0) return byName

    for (let i = 0; i < 4; i++) {
      if (a.parts[i] !== b.parts[i]) return a.parts[i] - b.parts[i]
    }
    return 0
  })

  const seen = new Set<string>()
  return sorted
    .map((candidate) => candidate.entry.address)
    .filter((address) => (seen.has(address) ? false : (seen.add(address), true)))
}

/** The single address the desktop shows him to type into the phone. Null
 * when nothing survives the ranking.
 *
 * Null on a vpn-only machine is the deliberate answer, not an oversight: a
 * machine whose only non-internal address is a tailnet address has no LAN,
 * and handing the phone an address it cannot route to is precisely the
 * failure being fixed -- it looks like the feature is working right up until
 * the phone says "connection failed". "no network found", which the gear
 * menu already says when this is null, is the honest report. */
export function chooseLanAddress(interfaces: NetworkAddress[]): string | null {
  return rankLanAddresses(interfaces)[0] ?? null
}
