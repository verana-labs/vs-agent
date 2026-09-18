import { Controller, Get, Inject, Optional } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { IssuerService, VerifierService } from '@verana-labs/vs-agent-plugin-openid4vc'

import { Openid4vcSigningCertificateDto } from './dto'

/** [VSA-ADM-OID-CS] Signing certificates of the configured OpenID4VC capabilities. */
@ApiTags('v2/openid4vc')
@Controller({ path: 'openid4vc', version: '2' })
export class V2Openid4vcSigningCertificatesController {
  public constructor(
    @Optional() @Inject(IssuerService) private readonly issuerService?: IssuerService,
    @Optional() @Inject(VerifierService) private readonly verifierService?: VerifierService,
  ) {}

  @Get('signing-certificates')
  @ApiOperation({
    summary: 'List signing certificates',
    description:
      'Returns the public signing certificate of each configured capability, so that an operator can pin a fingerprint on a peer verifier. Not paginated: at most two records.',
  })
  @ApiOkResponse({ description: 'The signing certificates', type: [Openid4vcSigningCertificateDto] })
  public async listSigningCertificates(): Promise<Openid4vcSigningCertificateDto[]> {
    const certificates: Openid4vcSigningCertificateDto[] = []
    if (this.issuerService) {
      await this.issuerService.ensureInitialized()
      certificates.push(this.issuerService.getCertificateInfo())
    }
    if (this.verifierService) {
      await this.verifierService.ensureInitialized()
      certificates.push(this.verifierService.getCertificateInfo())
    }
    return certificates
  }
}
