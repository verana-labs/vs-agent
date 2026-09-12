import type { DidcommModule } from '@verana-labs/vs-agent-sdk'

export const DIDCOMM_MODULES: readonly DidcommModule[] = [
  {
    module: 'connections',
    prefixes: ['https://didcomm.org/connections/', 'https://didcomm.org/didexchange/'],
  },
  { module: 'basic-messages', prefixes: ['https://didcomm.org/basicmessage/'] },
  { module: 'presentations', prefixes: ['https://didcomm.org/present-proof/'] },
  { module: 'credential-exchanges', prefixes: ['https://didcomm.org/issue-credential/'] },
]
