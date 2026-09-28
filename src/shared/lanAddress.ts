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

/** THE TWO KINDS OF "NO", AND THE LINE BETWEEN THEM (2026-09-26).
 *
 * This file used to have one list of interface names it threw away. It now
 * has two, because "a phone on the same wifi would not type this" and "no
 * device anywhere could ever hold an address on this network" are different
 * claims, and only the second one justifies hiding an address from him.
 *
 * NOT ALLOWED -- never a candidate, not even an offered one. An address on
 * one of these is not something another device can be given, on any network,
 * ever, so listing it would only be noise:
 *
 *   awdl, llw              -- apple's peer-to-peer link-local radios
 *   vmnet, vboxnet, docker -- the host side of a vm/container network
 *
 * plus, by range rather than by name: loopback, 169.254/16 link-local (what
 * an interface self-assigns when DHCP gave it nothing), anything internal,
 * anything not IPv4, and anything malformed.
 *
 * NOT PREFERRED -- offered in the picker, never the default:
 *
 *   utun, tun, tap  -- vpn and tunnel devices (tailscale lives on utun)
 *   ppp             -- point-to-point dial-up/pppoe links
 *   bridge          -- internet sharing / thunderbolt bridges
 *
 * plus, by range, 100.64.0.0/10 (see isCarrierGradeNat).
 *
 * The test for this group is "reachable by a device that shares the tunnel
 * (or is plugged into the sharing bridge)" -- which is a real setup and, on
 * his machine, the ONLY one that works: his router isolates wireless
 * clients, so his Mac and his iPhone cannot reach each other over the wifi
 * they are both on, and Tailscale is the way across. Excluding these
 * outright (f1fcc9b, this morning) was right for choosing a DEFAULT and
 * wrong for building a LIST.
 *
 * They stay unpreferred because the reason f1fcc9b existed has not gone
 * away: a phone that is not on the tailnet cannot use a tailnet address,
 * and a default nobody chose must be the one that works without any setup. */
const UNREACHABLE_NAME_PREFIXES = ['awdl', 'llw', 'vmnet', 'vboxnet', 'docker']

const TUNNEL_NAME_PREFIXES = ['utun', 'tun', 'tap', 'ppp']

const SHARING_NAME_PREFIXES = ['bridge']

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

