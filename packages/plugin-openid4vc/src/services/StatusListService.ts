import type { OpenId4VcAgent, OpenId4VcPluginOptions } from '../types'
import type { SigningCertificateHandle } from './CertificateService'
import type { TokenStatusListApi, X509Certificate } from '@credo-ts/core'

import { inflateSync } from 'zlib'

import { Jwt, RecordDuplicateError, utils } from '@credo-ts/core'
import { Inject, Injectable } from '@nestjs/common'
import { AdminApiError, AdminApiErrorCode } from '@verana-labs/vs-agent-sdk'

import { statusListUri } from '../config'
import {
  OpenId4VcStatusListEntryRecord,
  OpenId4VcStatusListEntryRepository,
} from '../storage/StatusListEntryRecord'
import { OpenId4VcStatusListRecord, OpenId4VcStatusListRepository } from '../storage/StatusListRecord'
import { OPENID4VC_OPTIONS } from '../types'

import { x5cCertificateChain } from './CertificateService'

/** [VSA-ADM-OID-SL-CREATE] bounds of the `size` of a list. */
export const STATUS_LIST_SIZE_DEFAULT = 131_072
export const STATUS_LIST_SIZE_MIN = 1_024
export const STATUS_LIST_SIZE_MAX = 16_777_216

/**
 * [VSA-PUB-OID-1]: every token carries an `exp`. The agent re-signs a list before that moment, once
 * half of the lifetime has passed, on the next read of its public URL.
 */
export const STATUS_LIST_TOKEN_LIFETIME_SECONDS = 24 * 60 * 60

/**
 * The `ttl` of every token: the longest a verifier may cache it, per Token Status List. A revocation
 * reaches a verifier that caches within these minutes, instead of at the `exp` of its copy.
 */
export const STATUS_LIST_TOKEN_TTL_SECONDS = 5 * 60

const BITS_PER_STATUS = 1
const STATUS_INVALID = 1
const SIGNING_ALGORITHM = 'ES256'

const BAD_REQUEST = 400
const NOT_FOUND = 404
const CONFLICT = 409

/** What the status lists need from the issuer capability: its initialization and its certificate. */
export interface StatusListIssuer {
  ensureInitialized(): Promise<void>
  signingCertificate(): SigningCertificateHandle
}

export interface OpenId4VcStatusListSummary {
  id: string
  uri: string
  size: number
  createdAt: Date
  updatedAt: Date
}

export interface OpenId4VcStatusListCoordinates {
  statusListId: string
  statusListIndex: number
}

export interface OpenId4VcStatusListBinding extends OpenId4VcStatusListCoordinates {
  uri: string
}

export interface OpenId4VcRevocationResult extends OpenId4VcStatusListCoordinates {
  revokedAt: Date
}

type TokenValidity = { issuedAt: Date; expiresAt: Date }
type StoredToken = Pick<OpenId4VcStatusListRecord, 'token' | 'tokenIssuedAt' | 'tokenExpiresAt'>

/** Less than half of the lifetime of the token is left. */
export function statusListTokenNearsExpiry(list: StoredToken, now = new Date()): boolean {
  const issuedAt = new Date(list.tokenIssuedAt).getTime()
  const expiresAt = new Date(list.tokenExpiresAt).getTime()
  return now.getTime() >= issuedAt + (expiresAt - issuedAt) / 2
}

/**
 * The `x5c` of the token is no longer the chain of the issuer capability: a verifier accepts a list
 * only from the signer of the credential ([VSA-VTI-FLOW-VERIFY-OID] step 6).
 */
export function statusListTokenChainDiffers(token: string, chain: string[]): boolean {
  const x5c = Jwt.fromSerializedJwt(token).header.x5c ?? []
  return x5c.length !== chain.length || x5c.some((certificate, index) => certificate !== chain[index])
}

/**
 * The indexes whose status is not VALID in a Status List Token. The token is what the agent
 * published, so a token that replaces it starts from these, not from the bindings: a revocation
 * that reached the token but not its binding is never lost.
 */
export function statusListTokenRevokedIndexes(token: string): number[] {
  const statusList = Jwt.fromSerializedJwt(token).payload.additionalClaims.status_list as
    | { bits?: number; lst?: string }
    | undefined
  if (typeof statusList?.lst !== 'string') throw new Error('the Status List Token carries no status_list.lst')
  const bits = statusList.bits ?? 1
  const perByte = 8 / bits
  const mask = (1 << bits) - 1
  const bytes = inflateSync(Buffer.from(statusList.lst, 'base64url'))
  const revoked: number[] = []
  for (let index = 0; index < bytes.length * perByte; index++) {
    const status = (bytes[Math.floor(index / perByte)] >> ((index % perByte) * bits)) & mask
    if (status !== 0) revoked.push(index)
  }
  return revoked
}

