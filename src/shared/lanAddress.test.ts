import { describe, expect, it } from 'vitest'
import {
  allLocalIPv4Addresses,
  chooseLanAddress,
  lanAddressCandidates,
  rankLanAddresses,
  resolveRemoteAddress,
  withComputerName,
  type LanAddressKind,
  type NetworkAddress
} from './lanAddress'

function ipv4(name: string, address: string): NetworkAddress {
  return { name, address, family: 'IPv4', internal: false }
}

/** The exact machine that produced the bug: Tailscale's utun0 enumerated
 * FIRST, the real wifi second, an internet-sharing bridge third. */
const HIS_MACHINE: NetworkAddress[] = [
  { name: 'lo0', address: '127.0.0.1', family: 'IPv4', internal: true },
  ipv4('utun0', '100.66.121.12'),
  ipv4('en0', '192.168.2.126'),
  ipv4('bridge100', '192.168.3.1')
]

describe('lanAddress', () => {
  it('picks the wifi on his machine, not the VPN listed first and not the sharing bridge', () => {
    expect(chooseLanAddress(HIS_MACHINE)).toBe('192.168.2.126')
  })

  it('picks the same address whatever order the interfaces are enumerated in', () => {
    // node does not guarantee networkInterfaces() ordering, and depending on
    // it is the actual defect being fixed here.
    const orderings = [
      [...HIS_MACHINE].reverse(),
      [HIS_MACHINE[2], HIS_MACHINE[0], HIS_MACHINE[3], HIS_MACHINE[1]],
      [HIS_MACHINE[3], HIS_MACHINE[1], HIS_MACHINE[2], HIS_MACHINE[0]]
    ]
    for (const ordering of orderings) {
      expect(chooseLanAddress(ordering)).toBe('192.168.2.126')
    }
  })

  it('returns null when there are no interfaces at all', () => {
    expect(chooseLanAddress([])).toBeNull()
    expect(rankLanAddresses([])).toEqual([])
  })

  it('returns null when only loopback is present', () => {
    expect(
      chooseLanAddress([{ name: 'lo0', address: '127.0.0.1', family: 'IPv4', internal: true }])
    ).toBeNull()
  })

  it('returns null when only a VPN is present', () => {
    // A VPN-only machine has no LAN. Advertising the tailnet address is what
    // caused this bug -- the desktop reached it, the phone could not -- so
    // "no network found" is the honest answer, and the UI already has it.
    expect(chooseLanAddress([ipv4('utun3', '100.82.4.9')])).toBeNull()
    expect(chooseLanAddress([ipv4('tun0', '10.8.0.6')])).toBeNull()
  })

  it('skips a VPN by CGNAT range even under an unrecognised interface name', () => {
    expect(chooseLanAddress([ipv4('vpn0', '100.100.7.1'), ipv4('en0', '10.0.0.5')])).toBe(
      '10.0.0.5'
    )
    // 100.64.0.0/10 is 100.64.x -- 100.127.x. Its neighbours are ordinary
    // public addresses and must not be swept up with it.
    expect(chooseLanAddress([ipv4('en0', '100.63.255.255')])).toBe('100.63.255.255')
    expect(chooseLanAddress([ipv4('en0', '100.128.0.1')])).toBe('100.128.0.1')
    expect(chooseLanAddress([ipv4('en0', '100.64.0.1')])).toBeNull()
    expect(chooseLanAddress([ipv4('en0', '100.127.255.254')])).toBeNull()
  })

  it('returns null when only a link-local address is present', () => {
    expect(chooseLanAddress([ipv4('en0', '169.254.30.4')])).toBeNull()
  })

  it('skips every virtual and point-to-point interface by name', () => {
    const virtual = [
      ipv4('utun5', '192.168.9.1'),
      ipv4('tun0', '192.168.9.2'),
      ipv4('tap0', '192.168.9.3'),
      ipv4('awdl0', '192.168.9.4'),
      ipv4('llw0', '192.168.9.5'),
      ipv4('bridge100', '192.168.9.6'),
      ipv4('vmnet8', '192.168.9.7'),
      ipv4('vboxnet0', '192.168.9.8'),
      ipv4('docker0', '192.168.9.9'),
      ipv4('ppp0', '192.168.9.10')
    ]
    expect(chooseLanAddress(virtual)).toBeNull()
    for (const one of virtual) {
      expect(chooseLanAddress([one, ipv4('en0', '192.168.2.126')])).toBe('192.168.2.126')
    }
  })

  it('matches interface names case-insensitively', () => {
    expect(chooseLanAddress([ipv4('UTUN0', '192.168.9.1')])).toBeNull()
  })

  it('ignores IPv6 and internal addresses', () => {
    expect(
      chooseLanAddress([
        { name: 'en0', address: 'fe80::1', family: 'IPv6', internal: false },
        { name: 'en0', address: '192.168.2.126', family: 'IPv4', internal: false },
        { name: 'en1', address: '192.168.2.200', family: 'IPv4', internal: true }
      ])
    ).toBe('192.168.2.126')
  })

  it('prefers an rfc1918 private address over a public one', () => {
    expect(chooseLanAddress([ipv4('en5', '203.0.113.9'), ipv4('eth0', '172.16.4.2')])).toBe(
      '172.16.4.2'
    )
    // 172.16/12 is 172.16.x -- 172.31.x; 172.15 and 172.32 are public.
    expect(chooseLanAddress([ipv4('en0', '172.32.0.1'), ipv4('eth0', '172.31.255.254')])).toBe(
      '172.31.255.254'
    )
    expect(chooseLanAddress([ipv4('en0', '172.15.0.1'), ipv4('eth0', '172.16.0.1')])).toBe(
      '172.16.0.1'
    )
  })

  it('prefers en* over another interface when both are equally private', () => {
    expect(chooseLanAddress([ipv4('eth0', '192.168.5.5'), ipv4('en0', '192.168.2.126')])).toBe(
      '192.168.2.126'
    )
  })

  it('is deterministic between several equally good candidates', () => {
    const two = [ipv4('en1', '192.168.2.200'), ipv4('en0', '192.168.2.126')]
    expect(chooseLanAddress(two)).toBe('192.168.2.126')
    expect(chooseLanAddress([...two].reverse())).toBe('192.168.2.126')
    // en2 before en10: compared as a number, not as text.
    expect(chooseLanAddress([ipv4('en10', '192.168.2.10'), ipv4('en2', '192.168.2.2')])).toBe(
      '192.168.2.2'
    )
    // Same interface, two addresses: lowest address wins, both orderings.
    const sameName = [ipv4('en0', '192.168.2.200'), ipv4('en0', '192.168.2.126')]
    expect(chooseLanAddress(sameName)).toBe('192.168.2.126')
    expect(chooseLanAddress([...sameName].reverse())).toBe('192.168.2.126')
  })

  it('ranks every survivor best-first, so a future ui could offer the runners-up', () => {
    expect(rankLanAddresses(HIS_MACHINE)).toEqual(['192.168.2.126'])
    expect(
      rankLanAddresses([
        ipv4('utun0', '100.66.121.12'),
        ipv4('en0', '192.168.2.126'),
        ipv4('eth0', '10.1.1.4'),
        ipv4('en3', '203.0.113.9')
      ])
    ).toEqual(['192.168.2.126', '10.1.1.4', '203.0.113.9'])
  })

  it('ignores malformed and non-ipv4-shaped addresses', () => {
    expect(
      chooseLanAddress([
        ipv4('en0', ''),
        ipv4('en0', 'not-an-address'),
        ipv4('en0', '192.168.2'),
        ipv4('en0', '999.1.1.1'),
        ipv4('en1', '192.168.2.126')
      ])
    ).toBe('192.168.2.126')
  })

  it('accepts the numeric family node used to report', () => {
    // Older node reported family as 4 rather than 'IPv4'. Cheap to accept.
    expect(
      chooseLanAddress([{ name: 'en0', address: '192.168.2.126', family: 4, internal: false }])
    ).toBe('192.168.2.126')
  })
})

