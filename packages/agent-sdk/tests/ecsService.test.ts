import { ECS } from '@verana-labs/vs-agent-model'
import { describe, expect, it, vi } from 'vitest'

import { agentDisplayName, ecsServiceClaims } from '../src/utils/ecsService'
import { linkedVpFragment } from '../src/utils/setupSelfTr'

const DID = 'did:webvh:QmAgent:agent.example'

function makeAgent(vtc: Record<string, unknown> | undefined) {
  const didRecord = { metadata: { get: vi.fn((key: string) => (key === '_vt/vtc' ? vtc : undefined)) } }
  return {
    did: DID,
    publicApiBaseUrl: 'https://agent.example/vs',
    dids: { getCreatedDids: vi.fn(async () => (vtc === undefined ? [] : [didRecord])) },
  }
}

const serviceEntry = {
  didDocumentServiceId: `${DID}#${linkedVpFragment(ECS.SERVICE)}`,
  credential: {
    credentialSubject: { name: 'Acme Service', description: 'd', logoUri: 'https://cdn/logo.png' },
  },
}
const orgEntry = {
  didDocumentServiceId: `${DID}#${linkedVpFragment(ECS.ORG)}`,
  credential: { credentialSubject: { name: 'Acme Org' } },
}

describe('ecsServiceClaims', () => {
  it('returns the claims of the ECS-Service credential and ignores the other schemas', async () => {
    const agent = makeAgent({ org: orgEntry, service: serviceEntry })

    await expect(ecsServiceClaims(agent as never)).resolves.toEqual({
      name: 'Acme Service',
      description: 'd',
      logoUri: 'https://cdn/logo.png',
    })
    expect(agent.dids.getCreatedDids).toHaveBeenCalledWith({ did: DID })
  })

  it('returns nothing when the agent holds no service credential, or no DID', async () => {
    await expect(ecsServiceClaims(makeAgent({ org: orgEntry }) as never)).resolves.toBeUndefined()
    await expect(ecsServiceClaims(makeAgent(undefined) as never)).resolves.toBeUndefined()
    await expect(
      ecsServiceClaims({ ...makeAgent({ service: serviceEntry }), did: undefined } as never),
    ).resolves.toBeUndefined()
  })
})

describe('agentDisplayName', () => {
  it('prefers the service credential name and falls back to the host of the public base url', async () => {
    await expect(agentDisplayName(makeAgent({ service: serviceEntry }) as never)).resolves.toBe(
      'Acme Service',
    )
    await expect(agentDisplayName(makeAgent(undefined) as never)).resolves.toBe('agent.example')
  })
})
