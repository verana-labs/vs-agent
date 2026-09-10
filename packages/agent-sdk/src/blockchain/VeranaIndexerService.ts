import { fetchJson } from '../utils/util'

import { toParticipant } from './indexerMappers'

import {
  CorporationDto,
  DurationParam,
  Participant,
  OperatorAuthorization,
  CredentialSchemaDto,
  DigestDto,
  EcosystemDto,
  ParticipantRole,
  ParticipantState,
  IndexerEventsResponse,
  ParticipantDto,
  ParticipantSessionDto,
  VeranaIdxConfig,
  VsOperatorAuthorization,
} from './types'

// Timeout so one stuck request cannot block the whole sync queue.
const REQUEST_TIMEOUT_MS = 30_000

// The delegation projection runs on its own bull job, so it can trail the event stream that told the
// agent to refresh. `atBlock` is that job's checkpoint: waiting for it closes the read-after-write gap.
const DELEGATION_CATCHUP_TIMEOUT_MS = 15_000
const CATCHUP_INTERVAL_MS = 500
const DIGEST_CATCHUP_TIMEOUT_MS = 15_000

type RawDuration = { seconds?: number | string; nanos?: number } | string

function toDuration(raw?: RawDuration | null): DurationParam | undefined {
  if (raw == null) return undefined
  if (typeof raw === 'string') {
    const seconds = Number.parseFloat(raw.endsWith('s') ? raw.slice(0, -1) : raw)
    return Number.isFinite(seconds) ? { seconds: Math.trunc(seconds) } : undefined
  }
  return { seconds: Number(raw.seconds ?? 0), nanos: raw.nanos }
}

interface RawOperatorAuthorization {
  id: number
  corporation_id: number
  operator: string
  msg_types?: string[]
  expiration?: string | null
  period?: RawDuration | null
}

interface RawVsOperatorAuthorization {
  id: number
  corporation_id: number
  vs_operator: string
  records?: {
    participant_id: number
    msg_types?: string[]
    with_feegrant?: boolean
    expiration?: string | null
    period?: RawDuration | null
  }[]
}

interface DelegationPage<T> {
  atBlock?: number
  authorizations?: T[]
}

