import { DidCommCallsModule } from '@2060.io/credo-ts-didcomm-calls'
import { DidCommMediaSharingModule } from '@2060.io/credo-ts-didcomm-media-sharing'
import { DidCommMrtdModule } from '@2060.io/credo-ts-didcomm-mrtd'
import { DidCommReceiptsModule } from '@2060.io/credo-ts-didcomm-receipts'
import { DidCommUserProfileModule } from '@2060.io/credo-ts-didcomm-user-profile'
import { ActionMenuModule } from '@credo-ts/action-menu'
import {
  AnonCredsDidCommCredentialFormatService,
  AnonCredsModule,
  AnonCredsDidCommProofFormatService,
  LegacyIndyDidCommCredentialFormatService,
  LegacyIndyDidCommProofFormatService,
} from '@credo-ts/anoncreds'
import { AskarModule } from '@credo-ts/askar'
import { DidsModule, W3cCredentialsModule } from '@credo-ts/core'
import {
  DidCommCredentialsModuleConfigOptions,
  DidCommCredentialV2Protocol,
  DidCommModule,
  DidCommModuleConfigOptions,
  DidCommProofsModuleConfigOptions,
  DidCommProofV2Protocol,
} from '@credo-ts/didcomm'
import { QuestionAnswerModule } from '@credo-ts/question-answer'

export type BaseAgentModules = {
  askar: AskarModule
  anoncreds: AnonCredsModule
  dids: DidsModule
  w3cCredentials: W3cCredentialsModule
}

export type BaseDidCommAgentModules = BaseAgentModules & {
  didcomm: DidCommModule<
    DidCommModuleConfigOptions & {
      credentials: DidCommCredentialsModuleConfigOptions<
        [
          DidCommCredentialV2Protocol<
            [LegacyIndyDidCommCredentialFormatService, AnonCredsDidCommCredentialFormatService]
          >,
        ]
      >
      proofs: DidCommProofsModuleConfigOptions<
        [DidCommProofV2Protocol<[LegacyIndyDidCommProofFormatService, AnonCredsDidCommProofFormatService]>]
      >
    }
  >
}

export type ChatAgentModules = BaseDidCommAgentModules & {
  actionMenu: ActionMenuModule
  calls: DidCommCallsModule
  media: DidCommMediaSharingModule
  questionAnswer: QuestionAnswerModule
  receipts: DidCommReceiptsModule
  userProfile: DidCommUserProfileModule
}

export type MrtdAgentModules = BaseDidCommAgentModules & {
  mrtd: DidCommMrtdModule
}

export type DidCommAgentModules = BaseAgentModules & {
  didcomm: DidCommModule<
    DidCommModuleConfigOptions & {
      credentials: DidCommCredentialsModuleConfigOptions<
        [
          DidCommCredentialV2Protocol<
            [LegacyIndyDidCommCredentialFormatService, AnonCredsDidCommCredentialFormatService]
          >,
        ]
      >
      proofs: DidCommProofsModuleConfigOptions<
        [DidCommProofV2Protocol<[LegacyIndyDidCommProofFormatService, AnonCredsDidCommProofFormatService]>]
      >
    }
  >
  actionMenu: ActionMenuModule
  calls: DidCommCallsModule
  media: DidCommMediaSharingModule
  mrtd: DidCommMrtdModule
  questionAnswer: QuestionAnswerModule
  receipts: DidCommReceiptsModule
  userProfile: DidCommUserProfileModule
}
