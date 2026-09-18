import type { DidCommConnectionRecord } from '@credo-ts/didcomm'

export function peerAnchorDid(connection: DidCommConnectionRecord): string | undefined {
  return connection.invitationDid ?? connection.previousTheirDids[0] ?? connection.theirDid
}