/**
 * The Token Status Lists of the issuer capability, [VSA-ADM-OID-SL], the binding of their indexes
 * to credentials, [VSA-ADM-OID-CE-OFFER], and their revocation, [VSA-ADM-OID-CR-REVOKE]. Credo
 * builds and signs every token; this service keeps the lists and the bindings in the agent storage
 * and serves the token of [VSA-PUB-OID-1].
 */
@Injectable()
export class StatusListService {
  private issuer?: StatusListIssuer
  // Every write to a list, to its token or to one of its bindings runs alone on that list.
  private readonly queues = new Map<string, Promise<unknown>>()

  public constructor(
    @Inject('VSAGENT') private readonly agent: OpenId4VcAgent,
    @Inject(OPENID4VC_OPTIONS) private readonly options: OpenId4VcPluginOptions,
  ) {}

  /** The issuer service binds itself here, so the lists sign with its certificate once it is loaded. */
  public attachIssuer(issuer: StatusListIssuer): void {
    this.issuer = issuer
  }

  public statusListUri(statusListId: string): string {
    return statusListUri(this.options.publicApiBaseUrl, statusListId)
  }

  /** [VSA-ADM-OID-SL-CREATE] */
  public async createStatusList({
    size = STATUS_LIST_SIZE_DEFAULT,
  }: {
    size?: number
  } = {}): Promise<OpenId4VcStatusListSummary> {
    if (!Number.isInteger(size) || size < STATUS_LIST_SIZE_MIN || size > STATUS_LIST_SIZE_MAX) {
      throw new AdminApiError(
        AdminApiErrorCode.InvalidInput,
        BAD_REQUEST,
        `size must be an integer between ${STATUS_LIST_SIZE_MIN} and ${STATUS_LIST_SIZE_MAX}`,
      )
    }
    await this.ensureIssuer()

    const id = utils.uuid()
    const token = await this.signFreshToken(id, size, [])
    const list = new OpenId4VcStatusListRecord({ id, size, ...token })
    await this.listRepository().save(this.agent.context, list)
    return summarize(list, this.statusListUri(list.id))
  }

  /** [VSA-ADM-OID-SL-LIST] */
  public async listStatusLists(): Promise<OpenId4VcStatusListSummary[]> {
    const lists = await this.listRepository().getAll(this.agent.context)
    return lists.map(list => summarize(list, this.statusListUri(list.id)))
  }

  /** [VSA-ADM-OID-SL-DELETE] */
  public async deleteStatusList(statusListId: string): Promise<void> {
    await this.serialized(statusListId, async () => {
      const list = await this.getList(statusListId)
      const entries = await this.entriesOf(statusListId)
      const now = new Date()
      const live = entries.filter(entry => entry.isLive(now))
      if (live.length > 0) {
        throw new AdminApiError(
          AdminApiErrorCode.InvalidState,
          CONFLICT,
          `status list "${statusListId}" still has ${live.length} index(es) bound to a credential that is not revoked and not expired`,
        )
      }
      for (const entry of entries) await this.entryRepository().delete(this.agent.context, entry)
      await this.listRepository().delete(this.agent.context, list)
    })
  }

  /**
   * [VSA-ADM-OID-CE-OFFER]: binds an index before the offer exists, so two offers can never share
   * it. The caller completes the binding with the session, or releases it when the offer fails.
   */
  public async bindIndex(coordinates: OpenId4VcStatusListCoordinates): Promise<OpenId4VcStatusListBinding> {
    const { statusListId, statusListIndex } = coordinates
    return this.serialized(statusListId, async () => {
      const list = await this.getList(statusListId)
      assertIndexInRange(statusListIndex, list)
      const entry = new OpenId4VcStatusListEntryRecord({ statusListId, statusListIndex })
      try {
        await this.entryRepository().save(this.agent.context, entry)
      } catch (error) {
        if (error instanceof RecordDuplicateError) {
          throw new AdminApiError(
            AdminApiErrorCode.InvalidState,
            CONFLICT,
            `an earlier offer already bound index ${statusListIndex} on status list "${statusListId}"`,
          )
        }
        throw error
      }
      return { statusListId, statusListIndex, uri: this.statusListUri(statusListId) }
    })
  }

