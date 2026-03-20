import {
  DidDocumentService,
  DidRecord,
  DidRepository,
  JsonObject,
  JsonTransformer,
  utils,
  W3cCredential,
  W3cJsonLdVerifiableCredential,
  W3cJsonLdVerifiablePresentation,
} from '@credo-ts/core'
import { Logger, Inject, Injectable, HttpException, HttpStatus } from '@nestjs/common'
import { CredentialIssuanceRequest, CredentialIssuanceResponse } from '@verana-labs/vs-agent-model'

import { UrlShorteningService } from '../../../services'
import { VsAgentService } from '../../../services/VsAgentService'
import {
  addDigestSRI,
  createCredential,
  createInvitation,
  createJsonSchema,
  createJsonSubjectRef,
  createPresentation,
  getEcsSchemas,
  getVerificationMethodId,
  mapToSelfTr,
  presentations,
  signerW3c,
  validateSchema,
  VsAgent,
} from '../../../utils'
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
      const metadata = this.findMetadataEntry(didRecord, key, schemaId)
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

  private async removeTrustCredential(schemaId: string, key: '_vt/vtc' | '_vt/jsc') {
    try {
      const { agent, didRecord } = await this.getDidRecord()
      const record = this.findMetadataEntry(didRecord, key, schemaId)
      // Currently, we only use one serviceEndpoint per ID.
      // In the future, if multiple serviceEndpoints exist for the same ID,
      // we should review the serviceEndpoint content and remove only the specific one.
      if (record?.didDocumentServiceId && didRecord.didDocument?.service) {
        didRecord.didDocument.service = didRecord.didDocument.service.filter(
          s => s.id !== record.didDocumentServiceId,
        )
      }
      await this.deleteMetadataEntry(agent, schemaId, didRecord, key)
      this.logger.log(`Metadata ${schemaId} successfully removed`)
      return { success: true, message: `Metadata ${schemaId} removed` }
    } catch (error) {
      this.handleError(error, 'Failed to remove schema data')
    }
  }

  public async removeVerifiableTrustCredential(schemaId: string) {
    return await this.removeTrustCredential(schemaId, '_vt/vtc')
  }

  public async removeJsonSchemaCredential(schemaId: string) {
    return await this.removeTrustCredential(schemaId, '_vt/jsc')
  }

  public async createVtc(id: string, credential: W3cJsonLdVerifiableCredential) {
    try {
      const { agent, didRecord } = await this.getDidRecord()
      const schemaId = `schemas-${id}-c-vp.json`
      const didDocumentServiceId = `${agent.did}#vpr-${schemaId.replace('.json', '')}`
      const serviceEndpoint = `${this.publicApiBaseUrl}/vt/${schemaId}`
      const record = this.findMetadataEntry(didRecord, '_vt/vtc', serviceEndpoint)
      const unsignedPresentation = createPresentation({
        id: serviceEndpoint,
        holder: agent.did,
        verifiableCredential: [credential],
      })

      if (!record) {
        didRecord.didDocument?.service?.push(
          new DidDocumentService({
            id: didDocumentServiceId,
            serviceEndpoint,
            type: 'LinkedVerifiablePresentation',
          }),
        )
      }
      const verifiablePresentation = await signerW3c(
        agent,
        unsignedPresentation,
        getVerificationMethodId(agent.config.logger, didRecord),
      )

      await this.saveMetadataEntry(
        agent,
        didRecord,
        credential,
        verifiablePresentation,
        didDocumentServiceId,
        '_vt/vtc',
      )
      this.logger.log(`Metadata for "${schemaId}" updated successfully.`)
      return verifiablePresentation
    } catch (error) {
      this.handleError(error, 'Error create credential')
    }
  }

  public async createJsc(id: string, jsonSchemaRef: string) {
    try {
      const { agent, didRecord } = await this.getDidRecord()
      const { id: subjectId, claims } = createJsonSubjectRef(jsonSchemaRef)
      const credentialSubject = {
        id: subjectId,
        claims: await addDigestSRI(subjectId, claims, this.ecsSchemas),
      }
      const schemaPresentation = `schemas-${id}-jsc-vp.json`
      const schemaCredential = `schemas-${id}-jsc.json`
      const serviceEndpoint = `${this.publicApiBaseUrl}/vt/${schemaPresentation}`
      const didDocumentServiceId = `${agent.did}#vpr-${schemaPresentation.replace('.json', '')}`
      const record = this.findMetadataEntry(didRecord, '_vt/jsc', serviceEndpoint)
      const unsignedCredential = createCredential({
        id: `${this.publicApiBaseUrl}/vt/${schemaCredential}`,
        type: ['VerifiableCredential', 'JsonSchemaCredential'],
        issuer: agent.did,
        credentialSubject,
      })
      unsignedCredential.credentialSchema = await addDigestSRI(
        createJsonSchema.id,
        createJsonSchema,
        this.ecsSchemas,
      )

      const verificationMethodId = getVerificationMethodId(agent.config.logger, didRecord)
      const credential = await signerW3c(
        agent,
        JsonTransformer.fromJSON(unsignedCredential, W3cCredential),
        verificationMethodId,
      )

      const unsignedPresentation = createPresentation({
        id: serviceEndpoint,
        holder: agent.did,
        verifiableCredential: [credential],
      })
      const verifiablePresentation = await signerW3c(
        agent,
        unsignedPresentation,
        getVerificationMethodId(agent.config.logger, didRecord),
      )

      if (!record) {
        didRecord.didDocument?.service?.push(
          new DidDocumentService({
            id: didDocumentServiceId,
            serviceEndpoint,
            type: 'LinkedVerifiablePresentation',
          }),
        )
      }
      await this.saveMetadataEntry(
        agent,
        didRecord,
        credential,
        verifiablePresentation,
        didDocumentServiceId,
        '_vt/jsc',
      )
      return credential.jsonCredential
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
          const request = await agent.didcomm.credentials.createOffer({
            protocolVersion: 'v2',
            credentialFormats: {
              anoncreds: {
                attributes: attrNames.map(name => {
                  return { name, mimeType: 'text/plain', value: String(claims[name]) }
                }),
                credentialDefinitionId,
              },
            },
          })
          const { url: longUrl } = await createInvitation({
            agent,
            messages: [request.message],
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

  // Helpers
  private async getDidRecord() {
    const agent = await this.agentService.getAgent()
    const [didRecord] = await agent.dids.getCreatedDids({ did: agent.did })
    return { agent, didRecord }
  }

  private async updateDidRecord(agent: VsAgent, didRecord: DidRecord) {
    const repo = agent.context.dependencyManager.resolve(DidRepository)
    await repo.update(agent.context, didRecord)
    await agent.dids.update({ did: didRecord.did, didDocument: didRecord.didDocument! })
  }

  private handleError(error: any, defaultMsg: string): never {
    const message = error?.message ?? String(error)
    this.logger.error(`Error: ${message}`)
    if (error instanceof HttpException) throw error
    throw new HttpException(message || defaultMsg, HttpStatus.INTERNAL_SERVER_ERROR)
  }

  private findMetadataEntry(
    didRecord: DidRecord,
    key: '_vt/vtc' | '_vt/jsc',
    id?: string,
    jsonSchemaRef?: string,
  ) {
    const metadata = didRecord.metadata.get(key)
    if (!metadata) return null
    if (!id) return { data: metadata }
    for (const [schemaId, entry] of Object.entries(metadata)) {
      if (schemaId === jsonSchemaRef) {
        return { schemaId, ...entry, data: entry.verifiablePresentation }
      }
      const credId = entry.credential?.id
      const presId = entry.verifiablePresentation?.id

      if (credId === id) {
        return { schemaId, ...entry, data: entry.credential }
      }

      if (presId === id) {
        return { schemaId, ...entry, data: entry.verifiablePresentation }
      }
    }
    return null
  }

  private async saveMetadataEntry(
    agent: VsAgent,
    didRecord: DidRecord,
    credential: W3cJsonLdVerifiableCredential,
    verifiablePresentation: W3cJsonLdVerifiablePresentation,
    didDocumentServiceId: string,
    key: '_vt/vtc' | '_vt/jsc',
  ) {
    const schema = key === '_vt/vtc' ? credential.credentialSchema : credential.credentialSubject
    const ref = Array.isArray(schema) ? schema[0]?.id : schema?.id

    if (!ref) {
      throw new HttpException('No ID was found in credentialSubject', HttpStatus.NOT_FOUND)
    }

    const record = didRecord.metadata.get(key) ?? {}
    // Remove previous entry for this credential ID (if exists)
    const found = this.findMetadataEntry(didRecord, key, credential.id, ref)
    if (found) {
      if (didRecord.didDocument?.service) {
        didRecord.didDocument.service = didRecord.didDocument.service.filter(
          s => s.id !== found.didDocumentServiceId,
        )
      }
      delete record[found.schemaId]
    }
    // Save new entry
    record[ref] = {
      credential: credential.jsonCredential,
      verifiablePresentation,
      didDocumentServiceId,
    }
    didRecord.metadata.set(key, record)

    // Update #whois with new endpoint
    const service = didRecord.didDocument?.service?.find(s => s.id === `${agent.did}#whois`)
    if (service && verifiablePresentation.id?.includes('service'))
      service.serviceEndpoint = verifiablePresentation.id!

    // When a new VTC has been added, remove the self VTCs
    this.updateVtcEntries(didRecord, false)
    await this.updateDidRecord(agent, didRecord)
  }

  private async deleteMetadataEntry(
    agent: VsAgent,
    id: string,
    didRecord: DidRecord,
    key: '_vt/vtc' | '_vt/jsc',
  ) {
    const found = this.findMetadataEntry(didRecord, key, id)
    if (!found) return null

    const metadata = didRecord.metadata.get(key)
    if (!metadata) return null

    delete metadata[found.schemaId]
    didRecord.metadata.set(key, metadata)

    // If the last entry is removed, restore defaults
    this.restoreDefaultVtcEntries(didRecord)
    await this.updateDidRecord(agent, didRecord)
    return {
      schemaId: found.schemaId,
    }
  }

  private restoreDefaultVtcEntries(didRecord: DidRecord) {
    const vtc = didRecord.metadata.get('_vt/vtc') ?? {}
    const jsc = didRecord.metadata.get('_vt/jsc') ?? {}
    // By default we have 2 Self-trusted VTCs
    if (Object.keys(vtc).length < 3 && Object.keys(jsc).length < 3) {
      this.updateVtcEntries(didRecord, true)
    }
  }

  private updateVtcEntries(didRecord: DidRecord, attach: boolean) {
    const record = didRecord.metadata.get('_vt/vtc') ?? {}

    presentations.forEach(p => {
      const schemaId = mapToSelfTr(p.schemaUrl, this.publicApiBaseUrl)
      const current = record[schemaId]
      if (current?.attached === attach) return
      record[schemaId] = {
        ...current,
        attached: attach,
      }

      const serviceId = current?.didDocumentServiceId
      const serviceEndpoint = current?.verifiablePresentation?.id
      if (!didRecord.didDocument?.service) return
      if (attach) {
        const alreadyExists = didRecord.didDocument.service.some(s => s.id === serviceId)
        if (!alreadyExists && serviceId && serviceEndpoint) {
          didRecord.didDocument.service.push(
            new DidDocumentService({
              id: serviceId,
              serviceEndpoint,
              type: 'LinkedVerifiablePresentation',
            }),
          )
        }

        // Return to self-trusted VTC in #whois endpoint
        const service = didRecord.didDocument?.service?.find(s => s.id === `${didRecord.did}#whois`)
        if (service && serviceEndpoint.includes('service')) service.serviceEndpoint = serviceEndpoint
      } else {
        didRecord.didDocument.service = didRecord.didDocument.service.filter(s => s.id !== serviceId)
      }
    })
    didRecord.metadata.set('_vt/vtc', record)
  }
}
