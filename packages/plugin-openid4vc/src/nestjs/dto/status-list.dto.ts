import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { PageDto, PaginationQueryDto } from '@verana-labs/vs-agent-sdk'
import { IsInt, IsOptional, Max, Min } from 'class-validator'

import {
  STATUS_LIST_SIZE_DEFAULT,
  STATUS_LIST_SIZE_MAX,
  STATUS_LIST_SIZE_MIN,
} from '../../services/StatusListService'

/** Query of [VSA-ADM-OID-SL-LIST] listStatusLists: the pagination parameters alone. */
export class OpenId4VcListStatusListsQueryDto extends PaginationQueryDto {}

/** Request body of [VSA-ADM-OID-SL-CREATE] createStatusList. */
export class OpenId4VcCreateStatusListBodyDto {
  @ApiPropertyOptional({
    type: Number,
    minimum: STATUS_LIST_SIZE_MIN,
    maximum: STATUS_LIST_SIZE_MAX,
    default: STATUS_LIST_SIZE_DEFAULT,
    description:
      'Number of entries of the list. The default is large so that a list reveals little about the number of credentials the issuer has issued.',
    example: STATUS_LIST_SIZE_DEFAULT,
  })
  @IsOptional()
  @IsInt()
  @Min(STATUS_LIST_SIZE_MIN)
  @Max(STATUS_LIST_SIZE_MAX)
  size?: number
}

/** A status list record, as returned by createStatusList and listStatusLists. */
export class OpenId4VcStatusListRecordDto {
  @ApiProperty({ description: 'Identifier of the list', example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  statusListId!: string

  @ApiProperty({
    description:
      'Public URL of the Status List Token, the value every credential registered on the list carries in status.status_list.uri',
    example: 'https://agent.example/oid4vc/status-list/3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  uri!: string

  @ApiProperty({ description: 'Number of entries of the list', example: STATUS_LIST_SIZE_DEFAULT })
  size!: number

  @ApiProperty({ type: String, format: 'date-time', description: 'When the agent created the list' })
  createdAt!: Date

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'The iat of the last token the agent published for the list',
  })
  updatedAt!: Date
}

export const OpenId4VcStatusListRecordPageDto = PageDto(OpenId4VcStatusListRecordDto)