  public async completeBinding(
    coordinates: OpenId4VcStatusListCoordinates,
    session: { issuanceSessionId: string; expiresAt?: Date },
  ): Promise<void> {
    await this.updateEntry(coordinates, entry => {
      entry.issuanceSessionId = session.issuanceSessionId
      if (session.expiresAt) entry.expiresAt = session.expiresAt.toISOString()
    })
  }

  public async releaseIndex(coordinates: OpenId4VcStatusListCoordinates): Promise<void> {
    await this.serialized(coordinates.statusListId, async () => {
      const entry = await this.findEntry(coordinates)
      if (entry) await this.entryRepository().delete(this.agent.context, entry)
    })
  }

  /** The credential is about to be issued with this `exp`: the binding keeps the index until then. */
  public async recordIssuance(coordinates: OpenId4VcStatusListCoordinates, expiresAt: Date): Promise<void> {
    await this.updateEntry(coordinates, entry => {
      entry.expiresAt = expiresAt.toISOString()
    })
  }

  /** [VSA-ADM-OID-CR-REVOKE] */
  public async revokeCredential(
    coordinates: OpenId4VcStatusListCoordinates,
  ): Promise<OpenId4VcRevocationResult> {
    const { statusListId, statusListIndex } = coordinates
    await this.ensureIssuer()
    return this.serialized(statusListId, async () => {
      const list = await this.getList(statusListId)
      assertIndexInRange(statusListIndex, list)
      const entry = await this.findEntry(coordinates)
      if (!entry) {
        throw new AdminApiError(
          AdminApiErrorCode.InvalidState,
          CONFLICT,
          `no offer bound index ${statusListIndex} on status list "${statusListId}"`,
        )
      }
      // A second call changes nothing, and answers the revocation it already published.
      if (entry.revokedAt) return { statusListId, statusListIndex, revokedAt: new Date(entry.revokedAt) }

      const published = await this.publish(list, [statusListIndex])
      entry.revokedAt = published.tokenIssuedAt
      await this.entryRepository().update(this.agent.context, entry)
      return { statusListId, statusListIndex, revokedAt: new Date(published.tokenIssuedAt) }
    })
  }

  /**
   * [VSA-PUB-OID-1]: the token to serve for a list, or undefined for an unknown id. The agent
   * re-signs the token first when it nears its `exp` or when the signing certificate changed.
   */
  public async getStatusListToken(statusListId: string): Promise<string | undefined> {
    const known = await this.listRepository().findById(this.agent.context, statusListId)
    if (!known) return undefined
    await this.ensureIssuer()
    return this.serialized(statusListId, async () => {
      const list = await this.listRepository().findById(this.agent.context, statusListId)
      if (!list) return undefined
      const stale =
        statusListTokenNearsExpiry(list) || statusListTokenChainDiffers(list.token, this.encodedChain())
      if (!stale) return list.token
      const refreshed = await this.publish(list)
      return refreshed.token
    })
  }

  // Signs a token that carries every revocation of the list, and stores it. Credo keeps the header
  // of the previous token when it updates one, so a chain change re-creates the token instead, from
  // the statuses of the token it replaces.
  private async publish(
    list: OpenId4VcStatusListRecord,
    newlyRevoked: number[] = [],
  ): Promise<OpenId4VcStatusListRecord> {
    const token = statusListTokenChainDiffers(list.token, this.encodedChain())
      ? await this.signFreshToken(list.id, list.size, [
          ...statusListTokenRevokedIndexes(list.token),
          ...newlyRevoked,
        ])
      : await this.signUpdatedToken(list.token, newlyRevoked, this.validity())
    list.token = token.token
    list.tokenIssuedAt = token.tokenIssuedAt
    list.tokenExpiresAt = token.tokenExpiresAt
    await this.listRepository().update(this.agent.context, list)
    return list
  }

  private async signFreshToken(
    statusListId: string,
    size: number,
    revokedIndexes: number[],
  ): Promise<StoredToken> {
    const validity = this.validity()
    const created = await this.tokenStatusListApi().createTokenStatusList<'jwt'>({
      format: 'jwt',
      statusList: { statusListLength: size, bitsPerStatus: BITS_PER_STATUS },
      statusListUri: this.statusListUri(statusListId),
      signer: this.signer(),
      alg: SIGNING_ALGORITHM,
      timeToLive: STATUS_LIST_TOKEN_TTL_SECONDS,
      ...validity,
    })
    if (revokedIndexes.length === 0) return storedToken(created.statusList, validity)
    return this.signUpdatedToken(created.statusList, revokedIndexes, validity)
  }

