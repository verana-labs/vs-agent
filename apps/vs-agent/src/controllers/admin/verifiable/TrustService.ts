import {
  DidRecord,
  JsonObject,
  JsonTransformer,
  utils,
  W3cCredential,
  W3cJsonLdVerifiableCredential,
} from '@credo-ts/core'
import { Logger, Inject, Injectable, HttpException, HttpStatus } from '@nestjs/common'
import {
  CredentialIssuanceRequest,
  CredentialIssuanceResponse,
  CredentialRevocationRequest,
  CredentialRevocationResponse,
} from '@verana-labs/vs-agent-model'
import {
  createCredential,
  createInvitation,
  createJsc,
  createVtc,
  findMetadataEntry,
  getEcsSchemas,
  getVerificationMethodId,
  removeTrustCredential,
  signerW3c,
  validateSchema,
  VsAgent,
} from '@verana-labs/vs-agent-sdk'

import { AGENT_INVITATION_BASE_URL } from '../../../config'
import { UrlShorteningService } from '../../../services'
import { VsAgentService } from '../../../services/VsAgentService'
import { CredentialTypesService } from '../credentials'

@Injectable()
export class TrustService {
  private readonly logger = new Logger(TrustService.name)
  private ecsSchemas

  constructor(
    @Inject(VsAgentService) private readonly agentService: VsAgentService,
    @Inject(UrlShorteningService) private readonly urlShortenerService: UrlShorteningService,
    @Inject(CredentialTypesService) private readonly credentialTypesService: CredentialTypesService,
    @Inject('PUBLIC_API_BASE_URL') private readonly publicApiBaseUrl: string,
  ) {
    this.ecsSchemas = getEcsSchemas(publicApiBaseUrl)
  }

  private async getTrustCredential(key: '_vt/vtc' | '_vt/jsc', schemaId?: string) {
    try {
      const { didRecord } = await this.getDidRecord()
      const metadata = findMetadataEntry(didRecord, key, schemaId)
      if (!metadata) {
        throw new HttpException('Schema not found', HttpStatus.NOT_FOUND)
      }
      return metadata.data
    } catch (error) {
      this.handleError(error, 'Failed to load schema')
    }
  }

  public async getVerifiableTrustCredential(schemaId?: string, page = 1, limit = 10) {
    return await this.getTrustCredentialPaginated('_vt/vtc', schemaId, page, limit)
  }

  public async getJsonSchemaCredential(schemaId?: string, page = 1, limit = 10) {
    return await this.getTrustCredentialPaginated('_vt/jsc', schemaId, page, limit)
  }

  private async getTrustCredentialPaginated(
    key: '_vt/vtc' | '_vt/jsc',
    schemaId?: string,
    page = 1,
    limit = 10,
  ) {
    const allMetadata = await this.getTrustCredential(key, schemaId)
    if (schemaId) return allMetadata
    if (!allMetadata || Object.keys(allMetadata).length === 0) {
      throw new HttpException('Trust registry not found', HttpStatus.NOT_FOUND)
    }

    const items = Object.entries(allMetadata).map(([schemaId, entry]) => ({
      schemaId,
      ...(entry as Record<string, any>),
    }))
    return this.paginate(items, page, limit)
  }

