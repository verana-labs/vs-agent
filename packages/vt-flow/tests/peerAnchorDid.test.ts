import { describe, expect, it } from 'vitest'

import { peerAnchorDid } from '../src'

describe('peerAnchorDid', () => {
  it('prefers the invitation DID', () => {
    const connection = {
      invitationDid: 'did:web:validator',
      previousTheirDids: ['did:web:other'],
      theirDid: 'did:peer:4zQmRotated',
    }
    expect(peerAnchorDid(connection as never)).toBe('did:web:validator')
  })

  it('falls back to the DID the peer rotated away from', () => {
    const connection = { previousTheirDids: ['did:web:validator'], theirDid: 'did:peer:4zQmRotated' }
    expect(peerAnchorDid(connection as never)).toBe('did:web:validator')
  })

  it('falls back to theirDid on a record without a rotation history', () => {
    expect(peerAnchorDid({ previousTheirDids: [], theirDid: 'did:web:validator' } as never)).toBe(
      'did:web:validator',
    )
  })
})
