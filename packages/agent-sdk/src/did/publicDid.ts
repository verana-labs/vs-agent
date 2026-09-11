import { parseDid } from '@credo-ts/core'

export const SUPPORTED_PUBLIC_DID_METHODS = ['web', 'webvh'] as const
export type SupportedPublicDidMethod = (typeof SUPPORTED_PUBLIC_DID_METHODS)[number]

export function isSupportedPublicDidMethod(method: string): method is SupportedPublicDidMethod {
  return (SUPPORTED_PUBLIC_DID_METHODS as readonly string[]).includes(method)
}

export function isSupportedPublicDid(did: string): boolean {
  try {
    return isSupportedPublicDidMethod(parseDid(did).method)
  } catch {
    return false
  }
}
