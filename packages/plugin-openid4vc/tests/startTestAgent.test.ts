import { describe, expect, it } from 'vitest'

import {
  activeTcpServers,
  createTestAgentsInput,
  OpenId4VcTestStartupError,
  startTestAgents,
  type TestAgentFailureHooks,
} from './helpers/startTestAgent'

describe('OpenID4VC test-agent startup cleanup', () => {
  it('closes the acquired server when plugin option creation fails', async () => {
    const primary = new Error('deliberate issuer options failure')
    await expectCleanStartupFailure(
      {
        beforeOptions: role => {
          if (role === 'issuer') throw primary
        },
      },
      primary,
    )
  })

  it('shuts down an acquired holder agent when holder initialization fails', async () => {
    const primary = new Error('deliberate holder initialization failure')
    await expectCleanStartupFailure(
      {
        afterInitialize: role => {
          if (role === 'holder') throw primary
        },
      },
      primary,
    )
  })

  it('closes verifier resources and reports cleanup failure without losing the startup error', async () => {
    const primary = new Error('deliberate verifier initialization failure')
    const cleanup = new Error('deliberate verifier cleanup failure')
    const outcome = await captureStartup({
      afterInitialize: role => {
        if (role === 'verifier') throw primary
      },
      afterCleanup: role => {
        if (role === 'verifier') throw cleanup
      },
    })

    expect(outcome.error).toBeInstanceOf(OpenId4VcTestStartupError)
    expect(outcome.error).toMatchObject({ cause: primary, cleanupErrors: [cleanup] })
    expect(outcome.after).toEqual(outcome.before)
  })
})

async function expectCleanStartupFailure(hooks: TestAgentFailureHooks, primary: Error): Promise<void> {
  const outcome = await captureStartup(hooks)
  expect(outcome.error).toBe(primary)
  expect(outcome.after).toEqual(outcome.before)
}

async function captureStartup(hooks: TestAgentFailureHooks): Promise<{
  before: string[]
  after: string[]
  error?: unknown
}> {
  const input = await createTestAgentsInput()
  const before = activeTcpServers()
  let error: unknown
  const started = await startTestAgents({ ...input, failureHooks: hooks }).catch(cause => {
    error = cause
    return undefined
  })
  await started?.stop()
  await new Promise(resolve => setImmediate(resolve))
  return { before, after: activeTcpServers(), error }
}
