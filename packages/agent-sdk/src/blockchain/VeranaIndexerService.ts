import { fetchJson } from '../utils/util'

import {
  CredentialSchemaDto,
  IndexerActivity,
  IndexerChangesResponse,
  IndexerEventsResponse,
  PermissionDto,
  TrustRegistryDto,
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

  async getTrustRegistry(id: string | number): Promise<TrustRegistryDto> {
    this.config.logger.debug(`[VeranaIndexer] getTrustRegistry id=${id}`)
    const data = await fetchJson<{ trust_registry: TrustRegistryDto }>(
      `${this.baseUrl}/verana/tr/v1/get/${id}`,
    )
    return data.trust_registry
  }

  async getCredentialSchema(id: string | number): Promise<CredentialSchemaDto> {
    this.config.logger.debug(`[VeranaIndexer] getCredentialSchema id=${id}`)
    const data = await fetchJson<{ schema: CredentialSchemaDto }>(`${this.baseUrl}/verana/cs/v1/get/${id}`)
    return data.schema
  }

  async getPermission(id: string | number): Promise<PermissionDto> {
    this.config.logger.debug(`[VeranaIndexer] getPermission id=${id}`)
    const data = await fetchJson<{ permission: PermissionDto }>(`${this.baseUrl}/verana/perm/v1/get/${id}`)
    return data.permission
  }
}
