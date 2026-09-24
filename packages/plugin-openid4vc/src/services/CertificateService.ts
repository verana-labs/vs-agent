import type { OpenId4VcAgent, OpenId4VcSigningOptions } from '../types'
import type { DidPurpose } from '@credo-ts/core'

import {
  DidDocument,
  DidRepository,
  Kms,
  tryParseDid,
  VerificationMethod,
  X509Certificate,
  X509KeyUsage,
} from '@credo-ts/core'
import { createHash } from 'crypto'

import { certificateFingerprint } from '../trust/CertificateTrust'
import { isRecord } from '../utils/isRecord'

const DEVELOPMENT_CERTIFICATE_VALIDITY_MS = 365 * 24 * 60 * 60 * 1_000
const DEVELOPMENT_RECORD_PREFIX = 'openid4vc-development-signing'
const JSON_WEB_KEY_2020_CONTEXT = 'https://w3id.org/security/suites/jws-2020/v1'
export type SigningRole = 'issuer' | 'verifier'

interface DevelopmentCertificateRecord {
  certificate: string
  keyId: string
}

export interface SigningCertificateInfo {
  role: SigningRole
  development: boolean
  fingerprint: string
  certificateChain: string[]
}

/** [VSA-ADM-OID-CS] Public signing material of one capability. */
export function signingCertificateInfo(
  role: SigningRole,
  handle: SigningCertificateHandle,
): SigningCertificateInfo {
  return {
    role,
    development: handle.development,
    fingerprint: certificateFingerprint(handle.certificate),
    certificateChain: handle.chain.map(certificate => certificate.toString('base64')),
  }
}

export interface SigningCertificateHandle {
  certificate: X509Certificate
  chain: X509Certificate[]
  keyId: string
  development: boolean
}

export async function loadSigningCertificate(
  agent: OpenId4VcAgent,
  signing: OpenId4VcSigningOptions | undefined,
  publicApiBaseUrl = agent.publicApiBaseUrl,
  role: SigningRole = 'issuer',
): Promise<SigningCertificateHandle> {
  if (signing) {
    return await loadConfiguredSigningCertificate(agent, signing.configured, publicApiBaseUrl, role)
  }

  return await loadDevelopmentSigningCertificate(agent, publicApiBaseUrl, role)
}

export function didFromValidatedCertificate(certificate: X509Certificate): string {
  const did = certificate.sanUriNames.map(uri => tryParseDid(uri)?.did).find(value => value !== undefined)
  if (!did) {
    throw new Error('certificate does not contain a DID URI SAN')
  }

  return did
}

// Nest calls every onModuleInit hook of a module concurrently, and two capabilities publishing into one DID
// document would each drop the verification method the other added.
let didDocumentPublication: Promise<unknown> = Promise.resolve()

export function publishDevelopmentSigningKey(
  agent: OpenId4VcAgent,
  signingCertificate: SigningCertificateHandle,
  role: SigningRole,
): Promise<string | undefined> {
  if (!signingCertificate.development) return Promise.resolve(undefined)

  const publication = didDocumentPublication
    .catch(() => undefined)
    .then(() => publishSigningKeyToDidDocument(agent, signingCertificate, role))
  didDocumentPublication = publication.catch(() => undefined)

  return publication
}

