import type { DidCommCallsModule } from '@credo-ts/didcomm-calls'
import type { DidCommMediaSharingModule } from '@credo-ts/didcomm-media-sharing'
import type { DidCommReactionsModule } from '@credo-ts/didcomm-reactions'
import type { DidCommReceiptsModule } from '@credo-ts/didcomm-receipts'
import type { DidCommUserProfileModule } from '@credo-ts/didcomm-user-profile'
import type { DidCommActionMenuModule } from '@credo-ts/didcomm-action-menu'
import type { DidCommQuestionAnswerModule } from '@credo-ts/didcomm-question-answer'
import type { BaseAgentModules } from '@verana-labs/vs-agent-sdk'

export type ChatAgentModules = BaseAgentModules & {
  actionMenu: DidCommActionMenuModule
  calls: DidCommCallsModule
  reactions: DidCommReactionsModule
  media: DidCommMediaSharingModule
  questionAnswer: DidCommQuestionAnswerModule
  receipts: DidCommReceiptsModule
  userProfile: DidCommUserProfileModule
}
