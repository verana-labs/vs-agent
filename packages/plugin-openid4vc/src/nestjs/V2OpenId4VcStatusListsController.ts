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
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger'
import { createdAtKey, mapPage, Page, paginate } from '@verana-labs/vs-agent-sdk'

import { StatusListService } from '../services/StatusListService'

import {
  OpenId4VcCreateStatusListBodyDto,
  OpenId4VcListStatusListsQueryDto,
  OpenId4VcStatusListRecordDto,
  OpenId4VcStatusListRecordPageDto,
} from './dto'
import { toStatusListDto } from './mappers'

/**
 * This controller has the Token Status Lists of the issuer capability of this agent.
 * Refer to [VSA-ADM-OID-SL].
 *
 * One list serves every credential type the agent issues. A credential joins a list through the
 * `statusListId` and `statusListIndex` of its offer, and the agent serves each list at its public
 * URL, [VSA-PUB-OID-1], signed with the certificate that signs its credentials.
 */
@ApiTags('v2/openid4vc')
@Controller({ path: 'openid4vc/status-lists', version: '2' })
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class V2OpenId4VcStatusListsController {
  public constructor(@Inject(StatusListService) private readonly statusListService: StatusListService) {}

  @Get()
  @ApiOperation({
    summary: 'List status lists',
    description: 'Returns the Token Status Lists of this agent.',
  })
  @ApiOkResponse({ description: 'A page of status list records', type: OpenId4VcStatusListRecordPageDto })
  public async listStatusLists(
    @Query() query: OpenId4VcListStatusListsQueryDto,
  ): Promise<Page<OpenId4VcStatusListRecordDto>> {
    const lists = await this.statusListService.listStatusLists()
    const page = paginate(lists, query, { method: 'openid4vc.listStatusLists', filters: {} }, createdAtKey)
    return mapPage(page, toStatusListDto)
  }

  @Post()
  @ApiOperation({
    summary: 'Create a status list',
    description:
      'Creates a Token Status List with every entry VALID, publishes its signed token at its public URL, and returns its record.',
  })
  @ApiBody({
    type: OpenId4VcCreateStatusListBodyDto,
    examples: {
      default: { summary: 'Default size', value: {} },
      small: { summary: 'Explicit size', value: { size: 4096 } },
    },
  })
  @ApiCreatedResponse({ description: 'The status list record', type: OpenId4VcStatusListRecordDto })
  @ApiBadRequestResponse({ description: 'size is out of range' })
  public async createStatusList(
    @Body() body: OpenId4VcCreateStatusListBodyDto,
  ): Promise<OpenId4VcStatusListRecordDto> {
    return toStatusListDto(await this.statusListService.createStatusList({ size: body.size }))
  }

  @Delete(':statusListId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a status list',
    description:
      'Deletes a status list and stops serving its public URL. Refused with INVALID_STATE while an index of the list is bound to a credential that is not revoked and not expired.',
  })
  @ApiParam({
    name: 'statusListId',
    type: String,
    description: 'Identifier of the list',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiNoContentResponse({ description: 'The status list is deleted' })
  @ApiNotFoundResponse({ description: 'No status list with the given id' })
  @ApiConflictResponse({ description: 'An index of the list is bound to a live credential' })
  public async deleteStatusList(@Param('statusListId') statusListId: string): Promise<void> {
    await this.statusListService.deleteStatusList(statusListId)
  }
}
