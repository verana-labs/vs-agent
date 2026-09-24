import type { OpenId4VcAgent } from '../types'

import { JwkDidResolver } from '@credo-ts/core'

// Wallets bind their OpenID4VCI proofs with `did:jwk`, and credo appends only PeerDidResolver and
// KeyDidResolver to a resolver list the agent supplies, never this one.
export function registerDidJwkResolver(agent: OpenId4VcAgent): void {
  if (agent.dids.config.resolvers.some(resolver => resolver instanceof JwkDidResolver)) return

  agent.dids.config.addResolver(new JwkDidResolver())
}
