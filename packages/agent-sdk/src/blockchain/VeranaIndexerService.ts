import { IndexerActivity, IndexerChangesResponse, VeranaIdxConfig } from './types'

export class VeranaIndexerService {
  private readonly baseUrl: string

  constructor(private readonly config: VeranaIdxConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
  }

  async getChanges(blockHeight: number): Promise<IndexerChangesResponse> {
    const url = `${this.baseUrl}/verana/indexer/v1/changes/${blockHeight}`
    const data = await this.get(url)
    return {
      block_height: Number(data['block_height'] ?? blockHeight),
      next_change_at: data['next_change_at'] != null ? Number(data['next_change_at']) : null,
      activity: (data['activity'] ?? []) as IndexerActivity[],
    }
  }

  private async get(url: string): Promise<Record<string, unknown>> {
    this.config.logger.debug(`[VeranaIndexer] GET ${url}`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`[VeranaIndexer] HTTP ${res.status} for ${url}`)
    return res.json() as Promise<Record<string, unknown>>
  }
}
