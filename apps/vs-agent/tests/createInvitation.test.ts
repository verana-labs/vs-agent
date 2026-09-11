import { createInvitation } from '@verana-labs/vs-agent-sdk'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startAgent } from './__mocks__'

describe('createInvitation envelopes', () => {
  let agent: Awaited<ReturnType<typeof startAgent>>

  beforeAll(async () => {
    agent = await startAgent({ label: 'Faber', domain: 'faber', didcommVersions: ['v1', 'v2'] })
    await agent.initialize()
  }, 60_000)

  afterAll(async () => {
    await agent?.shutdown()
  })

  it('returns the v2 out-of-band object by default and the v1 one on request', async () => {
    const v2 = await createInvitation({ agent })
    expect(v2.invitation).toMatchObject({ type: 'https://didcomm.org/out-of-band/2.0/invitation' })

    const v1 = await createInvitation({ agent, didCommVersion: 'v1' })
    const json = JSON.parse(JSON.stringify(v1.invitation)) as Record<string, unknown>
    expect(String(json['@type'] ?? json.type)).toContain('out-of-band/1.1/invitation')
  }, 60_000)

  it('round-trips both envelopes through the url a caller builds', async () => {
    for (const didCommVersion of ['v2', 'v1'] as const) {
      const { invitation, outOfBandInvitation } = await createInvitation({ agent, didCommVersion })
      const url = outOfBandInvitation.toUrl({ domain: 'https://example.com/' })
      expect(url).toContain(didCommVersion === 'v2' ? '?_oob=' : '?oob=')

      const parsed = await agent.didcomm.oob.parseInvitation(url)
      expect(parsed.v2Invitation?.toJSON() ?? parsed.toJSON()).toEqual(invitation)
    }
  }, 60_000)
})