/** What was added on 2026-09-26, and why.
 *
 * His router (a Bell Home Hub 3000) isolates wireless clients: the Mac and
 * the iPhone are both on 192.168.2.x and CANNOT REACH EACH OTHER AT ALL --
 * proven by a bare `python3 -m http.server` on another port being equally
 * unreachable from two different browsers while the gateway answered fine.
 * The LAN is the thing that is broken, and no ranking can fix it.
 *
 * He already runs Tailscale. With Tailscale on the phone too, 100.66.121.12
 * is the one address that works -- and it is precisely the address the
 * ranking above excludes. So the candidate list widens and the RANKING
 * STAYS: a tailnet address is OFFERED but never the default, because a
 * phone that is not on the tailnet cannot use it (that was this morning's
 * bug, and it must not come back by way of the fix for this one). */
describe('lanAddressCandidates', () => {
  it('offers the tailnet address his phone needs, ranked below the wifi', () => {
    expect(lanAddressCandidates(HIS_MACHINE)).toEqual([
      { address: '192.168.2.126', interfaceName: 'en0', kind: 'wifi', preferred: true },
      { address: '100.66.121.12', interfaceName: 'utun0', kind: 'vpn', preferred: false },
      { address: '192.168.3.1', interfaceName: 'bridge100', kind: 'bridge', preferred: false }
    ])
  })

  it('still defaults to the wifi, so this morning bug cannot come back', () => {
    // The whole point of the widening: more choice, same default.
    expect(chooseLanAddress(HIS_MACHINE)).toBe('192.168.2.126')
    expect(rankLanAddresses(HIS_MACHINE)).toEqual(['192.168.2.126'])
  })

  it('marks a cgnat address unpreferred whatever interface it turns up on', () => {
    expect(lanAddressCandidates([ipv4('vpn0', '100.100.7.1')])).toEqual([
      { address: '100.100.7.1', interfaceName: 'vpn0', kind: 'vpn', preferred: false }
    ])
  })

  it('offers every tunnel and sharing interface, unpreferred', () => {
    // Reachable BY A DEVICE THAT SHARES THE TUNNEL (or is plugged into the
    // sharing bridge). Not the default, but a real answer for a real setup.
    const offered: [NetworkAddress, LanAddressKind][] = [
      [ipv4('utun5', '192.168.9.1'), 'vpn'],
      [ipv4('tun0', '192.168.9.2'), 'vpn'],
      [ipv4('tap0', '192.168.9.3'), 'vpn'],
      [ipv4('ppp0', '192.168.9.4'), 'vpn'],
      [ipv4('bridge100', '192.168.9.5'), 'bridge']
    ]
    for (const [one, kind] of offered) {
      expect(lanAddressCandidates([one])).toEqual([
        { address: one.address, interfaceName: one.name, kind, preferred: false }
      ])
    }
  })

  it('never offers an address no other device could ever hold', () => {
    // Not "not preferred" -- NOT ALLOWED. Loopback, a self-assigned
    // link-local, apple's peer-to-peer radios and the host side of a vm or
    // container network are not addresses a phone can be given, on any
    // network, ever. Nothing is gained by listing them.
    expect(
      lanAddressCandidates([
        { name: 'lo0', address: '127.0.0.1', family: 'IPv4', internal: true },
        ipv4('lo0', '127.0.0.1'),
        ipv4('en0', '169.254.30.4'),
        ipv4('awdl0', '192.168.9.1'),
        ipv4('llw0', '192.168.9.2'),
        ipv4('vmnet8', '192.168.9.3'),
        ipv4('vboxnet0', '192.168.9.4'),
        ipv4('docker0', '192.168.9.5'),
        { name: 'en0', address: 'fe80::1', family: 'IPv6', internal: false },
        ipv4('en0', 'not-an-address')
      ])
    ).toEqual([])
  })

  it('puts a tunnel ahead of a sharing bridge among the unpreferred', () => {
    // A tailnet address works from anywhere; an internet-sharing bridge
    // only works for a device plugged into this mac. Both are offered, and
    // the more likely one is nearer the top.
    expect(
      lanAddressCandidates([ipv4('bridge100', '192.168.3.1'), ipv4('utun0', '100.66.121.12')]).map(
        (candidate) => candidate.address
      )
    ).toEqual(['100.66.121.12', '192.168.3.1'])
  })

  it('is deterministic whatever order the interfaces are enumerated in', () => {
    const forwards = lanAddressCandidates(HIS_MACHINE)
    expect(lanAddressCandidates([...HIS_MACHINE].reverse())).toEqual(forwards)
    expect(
      lanAddressCandidates([HIS_MACHINE[2], HIS_MACHINE[0], HIS_MACHINE[3], HIS_MACHINE[1]])
    ).toEqual(forwards)
  })

  it('lists one address once, under the first interface it was seen on', () => {
    expect(
      lanAddressCandidates([ipv4('en0', '192.168.2.126'), ipv4('en1', '192.168.2.126')])
    ).toEqual([{ address: '192.168.2.126', interfaceName: 'en0', kind: 'wifi', preferred: true }])
  })
})

