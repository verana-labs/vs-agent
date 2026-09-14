import type { DidcommModule } from '@verana-labs/vs-agent-sdk'

export const CHAT_DIDCOMM_MODULES: readonly DidcommModule[] = [
  { module: 'receipts', prefixes: ['https://didcomm.org/receipts/'] },
  { module: 'reactions', prefixes: ['https://didcomm.org/reactions/'] },
  { module: 'user-profile', prefixes: ['https://didcomm.org/user-profile/'] },
  { module: 'media-sharing', prefixes: ['https://didcomm.org/media-sharing/'] },
  { module: 'calls', prefixes: ['https://didcomm.org/calls/'] },
  { module: 'action-menu', prefixes: ['https://didcomm.org/action-menu/'] },
  { module: 'question-answer', prefixes: ['https://didcomm.org/questionanswer/'] },
]
