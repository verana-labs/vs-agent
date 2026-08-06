import type { ParticipantDto } from '@verana-labs/vs-agent-sdk'

import { ConsoleLogger, LogLevel } from '@credo-ts/core'
import { ParticipantRole, parseSchemaRef, VeranaIndexerService } from '@verana-labs/vs-agent-sdk'
import { describe, expect, it, vi } from 'vitest'

const accredited = (did: string) => ({ did }) as unknown as ParticipantDto

function indexerWith(accreditedDids: string[]) {
  const indexer = new VeranaIndexerService({
    baseUrl: 'http://indexer.invalid',
    logger: new ConsoleLogger(LogLevel.Off),
  })
  vi.spyOn(indexer, 'listParticipants').mockImplementation(async ({ did }) =>
    did && accreditedDids.includes(did) ? [accredited(did)] : [],
  )
  return indexer
}

describe('parseSchemaRef', () => {
  it('parses the canonical vpr colon form', () => {
    expect(parseSchemaRef('vpr:verana:vna-testnet-1:cs:16')).toBe(16)
  })

  it('parses the legacy slash form', () => {
    expect(parseSchemaRef('vpr:verana:vna-testnet-1/cs/v1/js/42')).toBe(42)
  })

  it('returns undefined for an unrecognized ref', () => {
    expect(parseSchemaRef('https://example.com/schema.json')).toBeUndefined()
  })
})

describe('VeranaIndexerService.findUnaccreditedDids', () => {
  it('returns nothing when every issuer is an active accredited issuer of the schema', async () => {
    const indexer = indexerWith(['did:webvh:issuer-a', 'did:webvh:issuer-b'])

    await expect(
      indexer.findUnaccreditedDids(['did:webvh:issuer-a', 'did:webvh:issuer-b'], ParticipantRole.Issuer, 16),
    ).resolves.toEqual([])
  })

  it('returns the issuers that are not accredited for the schema', async () => {
    const indexer = indexerWith(['did:webvh:issuer-a'])

    await expect(
      indexer.findUnaccreditedDids(
        ['did:webvh:issuer-a', 'did:webvh:issuer-rogue'],
        ParticipantRole.Issuer,
        16,
      ),
    ).resolves.toEqual(['did:webvh:issuer-rogue'])
  })

  it('queries the indexer once per distinct issuer', async () => {
    const indexer = indexerWith(['did:webvh:issuer-a'])

    await indexer.findUnaccreditedDids(
      ['did:webvh:issuer-a', 'did:webvh:issuer-a'],
      ParticipantRole.Issuer,
      16,
    )

    expect(indexer.listParticipants).toHaveBeenCalledTimes(1)
    expect(indexer.listParticipants).toHaveBeenCalledWith({
      did: 'did:webvh:issuer-a',
      schemaId: 16,
      role: 'ISSUER',
      participantState: 'ACTIVE',
    })
  })

  it('returns nothing when there are no dids to check', async () => {
    await expect(indexerWith([]).findUnaccreditedDids([], ParticipantRole.Issuer, 16)).resolves.toEqual([])
  })

  it('checks the requested role, so the same did can pass as issuer and fail as verifier', async () => {
    const indexer = new VeranaIndexerService({
      baseUrl: 'http://indexer.invalid',
      logger: new ConsoleLogger(LogLevel.Off),
    })
    vi.spyOn(indexer, 'listParticipants').mockImplementation(async ({ role }) =>
      role === ParticipantRole.Issuer ? [accredited('did:webvh:agent')] : [],
    )

    await expect(
      indexer.findUnaccreditedDids(['did:webvh:agent'], ParticipantRole.Issuer, 16),
    ).resolves.toEqual([])
    await expect(
      indexer.findUnaccreditedDids(['did:webvh:agent'], ParticipantRole.Verifier, 16),
    ).resolves.toEqual(['did:webvh:agent'])
  })
})
