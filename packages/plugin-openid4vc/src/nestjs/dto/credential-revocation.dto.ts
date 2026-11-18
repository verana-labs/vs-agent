import { ApiProperty } from '@nestjs/swagger'
import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator'

/** Request body of [VSA-ADM-OID-CR-REVOKE] revokeCredential. */
export class OpenId4VcRevokeCredentialBodyDto {
  @ApiProperty({
    description: 'The status list that the credential is registered on',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsString()
  @IsNotEmpty()
  statusListId!: string

  @ApiProperty({
    type: Number,
    minimum: 0,
    description: 'Index of the credential on the list, from 0 to size - 1',
    example: 42,
  })
  @IsInt()
  @Min(0)
  statusListIndex!: number
}

/** Response of [VSA-ADM-OID-CR-REVOKE] revokeCredential. */
export class OpenId4VcRevokeCredentialResponseDto {
  @ApiProperty({
    description: 'The status list of the request',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  statusListId!: string

  @ApiProperty({ description: 'The index of the request', example: 42 })
  statusListIndex!: number

  @ApiProperty({
    description:
      'The iat of the token the agent published for this revocation, as an ISO 8601 UTC datetime. It can differ from the time the agent received the request.',
    example: '2026-08-28T10:15:30.000Z',
  })
  revokedAt!: string
}
