import type { DidCommCallsModule } from '@2060.io/credo-ts-didcomm-calls'
import type { DidCommMediaSharingModule } from '@2060.io/credo-ts-didcomm-media-sharing'
import type { DidCommReactionsModule } from '@2060.io/credo-ts-didcomm-reactions'
import type { DidCommReceiptsModule } from '@2060.io/credo-ts-didcomm-receipts'
import type { DidCommUserProfileModule } from '@2060.io/credo-ts-didcomm-user-profile'
import type { ActionMenuModule } from '@credo-ts/action-menu'
import type { QuestionAnswerModule } from '@credo-ts/question-answer'
import type { BaseAgentModules } from '@verana-labs/vs-agent-sdk'

export type ChatAgentModules = BaseAgentModules & {
  actionMenu: ActionMenuModule
  calls: DidCommCallsModule
  reactions: DidCommReactionsModule
  media: DidCommMediaSharingModule
  questionAnswer: QuestionAnswerModule
  receipts: DidCommReceiptsModule
  userProfile: DidCommUserProfileModule
}
