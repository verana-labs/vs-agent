import { BadRequestException, Body, Controller, Inject, Post, UnauthorizedException } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { IsNotEmpty, IsString } from 'class-validator'

import { AdminAuthService } from './AdminAuthService'
import { AccessMode } from './accessMode'

export class ChallengeRequestDto {
  @IsString()
  @IsNotEmpty()
  account!: string
}

export class TokenRequestDto {
  @IsString()
  @IsNotEmpty()
  account!: string

  @IsString()
  @IsNotEmpty()
  pubKey!: string

  @IsString()
  @IsNotEmpty()
  signature!: string

  @IsString()
  @IsNotEmpty()
  nonce!: string
}

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(@Inject(AdminAuthService) private readonly authService: AdminAuthService) {}

  @Post('challenge')
  @AccessMode('PUBLIC')
  @ApiOperation({ summary: 'Request an ADR-036 signature challenge for a Verana account' })
  challenge(@Body() body: ChallengeRequestDto): { nonce: string; expiresAt: string } {
    if (!body.account.startsWith('verana1')) throw new BadRequestException('account must be a verana address')
    return this.authService.createChallenge(body.account)
  }

  @Post('token')
  @AccessMode('PUBLIC')
  @ApiOperation({ summary: 'Exchange a signed challenge for a short-lived bearer token' })
  async token(@Body() body: TokenRequestDto): Promise<{ token: string; expiresAt: string }> {
    const issued = await this.authService.issueToken(body)
    if (!issued) throw new UnauthorizedException('challenge verification failed')
    return issued
  }
}
