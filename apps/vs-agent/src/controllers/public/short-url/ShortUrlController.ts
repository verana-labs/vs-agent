import { Controller, Get, Inject, NotFoundException, Query } from '@nestjs/common'

import { UrlShorteningService } from '../../../services'

@Controller()
export class ShortUrlController {
  constructor(
    @Inject(UrlShorteningService) private readonly urlShortenerService: UrlShorteningService,
  ) {}

  @Get('/s')
  async getShortUrl(@Query('id') id?: string): Promise<Record<string, unknown>> {
    const invitation = id ? await this.urlShortenerService.getInvitation(id) : undefined
    if (!invitation) throw new NotFoundException('unknown short url')
    return invitation
  }
}
