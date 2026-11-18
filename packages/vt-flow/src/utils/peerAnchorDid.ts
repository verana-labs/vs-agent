import type { DidCommConnectionRecord } from '@credo-ts/didcomm'

export function peerAnchorDid(connection: DidCommConnectionRecord): string | undefined {
  const { invitationDid } = connection
  // Credo 0.8 sets invitationDid to our own public DID on a v2 connection a peer opens to it
  const isOurs =
    invitationDid !== undefined &&
    (invitationDid === connection.did || (connection.previousDids ?? []).includes(invitationDid))
  return (isOurs ? undefined : invitationDid) ?? connection.previousTheirDids[0] ?? connection.theirDid
}
