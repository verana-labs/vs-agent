import {
  AnonCredsCredentialDefinitionRepository,
  AnonCredsRevocationRegistryDefinitionRepository,
  AnonCredsSchemaRepository,
} from '@credo-ts/anoncreds'
import { parseDid } from '@credo-ts/core'
import { Controller, Get, Param, Res, HttpStatus, HttpException, Inject, NotFoundException, Query } from '@nestjs/common'
import {
  getLegacyDidDocument,
  getTailsDirectoryPath,
  isValidTailsFileName,
  VsAgent,
} from '@verana-labs/vs-agent-sdk'
import { DIDLog } from 'didwebvh-ts'
import { Response } from 'express'
import * as fs from 'fs'
import * as path from 'path'

import { VsAgentService } from '../../../services'
import { derivePublicDidLocation } from '../../../utils/didLocation'

type PublicDidAgent = VsAgent & { did: string }

@Controller()
export class DidWebController {
  constructor(
    @Inject(VsAgentService) private readonly agentService: VsAgentService,
    @Inject('PUBLIC_API_BASE_URL') private readonly publicApiBaseUrl: string,
  ) {}

  // .well-known only when the location carries no path, so a deployment answers on one shape.
  @Get('/.well-known/did.json')
  async getWellKnownDidDocument() {
    this.assertLocationShape(false)
    return this.serveDidDocument()
  }

  @Get('/did.json')
  async getDidDocument() {
    this.assertLocationShape(true)
    return this.serveDidDocument()
  }

  @Get('/.well-known/did.jsonl')
  async getWellKnownDidLog(@Res() res: Response) {
    this.assertLocationShape(false)
    return this.serveDidLog(res)
  }

  @Get('/did.jsonl')
  async getDidLog(@Res() res: Response) {
    this.assertLocationShape(true)
    return this.serveDidLog(res)
  }

  private assertLocationShape(expectsPath: boolean): void {
    if (derivePublicDidLocation(this.publicApiBaseUrl).hasPath !== expectsPath) {
      throw new NotFoundException()
    }
  }

  // Artifacts follow the method of the agent DID: the routes of the other method must not answer.
  private assertDidMethod(agent: VsAgent, method: 'web' | 'webvh'): asserts agent is PublicDidAgent {
    if (!agent.did || parseDid(agent.did).method !== method) throw new NotFoundException()
  }

  private async serveDidDocument() {
    const agent = await this.agentService.getAgent()
    agent.config.logger.debug(`Public DID document requested`)
    const { didDocument } = await resolveDidDocumentData(agent)

    if (didDocument) return getLegacyDidDocument(didDocument)

    // Neither did:web nor did:webvh
    throw new HttpException('DID Document not found', HttpStatus.NOT_FOUND)
  }

  private async serveDidLog(res: Response) {
    const agent = await this.agentService.getAgent()
    agent.config.logger.debug(`Public DID log requested`)
    const { didLog } = await resolveDidDocumentData(agent)

    if (didLog) {
      res.setHeader('Content-Type', 'text/jsonl; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache')
      res.send(didLog)
    } else {
      throw new HttpException('DID Log not found', HttpStatus.NOT_FOUND)
    }
  }

  // AnonCreds routes only make sense if we have a public DID (otherwise, we cannot be issuers)
  // Schemas
  @Get('/anoncreds/v1/schema/:schemaId')
  async getSchema(@Param('schemaId') schemaId: string, @Res() res: Response) {
    const agent = await this.agentService.getAgent()
    this.assertDidMethod(agent, 'web')
    agent.config.logger.debug(`Schema requested: ${schemaId}`)

    const schemaRepository = agent.dependencyManager.resolve(AnonCredsSchemaRepository)
    const schemaRecord = await schemaRepository.findBySchemaId(
      agent.context,
      `${agent.did}?service=anoncreds&relativeRef=/schema/${schemaId}`,
    )

    if (schemaRecord) {
      agent.config.logger.debug(`schema found: ${schemaId}`)
      res.send({ resource: schemaRecord.schema, resourceMetadata: {} })
    }

    agent.config.logger.debug(`schema not found: ${schemaId}`)
    throw new HttpException('', HttpStatus.NOT_FOUND)
  }

  // Credential Definitions
  @Get('/anoncreds/v1/credDef/:credentialDefinitionId')
  async getCredDef(@Param('credentialDefinitionId') credentialDefinitionId: string, @Res() res: Response) {
    const agent = await this.agentService.getAgent()
    this.assertDidMethod(agent, 'web')
    agent.config.logger.debug(`credential definition requested: ${credentialDefinitionId}`)

    const credentialDefinitionRepository = agent.dependencyManager.resolve(
      AnonCredsCredentialDefinitionRepository,
    )

    const credentialDefinitionRecord = await credentialDefinitionRepository.findByCredentialDefinitionId(
      agent.context,
      `${agent.did}?service=anoncreds&relativeRef=/credDef/${credentialDefinitionId}`,
    )

    if (credentialDefinitionRecord) {
      res.send({ resource: credentialDefinitionRecord.credentialDefinition, resourceMetadata: {} })
    }

    throw new HttpException('Credential Definition not found', HttpStatus.NOT_FOUND)
  }