function hasPrefix(name: string, prefixes: string[]): boolean {
  const lower = name.toLowerCase()
  return prefixes.some((prefix) => lower.startsWith(prefix))
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

/** What an address IS, in a word a person already knows.
 *
 * This is not a second classification sitting beside the ranking -- it is
 * the ranking's own one, said out loud. score() decides tier and kind in
 * the same breath from the same prefix lists, so there is exactly one
 * place that knows `utun` means vpn and `bridge` means bridge.
 *
 * 'wifi' vs 'ethernet' IS A HEURISTIC, and the only guess in here: node
 * hands us a device name and nothing about the medium behind it. en0 is
 * the wifi on every laptop apple has shipped in years and the higher
 * en* are thunderbolt or usb ethernet. On a mac mini or studio with the
 * ethernet port in use the two can be the other way round. The picker
 * therefore keeps the device name and the address visible under the word
 * -- the human word leads, it does not replace.
 *
 * 'computer-name' is not an interface at all -- it is this machine's own
 * bonjour name (`nickelm2.local`), which is offered alongside the numbers
 * and never chosen for anyone. See withComputerName. */
export type LanAddressKind = 'wifi' | 'ethernet' | 'vpn' | 'bridge' | 'computer-name'

/** One address the phone remote could be served on, as the picker shows it. */
export interface LanAddressCandidate {
  address: string
  /** The interface it was found on -- 'en0', 'utun0'. Carried so the picker
   * can tell two private-looking addresses apart at a glance. */
  interfaceName: string
  /** The human word this row leads with. See LanAddressKind. */
  kind: LanAddressKind
  /** True for an address a device on the same wifi can be expected to reach
   * with no setup. False for a tunnel, a vpn or a sharing bridge: offered,
   * but only the right answer for someone who knows their phone is on the
   * other end of it. See the two prefix lists above. */
  preferred: boolean
}

interface Scored {
  entry: NetworkAddress
  parts: number[]
  preferred: boolean
  kind: LanAddressKind
  /** 0 preferred, 1 tunnel/vpn, 2 sharing bridge. A tailnet address works
   * from anywhere; a sharing bridge only works for a device plugged into
   * this Mac -- so among the unpreferred, the likelier one comes first. */
  tier: number
}

function score(entry: NetworkAddress): Scored | null {
  const parts = octets(entry.address)
  if (parts === null) return null
  if (entry.internal || !isIPv4(entry.family)) return null
  if (parts[0] === 127 || isLinkLocal(parts)) return null
  if (hasPrefix(entry.name, UNREACHABLE_NAME_PREFIXES)) return null

  if (hasPrefix(entry.name, SHARING_NAME_PREFIXES))
    return { entry, parts, preferred: false, tier: 2, kind: 'bridge' }
  if (hasPrefix(entry.name, TUNNEL_NAME_PREFIXES) || isCarrierGradeNat(parts)) {
    return { entry, parts, preferred: false, tier: 1, kind: 'vpn' }
  }
  // The one guess in this file, and the reason the picker still shows the
  // device name underneath the word -- see LanAddressKind.
  const kind = entry.name.toLowerCase() === 'en0' ? 'wifi' : 'ethernet'
  return { entry, parts, preferred: true, tier: 0, kind }
}

/** Every address the phone remote could be served on, best first -- the
 * list the picker in PhoneRemoteModal.tsx offers him.
 *
 * Ranking, in order of priority:
 *   0. tier -- preferred beats tunnel beats sharing bridge (see Scored).
 *   1. rfc1918 private beats anything else -- that is what a home LAN is.
 *   2. en* (wifi and ethernet on macos) beats any other surviving name.
 *   3. lowest interface number, then lowest address -- purely to be
 *      deterministic when two candidates are otherwise identical.
 *
 * Deliberately a rank and not a scan-for-the-first-match: node does not
 * guarantee the order `networkInterfaces()` enumerates in, and depending on
 * that order is exactly the bug this replaces -- a tailscale utun0 listed
 * ahead of en0 got advertised to a phone that could not reach it. */
export function lanAddressCandidates(interfaces: NetworkAddress[]): LanAddressCandidate[] {
  const scored = interfaces
    .map(score)
    .filter((candidate): candidate is Scored => candidate !== null)

  const sorted = [...scored].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier

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
  const unique: LanAddressCandidate[] = []
  for (const candidate of sorted) {
    if (seen.has(candidate.entry.address)) continue
    seen.add(candidate.entry.address)
    unique.push({
      address: candidate.entry.address,
      interfaceName: candidate.entry.name,
      kind: candidate.kind,
      preferred: candidate.preferred
    })
  }
  return unique
}

/** A dns label and nothing else: letters, digits and hyphens. Deliberately
 * strict, because this one string reaches two places that must never take
 * anything surprising -- the Host allow-list (see isAllowedHost) and the
 * URL printed on the modal. Anything that is not plainly a label is
 * dropped, not repaired. */
const HOSTNAME_LABEL = /^[a-z0-9-]+$/

/** This machine's bonjour name as a URL host -- 'NickelM2' ->
 * 'nickelm2.local' -- or null when there isn't a usable one.
 *
 * macOS keeps this under `scutil --get LocalHostName` and advertises it
 * over mDNS with no code from us. Lowercased because it is about to be
 * typed by a person and compared against a Host header; `.local` added
 * unless it is already there, and a trailing dot (how a fully-qualified
 * name is written) removed. */
export function computerNameHost(localHostName: string | null | undefined): string | null {
  if (typeof localHostName !== 'string') return null
  let name = localHostName.trim().toLowerCase().replace(/\.$/, '')
  if (name.endsWith('.local')) name = name.slice(0, -'.local'.length)
  if (!HOSTNAME_LABEL.test(name)) return null
  return `${name}.local`
}

/** The candidates plus this machine's own bonjour name, last.
 *
 * WHY OFFER IT: every mac already advertises one, and unlike a raw ip it
 * survives the router handing out a different number tomorrow. The link
 * someone saves keeps working.
 *
 * WHY IT IS NEVER THE DEFAULT: we could not prove it reaches a real
 * iphone. His home router blocks mdns, and the personal-hotspot test was
 * void -- ios blocks the host phone from reaching its own clients, so the
 * plain ip failed there too. A dead qr code is worse than a jargon chip.
 * `preferred: false` keeps it out of chooseLanAddress, and appending it
 * LAST keeps it out of resolveRemoteAddress's final fallback as well, so
 * a machine whose only number is a tunnel still advertises the tunnel.
 *
 * WHY NOTHING IS OFFERED WHEN THERE ARE NO CANDIDATES: a .local name
 * resolves to the addresses the machine is advertising. With none, there
 * is nothing behind the name either. */
export function withComputerName(
  candidates: LanAddressCandidate[],
  localHostName: string | null | undefined
): LanAddressCandidate[] {
  if (candidates.length === 0) return candidates
  const host = computerNameHost(localHostName)
  if (host === null || candidates.some((candidate) => candidate.address === host)) {
    return candidates
  }
  // No interface: it is the machine's name, not one adapter's address.
  // The picker shows the name itself where it shows `en0 · 192.168.2.126`
  // for the others.
  return [
    ...candidates,
    { address: host, interfaceName: '', kind: 'computer-name', preferred: false }
  ]
}

/** Every address a phone on the same wifi has a real chance of reaching
 * WITH NO SETUP AT ALL, best first -- the candidates minus the tunnels and
 * bridges. This is what a default may be drawn from; the wider list above
 * is what he may choose from. */
export function rankLanAddresses(interfaces: NetworkAddress[]): string[] {
  return lanAddressCandidates(interfaces)
    .filter((candidate) => candidate.preferred)
    .map((candidate) => candidate.address)
}

/** The address the desktop serves on when he has expressed no preference.
 * Null when there is no such address.
 *
 * Null on a vpn-only machine is the deliberate answer here, not an
 * oversight: handing a phone an address it cannot route to is precisely the
 * failure f1fcc9b fixed -- it looks like the feature is working right up
 * until the phone says "connection failed". resolveRemoteAddress is what
 * decides whether to fall past that and serve on a tunnel anyway; this
 * function only ever answers "what works with no setup". */
export function chooseLanAddress(interfaces: NetworkAddress[]): string | null {
  return rankLanAddresses(interfaces)[0] ?? null
}

/** The address to actually serve on: his remembered choice when it is still
 * one of this machine's addresses, otherwise the best default there is.
 *
 * WHAT HAPPENS WHEN THE REMEMBERED ADDRESS IS GONE -- Tailscale quit, or he
 * left that network: it falls back to the default and says nothing. It does
 * NOT clear the stored choice (the caller keeps that untouched), so the
 * moment Tailscale is back the remote returns to the tailnet address by
 * itself. A preference that erased itself the first time a VPN was off
 * would have to be set again every session.
 *
 * The last fallback -- an unpreferred candidate when there is no preferred
 * one at all -- is for a machine whose only address IS the tunnel. Refusing
 * there would report "no network found" on a machine with a perfectly good
 * one, and unlike the silent misadvertisement f1fcc9b fixed, the address is
 * on screen in the modal and one click from being changed. */
export function resolveRemoteAddress(
  candidates: LanAddressCandidate[],
  remembered: string | null
): string | null {
  if (remembered !== null && candidates.some((candidate) => candidate.address === remembered)) {
    return remembered
  }
  return (
    candidates.find((candidate) => candidate.preferred)?.address ?? candidates[0]?.address ?? null
  )
}

/** Every IPv4 address this machine holds, loopback and tunnels included, in
 * the order the interfaces were enumerated.
 *
 * Not a ranking and not a filter: the only question it answers is "is this
 * Host header one of ours", and for that a machine's loopback, its tailnet
 * address and the bridge it serves count exactly as much as its wifi. See
 * isAllowedHost in remoteAuth.ts. */
export function allLocalIPv4Addresses(interfaces: NetworkAddress[]): string[] {
  const seen = new Set<string>()
  for (const entry of interfaces) {
    if (!isIPv4(entry.family) || octets(entry.address) === null) continue
    seen.add(entry.address)
  }
  return [...seen]
}
