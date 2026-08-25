import type { NextFunction, Request, Response } from 'express'

import { isTrustedPeer, type TrustedNetwork } from './trustedNetworks'

// SwaggerModule.setup registers on the express adapter, so the Nest guard never sees these paths
export function restrictDocsToTrustedPeers(trustedNetworks: TrustedNetwork[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const isDocs = req.path === '/api' || req.path.startsWith('/api/') || req.path.startsWith('/api-json')
    if (!isDocs || isTrustedPeer(req.socket?.remoteAddress, trustedNetworks)) {
      next()
      return
    }
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'the API documentation is not served to external callers' },
    })
  }
}
