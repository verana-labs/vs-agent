import { DidCommCallsModule } from '@2060.io/credo-ts-didcomm-calls'
import { DidCommMediaSharingModule } from '@2060.io/credo-ts-didcomm-media-sharing'
import { DidCommReactionsModule } from '@2060.io/credo-ts-didcomm-reactions'
import { DidCommReceiptsModule } from '@2060.io/credo-ts-didcomm-receipts'
import {
  DidCommUserProfileModule,
  DidCommUserProfileModuleConfig,
} from '@2060.io/credo-ts-didcomm-user-profile'
import { ActionMenuModule } from '@credo-ts/action-menu'
import { QuestionAnswerModule } from '@credo-ts/question-answer'

import { ChatAgentModules } from '../agent/types'

export interface ChatPlugin {
  modules: Pick<
    ChatAgentModules,
    'actionMenu' | 'calls' | 'reactions' | 'media' | 'questionAnswer' | 'receipts' | 'userProfile'
  >
}

/**
 * Sets up social/chat DIDComm protocol modules.
 * Adds action menu, calls, media sharing, question-answer, receipts, and user profile exchange.
 * Must be used together with setupBaseDidComm().
 */
export function setupChatProtocols(): ChatPlugin {
  return {
    modules: {
      actionMenu: new ActionMenuModule({ strictStateChecking: false }),
      calls: new DidCommCallsModule(),
      reactions: new DidCommReactionsModule(),
      media: new DidCommMediaSharingModule(),
      questionAnswer: new QuestionAnswerModule(),
      receipts: new DidCommReceiptsModule(),
      // Disable module's auto disclose feature, managed externally in ChatEvents
      userProfile: new DidCommUserProfileModule(
        new DidCommUserProfileModuleConfig({ autoSendProfile: false }),
      ),
    },
  }
}
