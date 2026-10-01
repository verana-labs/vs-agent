import type { DidDocument, VerificationMethod } from '@credo-ts/core'

// Only a nominated method: did:webvh's update Multikey sits first in verificationMethod and is the registrar's, not ours.
export function findDidCommVerificationMethodId(didDocument: DidDocument): string | undefined {
  const methods = didDocument.verificationMethod ?? []
  const nominated = [...(didDocument.authentication ?? []), ...(didDocument.assertionMethod ?? [])]
    .map(entry => (typeof entry === 'string' ? methods.find(method => method.id === entry) : entry))
    .filter((method): method is VerificationMethod => method !== undefined && isEd25519(method))

  return nominated.find(method => method.type === 'Ed25519VerificationKey2020')?.id ?? nominated[0]?.id
}

function isEd25519(method: VerificationMethod): boolean {
  return (
    method.type === 'Ed25519VerificationKey2020' ||
    method.type === 'Ed25519VerificationKey2018' ||
    (method.type === 'Multikey' &&
      typeof method.publicKeyMultibase === 'string' &&
      method.publicKeyMultibase.startsWith('z6Mk'))
  )
}
