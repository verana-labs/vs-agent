import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common'

import { VERANA_INDEXER_BASE_URL } from '../../../config/constants'

@Injectable()
export class IndexerDisabledGuard implements CanActivate {
  canActivate(): boolean {
    if (VERANA_INDEXER_BASE_URL) {
      throw new ForbiddenException('VTJSC lifecycle is automatically managed by Verana VPR events.')
    }
    return true
  }
}