describe('resolveRemoteAddress', () => {
  const candidates = lanAddressCandidates(HIS_MACHINE)

  it('uses the best preferred candidate when nothing has been chosen', () => {
    expect(resolveRemoteAddress(candidates, null)).toBe('192.168.2.126')
  })

  it('uses his remembered choice, even though it is not the preferred one', () => {
    expect(resolveRemoteAddress(candidates, '100.66.121.12')).toBe('100.66.121.12')
  })

  it('falls back to the default when the remembered address is gone', () => {
    // Tailscale quit, or he left that network. The remembered value itself
    // is NOT forgotten by this function -- the caller keeps it, so the
    // choice comes back by itself when tailscale does. Silently serving on
    // the wifi in the meantime beats refusing to start.
    expect(
      resolveRemoteAddress(lanAddressCandidates([ipv4('en0', '192.168.2.126')]), '100.66.121.12')
    ).toBe('192.168.2.126')
  })

  it('serves on the only address there is when none is preferred', () => {
    // A machine whose ONLY address is the tailnet -- no wifi, no ethernet.
    // Refusing here would mean "no network found" on a machine that has a
    // perfectly good one; the address is on screen in the modal either way.
    expect(resolveRemoteAddress(lanAddressCandidates([ipv4('utun0', '100.66.121.12')]), null)).toBe(
      '100.66.121.12'
    )
  })

  it('is null when there is no address at all', () => {
    expect(resolveRemoteAddress([], null)).toBeNull()
    expect(resolveRemoteAddress([], '100.66.121.12')).toBeNull()
  })
})

