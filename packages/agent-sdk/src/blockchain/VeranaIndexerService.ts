import { fetchJson } from '../utils/util'

import {
  CredentialSchemaDto,
  DigestDto,
  EcosystemDto,
  IndexerEventsResponse,
  ParticipantDto,
  ParticipantSessionDto,
  VeranaIdxConfig,
} from './types'

export class VeranaIndexerService {
  private readonly baseUrl: string

  constructor(private readonly config: VeranaIdxConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
  }

  async getEvents(agentDid: string, afterBlockHeight = 0, limit = 500): Promise<IndexerEventsResponse> {
    this.config.logger.debug(`[VeranaIndexer] getEvents after_block=${afterBlockHeight}`)
    const url = `${this.baseUrl}/v4/indexer/events?dids=${encodeURIComponent(agentDid)}&after_block_height=${afterBlockHeight}&limit=${limit}`
    return fetchJson<IndexerEventsResponse>(url)
  }

  async getEcosystem(id: string | number): Promise<EcosystemDto> {
    this.config.logger.debug(`[VeranaIndexer] getEcosystem id=${id}`)
    const data = await fetchJson<{ ecosystem: EcosystemDto }>(`${this.baseUrl}/v4/ecosystem/get/${id}`)
    return data.ecosystem
  }

  async getCredentialSchema(id: string | number): Promise<CredentialSchemaDto> {
    this.config.logger.debug(`[VeranaIndexer] getCredentialSchema id=${id}`)
    const data = await fetchJson<{ schema: CredentialSchemaDto }>(
      `${this.baseUrl}/v4/credential-schema/get/${id}`,
    )
    return data.schema
  }

  async getParticipant(id: string | number): Promise<ParticipantDto> {
    this.config.logger.debug(`[VeranaIndexer] getParticipant id=${id}`)
    const data = await fetchJson<{ participant: ParticipantDto }>(`${this.baseUrl}/v4/participant/get/${id}`)
    return data.participant
  }

  async getParticipantSession(id: string): Promise<ParticipantSessionDto | undefined> {
    this.config.logger.debug(`[VeranaIndexer] getParticipantSession id=${id}`)
    const data = await fetchJson<{ session: ParticipantSessionDto }>(
      `${this.baseUrl}/v4/participant/participant-session/${encodeURIComponent(id)}`,
      true,
    )
    return data?.session
  }

  async getDigest(digest: string): Promise<DigestDto | undefined> {
    this.config.logger.debug(`[VeranaIndexer] getDigest digest=${digest}`)
    const data = await fetchJson<{ digest: DigestDto }>(
      `${this.baseUrl}/v4/di/get/${encodeURIComponent(digest)}`,
      true,
    )
    return data?.digest
  }
}
