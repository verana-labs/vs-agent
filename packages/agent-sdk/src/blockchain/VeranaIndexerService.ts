import { fetchJson } from '../utils/util'

import {
  CorporationDto,
  CredentialSchemaDto,
  EcosystemDto,
  IndexerEventsResponse,
  ParticipantDto,
  VeranaIdxConfig,
} from './types'

// Timeout so one stuck request cannot block the whole sync queue.
const REQUEST_TIMEOUT_MS = 30_000

export class VeranaIndexerService {
  private readonly baseUrl: string

  constructor(private readonly config: VeranaIdxConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
  }

  async getEvents(
    agentDid: string,
    afterBlockHeight = 0,
    limit = 500,
    corporationId?: number,
  ): Promise<IndexerEventsResponse> {
    this.config.logger.debug(`[VeranaIndexer] getEvents after_block=${afterBlockHeight}`)
    const scope =
      corporationId != null ? `corporation_id=${corporationId}` : `dids=${encodeURIComponent(agentDid)}`
    const url = `${this.baseUrl}/v4/indexer/events?${scope}&after_block_height=${afterBlockHeight}&limit=${limit}`
    return fetchJson<IndexerEventsResponse>(url, REQUEST_TIMEOUT_MS)
  }

  async getEcosystem(id: string | number): Promise<EcosystemDto> {
    this.config.logger.debug(`[VeranaIndexer] getEcosystem id=${id}`)
    const data = await fetchJson<{ ecosystem: EcosystemDto }>(
      `${this.baseUrl}/v4/ecosystem/get/${id}`,
      REQUEST_TIMEOUT_MS,
    )
    return data.ecosystem
  }

  async getCredentialSchema(id: string | number): Promise<CredentialSchemaDto> {
    this.config.logger.debug(`[VeranaIndexer] getCredentialSchema id=${id}`)
    const data = await fetchJson<{ schema: CredentialSchemaDto }>(
      `${this.baseUrl}/v4/credential-schema/get/${id}`,
      REQUEST_TIMEOUT_MS,
    )
    return data.schema
  }

  async getParticipant(id: string | number): Promise<ParticipantDto> {
    this.config.logger.debug(`[VeranaIndexer] getParticipant id=${id}`)
    const data = await fetchJson<{ participant: ParticipantDto }>(
      `${this.baseUrl}/v4/participant/get/${id}`,
      REQUEST_TIMEOUT_MS,
    )
    return data.participant
  }

  async getCorporation(id: string | number): Promise<CorporationDto> {
    this.config.logger.debug(`[VeranaIndexer] getCorporation id=${id}`)
    return fetchJson<CorporationDto>(`${this.baseUrl}/v4/corporation/get/${id}`, REQUEST_TIMEOUT_MS)
  }
}
