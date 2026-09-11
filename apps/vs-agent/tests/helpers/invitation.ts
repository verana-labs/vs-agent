import { JsonEncoder } from '@credo-ts/core'

// A v2 invitation travels in `_oob`, a v1 one in `oob`.
export function invitationUrl(invitation: Record<string, unknown>): string {
  const param = String(invitation.type ?? invitation['@type']).includes('/2.0/') ? '_oob' : 'oob'
  return `https://example.com?${param}=${JsonEncoder.toBase64Url(invitation)}`
}
