import type { CredentialConfigurationRegistry, OpenId4VcCredentialConfiguration } from './types'

export function createCredentialConfigurationRegistry(
  initial: OpenId4VcCredentialConfiguration[] = [],
): CredentialConfigurationRegistry {
  assertNoDuplicates(initial)
  const configurations = [...initial]

  return {
    configurations,
    replace(next: OpenId4VcCredentialConfiguration[]) {
      assertNoDuplicates(next)
      // acceptDraftCredentialRequests closes over this array at agent construction, before Nest exists, so
      // the set is mutated in place and never reassigned.
      configurations.splice(0, configurations.length, ...next)
    },
  }
}

function assertNoDuplicates(configurations: OpenId4VcCredentialConfiguration[]): void {
  const ids = new Set<string>()
  const vcts = new Set<string>()
  for (const { id, vct } of configurations) {
    if (ids.has(id)) throw new Error(`duplicate credential configuration id "${id}"`)
    if (vcts.has(vct)) throw new Error(`duplicate credential configuration vct "${vct}"`)
    ids.add(id)
    vcts.add(vct)
  }
}
