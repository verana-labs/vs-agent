import type { VsAgent } from '../agent/VsAgent'

import { parseDid } from '@credo-ts/core'
import {
  DidCommConnectionRepository,
  DidCommHandshakeProtocol,
  DidCommMessage,
  type DidCommVersion,
} from '@credo-ts/didcomm'

/**
 * Creates an out of band invitation that will equal to the public DID in case the agent has one defined,
 * and a new one every time in case the agent does not have any public DID.
 *
 * @param agent
 * @returns
 */
export async function createInvitation(options: {
  agent: VsAgent
  messages?: DidCommMessage[]
  useLegacyDid?: boolean
  invitationBaseUrl: string
  imageUrl?: string
  didCommVersion?: DidCommVersion
}) {
  const { agent, messages, useLegacyDid, invitationBaseUrl, imageUrl, didCommVersion } = options

  // Use legacy did:web in case agent's did is webvh and using legacy did
  const ourDid =
    agent.did && parseDid(agent.did).method === 'webvh' && useLegacyDid
      ? `did:web:${parseDid(agent.did).id.split(':')[1]}`
      : agent.did

  const effectiveVersion: DidCommVersion = didCommVersion ?? 'v2'
  const isV2 = effectiveVersion === 'v2'

  if (!agent.didcomm.config.didcommVersions.includes(effectiveVersion)) {
    throw new Error(
      `Cannot create ${effectiveVersion} invitation: agent is configured with ` +
        `didcommVersions: [${agent.didcomm.config.didcommVersions.join(', ')}]. ` +
        `Add "${effectiveVersion}" to the agent's didcommVersions configuration.`,
    )
  }

  const outOfBandInvitation = (
    await agent.didcomm.oob.createInvitation({
      label: agent.label,
      multiUseInvitation: !messages,
      imageUrl,
      messages,
      didCommVersion: effectiveVersion,
      ...(isV2
        ? { ourDid }
        : {
            handshakeProtocols: [DidCommHandshakeProtocol.DidExchange, DidCommHandshakeProtocol.Connections],
            invitationDid: ourDid,
          }),
    })
  ).outOfBandInvitation
  return {
    url: outOfBandInvitation.toUrl({
      domain: invitationBaseUrl,
    }),
  }
}

/**
 * Connects to a peer that publishes a public DID, and reuses the connection that the
 * agent already has to that peer.
 *
 * The agent must keep one connection record only for each peer. A second record for the
 * same pair of DIDs makes the `findByDids` lookup of the message receiver throw
 * `RecordDuplicateError`, and the agent then fails to process every inbound message from
 * that peer. To find the existing record, the agent reads the `publicDid` tag that it
 * sets on each connection to a peer that publishes a public DID.
 *
 * @param agent the local agent
 * @param peerPublicDid the public DID of the peer
 * @returns the id of a ready connection record
 */
export async function connectToPublicDid(agent: VsAgent, peerPublicDid: string): Promise<string> {
  if (!agent.did) throw new Error('Agent has no public DID')

  const [existing] = await agent.didcomm.connections.findAllByQuery({
    publicDid: peerPublicDid,
  })
  if (existing) return (await agent.didcomm.connections.returnWhenIsConnected(existing.id)).id

  const { connectionRecord } = await agent.didcomm.oob.receiveImplicitInvitation({
    did: peerPublicDid,
    ourDid: agent.did,
    label: agent.label,
    didCommVersion: 'v2',
  })
  if (!connectionRecord) throw new Error(`Failed to establish a DIDComm connection to ${peerPublicDid}`)

  try {
    // Tag the record with the public DID of the peer, to find it on the next call.
    connectionRecord.setTag('publicDid', peerPublicDid)
    await agent.context.resolve(DidCommConnectionRepository).update(agent.context, connectionRecord)

    const ready = await agent.didcomm.connections.returnWhenIsConnected(connectionRecord.id)
    return ready.id
  } catch (error) {
    // Delete the incomplete record. If it stays, the next call reuses a connection that
    // the peer never completed, and a later retry adds a duplicate record for the pair.
    await agent.didcomm.connections.deleteById(connectionRecord.id).catch(deleteError => {
      agent.config.logger.warn(`Failed to delete the incomplete connection ${connectionRecord.id}`, {
        error: deleteError,
      })
    })
    throw error
  }
}

export async function getRecordId(agent: VsAgent, id: string): Promise<string> {
  const record = await agent.genericRecords.findById(id)
  return (record?.getTag('messageId') as string) ?? id
}

export async function getWebDid(agent: VsAgent) {
  if (agent.did) {
    const parsedDid = parseDid(agent.did)

    if (parsedDid.method === 'web') return agent.did
    if (parsedDid.method === 'webvh') return `did:web:${parsedDid.id.split(':')[1]}`
  }
}
