import type { BaseAgentModules, VsAgent } from '../agent/VsAgent'

import {
  JsonTransformer,
  W3cJsonLdVerifiableCredential,
  type W3cV2DataIntegritySecuredCredential,
  W3cV2DataIntegrityVerifiableCredential,
} from '@credo-ts/core'

import { fetchJson } from '../utils/util'
import { isVcdm2Credential } from '../utils/vcdm2'

import { ParticipantDto, ParticipantRole, ParticipantState } from './types'

const VTJSC_FETCH_TIMEOUT_MS = 30_000

const CREDENTIAL_SCHEMA_REFERENCE = /^vpr:verana:([^:/]+):cs:(\d+)$/

const RELATED_JSON_SCHEMA_CREDENTIAL_ID_TAG = 'relatedJsonSchemaCredentialId'

export const REQUESTED_CREDENTIAL_SCHEMAS_METADATA = '_2060/requestedCredentialSchemas'

export enum AnonCredsTrustProblemCode {
  IssuerNotAuthorized = 'e.p.issuer-not-authorized',
  TrustResolutionUnavailable = 'e.p.trust-resolution-unavailable',
}

export enum AnonCredsTrustErrorReason {
  NotDerivable = 'not-derivable',
  NotAuthorized = 'not-authorized',
  Unavailable = 'unavailable',
}

export class AnonCredsTrustError extends Error {
  public constructor(
    public readonly reason: AnonCredsTrustErrorReason,
    message: string,
  ) {
    super(message)
    this.name = 'AnonCredsTrustError'
  }
}

export type AnonCredsObjectReference = { credentialDefinitionId: string } | { schemaId: string }

export interface DerivedCredentialSchema {
  credentialSchemaId: number
  ecosystemDid: string
  jsonSchemaCredentialId: string
  anonCredsSchemaId: string
  issuerId?: string
}

export type RequestedCredentialSchema = Pick<
  DerivedCredentialSchema,
  'credentialSchemaId' | 'ecosystemDid' | 'jsonSchemaCredentialId'
>

export type RequestedCredentialSchemas = Record<string, RequestedCredentialSchema>

export function toRequestedCredentialSchema({
  credentialSchemaId,
  ecosystemDid,
  jsonSchemaCredentialId,
}: DerivedCredentialSchema): RequestedCredentialSchema {
  return { credentialSchemaId, ecosystemDid, jsonSchemaCredentialId }
}

export interface UnaccreditedDidsResult {
  unaccredited: string[]
  unchecked: string[]
}

interface CredentialSchemaLink {
  credentialSchemaId: number
  ecosystemDid: string
}

interface ResolvedAnonCredsObject {
  jsonSchemaCredentialId: string
  anonCredsSchemaId: string
  issuerId?: string
}

interface VtjscDocument {
  '@context'?: unknown
  issuer?: string | { id?: string }
  credentialSubject?: VtjscSubject | VtjscSubject[]
}

interface VtjscSubject {
  jsonSchema?: { $ref?: string }
}

function notDerivable(message: string): AnonCredsTrustError {
  return new AnonCredsTrustError(AnonCredsTrustErrorReason.NotDerivable, message)
}

function notAuthorized(message: string): AnonCredsTrustError {
  return new AnonCredsTrustError(AnonCredsTrustErrorReason.NotAuthorized, message)
}

function unavailable(message: string): AnonCredsTrustError {
  return new AnonCredsTrustError(AnonCredsTrustErrorReason.Unavailable, message)
}

