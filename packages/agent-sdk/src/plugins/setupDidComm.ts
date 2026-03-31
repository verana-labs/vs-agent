import { DidCommCallsModule } from '@2060.io/credo-ts-didcomm-calls'
import { DidCommMediaSharingModule } from '@2060.io/credo-ts-didcomm-media-sharing'
import { DidCommMrtdModule } from '@2060.io/credo-ts-didcomm-mrtd'
import { DidCommReceiptsModule } from '@2060.io/credo-ts-didcomm-receipts'
import { DidCommUserProfileModule, UserProfileModuleConfig } from '@2060.io/credo-ts-didcomm-user-profile'
import { ActionMenuModule } from '@credo-ts/action-menu'
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
import { QuestionAnswerModule } from '@credo-ts/question-answer'

import { VsAgentWsOutboundTransport } from '../transports/VsAgentWsOutboundTransport'

export interface DidCommPluginOptions {
  endpoints: string[]
  masterListCscaLocation?: string
}

export interface DidCommPlugin {
  modules: {
    didcomm: DidCommModule<any>
    actionMenu: ActionMenuModule
    calls: DidCommCallsModule
    media: DidCommMediaSharingModule
    mrtd: DidCommMrtdModule
    questionAnswer: QuestionAnswerModule
    receipts: DidCommReceiptsModule
    userProfile: DidCommUserProfileModule
  }
}

/**
 * Sets up DIDComm modules on top of the base signer.
 * Use this together with setupVeranaSigner() for a full DIDComm-capable agent.
 */
export function setupDidComm(options: DidCommPluginOptions): DidCommPlugin {
  return {
    modules: {
      actionMenu: new ActionMenuModule({ strictStateChecking: false }),
      calls: new DidCommCallsModule(),
      mrtd: new DidCommMrtdModule({ masterListCscaLocation: options.masterListCscaLocation }),
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
      media: new DidCommMediaSharingModule(),
      questionAnswer: new QuestionAnswerModule(),
      receipts: new DidCommReceiptsModule(),
      // Disable module's auto disclose feature, managed externally in MessageEvents
      userProfile: new DidCommUserProfileModule(new UserProfileModuleConfig({ autoSendProfile: false })),
    },
  }
}
