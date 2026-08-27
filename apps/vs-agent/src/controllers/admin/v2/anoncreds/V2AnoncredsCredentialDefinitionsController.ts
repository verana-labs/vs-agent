import type { VsAgent } from '@verana-labs/vs-agent-sdk'

import {
  AnonCredsCredentialDefinition,
  AnonCredsCredentialDefinitionPrivateRecord,
  AnonCredsCredentialDefinitionPrivateRepository,
  AnonCredsCredentialDefinitionRecord,
  AnonCredsCredentialDefinitionRepository,
  AnonCredsKeyCorrectnessProofRecord,
  AnonCredsKeyCorrectnessProofRepository,
  AnonCredsRevocationRegistryDefinitionRepository,
  AnonCredsSchema,
  AnonCredsSchemaRecord,
  AnonCredsSchemaRepository,
} from '@credo-ts/anoncreds'
import { utils } from '@credo-ts/core'
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common'
import {
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger'

import { AdminApiError, AdminApiErrorCode, Page, PaginationQueryDto, paginate } from '../../../../common'
import { AccessMode } from '../../../../security'
import { VsAgentService } from '../../../../services/VsAgentService'
import { CredentialTypesService } from '../../credentials'

import {
  CreateCredentialDefinitionDto,
  CredentialDefinitionDto,
  CredentialDefinitionPackageDto,
  CredentialDefinitionPageDto,
  DeleteCredentialDefinitionQueryDto,
} from './dto'

/**
 * The AnonCreds credential definitions of this agent. Refer to [VSA-ADM-AC-CD].
 *
 * A Verifiable Trust JSON Schema Credential governs each credential definition.
 * `createCredentialDefinition` receives the URL of that credential. Then the agent reads the
 * AnonCreds schema from that credential. The caller does not send schema attributes, a name,
 * or a version.
 */
@ApiTags('v2/anoncreds')
@AccessMode('INTERNAL')
@Controller({ path: 'anoncreds/credential-definitions', version: '2' })
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class V2AnoncredsCredentialDefinitionsController {
  public constructor(
    @Inject(VsAgentService) private readonly agentService: VsAgentService,
    @Inject(CredentialTypesService) private readonly service: CredentialTypesService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List credential definitions',
    description: 'Returns the credential definitions that this agent knows.',
  })
  @ApiOkResponse({
    description: 'A page of credential definition records',
    type: CredentialDefinitionPageDto,
  })
  public async listCredentialDefinitions(
    @Query() query: PaginationQueryDto,
  ): Promise<Page<CredentialDefinitionDto>> {
    const agent = await this.agentService.getAgent()

    const records = await agent.modules.anoncreds.getCreatedCredentialDefinitions({})
    const items = await Promise.all(records.map(record => this.toRecordDto(agent, record)))

    return paginate(items, query, { method: 'listCredentialDefinitions' }, item => item.id)
  }

  @Post()
  @ApiOperation({
    summary: 'Create a credential definition',
    description:
      'Creates a new AnonCreds credential definition governed by a Verifiable Trust JSON Schema Credential.',
  })
  @ApiOkResponse({ description: 'The created credential definition record', type: CredentialDefinitionDto })
  @ApiNotFoundResponse({ description: 'The agent cannot resolve relatedJsonSchemaCredentialId' })
  @ApiConflictResponse({ description: 'A credential definition already governs that JSON Schema Credential' })
  public async createCredentialDefinition(
    @Body() dto: CreateCredentialDefinitionDto,
  ): Promise<CredentialDefinitionDto> {
    const { relatedJsonSchemaCredentialId } = dto
    const supportRevocation = dto.supportRevocation ?? false

    const existing = await this.service.findAnonCredsCredentialDefinition({ relatedJsonSchemaCredentialId })
    if (existing) {
      throw new AdminApiError(
        AdminApiErrorCode.InvalidState,
        HttpStatus.CONFLICT,
        `a credential definition governed by "${relatedJsonSchemaCredentialId}" already exists`,
      )
    }

    // The agent must resolve the VTJSC before it writes to the registry. If the agent cannot
    // read the VTJSC, it must answer UNKNOWN_ID. It must not answer an internal error.
    try {
      await this.service.parseJsonSchemaCredential(relatedJsonSchemaCredentialId)
    } catch {
      throw unresolvableJsonSchemaCredential(relatedJsonSchemaCredentialId)
    }

    const { schema, schemaId } = await this.service.getOrRegisterAnonCredsSchema({
      relatedJsonSchemaCredentialId,
    })
    if (!schema || !schemaId) {
      throw new AdminApiError(
        AdminApiErrorCode.Internal,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'the agent could not resolve an AnonCreds schema for the credential definition',
      )
    }

    const record = await this.service.registerAnonCredsCredentialDefinition({
      name: schema.name,
      version: schema.version,
      schemaId,
      supportRevocation,
      relatedJsonSchemaCredentialId,
    })

    return {
      id: record.credentialDefinitionId,
      name: schema.name,
      version: schema.version,
      attributes: schema.attrNames ?? [],
      supportRevocation,
      relatedJsonSchemaCredentialId,
    }
  }

  @Post('import')
  @ApiOperation({
    summary: 'Import a credential definition',
    description: 'Imports a credential definition package that exportCredentialDefinition produced.',
  })
  @ApiOkResponse({ description: 'The imported credential definition record', type: CredentialDefinitionDto })
  @ApiConflictResponse({ description: 'The credential definition already exists' })
  public async importCredentialDefinition(
    @Body() body: CredentialDefinitionPackageDto,
  ): Promise<CredentialDefinitionDto> {
    const agent = await this.agentService.getAgent()

    const data = body.data ?? {}
    const credentialDefinition = data.credentialDefinition as AnonCredsCredentialDefinition | undefined
    if (!credentialDefinition?.schemaId) {
      throw invalidPackage('the package carries no credentialDefinition with a schemaId')
    }
    if (!data.credentialDefinitionPrivate || !data.keyCorrectnessProof) {
      throw invalidPackage('the package carries no credentialDefinitionPrivate or keyCorrectnessProof')
    }

    const credentialDefinitionRepository = agent.dependencyManager.resolve(
      AnonCredsCredentialDefinitionRepository,
    )
    const credentialDefinitionPrivateRepository = agent.dependencyManager.resolve(
      AnonCredsCredentialDefinitionPrivateRepository,
    )
    const keyCorrectnessProofRepository = agent.dependencyManager.resolve(
      AnonCredsKeyCorrectnessProofRepository,
    )
    const schemaRepository = agent.dependencyManager.resolve(AnonCredsSchemaRepository)

    if (await credentialDefinitionRepository.findByCredentialDefinitionId(agent.context, body.id)) {
      throw new AdminApiError(
        AdminApiErrorCode.InvalidState,
        HttpStatus.CONFLICT,
        `a credential definition with id "${body.id}" already exists`,
      )
    }

    let schema = data.schema as AnonCredsSchema | undefined
    if (!schema) {
      // The package does not include a schema. The agent gets the schema from the registry.
      const schemaState = await agent.modules.anoncreds.getSchema(credentialDefinition.schemaId)
      schema = schemaState.schema
      if (!schema) {
        throw invalidPackage(`no schema is known for "${credentialDefinition.schemaId}"`)
      }
    }

    const existingSchemaRecord = await schemaRepository.findBySchemaId(
      agent.context,
      credentialDefinition.schemaId,
    )
    if (!existingSchemaRecord) {
      await schemaRepository.save(
        agent.context,
        new AnonCredsSchemaRecord({
          methodName: 'web',
          schema,
          schemaId: credentialDefinition.schemaId,
          id: utils.uuid(),
        }),
      )
    }

    const credentialDefinitionRecordId = utils.uuid()
    await credentialDefinitionRepository.save(
      agent.context,
      new AnonCredsCredentialDefinitionRecord({
        methodName: 'web',
        credentialDefinition,
        credentialDefinitionId: body.id,
        id: credentialDefinitionRecordId,
      }),
    )

    const credentialDefinitionRecord = await credentialDefinitionRepository.getById(
      agent.context,
      credentialDefinitionRecordId,
    )
    const name = data.name ?? schema.name
    const version = data.version ?? schema.version
    credentialDefinitionRecord.setTag('name', name)
    credentialDefinitionRecord.setTag('version', version)
    if (data.relatedJsonSchemaCredentialId) {
      credentialDefinitionRecord.setTag('relatedJsonSchemaCredentialId', data.relatedJsonSchemaCredentialId)
    }
    await credentialDefinitionRepository.update(agent.context, credentialDefinitionRecord)

    await credentialDefinitionPrivateRepository.save(
      agent.context,
      new AnonCredsCredentialDefinitionPrivateRecord({
        value: data.credentialDefinitionPrivate,
        credentialDefinitionId: body.id,
        id: credentialDefinitionRecordId,
      }),
    )

    await keyCorrectnessProofRepository.save(
      agent.context,
      new AnonCredsKeyCorrectnessProofRecord({
        value: data.keyCorrectnessProof,
        credentialDefinitionId: body.id,
        id: credentialDefinitionRecordId,
      }),
    )

    return {
      id: body.id,
      name,
      version,
      attributes: schema.attrNames ?? [],
      supportRevocation: credentialDefinition.value?.revocation !== undefined,
      relatedJsonSchemaCredentialId: data.relatedJsonSchemaCredentialId as string,
    }
  }

  @Get(':credentialDefinitionId/export')
  @ApiOperation({
    summary: 'Export a credential definition',
    description: 'Exports a credential definition as a portable package, for import on another agent.',
  })
  @ApiParam({
    name: 'credentialDefinitionId',
    description: 'Identifier of the credential definition to export',
    example: 'did:webvh:Qm...:issuer.example.com/resources/zQm...',
  })
  @ApiOkResponse({ description: 'The exported package', type: CredentialDefinitionPackageDto })
  @ApiNotFoundResponse({ description: 'No credential definition with the given id' })
  public async exportCredentialDefinition(
    @Param('credentialDefinitionId') credentialDefinitionId: string,
  ): Promise<CredentialDefinitionPackageDto> {
    const agent = await this.agentService.getAgent()

    const credentialDefinitionRepository = agent.dependencyManager.resolve(
      AnonCredsCredentialDefinitionRepository,
    )
    const credentialDefinitionPrivateRepository = agent.dependencyManager.resolve(
      AnonCredsCredentialDefinitionPrivateRepository,
    )
    const keyCorrectnessProofRepository = agent.dependencyManager.resolve(
      AnonCredsKeyCorrectnessProofRepository,
    )
    const schemaRepository = agent.dependencyManager.resolve(AnonCredsSchemaRepository)

    const record = await credentialDefinitionRepository.findByCredentialDefinitionId(
      agent.context,
      credentialDefinitionId,
    )
    if (!record) throw unknownCredentialDefinition(credentialDefinitionId)

    const credentialDefinitionPrivate =
      await credentialDefinitionPrivateRepository.findByCredentialDefinitionId(
        agent.context,
        credentialDefinitionId,
      )
    const keyCorrectnessProof = await keyCorrectnessProofRepository.findByCredentialDefinitionId(
      agent.context,
      credentialDefinitionId,
    )

    return {
      id: credentialDefinitionId,
      data: {
        name: record.getTag('name') as string,
        version: record.getTag('version') as string,
        // The import operation must send this field back. Refer to [VSA-ADM-AC-CD-CREATE].
        relatedJsonSchemaCredentialId: record.getTag('relatedJsonSchemaCredentialId') as string,
        credentialDefinition: record.credentialDefinition,
        credentialDefinitionPrivate: credentialDefinitionPrivate?.value,
        keyCorrectnessProof: keyCorrectnessProof?.value,
        schema: (await schemaRepository.findBySchemaId(agent.context, record.credentialDefinition.schemaId))
          ?.schema,
      },
    }
  }

  @Delete(':credentialDefinitionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a credential definition',
    description: 'Deletes a credential definition and all its related cryptographic data.',
  })
  @ApiParam({
    name: 'credentialDefinitionId',
    description: 'Identifier of the credential definition to delete',
    example: 'did:webvh:Qm...:issuer.example.com/resources/zQm...',
  })
  @ApiQuery({
    name: 'deleteAssociatedRevocationRegistries',
    required: false,
    type: Boolean,
    description: 'Also delete each revocation registry and status list related to this credential definition',
    example: false,
  })
  @ApiNoContentResponse({ description: 'The credential definition is deleted' })
  @ApiNotFoundResponse({ description: 'No credential definition with the given id' })
  public async deleteCredentialDefinition(
    @Param('credentialDefinitionId') credentialDefinitionId: string,
    @Query() query: DeleteCredentialDefinitionQueryDto,
  ): Promise<void> {
    const agent = await this.agentService.getAgent()

    const credentialDefinitionRepository = agent.dependencyManager.resolve(
      AnonCredsCredentialDefinitionRepository,
    )
    const credentialDefinitionPrivateRepository = agent.dependencyManager.resolve(
      AnonCredsCredentialDefinitionPrivateRepository,
    )
    const keyCorrectnessProofRepository = agent.dependencyManager.resolve(
      AnonCredsKeyCorrectnessProofRepository,
    )
    const revocationDefinitionRepository = agent.dependencyManager.resolve(
      AnonCredsRevocationRegistryDefinitionRepository,
    )

    const record = await credentialDefinitionRepository.findByCredentialDefinitionId(
      agent.context,
      credentialDefinitionId,
    )
    if (!record) throw unknownCredentialDefinition(credentialDefinitionId)

    const credentialDefinitionPrivate =
      await credentialDefinitionPrivateRepository.findByCredentialDefinitionId(
        agent.context,
        credentialDefinitionId,
      )
    if (credentialDefinitionPrivate) {
      await credentialDefinitionPrivateRepository.delete(agent.context, credentialDefinitionPrivate)
    }

    const keyCorrectnessProof = await keyCorrectnessProofRepository.findByCredentialDefinitionId(
      agent.context,
      credentialDefinitionId,
    )
    if (keyCorrectnessProof) {
      await keyCorrectnessProofRepository.delete(agent.context, keyCorrectnessProof)
    }

    const [attestedResource] = await agent.genericRecords.findAllByQuery({
      type: 'AttestedResource',
      attestedResourceId: credentialDefinitionId,
    })
    if (attestedResource) await agent.genericRecords.delete(attestedResource)

    if (query.deleteAssociatedRevocationRegistries) {
      const revocationDefinitions = await revocationDefinitionRepository.findAllByCredentialDefinitionId(
        agent.context,
        credentialDefinitionId,
      )
      for (const revocationDefinition of revocationDefinitions) {
        await this.service.deleteRevocationRegistry(
          agent,
          revocationDefinition.revocationRegistryDefinitionId,
        )
      }
    }

    await credentialDefinitionRepository.delete(agent.context, record)
  }

  private async toRecordDto(
    agent: VsAgent,
    record: AnonCredsCredentialDefinitionRecord,
  ): Promise<CredentialDefinitionDto> {
    const { schema } = await agent.modules.anoncreds.getSchema(record.credentialDefinition.schemaId)

    return {
      id: record.credentialDefinitionId,
      name: (record.getTag('name') as string) ?? schema?.name,
      version: (record.getTag('version') as string) ?? schema?.version,
      attributes: schema?.attrNames ?? [],
      supportRevocation: record.credentialDefinition?.value?.revocation !== undefined,
      relatedJsonSchemaCredentialId: record.getTag('relatedJsonSchemaCredentialId') as string,
    }
  }
}

function unknownCredentialDefinition(credentialDefinitionId: string): AdminApiError {
  return new AdminApiError(
    AdminApiErrorCode.UnknownId,
    HttpStatus.NOT_FOUND,
    `no credential definition with id "${credentialDefinitionId}"`,
  )
}

function unresolvableJsonSchemaCredential(relatedJsonSchemaCredentialId: string): AdminApiError {
  return new AdminApiError(
    AdminApiErrorCode.UnknownId,
    HttpStatus.NOT_FOUND,
    `the agent cannot resolve relatedJsonSchemaCredentialId "${relatedJsonSchemaCredentialId}"`,
  )
}

function invalidPackage(message: string): AdminApiError {
  return new AdminApiError(AdminApiErrorCode.InvalidPackage, HttpStatus.BAD_REQUEST, message)
}
