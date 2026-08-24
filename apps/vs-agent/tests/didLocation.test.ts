import { describe, expect, it } from 'vitest'

import { derivePublicDidLocation } from '../src/utils/didLocation'

describe('derivePublicDidLocation', () => {
  it.each([
    {
      name: 'bare domain resolves under /.well-known',
      baseUrl: 'https://w3c-ccg.github.io',
      expected: {
        host: 'w3c-ccg.github.io',
        port: undefined,
        pathSegments: [],
        domain: 'w3c-ccg.github.io',
        location: 'w3c-ccg.github.io',
        path: undefined,
        hasPath: false,
        normalizedBaseUrl: 'https://w3c-ccg.github.io',
      },
    },
    {
      name: 'domain with path uses colon-separated segments',
      baseUrl: 'https://w3c-ccg.github.io/user/alice',
      expected: {
        host: 'w3c-ccg.github.io',
        port: undefined,
        pathSegments: ['user', 'alice'],
        domain: 'w3c-ccg.github.io',
        location: 'w3c-ccg.github.io:user:alice',
        path: 'user/alice',
        hasPath: true,
        normalizedBaseUrl: 'https://w3c-ccg.github.io/user/alice',
      },
    },
    {
      name: 'domain with port and path encodes the port as %3A',
      baseUrl: 'https://example.com:3000/user/alice',
      expected: {
        host: 'example.com',
        port: '3000',
        pathSegments: ['user', 'alice'],
        domain: 'example.com%3A3000',
        location: 'example.com%3A3000:user:alice',
        path: 'user/alice',
        hasPath: true,
        normalizedBaseUrl: 'https://example.com:3000/user/alice',
      },
    },
  ])('$name', ({ baseUrl, expected }) => {
    expect(derivePublicDidLocation(baseUrl)).toEqual(expected)
  })

  it('strips a trailing slash from the normalized base URL', () => {
    expect(derivePublicDidLocation('https://example.com/').normalizedBaseUrl).toBe('https://example.com')
    expect(derivePublicDidLocation('https://example.com/dids/issuer/').normalizedBaseUrl).toBe(
      'https://example.com/dids/issuer',
    )
  })

  it.each([
    { name: 'unparseable URL', baseUrl: 'not a url', message: /not a valid URL/ },
    { name: 'non-http scheme', baseUrl: 'ftp://example.com', message: /must use http or https/ },
    { name: 'userinfo with password', baseUrl: 'https://user:pass@example.com', message: /userinfo/ },
    { name: 'userinfo without password', baseUrl: 'https://user@example.com', message: /userinfo/ },
    { name: 'query', baseUrl: 'https://example.com?x=1', message: /query or fragment/ },
    { name: 'fragment', baseUrl: 'https://example.com#top', message: /query or fragment/ },
  ])('rejects $name', ({ baseUrl, message }) => {
    expect(() => derivePublicDidLocation(baseUrl)).toThrow(message)
  })
})
