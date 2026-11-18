import { DidCommCallsModule } from '@credo-ts/didcomm-calls'
import { DidCommMediaSharingModule } from '@credo-ts/didcomm-media-sharing'
import { DidCommReactionsModule } from '@credo-ts/didcomm-reactions'
import { DidCommReceiptsModule } from '@credo-ts/didcomm-receipts'
import { DidCommUserProfileModule, DidCommUserProfileModuleConfig } from '@credo-ts/didcomm-user-profile'
import { DidCommActionMenuModule } from '@credo-ts/didcomm-action-menu'
import { DidCommQuestionAnswerModule } from '@credo-ts/didcomm-question-answer'

import { ChatAgentModules } from '../types'

export interface ChatSdkPlugin {
  modules: Pick<
    ChatAgentModules,
    'actionMenu' | 'calls' | 'reactions' | 'media' | 'questionAnswer' | 'receipts' | 'userProfile'
  >
}

export function setupChatProtocols(): ChatSdkPlugin {
  return {
    modules: {
      actionMenu: new DidCommActionMenuModule({ strictStateChecking: false }),
      calls: new DidCommCallsModule(),
      reactions: new DidCommReactionsModule(),
      media: new DidCommMediaSharingModule(),
      questionAnswer: new DidCommQuestionAnswerModule(),
      receipts: new DidCommReceiptsModule(),
      // Disable module's auto disclose feature, managed externally in ChatEvents
      userProfile: new DidCommUserProfileModule(
        new DidCommUserProfileModuleConfig({ autoSendProfile: false }),
      ),
    },
  }
}
