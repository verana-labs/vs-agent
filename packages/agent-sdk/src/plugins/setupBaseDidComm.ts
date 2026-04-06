import {
  AnonCredsDidCommCredentialFormatService,
  AnonCredsDidCommProofFormatService,
  LegacyIndyDidCommCredentialFormatService,
  LegacyIndyDidCommProofFormatService,
} from '@credo-ts/anoncreds'
import {
  DidCommAutoAcceptCredential,
  DidCommAutoAcceptProof,
  DidCommCredentialV2Protocol,
  DidCommHttpOutboundTransport,
  DidCommModule,
  DidCommProofV2Protocol,
} from '@credo-ts/didcomm'

import { BaseDidCommAgentModules } from '../agent/types'
import { VsAgentWsOutboundTransport } from '../transports/VsAgentWsOutboundTransport'

export interface BaseDidCommPluginOptions {
  endpoints: string[]
}

export interface BaseDidCommPlugin {
  modules: Pick<BaseDidCommAgentModules, 'didcomm'>
}

/**
 * Sets up the base DIDComm module: connections, OOB, credential exchange, and proof exchange.
 * Use together with setupVeranaSigner() as the foundational DIDComm layer.
 * For chat protocols, add setupChatProtocols(). For eMRTD, add setupMrtdProtocol().
 */
export function setupBaseDidComm(options: BaseDidCommPluginOptions): BaseDidCommPlugin {
  return {
    modules: {
      didcomm: new DidCommModule({
        endpoints: options.endpoints,
        transports: {
          outbound: [new DidCommHttpOutboundTransport(), new VsAgentWsOutboundTransport()],
        },
        connections: { autoAcceptConnections: true },
        credentials: {
          autoAcceptCredentials: DidCommAutoAcceptCredential.ContentApproved,
          credentialProtocols: [
            new DidCommCredentialV2Protocol({
              credentialFormats: [
                new LegacyIndyDidCommCredentialFormatService(),
                new AnonCredsDidCommCredentialFormatService(),
              ],
            }),
          ],
        },
        proofs: {
          autoAcceptProofs: DidCommAutoAcceptProof.ContentApproved,
          proofProtocols: [
            new DidCommProofV2Protocol({
              proofFormats: [
                new LegacyIndyDidCommProofFormatService(),
                new AnonCredsDidCommProofFormatService(),
              ],
            }),
          ],
        },
      }),
    },
  }
}