describe('allLocalIPv4Addresses', () => {
  it('lists every ipv4 the machine holds, loopback and tunnels included', () => {
    // Not a ranking and not a filter -- the question this answers is "is
    // this host one of ours", and for that a machine's own loopback and its
    // tailnet address count exactly as much as its wifi.
    expect(allLocalIPv4Addresses(HIS_MACHINE)).toEqual([
      '127.0.0.1',
      '100.66.121.12',
      '192.168.2.126',
      '192.168.3.1'
    ])
  })

  it('skips ipv6 and malformed rows, and lists each address once', () => {
    expect(
      allLocalIPv4Addresses([
        { name: 'en0', address: 'fe80::1', family: 'IPv6', internal: false },
        ipv4('en0', 'not-an-address'),
        ipv4('en0', '192.168.2.126'),
        ipv4('en1', '192.168.2.126')
      ])
    ).toEqual(['192.168.2.126'])
  })
})

/** THE HUMAN WORD FOR EACH ADDRESS (2026-09-28).
 *
 * The picker used to read `en0 192.168.2.126` / `utun0 100.66.121.12` /
 * `bridge100 192.168.3.1`. Those are BSD device names and nobody outside
 * this file should have to know them. `kind` is the same classification
 * the ranking already does -- tunnel, sharing bridge, everything else --
 * said out loud, so the modal can lead each row with a word instead of a
 * device. There is deliberately no second list of prefixes: kind and tier
 * are decided together in score(). */
describe('lanAddressCandidates kinds', () => {
  it('names his three addresses wifi, vpn and bridge', () => {
    expect(lanAddressCandidates(HIS_MACHINE).map((candidate) => candidate.kind)).toEqual([
      'wifi',
      'vpn',
      'bridge'
    ])
  })

  it('calls every tunnel prefix a vpn, whatever the address range', () => {
    for (const name of ['utun5', 'tun0', 'tap0', 'ppp0']) {
      expect(lanAddressCandidates([ipv4(name, '192.168.9.1')])[0].kind).toBe('vpn')
    }
  })

  it('calls a cgnat address a vpn even on an interface it has never heard of', () => {
    expect(lanAddressCandidates([ipv4('vpn0', '100.100.7.1')])[0].kind).toBe('vpn')
  })

  it('calls a sharing bridge a bridge', () => {
    expect(lanAddressCandidates([ipv4('bridge100', '192.168.3.1')])[0].kind).toBe('bridge')
  })

  it('calls en0 wifi and every other ordinary interface ethernet', () => {
    // A HEURISTIC AND KNOWN TO BE ONE. node tells us a device name and
    // nothing about the medium behind it. On every laptop apple has
    // shipped for years en0 is the wifi and the higher-numbered en* are
    // thunderbolt or usb ethernet, which is what this says. On a mac mini
    // or mac studio with the ethernet port in use the two can be the other
    // way round, and this will then read `ethernet` for the wifi. That is
    // why the row still carries `en0 192.168.2.126` underneath the word --
    // the human word leads, it does not replace.
    expect(lanAddressCandidates([ipv4('en0', '192.168.2.126')])[0].kind).toBe('wifi')
    expect(lanAddressCandidates([ipv4('en5', '192.168.2.126')])[0].kind).toBe('ethernet')
    expect(lanAddressCandidates([ipv4('eth0', '192.168.2.126')])[0].kind).toBe('ethernet')
  })

  it('agrees with preferred, which is the same classification counted twice', () => {
    for (const candidate of lanAddressCandidates(HIS_MACHINE)) {
      expect(candidate.preferred).toBe(candidate.kind === 'wifi' || candidate.kind === 'ethernet')
    }
  })
})

