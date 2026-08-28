import { AnonCredsRevocationRegistryDefinitionRepository } from '@credo-ts/anoncreds'
import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'

import { AdminApiError, AdminApiErrorCode } from '../../../../common'
import { AccessMode } from '../../../../security'
import { VsAgentService } from '../../../../services/VsAgentService'
import { CredentialTypesService } from '../../credentials'

import { RevokeCredentialBodyDto, RevokeCredentialResponseDto } from './dto'

@ApiTags('v2/anoncreds')
@AccessMode('INTERNAL')
@Controller({ path: 'anoncreds', version: '2' })
export class V2AnoncredsController {
  public constructor(
    @Inject(VsAgentService) private readonly vsAgentService: VsAgentService,
    @Inject(CredentialTypesService) private readonly credentialTypesService: CredentialTypesService,
  ) {}

  @Post('revoke-credential')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke an AnonCreds credential',
    description:
      'Revokes one AnonCreds credential at registry level, addressed by revocation registry definition ' +
      'and index. The agent updates and republishes the revocation status list. This method has no ' +
      'DIDComm and no Flow State effect: use `revokeFlowCredential` to also notify the applicant.',
  })
  @ApiOkResponse({ type: RevokeCredentialResponseDto })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  public async revokeCredential(@Body() body: RevokeCredentialBodyDto): Promise<RevokeCredentialResponseDto> {
    const { revocationRegistryDefinitionId, revocationRegistryIndex } = body
    const agent = await this.vsAgentService.getAgent()

    const revocationRegistryDefinitionRepository = agent.dependencyManager.resolve(
      AnonCredsRevocationRegistryDefinitionRepository,
    )
    const record = await revocationRegistryDefinitionRepository.findByRevocationRegistryDefinitionId(
      agent.context,
      revocationRegistryDefinitionId,
    )
    if (!record) {
      throw new AdminApiError(
        AdminApiErrorCode.UnknownId,
        HttpStatus.NOT_FOUND,
        `no revocation registry definition with id "${revocationRegistryDefinitionId}"`,
      )
    }

    const { maxCredNum } = record.revocationRegistryDefinition.value
    if (revocationRegistryIndex > maxCredNum) {
      throw new AdminApiError(
        AdminApiErrorCode.InvalidInput,
        HttpStatus.BAD_REQUEST,
        `revocationRegistryIndex ${revocationRegistryIndex} is beyond the registry capacity of ${maxCredNum}`,
      )
    }

    const { timestamp } = await this.credentialTypesService.revokeCredential(
      agent,
      revocationRegistryDefinitionId,
      revocationRegistryIndex,
    )

    return {
      revocationRegistryDefinitionId,
      revocationRegistryIndex,
      revokedAt: new Date(timestamp * 1000).toISOString(),
    }
  }
}
