import {
  AnonCredsCredentialDefinitionRepository,
  AnonCredsRevocationRegistryDefinitionRepository,
  AnonCredsSchemaRepository,
} from '@credo-ts/anoncreds'
import { Controller, Get, Param, Res, HttpStatus, HttpException, Inject, Query } from '@nestjs/common'
import { getLegacyDidDocument, getWebDid, VsAgent } from '@verana-labs/vs-agent-sdk'
import { DIDLog } from 'didwebvh-ts'
import { Response } from 'express'
import * as fs from 'fs'

import { baseFilePath, tailsIndex, VsAgentService } from '../../../services'

@Controller()
export class DidWebController {
  constructor(
    @Inject(VsAgentService) private readonly agentService: VsAgentService,
    @Inject('PUBLIC_API_BASE_URL') private readonly publicApiBaseUrl: string,
  ) {}

  @Get('/.well-known/did.json')
  async getDidDocument() {
    const agent = await this.agentService.getAgent()
    agent.config.logger.debug(`Public DID document requested`)
    const { didDocument } = await resolveDidDocumentData(agent)

    if (didDocument) return getLegacyDidDocument(didDocument, this.publicApiBaseUrl)

    // Neither did:web nor did:webvh
    throw new HttpException('DID Document not found', HttpStatus.NOT_FOUND)
  }

  @Get('/.well-known/did.jsonl')
  async getDidLog(@Res() res: Response) {
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
    agent.config.logger.debug(`Schema requested: ${schemaId}`)

    const issuerId = await getWebDid(agent)
    if (!issuerId) {
      throw new HttpException('Agent does not have any defined public DID', HttpStatus.NOT_FOUND)
    }

    const schemaRepository = agent.dependencyManager.resolve(AnonCredsSchemaRepository)
    const schemaRecord = await schemaRepository.findBySchemaId(
      agent.context,
      `${issuerId}?service=anoncreds&relativeRef=/schema/${schemaId}`,
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
    agent.config.logger.debug(`credential definition requested: ${credentialDefinitionId}`)

    const issuerId = await getWebDid(agent)
    if (!issuerId) {
      throw new HttpException('Agent does not have any defined public DID', HttpStatus.NOT_FOUND)
    }

    const credentialDefinitionRepository = agent.dependencyManager.resolve(
      AnonCredsCredentialDefinitionRepository,
    )

    const credentialDefinitionRecord = await credentialDefinitionRepository.findByCredentialDefinitionId(
      agent.context,
      `${issuerId}?service=anoncreds&relativeRef=/credDef/${credentialDefinitionId}`,
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
    agent.config.logger.debug(`revocate definition requested: ${revocationDefinitionId}`)
    const issuerId = await getWebDid(agent)
    if (!issuerId) {
      throw new HttpException('Agent does not have any defined public DID', HttpStatus.NOT_FOUND)
    }

    const revocationDefinitionRepository = agent.dependencyManager.resolve(
      AnonCredsRevocationRegistryDefinitionRepository,
    )

    const revocationDefinitionRecord =
      await revocationDefinitionRepository.findByRevocationRegistryDefinitionId(
        agent.context,
        `${issuerId}?service=anoncreds&relativeRef=/revRegDef/${revocationDefinitionId}`,
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
    agent.config.logger.debug(`revocate definition requested: ${revocationDefinitionId}`)

    const issuerId = await getWebDid(agent)
    if (!issuerId) {
      throw new HttpException('Agent does not have any defined public DID', HttpStatus.NOT_FOUND)
    }

    const revocationDefinitionRepository = agent.dependencyManager.resolve(
      AnonCredsRevocationRegistryDefinitionRepository,
    )

    const revocationDefinitionRecord =
      await revocationDefinitionRepository.findByRevocationRegistryDefinitionId(
        agent.context,
        `${issuerId}?service=anoncreds&relativeRef=/revRegDef/${revocationDefinitionId}`,
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
    agent.config.logger.debug(`requested file`)

    if (!tailsFileId) {
      throw new HttpException('tailsFileId not found', HttpStatus.CONFLICT)
    }

    const fileName = tailsIndex[tailsFileId]

    if (!fileName) {
      agent.config.logger.debug(`no entry found for tailsFileId: ${tailsFileId}`)
      throw new HttpException('tailsFileId not found', HttpStatus.NOT_FOUND)
    }

    const path = `${baseFilePath}/${fileName}`
    try {
      agent.config.logger.debug(`reading file: ${path}`)

      if (!fs.existsSync(path)) {
        agent.config.logger.debug(`file not found: ${path}`)
        throw new HttpException('tailsFileId not found', HttpStatus.NOT_FOUND)
      }

      const file = fs.createReadStream(path)
      res.setHeader('Content-Disposition', `attachment: filename="${fileName}"`)
      file.pipe(res)
    } catch (error) {
      agent.config.logger.debug(`error reading file: ${path}`)
      throw new HttpException('Internal Server Error', HttpStatus.INTERNAL_SERVER_ERROR)
    }
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
    const resourcePath = `${agent.did}/resources/${resourceId}`

    agent.config.logger.debug(`requested resource ${resourceId}`)

    if (!resourceId) {
      throw new HttpException('resourceId not found', HttpStatus.CONFLICT)
    }
    if (!agent.did) {
      throw new HttpException('Agent does not have any defined public DID', HttpStatus.NOT_FOUND)
    }

    const [record] = await agent.genericRecords.findAllByQuery({
      attestedResourceId: resourcePath,
      type: 'AttestedResource',
    })
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
