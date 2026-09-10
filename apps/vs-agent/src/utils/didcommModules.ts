export interface DidcommModule {
  module: string
  prefixes: string[]
}

export const DIDCOMM_MODULES: readonly DidcommModule[] = [
  {
    module: 'connections',
    prefixes: ['https://didcomm.org/connections/', 'https://didcomm.org/didexchange/'],
  },
  { module: 'basic-messages', prefixes: ['https://didcomm.org/basicmessage/'] },
  { module: 'presentations', prefixes: ['https://didcomm.org/present-proof/'] },
  { module: 'credential-exchanges', prefixes: ['https://didcomm.org/issue-credential/'] },
  { module: 'receipts', prefixes: ['https://didcomm.org/receipts/'] },
  { module: 'reactions', prefixes: ['https://didcomm.org/reactions/'] },
  { module: 'user-profile', prefixes: ['https://didcomm.org/user-profile/'] },
  { module: 'media-sharing', prefixes: ['https://didcomm.org/media-sharing/'] },
  { module: 'calls', prefixes: ['https://didcomm.org/calls/'] },
  { module: 'action-menu', prefixes: ['https://didcomm.org/action-menu/'] },
  { module: 'question-answer', prefixes: ['https://didcomm.org/questionanswer/'] },
  { module: 'mrtd', prefixes: ['https://didcomm.org/mrtd/'] },
]

export function moduleOf(protocol: string): string | undefined {
  return DIDCOMM_MODULES.find(({ prefixes }) => prefixes.some(prefix => protocol.startsWith(prefix)))?.module
}
