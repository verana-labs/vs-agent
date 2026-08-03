import type { SigningCertificateInfo } from '../services/CertificateService'

import { Controller, Get, Inject, Optional } from '@nestjs/common'

import { IssuerService } from '../services/IssuerService'
import { VerifierService } from '../services/VerifierService'

// Internal admin route exposing the plugin's PUBLIC signing-certificate
// material: the leaf fingerprint (the exact pin format verifiers configure
// in trust.developmentCertificateFingerprints) and the base64 chain. Lets
// operators wire verifier pins without reaching into agent storage. Never
// returns private keys.
@Controller({ path: 'oid4vc/certificates', version: '1' })
export class CertificatesController {
  public constructor(
    @Optional() @Inject(IssuerService) private readonly issuerService?: IssuerService,
    @Optional() @Inject(VerifierService) private readonly verifierService?: VerifierService,
  ) {}

  @Get()
  public async list(): Promise<{ certificates: SigningCertificateInfo[] }> {
    const certificates: SigningCertificateInfo[] = []
    if (this.issuerService) {
      await this.issuerService.ensureInitialized()
      certificates.push(this.issuerService.getCertificateInfo())
    }
    if (this.verifierService) {
      await this.verifierService.ensureInitialized()
      certificates.push(this.verifierService.getCertificateInfo())
    }
    return { certificates }
  }
}
