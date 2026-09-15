import type { DidDocument, VerificationMethod } from '@credo-ts/core'

export function findDidCommVerificationMethodId(didDocument: DidDocument): string | undefined {
  const methods = didDocument.verificationMethod ?? []
  const nominated = [didDocument.authentication, didDocument.assertionMethod]
    .flat()
    .find((entry): entry is string => typeof entry === 'string')
  const nominatedMethod = methods.find(method => method.id === nominated && isEd25519(method))
  if (nominatedMethod) return nominatedMethod.id

  return (
    methods.find(method => method.type === 'Ed25519VerificationKey2020')?.id ?? methods.find(isEd25519)?.id
  )
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
