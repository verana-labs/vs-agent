import type { BaseLogger } from '@credo-ts/core'

import { Claim } from '@verana-labs/vs-agent-model'
import fetch from 'node-fetch'

export enum PresentationStatus {
  OK = 'ok',
  CONNECTED = 'connected',
  SCANNED = 'scanned',
  REFUSED = 'refused',
  NO_COMPATIBLE_CREDENTIALS = 'no-compatible-credentials',
  VERIFICATION_ERROR = 'verification-error',
  UNSPECIFIED_ERROR = 'unspecified-error',
}

export const sendPresentationCallbackEvent = async (options: {
  proofExchangeId: string
  callbackUrl: string
  status: PresentationStatus
  ref?: string
  claims?: Claim[]
  logger: BaseLogger
}) => {
  const { callbackUrl, ref, claims, logger, status, proofExchangeId } = options
  try {
    logger.debug(`sending presentation callback event to ${callbackUrl}: ${JSON.stringify(options)}`)
    await fetch(callbackUrl, {
      method: 'POST',
      body: JSON.stringify({
        ref,
        claims,
        status,
        proofExchangeId,
      }),
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    logger.error(`Error sending presentation callback event to ${callbackUrl}`, {
      cause: error,
    })
  }
}
