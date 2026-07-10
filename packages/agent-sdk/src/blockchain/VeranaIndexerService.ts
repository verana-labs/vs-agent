import { fetchJson } from '../utils/util'

import {
  CorporationDto,
  CredentialSchemaDto,
  DigestDto,
  EcosystemDto,
  ParticipantRole,
  ParticipantState,
  IndexerEventsResponse,
  ParticipantDto,
  ParticipantSessionDto,
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

  async listEcosystems(): Promise<EcosystemDto[]> {
    this.config.logger.debug('[VeranaIndexer] listEcosystems')
    const data = await fetchJson<{ ecosystems: EcosystemDto[] }>(
      `${this.baseUrl}/v4/ecosystem/list`,
      REQUEST_TIMEOUT_MS,
    )
    return data.ecosystems ?? []
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

  async getCorporation(id: string | number): Promise<CorporationDto | undefined> {
    this.config.logger.debug(`[VeranaIndexer] getCorporation id=${id}`)
    const data = await fetchJson<{ corporation: CorporationDto }>(
      `${this.baseUrl}/v4/corporation/get/${id}`,
      { timeoutMs: REQUEST_TIMEOUT_MS, allowNotFound: true },
    )
    return data?.corporation
  }

  async getParticipantSession(id: string): Promise<ParticipantSessionDto | undefined> {
    this.config.logger.debug(`[VeranaIndexer] getParticipantSession id=${id}`)
    const data = await fetchJson<{ session: ParticipantSessionDto }>(
      `${this.baseUrl}/v4/participant/participant-session/${encodeURIComponent(id)}`,
      { timeoutMs: REQUEST_TIMEOUT_MS, allowNotFound: true },
    )
    return data?.session
  }

  async listCredentialSchemas(ecosystemId: number): Promise<CredentialSchemaDto[]> {
    this.config.logger.debug(`[VeranaIndexer] listCredentialSchemas ecosystem=${ecosystemId}`)
    const data = await fetchJson<{ schemas: CredentialSchemaDto[] }>(
      `${this.baseUrl}/v4/credential-schema/list?ecosystem_id=${ecosystemId}`,
      REQUEST_TIMEOUT_MS,
    )
    return data.schemas
  }

  async listParticipants(filter: {
    schemaId?: number
    role?: ParticipantRole
    did?: string
    participantState?: ParticipantState
  }): Promise<ParticipantDto[]> {
    const params = new URLSearchParams()
    if (filter.schemaId != null) params.set('schema_id', String(filter.schemaId))
    if (filter.role) params.set('role', filter.role)
    if (filter.did) params.set('did', filter.did)
    if (filter.participantState) params.set('participant_state', filter.participantState)
    this.config.logger.debug(`[VeranaIndexer] listParticipants ${params.toString()}`)
    const data = await fetchJson<{ participants: ParticipantDto[] }>(
      `${this.baseUrl}/v4/participant/list?${params.toString()}`,
      REQUEST_TIMEOUT_MS,
    )
    return data.participants
  }

  async getDigest(digest: string): Promise<DigestDto | undefined> {
    this.config.logger.debug(`[VeranaIndexer] getDigest digest=${digest}`)
    const data = await fetchJson<{ digest: DigestDto }>(
      `${this.baseUrl}/v4/di/get/${encodeURIComponent(digest)}`,
      { timeoutMs: REQUEST_TIMEOUT_MS, allowNotFound: true },
    )
    return data?.digest
  }
}
