import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString } from 'class-validator'

/**
 * Request body of [VSA-ADM-DC-PR-DECLINE] declinePresentationExchange and of
 * [VSA-ADM-DC-CE-DECLINE] declineCredentialExchange. The two methods take the same body.
 */
export class DeclineExchangeBodyDto {
  @ApiPropertyOptional({
    description: 'Text for the problem report. The agent sends the report to the peer.',
    example: 'The operator refused the exchange',
  })
  @IsOptional()
  @IsString()
  reason?: string
}
