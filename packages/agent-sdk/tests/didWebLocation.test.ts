import { describe, expect, it } from 'vitest'

import { getDidWebHttpsBaseUrl } from '../src/did/didWebLocation'

describe('getDidWebHttpsBaseUrl', () => {
  it('maps a plain did:web host without a trailing slash', () => {
    expect(getDidWebHttpsBaseUrl('did:web:example.com')).toBe('https://example.com')
  })

  it('decodes the %3A-encoded port of the host segment', () => {
    expect(getDidWebHttpsBaseUrl('did:web:localhost%3A3000')).toBe('https://localhost:3000')
  })

  it('joins the colon-separated path segments with slashes', () => {
    expect(getDidWebHttpsBaseUrl('did:web:example.com%3A3000:dids:issuer')).toBe(
      'https://example.com:3000/dids/issuer',
    )
  })

  it('skips the SCID segment of a did:webvh', () => {
    expect(getDidWebHttpsBaseUrl('did:webvh:QmFixtureScid:example.com:dids:issuer')).toBe(
      'https://example.com/dids/issuer',
    )
    expect(getDidWebHttpsBaseUrl('did:webvh:QmFixtureScid:example.com')).toBe('https://example.com')
  })

  it('lowercases the host and leaves the path alone', () => {
    expect(getDidWebHttpsBaseUrl('did:web:Example.COM:Dids:Issuer')).toBe('https://example.com/Dids/Issuer')
  })

  it('returns undefined for a method it cannot map to https', () => {
    expect(getDidWebHttpsBaseUrl('did:key:z6MkfixtureKey')).toBeUndefined()
    expect(getDidWebHttpsBaseUrl('did:peer:2.Ez6fixture')).toBeUndefined()
  })

  it.each([
    'not-a-did',
    'did:web',
    'did:web:',
    'did:webvh:QmFixtureScid',
    'did:web:example.com::issuer',
    'did:web:example.com%2Fissuer',
    'did:web:example.com#key-1',
    'did:web:example.com/did.json',
  ])('returns undefined for %s', value => {
    expect(getDidWebHttpsBaseUrl(value)).toBeUndefined()
  })
})
