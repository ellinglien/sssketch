import { describe, expect, it } from 'vitest'
import { chooseLanAddress, rankLanAddresses, type NetworkAddress } from './lanAddress'

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
