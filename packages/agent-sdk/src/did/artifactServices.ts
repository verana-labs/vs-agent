import { DidDocument, DidDocumentService } from '@credo-ts/core'

const ANONCREDS_REGISTRY_SERVICE_TYPE = 'AnonCredsRegistry'
const RELATIVE_REF_SERVICE_TYPE = 'relativeRef'

const ARTIFACT_SERVICE_TYPES: readonly string[] = [ANONCREDS_REGISTRY_SERVICE_TYPE, RELATIVE_REF_SERVICE_TYPE]

export type ArtifactServiceMethod = 'web' | 'webvh'

export interface ArtifactServiceOptions {
  method: ArtifactServiceMethod
  publicApiBaseUrl: string
}

/** Declares the artifact service of the given method, and only that one. */
export function applyArtifactServices(didDocument: DidDocument, options: ArtifactServiceOptions): void {
  removeArtifactServices(didDocument)
  didDocument.service = [...(didDocument.service ?? []), ...expectedArtifactServices(didDocument.id, options)]
}

/** Strips every artifact service: the parallel did:web document advertises none. */
export function removeArtifactServices(didDocument: DidDocument): void {
  didDocument.service = (didDocument.service ?? []).filter(
    service => !ARTIFACT_SERVICE_TYPES.includes(service.type),
  )
}

export function artifactServicesMatch(didDocument: DidDocument, options: ArtifactServiceOptions): boolean {
  const current = (didDocument.service ?? []).filter(service => ARTIFACT_SERVICE_TYPES.includes(service.type))
  const expected = expectedArtifactServices(didDocument.id, options)

  return (
    current.length === expected.length &&
    expected.every(service =>
      current.some(
        entry =>
          entry.id === service.id &&
          entry.type === service.type &&
          entry.serviceEndpoint === service.serviceEndpoint,
      ),
    )
  )
}

function expectedArtifactServices(did: string, options: ArtifactServiceOptions): DidDocumentService[] {
  const { method, publicApiBaseUrl } = options

  return method === 'web'
    ? [
        new DidDocumentService({
          id: `${did}#anoncreds`,
          serviceEndpoint: `${publicApiBaseUrl}/anoncreds/v1`,
          type: ANONCREDS_REGISTRY_SERVICE_TYPE,
        }),
      ]
    : [
        new DidDocumentService({
          id: `${did}#files`,
          serviceEndpoint: publicApiBaseUrl,
          type: RELATIVE_REF_SERVICE_TYPE,
        }),
      ]
}
