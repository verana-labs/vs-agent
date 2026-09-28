import type {
  CredentialConfigurationRefresh,
  CredentialConfigurationRegistry,
  OpenId4VcCredentialConfiguration,
} from './types'

export function createCredentialConfigurationRegistry(
  initial: OpenId4VcCredentialConfiguration[] = [],
): CredentialConfigurationRegistry {
  assertNoDuplicates(initial)
  const configurations = [...initial]
  let refresh: CredentialConfigurationRefresh | undefined

  const refreshOrRollBack = async (previous: OpenId4VcCredentialConfiguration[]) => {
    try {
      await refresh?.()
    } catch (error) {
      configurations.splice(0, configurations.length, ...previous)
      throw error
    }
  }

  return {
    configurations,
    onReplace(next: CredentialConfigurationRefresh) {
      refresh = next
    },
    replace(next: OpenId4VcCredentialConfiguration[]) {
      assertNoDuplicates(next)
      const previous = [...configurations]
      // acceptDraftCredentialRequests closes over this array at agent construction, before Nest exists, so
      // the set is mutated in place and never reassigned.
      configurations.splice(0, configurations.length, ...next)
      return refreshOrRollBack(previous)
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
