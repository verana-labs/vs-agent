import { parseDid } from '@credo-ts/core'
import { DidCommHandshakeProtocol, DidCommMessage, type DidCommVersion } from '@credo-ts/didcomm'

import { VsAgent } from '../agent/VsAgent'

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

  const isV2 = didCommVersion === 'v2'

  const outOfBandInvitation = (
    await agent.didcomm.oob.createInvitation({
      label: agent.label,
      multiUseInvitation: !messages,
      imageUrl,
      messages,
      didCommVersion,
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
