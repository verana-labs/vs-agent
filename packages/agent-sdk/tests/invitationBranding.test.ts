import { ECS } from '@verana-labs/vs-agent-model'
import { describe, expect, it, vi } from 'vitest'

import { createInvitation } from '../src/utils/agent'
import { linkedVpFragment } from '../src/utils/setupSelfTr'

const DID = 'did:webvh:QmAgent:agent.example'

function makeAgent(serviceClaims?: Record<string, unknown>) {
  const entry = serviceClaims && {
    didDocumentServiceId: `${DID}#${linkedVpFragment(ECS.SERVICE)}`,
    credential: { credentialSubject: serviceClaims },
  }
  const didRecord = { metadata: { get: vi.fn(() => (entry ? { service: entry } : undefined)) } }
  return {
    did: DID,
    publicApiBaseUrl: 'https://agent.example',
    dids: { getCreatedDids: vi.fn(async () => [didRecord]) },
    didcomm: {
      config: { didcommVersions: ['v1', 'v2'] },
      oob: {
        createInvitation: vi.fn(async (_config: Record<string, unknown>) => ({
          outOfBandInvitation: { toJSON: () => ({ id: 'inv' }), v2Invitation: undefined },
        })),
      },
    },
  }
}

describe('createInvitation branding', () => {
  it('takes the label and the image from the ECS-Service credential', async () => {
    const agent = makeAgent({ name: 'Acme Service', logoUri: 'https://cdn/logo.png' })

    await createInvitation({ agent: agent as never })

    expect(agent.didcomm.oob.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Acme Service', imageUrl: 'https://cdn/logo.png' }),
    )
  })

  it('sends no label and no image when the agent holds no service credential', async () => {
    const agent = makeAgent()

    await createInvitation({ agent: agent as never })

    const [config] = agent.didcomm.oob.createInvitation.mock.calls[0]
    expect(config).toMatchObject({ label: undefined, imageUrl: undefined })
  })
})