const active = (p: ParticipantDto): boolean => !p.revoked && !p.slashed

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

  async getEcosystem(id: string | number): Promise<EcosystemDto>
  async getEcosystem(id: string | number, options: { allowNotFound: true }): Promise<EcosystemDto | undefined>
  async getEcosystem(
    id: string | number,
    options?: { allowNotFound?: boolean },
  ): Promise<EcosystemDto | undefined> {
    this.config.logger.debug(`[VeranaIndexer] getEcosystem id=${id}`)
    const url = `${this.baseUrl}/v4/ecosystem/get/${encodeURIComponent(id)}`
    const data = options?.allowNotFound
      ? await fetchJson<{ ecosystem: EcosystemDto }>(url, {
          timeoutMs: REQUEST_TIMEOUT_MS,
          allowNotFound: true,
        })
      : await fetchJson<{ ecosystem: EcosystemDto }>(url, REQUEST_TIMEOUT_MS)
    return data?.ecosystem
  }

  async listEcosystems(): Promise<EcosystemDto[]> {
    this.config.logger.debug('[VeranaIndexer] listEcosystems')
    const data = await fetchJson<{ ecosystems: EcosystemDto[] }>(
      `${this.baseUrl}/v4/ecosystem/list`,
      REQUEST_TIMEOUT_MS,
    )
    return data.ecosystems ?? []
  }

  async listCredentialSchemas(ecosystemId: number): Promise<CredentialSchemaDto[]> {
    this.config.logger.debug(`[VeranaIndexer] listCredentialSchemas ecosystem=${ecosystemId}`)
    const data = await fetchJson<{ schemas: CredentialSchemaDto[] }>(
      `${this.baseUrl}/v4/credential-schema/list?ecosystem_id=${ecosystemId}`,
      REQUEST_TIMEOUT_MS,
    )
    return data.schemas
  }

  async getCredentialSchema(id: string | number): Promise<CredentialSchemaDto>
  async getCredentialSchema(
    id: string | number,
    options: { allowNotFound: true },
  ): Promise<CredentialSchemaDto | undefined>
  async getCredentialSchema(
    id: string | number,
    options?: { allowNotFound?: boolean },
  ): Promise<CredentialSchemaDto | undefined> {
    this.config.logger.debug(`[VeranaIndexer] getCredentialSchema id=${id}`)
    const url = `${this.baseUrl}/v4/credential-schema/get/${encodeURIComponent(id)}`
    const data = options?.allowNotFound
      ? await fetchJson<{ schema: CredentialSchemaDto }>(url, {
          timeoutMs: REQUEST_TIMEOUT_MS,
          allowNotFound: true,
        })
      : await fetchJson<{ schema: CredentialSchemaDto }>(url, REQUEST_TIMEOUT_MS)
    return data?.schema
  }

  async getParticipant(id: string | number): Promise<ParticipantDto> {
    this.config.logger.debug(`[VeranaIndexer] getParticipant id=${id}`)
    const data = await fetchJson<{ participant: ParticipantDto }>(
      `${this.baseUrl}/v4/participant/get/${encodeURIComponent(id)}`,
      REQUEST_TIMEOUT_MS,
    )
    return data.participant
  }

  async getCorporation(id: string | number): Promise<CorporationDto | undefined> {
    this.config.logger.debug(`[VeranaIndexer] getCorporation id=${id}`)
    const data = await fetchJson<{ corporation: CorporationDto }>(
      `${this.baseUrl}/v4/corporation/get/${encodeURIComponent(id)}`,
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

  async findParticipant(id: string | number): Promise<Participant | undefined> {
    this.config.logger.debug(`[VeranaIndexer] findParticipant id=${id}`)
    const data = await fetchJson<{ participant: ParticipantDto }>(
      `${this.baseUrl}/v4/participant/get/${encodeURIComponent(id)}`,
      { timeoutMs: REQUEST_TIMEOUT_MS, allowNotFound: true },
    )
    return data?.participant ? toParticipant(data.participant) : undefined
  }

  async findActiveHolderParticipantIdByDid(did: string): Promise<number | undefined> {
    const participants = await this.listParticipants({ did, role: ParticipantRole.Holder })
    return participants.find(p => p.did === did && p.role === ParticipantRole.Holder && active(p))?.id
  }

  async findActiveIssuerParticipantId(
    did: string,
    schemaId: number,
    vsOperator: string,
  ): Promise<number | undefined> {
    const participants = await this.listParticipants({ did, schemaId, role: ParticipantRole.Issuer })
    return participants.find(
      p =>
        p.did === did &&
        p.role === ParticipantRole.Issuer &&
        p.schema_id === schemaId &&
        p.vs_operator === vsOperator &&
        active(p),
    )?.id
  }

  private async delegationPage<T>(path: string, minBlock?: number): Promise<T[]> {
    const deadline = Date.now() + DELEGATION_CATCHUP_TIMEOUT_MS
    for (;;) {
      const data = await fetchJson<DelegationPage<T>>(`${this.baseUrl}${path}`, REQUEST_TIMEOUT_MS)
      const atBlock = data.atBlock ?? 0
      if (minBlock === undefined || atBlock >= minBlock) return data.authorizations ?? []
      if (Date.now() >= deadline) {
        throw new Error(
          `[VeranaIndexer] delegation checkpoint ${atBlock} never reached block ${minBlock} for ${path}`,
        )
      }
      await new Promise(resolve => setTimeout(resolve, CATCHUP_INTERVAL_MS))
    }
  }

  async listOperatorAuthorizations(operator: string, minBlock?: number): Promise<OperatorAuthorization[]> {
    this.config.logger.debug(`[VeranaIndexer] listOperatorAuthorizations operator=${operator}`)
    const rows = await this.delegationPage<RawOperatorAuthorization>(
      `/v4/delegation/operator-authorizations?operator=${encodeURIComponent(operator)}`,
      minBlock,
    )
    return rows.map(a => ({
      id: a.id,
      corporationId: a.corporation_id,
      operator: a.operator,
      msgTypes: a.msg_types ?? [],
      expiration: a.expiration ? new Date(a.expiration) : undefined,
      period: toDuration(a.period),
    }))
  }

  async listVsOperatorAuthorizations(
    vsOperator: string,
    minBlock?: number,
  ): Promise<VsOperatorAuthorization[]> {
    this.config.logger.debug(`[VeranaIndexer] listVsOperatorAuthorizations vs_operator=${vsOperator}`)
    const rows = await this.delegationPage<RawVsOperatorAuthorization>(
      `/v4/delegation/vs-operator-authorizations?vs_operator=${encodeURIComponent(vsOperator)}`,
      minBlock,
    )
    return rows.map(a => ({
      id: a.id,
      corporationId: a.corporation_id,
      vsOperator: a.vs_operator,
      records: (a.records ?? []).map(r => ({
        participantId: r.participant_id,
        msgTypes: r.msg_types ?? [],
        withFeegrant: Boolean(r.with_feegrant),
        expiration: r.expiration ? new Date(r.expiration) : undefined,
        period: toDuration(r.period),
      })),
    }))
  }

  // Anchoring is a write this agent reads back on its next run, so the redundant-transaction check
  // only holds if the indexer has caught up first. A timeout costs one extra anchoring, not a boot.
  async waitForDigest(digest: string): Promise<void> {
    const deadline = Date.now() + DIGEST_CATCHUP_TIMEOUT_MS
    for (;;) {
      if (await this.getDigest(digest)) return
      if (Date.now() >= deadline) {
        this.config.logger.warn(`[VeranaIndexer] digest ${digest} was not indexed before the deadline`)
        return
      }
      await new Promise(resolve => setTimeout(resolve, CATCHUP_INTERVAL_MS))
    }
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