async function publishSigningKeyToDidDocument(
  agent: OpenId4VcAgent,
  signingCertificate: SigningCertificateHandle,
  role: SigningRole,
): Promise<string> {
  const did = agent.did
  if (!did) throw new Error('development signing key publication requires an agent DID')

  const resolution = await agent.dids.resolve(did).catch(() => {
    throw new Error('development signing key DID resolution failed')
  })
  if (resolution.didResolutionMetadata?.error || !resolution.didDocument) {
    throw new Error('development signing key DID resolution failed')
  }
  if (resolution.didDocument.id !== did) {
    throw new Error('development signing key DID resolution returned a different DID')
  }

  const methodId = `${did}#openid4vc-development-${role}`
  const purposes: DidPurpose[] = [role === 'issuer' ? 'assertionMethod' : 'authentication']
  const publicJwk = canonicalP256PublicJwk(signingCertificate.certificate.publicJwk.toJson())
  await ensureCreatedDidRecordKeyMapping(agent, did, methodId.slice(did.length), signingCertificate.keyId)
  const existingMethod = resolution.didDocument.verificationMethod?.find(method => method.id === methodId)
  const published = (purpose: DidPurpose) =>
    (resolution.didDocument?.[purpose] ?? []).some(
      method => (typeof method === 'string' ? method : method.id) === methodId,
    )
  if (
    existingMethod &&
    equalVerificationMethodJwk(existingMethod, publicJwk) &&
    purposes.every(published) &&
    contextValues(resolution.didDocument.context).includes(JSON_WEB_KEY_2020_CONTEXT)
  ) {
    return methodId
  }

  const didDocument = DidDocument.fromJSON(resolution.didDocument.toJSON())
  // A resolver that doesn't recognise JsonWebKey2020 rejects the method without this context, so it is
  // published alongside the type.
  didDocument.context = [...new Set([...contextValues(didDocument.context), JSON_WEB_KEY_2020_CONTEXT])]
  didDocument.verificationMethod = [
    ...(didDocument.verificationMethod ?? []).filter(method => method.id !== methodId),
    new VerificationMethod({
      id: methodId,
      type: 'JsonWebKey2020',
      publicKeyJwk: { ...publicJwk, kid: signingCertificate.keyId },
      controller: did,
    }),
  ]
  for (const purpose of purposes) {
    didDocument[purpose] = [
      ...(didDocument[purpose] ?? []).filter(
        method => (typeof method === 'string' ? method : method.id) !== methodId,
      ),
      methodId,
    ]
  }

  const update = await agent.dids.update({ did, didDocument }).catch(() => {
    throw new Error('development signing key DID update failed')
  })
  if (update.didState.state !== 'finished') {
    const reason = (update.didState as { reason?: string }).reason ?? 'unknown reason'
    throw new Error(`development signing key DID update failed: ${reason}`)
  }
  if (update.didState.did !== did || update.didState.didDocument.id !== did) {
    throw new Error('development signing key DID update returned a different DID')
  }

  return methodId
}

// Credo reads the KMS key-id mapping on the DidRecord, never the published `kid`, and registrars like
// did:webvh don't maintain it on update, so it is written here directly.
async function ensureCreatedDidRecordKeyMapping(
  agent: Pick<OpenId4VcAgent, 'context'>,
  did: string,
  didDocumentRelativeKeyId: string,
  kmsKeyId: string,
): Promise<void> {
  const agentContext = agent.context
  const didRepository = agentContext.dependencyManager.resolve(DidRepository)
  const didRecord = await didRepository.findCreatedDid(agentContext, did)
  if (!didRecord) throw new Error('development signing key DID record was not found')

  const keys = didRecord.keys ?? []
  if (
    keys.some(key => key.didDocumentRelativeKeyId === didDocumentRelativeKeyId && key.kmsKeyId === kmsKeyId)
  ) {
    return
  }

  didRecord.keys = [
    ...keys.filter(key => key.didDocumentRelativeKeyId !== didDocumentRelativeKeyId),
    { didDocumentRelativeKeyId, kmsKeyId },
  ]
  await didRepository.update(agentContext, didRecord)
}

