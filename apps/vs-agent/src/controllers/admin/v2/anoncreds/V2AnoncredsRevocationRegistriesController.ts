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
} from '@nestjs/common'
import {
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger'

import { AdminApiError, AdminApiErrorCode, Page, paginate } from '../../../../common'
import { AccessMode } from '../../../../security'
import { VsAgentService } from '../../../../services/VsAgentService'
import { CredentialTypesService } from '../../credentials/CredentialTypeService'

import {
  CreateRevocationRegistryBodyDto,
  CreateRevocationRegistryResponseDto,
  ListRevocationRegistriesQueryDto,
  RevocationRegistryDefinitionIdPageDto,
} from './dto'

/**
 * AnonCreds revocation registry definitions held by this agent.
 */
@ApiTags('v2/anoncreds')
@AccessMode('INTERNAL')
@Controller({ path: 'anoncreds/revocation-registries', version: '2' })
export class V2AnoncredsRevocationRegistriesController {
  public constructor(
    @Inject(VsAgentService) private readonly vsAgentService: VsAgentService,
    @Inject(CredentialTypesService) private readonly credentialTypesService: CredentialTypesService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List revocation registries',
    description:
      'Returns the revocation registry definitions this agent knows, restricted to one credential ' +
      'definition when the caller supplies the filter.',
  })
  @ApiOkResponse({
    description: 'A page of revocation registry definition identifiers',
    type: RevocationRegistryDefinitionIdPageDto,
  })
  public async listRevocationRegistries(
    @Query() query: ListRevocationRegistriesQueryDto,
  ): Promise<Page<string>> {
    const agent = await this.vsAgentService.getAgent()

    const revocationRegistryDefinitionIds = await this.credentialTypesService.listRevocationRegistries(
      agent,
      query.credentialDefinitionId,
    )

    return paginate(
      revocationRegistryDefinitionIds,
      query,
      {
        method: 'listRevocationRegistries',
        filters: { credentialDefinitionId: query.credentialDefinitionId },
      },
      revocationRegistryDefinitionId => revocationRegistryDefinitionId,
    )
  }

  @Post()
  @ApiOperation({
    summary: 'Create a revocation registry',
    description:
      'Creates a revocation registry definition, and its first status list, for a credential ' +
      'definition that supports revocation.',
  })
  @ApiBody({
    type: CreateRevocationRegistryBodyDto,
    examples: {
      default: {
        summary: 'Default capacity',
        value: {
          credentialDefinitionId:
            'did:web:chatbot-demo.dev.2060.io?service=anoncreds&relativeRef=/credDef/8TsGLaSPVKPVMXK8APzBRcXZryxutvQuZnnTcDmbqd9p',
        },
      },
      withCapacity: {
        summary: 'Explicit capacity',
        value: {
          credentialDefinitionId:
            'did:web:chatbot-demo.dev.2060.io?service=anoncreds&relativeRef=/credDef/8TsGLaSPVKPVMXK8APzBRcXZryxutvQuZnnTcDmbqd9p',
          maximumCredentialNumber: 500,
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'The created revocation registry definition identifier',
    type: CreateRevocationRegistryResponseDto,
  })
  @ApiNotFoundResponse({ description: 'No credential definition with the given id' })
  public async createRevocationRegistry(
    @Body() body: CreateRevocationRegistryBodyDto,
  ): Promise<CreateRevocationRegistryResponseDto> {
    const agent = await this.vsAgentService.getAgent()

    const revocationRegistryDefinitionId = await this.credentialTypesService.createRevocationRegistry(agent, {
      credentialDefinitionId: body.credentialDefinitionId,
      maximumCredentialNumber: body.maximumCredentialNumber,
    })

    return { revocationRegistryDefinitionId }
  }

  @Delete(':revocationRegistryDefinitionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a revocation registry',
    description: 'Deletes a revocation registry definition, its status lists, and its tails file.',
  })
  @ApiParam({
    name: 'revocationRegistryDefinitionId',
    type: String,
    description: 'Percent-encoded identifier of the revocation registry definition to delete',
    example:
      'did%3Aweb%3Achatbot-demo.dev.2060.io%3Fservice%3Danoncreds%26relativeRef%3D%2FrevRegDef%2F8TsGLaSPVKPVMXK8APzBRcXZryxutvQuZnnTcDmbqd9p',
  })
  @ApiNoContentResponse({ description: 'The revocation registry definition is deleted' })
  @ApiNotFoundResponse({ description: 'No revocation registry definition with the given id' })
  public async deleteRevocationRegistry(
    @Param('revocationRegistryDefinitionId') revocationRegistryDefinitionId: string,
  ): Promise<void> {
    const agent = await this.vsAgentService.getAgent()

    const deleted = await this.credentialTypesService.deleteRevocationRegistry(
      agent,
      revocationRegistryDefinitionId,
    )
    if (!deleted) {
      throw new AdminApiError(
        AdminApiErrorCode.UnknownId,
        HttpStatus.NOT_FOUND,
        `no revocation registry definition with id "${revocationRegistryDefinitionId}"`,
      )
    }
  }
}
