import { Controller, Get, Inject } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { IssuerService, VerifierService } from '@verana-labs/vs-agent-plugin-openid4vc'

import { Openid4vcSigningCertificateDto } from './dto'

/** [VSA-ADM-OID-CS] Signing certificates of the two OpenID4VC capabilities. */
@ApiTags('v2/openid4vc')
@Controller({ path: 'openid4vc', version: '2' })
export class V2Openid4vcSigningCertificatesController {
  public constructor(
    @Inject(IssuerService) private readonly issuerService: IssuerService,
    @Inject(VerifierService) private readonly verifierService: VerifierService,
  ) {}

  @Get('signing-certificates')
  @ApiOperation({
    summary: 'List signing certificates',
    description:
      'Returns the public signing certificate of each capability, so that an operator can pin a fingerprint on a peer verifier. Not paginated: one record for the issuer and one for the verifier.',
  })
  @ApiOkResponse({ description: 'The signing certificates', type: [Openid4vcSigningCertificateDto] })
  public async listSigningCertificates(): Promise<Openid4vcSigningCertificateDto[]> {
    await this.issuerService.ensureInitialized()
    await this.verifierService.ensureInitialized()
    return [this.issuerService.getCertificateInfo(), this.verifierService.getCertificateInfo()]
  }
}