  private async signUpdatedToken(
    token: string,
    revokedIndexes: number[],
    validity: TokenValidity,
  ): Promise<StoredToken> {
    const updated = await this.tokenStatusListApi().updateTokenStatusList<'jwt'>({
      format: 'jwt',
      token,
      status: revokedIndexes.map(index => ({ index, status: STATUS_INVALID })),
      signer: this.signer(),
      alg: SIGNING_ALGORITHM,
      timeToLive: STATUS_LIST_TOKEN_TTL_SECONDS,
      ...validity,
    })
    return storedToken(updated.statusList, validity)
  }

  private validity(): TokenValidity {
    const issuedAt = new Date()
    issuedAt.setMilliseconds(0)
    return { issuedAt, expiresAt: new Date(issuedAt.getTime() + STATUS_LIST_TOKEN_LIFETIME_SECONDS * 1_000) }
  }

  private signer(): { method: 'x5c'; x5c: X509Certificate[] } {
    return { method: 'x5c', x5c: x5cCertificateChain(this.requireIssuer().signingCertificate()) }
  }

  private encodedChain(): string[] {
    return this.signer().x5c.map(certificate => certificate.toString('base64'))
  }

  private async updateEntry(
    coordinates: OpenId4VcStatusListCoordinates,
    change: (entry: OpenId4VcStatusListEntryRecord) => void,
  ): Promise<void> {
    await this.serialized(coordinates.statusListId, async () => {
      const entry = await this.findEntry(coordinates)
      if (!entry) return
      change(entry)
      await this.entryRepository().update(this.agent.context, entry)
    })
  }

  private async getList(statusListId: string): Promise<OpenId4VcStatusListRecord> {
    const list = await this.listRepository().findById(this.agent.context, statusListId)
    if (!list) {
      throw new AdminApiError(
        AdminApiErrorCode.UnknownId,
        NOT_FOUND,
        `no status list with id "${statusListId}"`,
      )
    }
    return list
  }

  private findEntry(
    coordinates: OpenId4VcStatusListCoordinates,
  ): Promise<OpenId4VcStatusListEntryRecord | null> {
    return this.entryRepository().findById(
      this.agent.context,
      OpenId4VcStatusListEntryRecord.idFor(coordinates.statusListId, coordinates.statusListIndex),
    )
  }

  private entriesOf(statusListId: string): Promise<OpenId4VcStatusListEntryRecord[]> {
    return this.entryRepository().findByQuery(this.agent.context, { statusListId })
  }

  private serialized<T>(statusListId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(statusListId) ?? Promise.resolve()
    const next = previous.then(task, task)
    const settled = next.then(
      () => undefined,
      () => undefined,
    )
    this.queues.set(statusListId, settled)
    settled.then(() => {
      if (this.queues.get(statusListId) === settled) this.queues.delete(statusListId)
    })
    return next
  }

  private async ensureIssuer(): Promise<void> {
    await this.requireIssuer().ensureInitialized()
  }

  private requireIssuer(): StatusListIssuer {
    if (!this.issuer) throw new Error('OpenID4VC status lists have no issuer capability to sign with')
    return this.issuer
  }

  private tokenStatusListApi(): TokenStatusListApi {
    return this.agent.tokenStatusList
  }

  private listRepository(): OpenId4VcStatusListRepository {
    return this.agent.context.dependencyManager.resolve(OpenId4VcStatusListRepository)
  }

  private entryRepository(): OpenId4VcStatusListEntryRepository {
    return this.agent.context.dependencyManager.resolve(OpenId4VcStatusListEntryRepository)
  }
}

function assertIndexInRange(statusListIndex: number, list: OpenId4VcStatusListRecord): void {
  if (!Number.isInteger(statusListIndex) || statusListIndex < 0 || statusListIndex >= list.size) {
    throw new AdminApiError(
      AdminApiErrorCode.InvalidInput,
      BAD_REQUEST,
      `statusListIndex must be an integer between 0 and ${list.size - 1} on status list "${list.id}"`,
    )
  }
}

function storedToken(token: string, { issuedAt, expiresAt }: TokenValidity): StoredToken {
  return { token, tokenIssuedAt: issuedAt.toISOString(), tokenExpiresAt: expiresAt.toISOString() }
}

function summarize(list: OpenId4VcStatusListRecord, uri: string): OpenId4VcStatusListSummary {
  return {
    id: list.id,
    uri,
    size: list.size,
    createdAt: list.createdAt,
    updatedAt: new Date(list.tokenIssuedAt),
  }
}
