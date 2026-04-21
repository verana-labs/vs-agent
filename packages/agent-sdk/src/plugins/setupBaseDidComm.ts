import {
  AnonCredsDidCommCredentialFormatService,
  AnonCredsDidCommProofFormatService,
  LegacyIndyDidCommCredentialFormatService,
  LegacyIndyDidCommProofFormatService,
  AnonCredsModule,
} from '@credo-ts/anoncreds'
import { AskarModule, AskarModuleConfigStoreOptions } from '@credo-ts/askar'
import { DidsModule, W3cCredentialsModule } from '@credo-ts/core'
import {
  DidCommAutoAcceptCredential,
  DidCommAutoAcceptProof,
  DidCommCredentialV2Protocol,
  DidCommHttpOutboundTransport,
  DidCommJsonLdCredentialFormatService,
  DidCommModule,
  DidCommProofV2Protocol,
} from '@credo-ts/didcomm'
import { WebVhAnonCredsRegistry, WebVhDidRegistrar, WebVhDidResolver } from '@credo-ts/webvh'
import { anoncreds } from '@hyperledger/anoncreds-nodejs'
import { askar } from '@openwallet-foundation/askar-nodejs'
import { DidWebAnonCredsRegistry } from 'credo-ts-didweb-anoncreds'

import { BaseAgentModules } from '../agent/VsAgent'
import { FullTailsFileService } from '../credentials/FullTailsFileService'
import { defaultDocumentLoader } from '../did/CachedDocumentLoader'
import { CachedWebDidResolver } from '../did/CachedWebDidResolver'
import { WebDidRegistrar } from '../did/WebDidRegistrar'
import { VsAgentWsOutboundTransport } from '../transports/VsAgentWsOutboundTransport'

export interface BaseDidCommPluginOptions {
  walletConfig: AskarModuleConfigStoreOptions
  publicApiBaseUrl: string
  endpoints: string[]
}

export interface BaseDidCommPlugin {
  modules: BaseAgentModules
}

/**
 * Sets up the base DIDComm module: connections, OOB, credential exchange, and proof exchange.
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
                // Required for W3C JSON-LD credentials (vt-flow, ECS).
                new DidCommJsonLdCredentialFormatService(),
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
      askar: new AskarModule({
        askar,
        store: options.walletConfig,
      }),
      anoncreds: new AnonCredsModule({
        anoncreds,
        tailsFileService: new FullTailsFileService({
          tailsServerBaseUrl: `${options.publicApiBaseUrl}/anoncreds/v1/tails`,
        }),
        registries: [
          new DidWebAnonCredsRegistry({
            cacheOptions: { allowCaching: true, cacheDurationInSeconds: 24 * 60 * 60 },
          }),
          new WebVhAnonCredsRegistry(),
        ],
      }),
      dids: new DidsModule({
        resolvers: [
          new CachedWebDidResolver({ publicApiBaseUrl: options.publicApiBaseUrl }),
          new WebVhDidResolver(),
        ],
        registrars: [new WebDidRegistrar(), new WebVhDidRegistrar()],
      }),
      w3cCredentials: new W3cCredentialsModule({
        documentLoader: defaultDocumentLoader,
      }),
    },
  }
}
