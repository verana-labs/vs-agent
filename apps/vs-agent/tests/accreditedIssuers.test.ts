import type { ParticipantDto } from '@verana-labs/vs-agent-sdk'

import { describe, expect, it } from 'vitest'

import {
  buildIssuerRestrictions,
  extractOnChainSchemaId,
} from '../src/controllers/admin/credentials/CredentialTypeService'

const issuer = (did: string | null) => ({ did }) as unknown as ParticipantDto

describe('extractOnChainSchemaId', () => {
  it('parses the canonical vpr colon form', () => {
    expect(extractOnChainSchemaId('vpr:verana:vna-testnet-1:cs:16')).toBe(16)
  })

  it('parses the legacy slash form', () => {
    expect(extractOnChainSchemaId('vpr:verana:vna-testnet-1/cs/v1/js/42')).toBe(42)
  })

  it('returns undefined for an unrecognized ref', () => {
    expect(extractOnChainSchemaId('https://example.com/schema.json')).toBeUndefined()
  })
})

describe('buildIssuerRestrictions', () => {
  it('builds one issuer_id restriction per accredited issuer DID', () => {
    expect(buildIssuerRestrictions([issuer('did:webvh:issuer-a'), issuer('did:webvh:issuer-b')])).toEqual([
      { issuer_id: 'did:webvh:issuer-a' },
      { issuer_id: 'did:webvh:issuer-b' },
    ])
  })

  it('deduplicates repeated issuers and drops null DIDs', () => {
    expect(
      buildIssuerRestrictions([issuer('did:webvh:issuer-a'), issuer('did:webvh:issuer-a'), issuer(null)]),
    ).toEqual([{ issuer_id: 'did:webvh:issuer-a' }])
  })

  it('returns an empty list when no issuers are accredited', () => {
    expect(buildIssuerRestrictions([])).toEqual([])
  })
})