async function loadConfiguredSigningCertificate(
  agent: OpenId4VcAgent,
  configured: OpenId4VcSigningOptions['configured'],
  publicApiBaseUrl: string | undefined,
  role: SigningRole,
): Promise<SigningCertificateHandle> {
  if (configured.certificateChain.length === 0) {
    throw new Error('configured certificate chain must not be empty')
  }

  const chain = configured.certificateChain.map(encoded => X509Certificate.fromEncodedCertificate(encoded))
  assertCertificateChainUsable(chain)
  const configuredChainEndpoint = configured.certificateChain[configured.certificateChain.length - 1]

  const validatedRootToLeafChain = await agent.x509.validateCertificateChain({
    certificateChain: configured.certificateChain,
    trustedCertificates: [configuredChainEndpoint],
    allowNonRootTrustedCertificate: true,
  })

  const validatedChain = [...validatedRootToLeafChain].reverse()
  if (
    validatedChain.length !== chain.length ||
    validatedChain.some((certificate, index) => !certificate.equal(chain[index]))
  ) {
    throw new Error('configured certificate chain must be ordered leaf-first')
  }

  const certificate = validatedChain[0]
  if (certificate.subject === certificate.issuer) {
    throw new Error('configured leaf certificate must not be self-signed')
  }
  if (role === 'issuer') assertCertificateSignsIssuedCredentials(certificate, publicApiBaseUrl)

  const privatePublicJwk = canonicalP256PublicJwk(configured.privateJwk)
  const certificatePublicJwk = canonicalP256PublicJwk(certificate.publicJwk.toJson())
  if (!equalPublicJwk(privatePublicJwk, certificatePublicJwk)) {
    throw new Error('configured private key does not match the leaf certificate')
  }

  const keyId = configured.privateJwk.kid ?? Kms.PublicJwk.fromPublicJwk(privatePublicJwk).legacyKeyId
  let storedPublicJwk: unknown

  try {
    storedPublicJwk = await agent.kms.getPublicKey({ keyId })
  } catch (error) {
    if (!(error instanceof Kms.KeyManagementKeyNotFoundError)) throw error

    const imported = await agent.kms.importKey({
      privateJwk: { ...configured.privateJwk, kid: keyId },
    })
    storedPublicJwk = imported.publicJwk
  }

  if (!equalPublicJwk(canonicalP256PublicJwk(storedPublicJwk), privatePublicJwk)) {
    throw new Error('stored KMS key does not match the configured private key')
  }

  certificate.keyId = keyId
  return { certificate, chain: validatedChain, keyId, development: false }
}

async function loadDevelopmentSigningCertificate(
  agent: OpenId4VcAgent,
  publicApiBaseUrl?: string,
  role: SigningRole = 'issuer',
): Promise<SigningCertificateHandle> {
  if (!agent.did || !tryParseDid(agent.did)) {
    throw new Error('development certificate mode requires an agent DID')
  }
  if (!publicApiBaseUrl) {
    throw new Error('development certificate mode requires publicApiBaseUrl')
  }

  const hostname = new URL(publicApiBaseUrl).hostname
  const commonName = developmentCommonName(hostname, role)
  const recordId = developmentRecordId(agent.did, hostname, role)
  const existing = await agent.genericRecords.findById(recordId)
  if (existing) {
    try {
      const stored = parseDevelopmentRecord(existing.content)
      const certificate = X509Certificate.fromEncodedCertificate(stored.certificate)
      assertCertificateChainUsable([certificate])
      assertDevelopmentCertificateIdentity(certificate, agent.did, hostname)

      const storedPublicJwk = await agent.kms.getPublicKey({ keyId: stored.keyId })
      if (
        !equalPublicJwk(
          canonicalP256PublicJwk(storedPublicJwk),
          canonicalP256PublicJwk(certificate.publicJwk.toJson()),
        )
      ) {
        throw new Error('stored development KMS key does not match its certificate')
      }

      certificate.keyId = stored.keyId
      return { certificate, chain: [certificate], keyId: stored.keyId, development: true }
    } catch (error) {
      if (error instanceof Kms.KeyManagementError && !(error instanceof Kms.KeyManagementKeyNotFoundError)) {
        throw error
      }
      await agent.genericRecords.deleteById(recordId)
    }
  }

  const { keyId, publicJwk } = await agent.kms.createKey({ type: { kty: 'EC', crv: 'P-256' } })
  const authorityKey = Kms.PublicJwk.fromPublicJwk(publicJwk)
  const now = new Date()
  const certificate = await agent.x509.createCertificate({
    serialNumber: createHash('sha256').update(keyId).digest('hex').slice(0, 32),
    authorityKey,
    issuer: { commonName },
    validity: {
      notBefore: new Date(now.getTime() - 60_000),
      notAfter: new Date(now.getTime() + DEVELOPMENT_CERTIFICATE_VALIDITY_MS),
    },
    extensions: {
      subjectKeyIdentifier: { include: true },
      authorityKeyIdentifier: { include: true },
      keyUsage: { usages: [X509KeyUsage.DigitalSignature] },
      basicConstraints: { ca: false },
      subjectAlternativeName: {
        name: [
          { type: 'url', value: agent.did },
          { type: 'dns', value: hostname },
        ],
      },
    },
  })

  certificate.keyId = keyId
  await agent.genericRecords.save({
    id: recordId,
    content: { certificate: certificate.toString('base64'), keyId },
  })

  return { certificate, chain: [certificate], keyId, development: true }
}

