import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common'

import {
  OpenId4VcVerifierRequestError,
  UnknownVerificationSessionError,
  VerifierService,
} from '../services/VerifierService'

import { CreateOpenId4VcVerificationRequestDto } from './dto'

@Controller({ path: 'oid4vc/verifier', version: '1' })
export class VerifierController {
  public constructor(@Inject(VerifierService) private readonly verifierService: VerifierService) {}

  @Post('requests')
  public async createRequest(@Body() dto: CreateOpenId4VcVerificationRequestDto) {
    try {
      return await this.verifierService.createRequest(dto.policyId)
    } catch (error) {
      if (error instanceof OpenId4VcVerifierRequestError) {
        throw new BadRequestException(error.message)
      }
      throw error
    }
  }

  @Get('sessions/:id')
  public async getResult(@Param('id') id: string) {
    try {
      return await this.verifierService.getResult(id)
    } catch (error) {
      if (error instanceof UnknownVerificationSessionError) {
        throw new NotFoundException(error.message)
      }
      throw error
    }
  }
}
