import type { CredentialConfigurationRegistry, OpenId4VcCredentialConfiguration } from './types'

export function createCredentialConfigurationRegistry(
  initial: OpenId4VcCredentialConfiguration[] = [],
): CredentialConfigurationRegistry {
  const configurations = [...initial]

  return {
    configurations,
    replace(next: OpenId4VcCredentialConfiguration[]) {
      // acceptDraftCredentialRequests closes over this array at agent construction, before Nest exists, so
      // the set is mutated in place and never reassigned.
      configurations.splice(0, configurations.length, ...next)
    },
  }
}
