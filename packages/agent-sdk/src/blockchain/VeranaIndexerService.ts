import { fetchJson } from '../utils/util'

import {
  CredentialSchemaDto,
  EcosystemDto,
  IndexerEventsResponse,
  ParticipantDto,
  VeranaIdxConfig,
} from './types'

export class VeranaIndexerService {
  private readonly baseUrl: string

  constructor(private readonly config: VeranaIdxConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
  }

  async getEvents(agentDid: string, afterBlockHeight = 0, limit = 500): Promise<IndexerEventsResponse> {
    this.config.logger.debug(`[VeranaIndexer] getEvents after_block=${afterBlockHeight}`)
    const url = `${this.baseUrl}/verana/indexer/v1/events?did=${encodeURIComponent(agentDid)}&after_block_height=${afterBlockHeight}&limit=${limit}`
    return fetchJson<IndexerEventsResponse>(url)
  }

  async getEcosystem(id: string | number): Promise<EcosystemDto> {
    this.config.logger.debug(`[VeranaIndexer] getEcosystem id=${id}`)
    const data = await fetchJson<{ ecosystem: EcosystemDto }>(`${this.baseUrl}/verana/ec/v1/get/${id}`)
    return data.ecosystem
  }

  async getCredentialSchema(id: string | number): Promise<CredentialSchemaDto> {
    this.config.logger.debug(`[VeranaIndexer] getCredentialSchema id=${id}`)
    const data = await fetchJson<{ schema: CredentialSchemaDto }>(`${this.baseUrl}/verana/cs/v1/get/${id}`)
    return data.schema
  }

  async getParticipant(id: string | number): Promise<ParticipantDto> {
    this.config.logger.debug(`[VeranaIndexer] getParticipant id=${id}`)
    const data = await fetchJson<{ participant: ParticipantDto }>(`${this.baseUrl}/verana/pp/v1/get/${id}`)
    return data.participant
  }
}
