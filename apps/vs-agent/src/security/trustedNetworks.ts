import ipaddr from 'ipaddr.js'

export type TrustedNetwork = [ipaddr.IPv4 | ipaddr.IPv6, number]

export const DEFAULT_ADMIN_API_TRUSTED_NETWORKS = ['127.0.0.0/8', '::1/128']

export function parseTrustedNetworks(blocks: string[]): TrustedNetwork[] {
  return blocks.map(block => ipaddr.parseCIDR(block))
}

export function isTrustedPeer(remoteAddress: string | undefined, networks: TrustedNetwork[]): boolean {
  if (!remoteAddress) return false
  let address: ipaddr.IPv4 | ipaddr.IPv6
  try {
    // process() unmaps IPv4-mapped IPv6 (dual-stack listeners hand '::ffff:127.0.0.1' to loopback callers)
    address = ipaddr.process(remoteAddress)
  } catch {
    return false
  }
  return networks.some(
    network =>
      address.kind() === network[0].kind() &&
      (address as ipaddr.IPv4).match(network as [ipaddr.IPv4, number]),
  )
}