/** THE COMPUTER'S OWN NAME, AS ONE OF THE ADDRESSES (2026-09-28).
 *
 * Every mac already advertises one over bonjour with no code from us --
 * `scutil --get LocalHostName` gives it, `NickelM2` here, so
 * `nickelm2.local`. It survives dhcp moves, which a raw ip does not: the
 * link he sends himself keeps working after the router hands out a
 * different number.
 *
 * IT IS NOT AND MUST NOT BE THE DEFAULT. We could not prove it reaches a
 * real iphone: his home router blocks mdns, and the personal-hotspot test
 * was void because ios blocks the host phone from reaching its own
 * clients (the plain ip failed there too). A dead qr code is worse than a
 * jargon chip, so the ip stays the default and this is an option in the
 * opened list. */
describe('withComputerName', () => {
  const candidates = lanAddressCandidates(HIS_MACHINE)

  it('offers nickelm2.local last, and never as the default', () => {
    const offered = withComputerName(candidates, 'NickelM2')
    expect(offered.map((candidate) => candidate.address)).toEqual([
      '192.168.2.126',
      '100.66.121.12',
      '192.168.3.1',
      'nickelm2.local'
    ])
    expect(offered[3]).toEqual({
      address: 'nickelm2.local',
      interfaceName: '',
      kind: 'computer-name',
      preferred: false
    })
    // The whole point: more choice, same default.
    expect(resolveRemoteAddress(offered, null)).toBe('192.168.2.126')
  })

  it('is still not the default on a machine whose only address is a tunnel', () => {
    // resolveRemoteAddress falls past `preferred` to the first candidate
    // when nothing is preferred. The name must not be that first one, or
    // a vpn-only machine would advertise an unproven address by default.
    const tunnelOnly = withComputerName(
      lanAddressCandidates([ipv4('utun0', '100.66.121.12')]),
      'NickelM2'
    )
    expect(resolveRemoteAddress(tunnelOnly, null)).toBe('100.66.121.12')
  })

  it('lowercases the name and adds .local, because a url is typed by a human', () => {
    expect(withComputerName([], 'NickelM2')).toEqual([])
    expect(withComputerName(candidates, 'NickelM2').at(-1)?.address).toBe('nickelm2.local')
    expect(withComputerName(candidates, 'nickel-m2').at(-1)?.address).toBe('nickel-m2.local')
    // scutil sometimes hands back a name that already carries it, and a
    // trailing dot is how a fully-qualified name is written.
    expect(withComputerName(candidates, 'NickelM2.local').at(-1)?.address).toBe('nickelm2.local')
    expect(withComputerName(candidates, 'NickelM2.local.').at(-1)?.address).toBe('nickelm2.local')
    expect(withComputerName(candidates, '  NickelM2  ').at(-1)?.address).toBe('nickelm2.local')
  })

  it('offers nothing when there is no name, or the name is not a hostname', () => {
    // A name goes into a Host allow-list and into a url. Anything that is
    // not plainly a dns label is dropped rather than repaired -- this is
    // the one place a string from outside reaches the host guard.
    for (const name of [null, undefined, '', '   ', '.local', 'has space', 'semi;colon', 'a/b']) {
      expect(withComputerName(candidates, name)).toEqual(candidates)
    }
  })

  it('offers nothing when the machine has no address at all', () => {
    // A .local name resolves to the addresses the machine is advertising.
    // With none, there is nothing for it to resolve to either.
    expect(withComputerName([], 'NickelM2')).toEqual([])
  })
})
