import { Controller, Get, Header } from '@nestjs/common'
import { ApiExcludeController } from '@nestjs/swagger'

import { DEFAULT_LOGO_SVG, DEFAULT_PRIVACY_HTML, DEFAULT_TERMS_HTML } from '../../../config'

/**
 * Placeholder resources for a Verifiable Service that has not configured its own. The self-issued
 * credentials reference these by URL and hash them, so they must be fetchable for the agent to start.
 * Content lives in config/constants.ts so it can be hashed locally (see main.ts) without the agent
 * having to fetch its own public URL over HTTP.
 */
@ApiExcludeController()
@Controller('vt/default')
export class DefaultResourcesController {
  @Get('logo.svg')
  @Header('Content-Type', 'image/svg+xml')
  getLogo(): string {
    return DEFAULT_LOGO_SVG
  }

  @Get('terms.html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getTermsAndConditions(): string {
    return DEFAULT_TERMS_HTML
  }

  @Get('privacy.html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getPrivacyPolicy(): string {
    return DEFAULT_PRIVACY_HTML
  }
}