function relatedJsonSchemaCredentialIdOf(metadata: Record<string, unknown>): string | undefined {
  const value = metadata[RELATED_JSON_SCHEMA_CREDENTIAL_ID_TAG]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export class AnonCredsTrustService {
  private readonly derivations = new Map<string, DerivedCredentialSchema>()
  private readonly credentialSchemaLinks = new Map<string, CredentialSchemaLink>()

  public constructor(private readonly agent: VsAgent<BaseAgentModules>) {}

  public async deriveCredentialSchema(reference: AnonCredsObjectReference): Promise<DerivedCredentialSchema> {
    const key =
      'credentialDefinitionId' in reference
        ? `credentialDefinition:${reference.credentialDefinitionId}`
        : `schema:${reference.schemaId}`

    const cached = this.derivations.get(key)
    if (cached) return cached

    const object = await this.resolveAnonCredsObject(reference)
    const link = await this.resolveCredentialSchemaLink(object.jsonSchemaCredentialId)

    const derived: DerivedCredentialSchema = {
      credentialSchemaId: link.credentialSchemaId,
      ecosystemDid: link.ecosystemDid,
      jsonSchemaCredentialId: object.jsonSchemaCredentialId,
      anonCredsSchemaId: object.anonCredsSchemaId,
      issuerId: object.issuerId,
    }

    this.derivations.set(key, derived)
    return derived
  }

  public async assertAuthorized(options: {
    did: string
    role: ParticipantRole
    credentialSchemaId: number
  }): Promise<void> {
    const { did, role, credentialSchemaId } = options

    let participants: ParticipantDto[]
    try {
      participants = await this.agent.indexer.listParticipants({
        did,
        role,
        schemaId: credentialSchemaId,
        participantState: ParticipantState.Active,
      })
    } catch (error) {
      throw unavailable(
        `the agent cannot read the Participant entries of "${did}" for the CredentialSchema ${credentialSchemaId}: ${error}`,
      )
    }

    const authorized = (participants ?? []).some(
      participant =>
        participant.did === did &&
        participant.role === role &&
        Number(participant.schema_id) === credentialSchemaId &&
        participant.participant_state === ParticipantState.Active,
    )

    if (!authorized) {
      throw notAuthorized(
        `"${did}" holds no active ${role} Participant for the CredentialSchema ${credentialSchemaId}`,
      )
    }
  }

  public async assertOwnAuthorization(options: {
    role: ParticipantRole
    credentialSchemaId: number
  }): Promise<void> {
    if (!this.agent.did) {
      throw unavailable('the agent has no public DID, so it cannot check its own Participant entry')
    }

    await this.assertAuthorized({ did: this.agent.did, ...options })
  }

  public async findUnaccreditedDids(
    dids: string[],
    role: ParticipantRole,
    credentialSchemaId: number,
  ): Promise<UnaccreditedDidsResult> {
    const unaccredited: string[] = []
    const unchecked: string[] = []

    for (const did of new Set(dids)) {
      try {
        await this.assertAuthorized({ did, role, credentialSchemaId })
      } catch (error) {
        if (!(error instanceof AnonCredsTrustError)) throw error
        if (error.reason === AnonCredsTrustErrorReason.Unavailable) unchecked.push(did)
        else unaccredited.push(did)
      }
    }

    return { unaccredited, unchecked }
  }

  private async resolveAnonCredsObject(
    reference: AnonCredsObjectReference,
  ): Promise<ResolvedAnonCredsObject> {
    const anoncreds = this.agent.modules.anoncreds

    if ('credentialDefinitionId' in reference) {
      const { credentialDefinitionId } = reference

      const [record] = await anoncreds.getCreatedCredentialDefinitions({ credentialDefinitionId })
      const localId = record?.getTag(RELATED_JSON_SCHEMA_CREDENTIAL_ID_TAG)
      if (record && typeof localId === 'string' && localId.length > 0) {
        return {
          jsonSchemaCredentialId: localId,
          anonCredsSchemaId: record.credentialDefinition.schemaId,
          issuerId: record.credentialDefinition.issuerId,
        }
      }

      const result = await anoncreds.getCredentialDefinition(credentialDefinitionId, {
        useLocalRecord: false,
      })
      if (!result.credentialDefinition) {
        throw unavailable(
          `the agent cannot resolve the credential definition "${credentialDefinitionId}": ${result.resolutionMetadata.message ?? result.resolutionMetadata.error}`,
        )
      }

      const jsonSchemaCredentialId = relatedJsonSchemaCredentialIdOf(result.credentialDefinitionMetadata)
      if (!jsonSchemaCredentialId) {
        throw notDerivable(
          `the credential definition "${credentialDefinitionId}" carries no relatedJsonSchemaCredentialId, so it binds to no CredentialSchema`,
        )
      }

      return {
        jsonSchemaCredentialId,
        anonCredsSchemaId: result.credentialDefinition.schemaId,
        issuerId: result.credentialDefinition.issuerId,
      }
    }

    const { schemaId } = reference

    const [record] = await anoncreds.getCreatedSchemas({ schemaId })
    const localId = record?.getTag(RELATED_JSON_SCHEMA_CREDENTIAL_ID_TAG)
    if (record && typeof localId === 'string' && localId.length > 0) {
      return { jsonSchemaCredentialId: localId, anonCredsSchemaId: schemaId }
    }

    const result = await anoncreds.getSchema(schemaId, { useLocalRecord: false })
    if (!result.schema) {
      throw unavailable(
        `the agent cannot resolve the AnonCreds schema "${schemaId}": ${result.resolutionMetadata.message ?? result.resolutionMetadata.error}`,
      )
    }

    const jsonSchemaCredentialId = relatedJsonSchemaCredentialIdOf(result.schemaMetadata)
    if (!jsonSchemaCredentialId) {
      throw notDerivable(
        `the AnonCreds schema "${schemaId}" carries no relatedJsonSchemaCredentialId, so it binds to no CredentialSchema`,
      )
    }

    return { jsonSchemaCredentialId, anonCredsSchemaId: schemaId }
  }

  private async resolveCredentialSchemaLink(jsonSchemaCredentialId: string): Promise<CredentialSchemaLink> {
    const cached = this.credentialSchemaLinks.get(jsonSchemaCredentialId)
    if (cached) return cached

    let document: VtjscDocument
    try {
      document = await fetchJson<VtjscDocument>(jsonSchemaCredentialId, VTJSC_FETCH_TIMEOUT_MS)
    } catch (error) {
      throw unavailable(`the agent cannot read the VTJSC "${jsonSchemaCredentialId}": ${error}`)
    }

    await this.verifyVtjscProof(jsonSchemaCredentialId, document)

    const subject = Array.isArray(document.credentialSubject)
      ? document.credentialSubject[0]
      : document.credentialSubject
    const schemaReference = subject?.jsonSchema?.$ref
    const parsed = schemaReference?.match(CREDENTIAL_SCHEMA_REFERENCE)
    if (!parsed) {
      throw notDerivable(
        `the VTJSC "${jsonSchemaCredentialId}" names "${schemaReference ?? 'no'}" in credentialSubject.jsonSchema.$ref, which is no "vpr:verana:<chain>:cs:<id>" reference`,
      )
    }

    const chainId = this.agent.veranaChain?.getChainId
    if (!chainId) {
      throw unavailable(
        `the agent runs on no chain, so it cannot read the CredentialSchema of the VTJSC "${jsonSchemaCredentialId}"`,
      )
    }
    if (parsed[1] !== chainId) {
      throw notDerivable(
        `the VTJSC "${jsonSchemaCredentialId}" names the chain "${parsed[1]}", and the agent runs on "${chainId}"`,
      )
    }

    const credentialSchemaId = Number(parsed[2])

    const credentialSchema = await this.requireFromIndexer(
      () => this.agent.indexer.getCredentialSchema(credentialSchemaId, { allowNotFound: true }),
      `CredentialSchema ${credentialSchemaId}, which the VTJSC "${jsonSchemaCredentialId}" names`,
    )

    const ecosystem = await this.requireFromIndexer(
      () => this.agent.indexer.getEcosystem(credentialSchema.ecosystem_id, { allowNotFound: true }),
      `Ecosystem ${credentialSchema.ecosystem_id}, which the CredentialSchema ${credentialSchemaId} names`,
    )

    const ecosystemDid = ecosystem.did
    if (!ecosystemDid) {
      throw notDerivable(`the Ecosystem of the CredentialSchema ${credentialSchemaId} carries no DID`)
    }

    const issuer = typeof document.issuer === 'string' ? document.issuer : document.issuer?.id
    if (issuer !== ecosystemDid) {
      throw notDerivable(
        `the VTJSC "${jsonSchemaCredentialId}" carries the issuer "${issuer}", and the Ecosystem of the CredentialSchema ${credentialSchemaId} is "${ecosystemDid}"`,
      )
    }

    const link = { credentialSchemaId, ecosystemDid }
    this.credentialSchemaLinks.set(jsonSchemaCredentialId, link)
    return link
  }

  private async requireFromIndexer<T>(read: () => Promise<T | undefined>, describe: string): Promise<T> {
    let value: T | undefined
    try {
      value = await read()
    } catch (error) {
      throw unavailable(`the agent cannot read the ${describe}: ${error}`)
    }

    if (!value) throw notDerivable(`the VPR holds no ${describe}`)
    return value
  }

  /**
   * A VTJSC is a data model 2.0 credential secured with a DataIntegrityProof, as
   * [VT-JSON-SCHEMA-CRED-W3C] requires; one an ecosystem still publishes as data model 1.1 with a
   * linked data proof is verified through the 1.1 API, as verre accepts both.
   */
  private async verifyVtjscProof(jsonSchemaCredentialId: string, document: VtjscDocument): Promise<void> {
    let verify: () => Promise<{ isValid: boolean; error?: Error }>
    try {
      if (isVcdm2Credential(document)) {
        const credential = W3cV2DataIntegrityVerifiableCredential.fromObject(
          document as unknown as W3cV2DataIntegritySecuredCredential,
        )
        verify = () => this.agent.w3cV2Credentials.verifyCredential({ credential })
      } else {
        const credential = JsonTransformer.fromJSON(document, W3cJsonLdVerifiableCredential)
        verify = () => this.agent.w3cCredentials.verifyCredential({ credential })
      }
    } catch (error) {
      throw notDerivable(`the document at "${jsonSchemaCredentialId}" is no verifiable credential: ${error}`)
    }

    try {
      const result = await verify()
      if (result.isValid) return

      throw notDerivable(
        `the proof of the VTJSC "${jsonSchemaCredentialId}" is invalid: ${result.error ?? 'the verification failed'}`,
      )
    } catch (error) {
      if (error instanceof AnonCredsTrustError) throw error

      throw unavailable(
        `the agent cannot verify the proof of the VTJSC "${jsonSchemaCredentialId}": ${error}`,
      )
    }
  }
}