  // Endpoint to retrieve a revocation registry definition by its ID
  @Get('/anoncreds/v1/revRegDef/:revocationDefinitionId')
  async getRevRegDef(@Param('revocationDefinitionId') revocationDefinitionId: string, @Res() res: Response) {
    const agent = await this.agentService.getAgent()
    this.assertDidMethod(agent, 'web')
    agent.config.logger.debug(`revocate definition requested: ${revocationDefinitionId}`)

    const revocationDefinitionRepository = agent.dependencyManager.resolve(
      AnonCredsRevocationRegistryDefinitionRepository,
    )

    const revocationDefinitionRecord =
      await revocationDefinitionRepository.findByRevocationRegistryDefinitionId(
        agent.context,
        `${agent.did}?service=anoncreds&relativeRef=/revRegDef/${revocationDefinitionId}`,
      )

    if (revocationDefinitionRecord) {
      res.send({
        resource: revocationDefinitionRecord.revocationRegistryDefinition,
        resourceMetadata: {
          statusListEndpoint: `${this.publicApiBaseUrl}/anoncreds/v1/revStatus/${revocationDefinitionId}`,
        },
      })
    }

    throw new HttpException('Revocation Definition not found', HttpStatus.NOT_FOUND)
  }

  // Endpoint to retrieve the revocation status list for a specific revocation definition ID
  // Optional: Accepts a timestamp parameter (not currently used in the logic)
  @Get('/anoncreds/v1/revStatus/:revocationDefinitionId/:timestamp?')
  async getRevStatus(@Param('revocationDefinitionId') revocationDefinitionId: string, @Res() res: Response) {
    const agent = await this.agentService.getAgent()
    this.assertDidMethod(agent, 'web')
    agent.config.logger.debug(`revocate definition requested: ${revocationDefinitionId}`)

    const revocationDefinitionRepository = agent.dependencyManager.resolve(
      AnonCredsRevocationRegistryDefinitionRepository,
    )

    const revocationDefinitionRecord =
      await revocationDefinitionRepository.findByRevocationRegistryDefinitionId(
        agent.context,
        `${agent.did}?service=anoncreds&relativeRef=/revRegDef/${revocationDefinitionId}`,
      )

    if (revocationDefinitionRecord) {
      const revStatusList = revocationDefinitionRecord.metadata.get('revStatusList')
      res.send({
        resource: revStatusList,
        resourceMetadata: {
          previousVersionId: '',
          nextVersionId: '',
        },
      })
    }

    throw new HttpException('Revocation Status not found', HttpStatus.NOT_FOUND)
  }

  @Get('/anoncreds/v1/tails/:tailsFileId')
  async getTailsFile(@Param('tailsFileId') tailsFileId: string, @Res() res: Response) {
    const agent = await this.agentService.getAgent()

    if (!tailsFileId || !isValidTailsFileName(tailsFileId)) {
      throw new HttpException('tailsFileId not found', HttpStatus.NOT_FOUND)
    }

    const filePath = path.join(getTailsDirectoryPath(agent.context), tailsFileId)
    if (!fs.existsSync(filePath)) {
      throw new HttpException('tailsFileId not found', HttpStatus.NOT_FOUND)
    }

    res.setHeader('Content-Disposition', `attachment; filename="${tailsFileId}"`)
    const stream = fs.createReadStream(filePath)
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  }

  @Get('/resources')
  async getWebVhResourcesByType(
    @Res() res: Response,
    @Query('resourceType') resourceType: string,
    @Query('relatedJsonSchemaCredentialId') relatedJsonSchemaCredentialId?: string,
  ) {
    if (!resourceType) {
      throw new HttpException('resourceType query param is required', HttpStatus.BAD_REQUEST)
    }
    const agent = await this.agentService.getAgent()
    this.assertDidMethod(agent, 'webvh')
    const records = await agent.genericRecords.findAllByQuery({
      type: 'AttestedResource',
      resourceType,
      relatedJsonSchemaCredentialId,
    })

    if (!records || records.length === 0) {
      throw new HttpException('No entries found for resourceType', HttpStatus.NOT_FOUND)
    }

    return res.send(records.map(r => r.content))
  }

  @Get('/resources/:resourceId')
  async getWebVhResources(@Param('resourceId') resourceId: string, @Res() res: Response) {
    const agent = await this.agentService.getAgent()
    this.assertDidMethod(agent, 'webvh')
    const resourcePath = `${agent.did}/resources/${resourceId}`

    agent.config.logger.debug(`requested resource ${resourceId}`)

    if (!resourceId) {
      throw new HttpException('resourceId not found', HttpStatus.CONFLICT)
    }

    const [record] = await agent.genericRecords.findAllByQuery({
      attestedResourceId: resourcePath,
      type: 'AttestedResource',
    })

    if (!record) {
      throw new HttpException('Resource not found', HttpStatus.NOT_FOUND)
    }

    res.send(record.content)
  }
}

async function resolveDidDocumentData(agent: VsAgent) {
  if (!agent.did) return {}

  const [didRecord] = await agent.dids.getCreatedDids({ did: agent.did })

  if (!didRecord) {
    throw new HttpException('DID Document not found', HttpStatus.NOT_FOUND)
  }

  const didDocument = didRecord.didDocument

  const didLog = didRecord.metadata.get('log') as DIDLog[] | null

  return { didDocument, didLog: didLog?.map(entry => JSON.stringify(entry)).join('\n') }
}
