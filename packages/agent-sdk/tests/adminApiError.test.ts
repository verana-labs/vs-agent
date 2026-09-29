import { describe, expect, it } from 'vitest'

import { AdminApiErrorCode, trustDecisionError } from '../src/adminApi/AdminApiError'
import { AnonCredsTrustError, AnonCredsTrustErrorReason } from '../src/blockchain/AnonCredsTrustService'

describe('trustDecisionError', () => {
  it.each([
    [AnonCredsTrustErrorReason.Unavailable, undefined, AdminApiErrorCode.ResolverUnavailable, 503],
    [AnonCredsTrustErrorReason.NotAuthorized, undefined, AdminApiErrorCode.NotAuthorized, 409],
    [AnonCredsTrustErrorReason.NotDerivable, undefined, AdminApiErrorCode.NotAuthorized, 409],
    [
      AnonCredsTrustErrorReason.NotDerivable,
      AdminApiErrorCode.InvalidInput,
      AdminApiErrorCode.InvalidInput,
      400,
    ],
    [AnonCredsTrustErrorReason.NotDerivable, AdminApiErrorCode.UnknownId, AdminApiErrorCode.UnknownId, 404],
  ])('maps a %s error with the %s code to %s %i', (reason, notDerivableCode, code, status) => {
    const error = new AnonCredsTrustError(reason, 'why')

    expect(trustDecisionError(error, 'agent', notDerivableCode)).toMatchObject({
      code,
      status,
      message: 'why',
    })
  })

  it('names the peer for an unauthorized peer', () => {
    const error = new AnonCredsTrustError(AnonCredsTrustErrorReason.NotAuthorized, 'why')

    expect(trustDecisionError(error, 'peer')).toMatchObject({ code: AdminApiErrorCode.PeerNotAuthorized })
  })

  it('leaves any other error as it is', () => {
    const error = new Error('unrelated')

    expect(trustDecisionError(error, 'agent')).toBe(error)
  })
})
