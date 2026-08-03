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
  IssuerService,
  OpenId4VcIssuerRequestError,
  OpenId4VcOfferNotFoundError,
} from '../services/IssuerService'

import { CreateOpenId4VcOfferDto } from './dto'

@Controller({ path: 'oid4vc/offers', version: '1' })
export class IssuerController {
  public constructor(@Inject(IssuerService) private readonly issuerService: IssuerService) {}

  @Post()
  public async createOffer(@Body() dto: CreateOpenId4VcOfferDto) {
    try {
      return await this.issuerService.createOffer(dto.credentialConfigurationId, dto.claims)
    } catch (error) {
      if (error instanceof OpenId4VcIssuerRequestError) {
        throw new BadRequestException(error.message)
      }
      throw error
    }
  }

  @Get(':id')
  public async getOfferState(@Param('id') id: string) {
    try {
      return await this.issuerService.getOfferState(id)
    } catch (error) {
      if (error instanceof OpenId4VcOfferNotFoundError) {
        throw new NotFoundException(error.message)
      }
      throw error
    }
  }
}