function assertCertificateChainUsable(chain: X509Certificate[], now = new Date()): void {
  for (const certificate of chain) {
    if (certificate.data.notAfter.getTime() < now.getTime()) {
      throw new Error('certificate chain contains an expired certificate')
    }
    if (certificate.data.notBefore.getTime() > now.getTime()) {
      throw new Error('certificate chain contains a certificate that is not yet valid')
    }
  }
}

// Credo matches the `iss` of an issued credential against the leaf SANs on both sign and verify, exactly: a
// wildcard or parent-domain SAN passes startup and then fails every redemption.
function assertCertificateSignsIssuedCredentials(
  certificate: X509Certificate,
  publicApiBaseUrl: string | undefined,
): void {
  if (!publicApiBaseUrl) {
    throw new Error('configured issuer certificate mode requires publicApiBaseUrl')
  }

  const hostname = new URL(publicApiBaseUrl).hostname
  if (certificate.sanUriNames.includes(publicApiBaseUrl) || certificate.sanDnsNames.includes(hostname)) {
    return
  }

  throw new Error(
    `configured issuer certificate must carry '${publicApiBaseUrl}' as a URI SAN or '${hostname}' as a DNS SAN`,
  )
}

function assertDevelopmentCertificateIdentity(
  certificate: X509Certificate,
  expectedDid: string,
  expectedHostname: string,
): void {
  if (certificate.subject !== certificate.issuer) {
    throw new Error('stored development certificate is not self-signed')
  }
  if (didFromValidatedCertificate(certificate) !== expectedDid) {
    throw new Error('stored development certificate DID does not match the agent DID')
  }
  if (!certificate.sanDnsNames.includes(expectedHostname)) {
    throw new Error('stored development certificate DNS SAN does not match publicApiBaseUrl')
  }
}

function canonicalP256PublicJwk(jwk: unknown): Kms.KmsJwkPublicEc & { crv: 'P-256' } {
  if (!isRecord(jwk)) throw new Error('certificate signing key must be a P-256 key')
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string') {
    throw new Error('certificate signing key must be a P-256 key')
  }

  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }
}

function equalPublicJwk(left: Kms.KmsJwkPublicEc, right: Kms.KmsJwkPublicEc): boolean {
  return left.kty === right.kty && left.crv === right.crv && left.x === right.x && left.y === right.y
}

function contextValues(context: string | string[] | undefined): string[] {
  if (!context) return []
  return Array.isArray(context) ? context : [context]
}

function equalVerificationMethodJwk(method: VerificationMethod, expected: Kms.KmsJwkPublicEc): boolean {
  try {
    return equalPublicJwk(canonicalP256PublicJwk(method.publicKeyJwk), expected)
  } catch {
    return false
  }
}

function developmentCommonName(hostname: string, role: SigningRole): string {
  return `${hostname} ${role}`
}

function developmentRecordId(did: string, hostname: string, role: SigningRole): string {
  const suffix = createHash('sha256').update(`${did}\0${hostname}\0${role}`).digest('hex')
  return `${DEVELOPMENT_RECORD_PREFIX}:${suffix}`
}

function parseDevelopmentRecord(content: Record<string, unknown>): DevelopmentCertificateRecord {
  if (typeof content.certificate !== 'string' || typeof content.keyId !== 'string') {
    throw new Error('stored development certificate record is invalid')
  }

  return { certificate: content.certificate, keyId: content.keyId }
}

// HAIP forbids the trust anchor inside `x5c`, so a configured chain drops its self-signed root.
export function x5cCertificateChain(signingCertificate: SigningCertificateHandle): X509Certificate[] {
  if (signingCertificate.development) return signingCertificate.chain

  return signingCertificate.chain.filter(
    (certificate, index, chain) => index !== chain.length - 1 || certificate.subject !== certificate.issuer,
  )
}