  private paginate<T>(items: T[], page = 1, limit = 10) {
    const totalItems = items.length
    const totalPages = Math.ceil(totalItems / limit)
    const start = (page - 1) * limit
    const end = start + limit

    return {
      meta: {
        page,
        limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      data: items.slice(start, end),
    }
  }

  private async removeCredentialByType(schemaId: string, key: '_vt/vtc' | '_vt/jsc') {
    try {
      const { agent } = await this.getDidRecord()
      await removeTrustCredential(agent, this.publicApiBaseUrl, schemaId, key)

      this.logger.log(`Metadata ${schemaId} successfully removed`)
      return { success: true, message: `Metadata ${schemaId} removed` }
    } catch (error) {
      this.handleError(error, 'Failed to remove schema data')
    }
  }

  public async removeVerifiableTrustCredential(schemaId: string) {
    return await this.removeCredentialByType(schemaId, '_vt/vtc')
  }

  public async removeJsonSchemaCredential(schemaId: string) {
    return await this.removeCredentialByType(schemaId, '_vt/jsc')
  }

  public async createVtc(id: string, credential: W3cJsonLdVerifiableCredential) {
    try {
      const { agent } = await this.getDidRecord()
      const verifiablePresentation = await createVtc(agent, this.publicApiBaseUrl, id, credential)
      this.logger.log(`Metadata for "schemas-${id}-c-vp.json" updated successfully.`)
      return verifiablePresentation
    } catch (error) {
      this.handleError(error, 'Error create credential')
    }
  }

  public async createJsc(id: string, jsonSchemaRef: string) {
    try {
      const { agent } = await this.getDidRecord()
      return await createJsc(agent, this.publicApiBaseUrl, this.ecsSchemas, {
        schemaBaseId: id,
        jsonSchemaRef,
      })
    } catch (error) {
      this.handleError(error, 'Failed to create schema')
    }
  }

  private async issueW3cJsonLd(
    agent: VsAgent,
    didRecord: DidRecord,
    did: string,
    jsonSchemaCredentialId: string,
    claims: JsonObject,
  ) {
    const unsignedCredential = createCredential({
      id: `${did}#${utils.uuid()}`,
      type: ['VerifiableCredential', 'VerifiableTrustCredential'],
      issuer: agent.did,
      credentialSubject: {
        id: did,
        claims,
      },
    })
    unsignedCredential.credentialSchema = {
      id: jsonSchemaCredentialId,
      type: 'JsonSchemaCredential',
    }
    const verificationMethodId = getVerificationMethodId(agent.config.logger, didRecord)
    const credential = await signerW3c(
      agent,
      JsonTransformer.fromJSON(unsignedCredential, W3cCredential),
      verificationMethodId,
    )
    return credential.jsonCredential
  }

  public async issueCredential({
    format,
    jsonSchemaCredentialId,
    claims,
    did,
  }: CredentialIssuanceRequest): Promise<CredentialIssuanceResponse> {
    try {
      // Check schema for credential
      const { agent, didRecord } = await this.getDidRecord()

      const { parsedSchema, attrNames } =
        await this.credentialTypesService.parseJsonSchemaCredential(jsonSchemaCredentialId)
      if (attrNames.length === 0) {
        throw new HttpException(
          `No properties found in credentialSubject of schema from ${jsonSchemaCredentialId}`,
          HttpStatus.BAD_REQUEST,
        )
      }
      validateSchema(parsedSchema, claims)

      switch (format) {
        case 'jsonld':
          if (!did)
            throw new HttpException('did must be present for JSON-LD credentials', HttpStatus.BAD_REQUEST)
          const credential = await this.issueW3cJsonLd(agent, didRecord, did, jsonSchemaCredentialId, claims)
          return { status: 200, didcommInvitationUrl: '', credential }
        case 'anoncreds':
          const { credentialDefinitionId } =
            await this.credentialTypesService.getOrRegisterAnonCredsCredentialDefinition({
              relatedJsonSchemaCredentialId: jsonSchemaCredentialId,
            })

          // TODO: if a DID is specified, we can directly start the exchange: if we are already connected, start the offer
          // and if not, do the DID Exchange and then the offer
          if (did) {
            throw new HttpException(
              'Specifying did not supported for AnonCreds credentials',
              HttpStatus.BAD_REQUEST,
            )
          }
          const providedAttributes = Object.entries(claims)
            .filter(([, v]) => v !== undefined && v !== null)
            .map(([name, value]) => ({ name, mimeType: 'text/plain', value: String(value) }))

          const attributes = this.credentialTypesService.buildAnonCredsAttributes(
            attrNames,
            providedAttributes,
          )

          const request = await agent.didcomm.credentials.createOffer({
            protocolVersion: 'v2',
            credentialFormats: {
              anoncreds: {
                attributes,
                credentialDefinitionId,
              },
            },
          })
          const { url: longUrl } = await createInvitation({
            agent,
            messages: [request.message],
            invitationBaseUrl: AGENT_INVITATION_BASE_URL,
          })

          const shortUrlId = await this.urlShortenerService.createShortUrl({
            longUrl,
            relatedFlowId: request.credentialExchangeRecord.id,
          })
          const didcommInvitationUrl = `${this.publicApiBaseUrl}/s?id=${shortUrlId}`
          return {
            status: 200,
            didcommInvitationUrl,
            jsonSchemaCredentialId,
          }
        default:
          throw new HttpException(`Invalid credential type: ${format}`, HttpStatus.BAD_REQUEST)
      }
    } catch (error) {
      this.handleError(error, 'Failed to issue credential')
    }
  }

  public async revokeCredential({
    format,
    anoncredsRevocationRegistryDefinitionId,
    anoncredsRevocationRegistryIndex,
  }: CredentialRevocationRequest): Promise<CredentialRevocationResponse> {
    try {
      const { agent } = await this.getDidRecord()

      switch (format) {
        case 'jsonld':
          throw new HttpException(
            'Revocation not currently supported for JSON-LD credentials',
            HttpStatus.BAD_REQUEST,
          )

        case 'anoncreds':
          if (!anoncredsRevocationRegistryDefinitionId || !anoncredsRevocationRegistryIndex) {
            throw new HttpException(
              'Revocation registry definition ID and index are required for AnonCreds. Make sure to specify a valid ' +
                'anoncredsRevocationRegistryDefinitionId and anoncredsRevocationRegistryIndex',
              HttpStatus.BAD_REQUEST,
            )
          }

          const uptStatusListResult = await agent.modules.anoncreds.updateRevocationStatusList({
            revocationStatusList: {
              revocationRegistryDefinitionId: anoncredsRevocationRegistryDefinitionId,
              revokedCredentialIndexes: [anoncredsRevocationRegistryIndex],
            },
            options: {},
          })
          if (!uptStatusListResult.revocationStatusListState.revocationStatusList) {
            throw new Error(`Failed to update revocation status list`)
          }
          return {
            status: 200,
          }
        default:
          throw new HttpException(`Invalid credential type: ${format}`, HttpStatus.BAD_REQUEST)
      }
    } catch (error) {
      this.handleError(error, 'Failed to issue credential')
    }
  }

  // Helpers
  private async getDidRecord() {
    const agent = await this.agentService.getAgent()
    const [didRecord] = await agent.dids.getCreatedDids({ did: agent.did })
    return { agent, didRecord }
  }

  private handleError(error: any, defaultMsg: string): never {
    const message = error?.message ?? String(error)
    this.logger.error(`Error: ${message}`)
    if (error instanceof HttpException) throw error
    throw new HttpException(message || defaultMsg, HttpStatus.INTERNAL_SERVER_ERROR)
  }
}
