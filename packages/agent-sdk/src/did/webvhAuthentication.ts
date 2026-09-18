import type { VerificationMethod } from '@credo-ts/core'

export type AuthenticationEntry = string | VerificationMethod

// OpenID4VC keys live under authentication and must survive the update-key migration.
const isPluginEntry = (id: string) => id.includes('#openid4vc-')

const entryId = (entry: AuthenticationEntry) => (typeof entry === 'string' ? entry : entry.id)

export function needsAuthenticationMigration(entries: AuthenticationEntry[], didcommKeyId: string): boolean {
  return entries.some(entry => {
    const id = entryId(entry)
    return id !== didcommKeyId && !isPluginEntry(id)
  })
}

export function migratedAuthentication(
  entries: AuthenticationEntry[],
  didcommKeyId: string,
): AuthenticationEntry[] {
  return [didcommKeyId, ...entries.filter(entry => isPluginEntry(entryId(entry)))]
}
