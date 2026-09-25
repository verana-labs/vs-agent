import { Controller, Get, Inject } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { IssuerService } from '../services/IssuerService'
import { VerifierService } from '../services/VerifierService'

import { OpenId4VcSigningCertificateDto } from './dto'

/**
 * This controller has the signing certificates of the two OpenID4VC capabilities of this agent.
 * Refer to [VSA-ADM-OID-CS].
 *
 * The issuer signs the credentials it mints and the verifier signs the requests it sends, each
 * with its own certificate. An operator reads the public certificate of a capability here to pin
 * its fingerprint on a peer.
 */
@ApiTags('v2/openid4vc')
@Controller({ path: 'openid4vc', version: '2' })
export class V2OpenId4VcSigningCertificatesController {
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
  @ApiOkResponse({ description: 'The signing certificates', type: [OpenId4VcSigningCertificateDto] })
  public async listSigningCertificates(): Promise<OpenId4VcSigningCertificateDto[]> {
    return Promise.all([this.issuerService.getCertificateInfo(), this.verifierService.getCertificateInfo()])
  }
}
