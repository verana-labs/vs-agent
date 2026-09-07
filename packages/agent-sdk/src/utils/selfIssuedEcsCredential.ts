import {
  DidDocumentService,
  DidRecord,
  DidRepository,
  W3cCredentialSchema,
  W3cCredentialSubject,
  W3cJsonLdVerifiablePresentation,
  W3cPresentation,
} from '@credo-ts/core'

import { VsAgent } from '../agent/VsAgent'
import { EcsClaims } from './ecsClaims'
import {
  createCredential,
  createPresentation,
  generateDigestSRI,
  getClaims,
  getVerificationMethodId,
  linkedVpFragment,
  signerW3c,
  sortKeysDeep,
} from './setupSelfTr'

const buildIntegrityData = (data: Record<string, unknown>) => {
  return generateDigestSRI(JSON.stringify(sortKeysDeep(data)))
}

interface StoredSelfIssuedCredential {
  issuer?: string | { id?: string }
  credentialSchema?: { id?: string } | Array<{ id?: string }>
  proof?: { verificationMethod?: string } | Array<{ verificationMethod?: string }>
}

function storedCredentialIsCurrent(
  credential: StoredSelfIssuedCredential | undefined,
  credentialSchemaId: string,
  did: string,
  didRecord: DidRecord,
): boolean {
  if (!credential) return false

  const issuer = typeof credential.issuer === 'string' ? credential.issuer : credential.issuer?.id
  if (issuer !== did) return false

  const schema = Array.isArray(credential.credentialSchema)
    ? credential.credentialSchema[0]
    : credential.credentialSchema
  if (schema?.id !== credentialSchemaId) return false

  const proofs = !credential.proof
    ? []
    : Array.isArray(credential.proof)
      ? credential.proof
      : [credential.proof]
  if (proofs.length === 0) return false

  const assertionMethods = new Set(
    (didRecord.didDocument?.assertionMethod ?? []).map(entry =>
      typeof entry === 'string' ? entry : entry.id,
    ),
  )
  return proofs.every(proof => !!proof.verificationMethod && assertionMethods.has(proof.verificationMethod))
}

async function signSelfIssuedEcsCredential(
  agent: VsAgent,
  didRecord: DidRecord,
  type: string[],
  claims: W3cCredentialSubject['claims'],
  credentialSchema: W3cCredentialSchema,
  presentation: W3cPresentation,
): Promise<W3cJsonLdVerifiablePresentation> {
  const unsignedCredential = createCredential({
    id: agent.did,
    type,
    issuer: agent.did,
    credentialSubject: { id: agent.did, claims },
  })
  unsignedCredential.credentialSchema = credentialSchema
  const verificationMethodId = getVerificationMethodId(agent.config.logger, didRecord)
  const signedCredential = await signerW3c(agent, unsignedCredential, verificationMethodId)
  presentation.verifiableCredential = [signedCredential]
  return await signerW3c(agent, presentation, verificationMethodId)
}

export async function publishSelfIssuedEcsPresentation(
  agent: VsAgent,
  id: string,
  ecsSchemas: Record<string, string>,
  schemaKey: string,
  type: string[],
  credentialSchema: W3cCredentialSchema,
  ecsClaims: EcsClaims,
  beforePublish?: (verifiablePresentation: any) => Promise<void>,
) {
  if (!agent.did) throw Error('The DID must be set up')
  const [didRecord] = await agent.dids.getCreatedDids({ did: agent.did })
  const didDocument = didRecord.didDocument
  if (!didDocument) throw Error('The DID Document must be set up')
  const claims = await getClaims(agent.config.logger, ecsSchemas, { id: agent.did }, schemaKey, ecsClaims)
  const didDocumentServiceId = `${agent.did}#${linkedVpFragment(schemaKey)}`
  const integrityData = buildIntegrityData({ id, type, credentialSchema, claims })
  const record = didRecord.metadata.get('_vt/vtc') ?? {}
  const metadata = record[credentialSchema.id]
  const superseded = Object.entries(record).some(
    ([storedSchemaId, entry]) =>
      storedSchemaId !== credentialSchema.id &&
      entry?.verifiablePresentation?.id === id &&
      entry?.attached !== false,
  )
  const attached = (metadata?.attached ?? true) && !superseded
  if (
    metadata?.integrityData === integrityData &&
    storedCredentialIsCurrent(metadata?.credential, credentialSchema.id, agent.did, didRecord)
  ) {
    // the presentation is already public, so a failed beforePublish step still needs a retry here
    if (attached) await beforePublish?.(metadata.verifiablePresentation)
    return metadata.verifiablePresentation
  }

  const presentation = createPresentation({
    id,
    holder: agent.did,
    verifiableCredential: [],
  })
  const verifiablePresentation = await signSelfIssuedEcsCredential(
    agent,
    didRecord,
    type,
    claims,
    credentialSchema,
    presentation,
  )
  // nothing is persisted yet, so a failure here leaves no public presentation behind
  if (attached) await beforePublish?.(verifiablePresentation)
  // Update linked VP when the presentation has changed
  if (attached)
    didDocument.service = didDocument.service?.map(s => {
      if (typeof s.serviceEndpoint !== 'string') return s
      if (s.serviceEndpoint.includes(schemaKey) && s.id !== `${agent.did}#whois`) {
        s.id = didDocumentServiceId
        s.serviceEndpoint = id
      }
      return s
    })
  // Resolvers only discover the credential through the [VT-CRED-W3C-LINKED-VP] fragment, and
  // #whois does not match it. The rename above only covers documents that already carry the
  // service, so publish it here when nothing declared it yet.
  let didDocumentChanged = false
  if (attached && !didDocument.service?.some(s => s.id === didDocumentServiceId)) {
    didDocument.service = [
      ...(didDocument.service ?? []),
      new DidDocumentService({
        id: didDocumentServiceId,
        serviceEndpoint: id,
        type: 'LinkedVerifiablePresentation',
      }),
    ]
    didDocumentChanged = true
  }
  const whoisId = `${agent.did}#whois`
  if (attached && schemaKey === 'ecs-service') {
    const whois = didDocument.service?.find(s => s.id === whoisId)
    if (whois) {
      if (whois.serviceEndpoint !== id) {
        whois.serviceEndpoint = id
        didDocumentChanged = true
      }
    } else {
      didDocument.service = [
        ...(didDocument.service ?? []),
        new DidDocumentService({ id: whoisId, serviceEndpoint: id, type: 'LinkedVerifiablePresentation' }),
      ]
      didDocumentChanged = true
    }
  }
  const credential = Array.isArray(verifiablePresentation.verifiableCredential)
    ? verifiablePresentation.verifiableCredential[0]
    : verifiablePresentation.verifiableCredential
  record[credentialSchema.id] = {
    credential,
    verifiablePresentation,
    didDocumentServiceId,
    integrityData,
    attached,
  }
  didRecord.metadata.set('_vt/vtc', record)
  await agent.context.dependencyManager.resolve(DidRepository).update(agent.context, didRecord)
  if (didDocumentChanged) {
    await agent.dids.update({ did: didRecord.did, didDocument })
  }
  return verifiablePresentation
}
