import type { OpenId4VcSigningOptions } from '../types'
import type { BaseAgent, DidPurpose } from '@credo-ts/core'

import {
  AgentContext,
  DidDocument,
  DidRepository,
  Kms,
  tryParseDid,
  VerificationMethod,
  X509Certificate,
  X509KeyUsage,
} from '@credo-ts/core'
import { createHash } from 'node:crypto'

const DEVELOPMENT_CERTIFICATE_VALIDITY_MS = 365 * 24 * 60 * 60 * 1_000
const DEVELOPMENT_RECORD_PREFIX = 'openid4vc-development-signing'
const JSON_WEB_KEY_2020_CONTEXT = 'https://w3id.org/security/suites/jws-2020/v1'
export type SigningRole = 'issuer' | 'verifier'

type CertificateAgent = Pick<BaseAgent, 'genericRecords' | 'kms' | 'x509'> & {
  did?: string
  publicApiBaseUrl?: string
}

interface DevelopmentCertificateRecord {
  certificate: string
  keyId: string
}

export interface SigningCertificateInfo {
  role: SigningRole
  development: boolean
  /** SHA256:<hex> of the leaf, the pin format of trust.developmentCertificateFingerprints. */
  fingerprint: string
  /** Base64 DER, leaf first. */
  certificateChain: string[]
}

export function signingCertificateInfo(
  role: SigningRole,
  handle: SigningCertificateHandle,
): SigningCertificateInfo {
  const digest = createHash('sha256').update(handle.certificate.rawCertificate).digest('hex')
  return {
    role,
    development: handle.development,
    fingerprint: `SHA256:${digest}`,
    certificateChain: handle.chain.map(certificate => certificate.toString('base64')),
  }
}

export interface SigningCertificateHandle {
  certificate: X509Certificate
  chain: X509Certificate[]
  keyId: string
  development: boolean
}

type DevelopmentDidAgent = {
  did?: string
  dids: Pick<BaseAgent['dids'], 'resolve' | 'update'>
  dependencyManager: BaseAgent['dependencyManager']
}

export async function loadSigningCertificate(
  agent: CertificateAgent,
  signing: OpenId4VcSigningOptions,
  publicApiBaseUrl = agent.publicApiBaseUrl,
  role: SigningRole = 'issuer',
): Promise<SigningCertificateHandle> {
  if (signing.configured) {
    return await loadConfiguredSigningCertificate(agent, signing.configured)
  }

  return await loadDevelopmentSigningCertificate(agent, signing.development, publicApiBaseUrl, role)
}

export function didFromValidatedCertificate(certificate: X509Certificate): string {
  const did = certificate.sanUriNames.map(uri => tryParseDid(uri)?.did).find(value => value !== undefined)
  if (!did) {
    throw new Error('certificate does not contain a DID URI SAN')
  }

  return did
}

/**
 * `extraPurposes` exists because Credo signs credential issuer metadata through the DID's
 * `authentication` relationship, while an issuer key otherwise only needs `assertionMethod`.
 * An issuer configured to sign its metadata with its DID has to publish under both.
 */
export async function publishDevelopmentSigningKey(
  agent: DevelopmentDidAgent,
  signingCertificate: SigningCertificateHandle,
  role: SigningRole,
  extraPurposes: DidPurpose[] = [],
): Promise<void> {
  if (!signingCertificate.development) return

  const did = agent.did
  if (!did) throw new Error('development signing key publication requires an agent DID')

  let resolution
  try {
    resolution = await agent.dids.resolve(did)
  } catch {
    throw new Error('development signing key DID resolution failed')
  }
  if (resolution.didResolutionMetadata?.error || !resolution.didDocument) {
    throw new Error('development signing key DID resolution failed')
  }
  if (resolution.didDocument.id !== did) {
    throw new Error('development signing key DID resolution returned a different DID')
  }

  const methodId = `${did}#openid4vc-development-${role}`
  const basePurpose: DidPurpose = role === 'issuer' ? 'assertionMethod' : 'authentication'
  const purposes = [...new Set<DidPurpose>([basePurpose, ...extraPurposes])]
  const publicJwk = canonicalP256PublicJwk(signingCertificate.certificate.publicJwk.toJson())
  await ensureCreatedDidRecordKeyMapping(agent, did, methodId, signingCertificate.keyId)
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
    return
  }

  const didDocument = DidDocument.fromJSON(resolution.didDocument.toJSON())
  didDocument.context = [
    ...new Set([...contextValues(didDocument.context), JSON_WEB_KEY_2020_CONTEXT]),
  ]
  didDocument.verificationMethod = [
    ...(didDocument.verificationMethod ?? []).filter(method => method.id !== methodId),
    new VerificationMethod({
      id: methodId,
      type: 'JsonWebKey2020',
      // The kid ties the published method back to the KMS key. Without it Credo derives a
      // legacy key id from the JWK when signing through the DID, which no backend holds.
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

  let update
  try {
    update = await agent.dids.update({ did, didDocument })
  } catch {
    throw new Error('development signing key DID update failed')
  }
  if (update.didState.state !== 'finished') {
    throw new Error('development signing key DID update failed')
  }
  if (update.didState.did !== did || update.didState.didDocument.id !== did) {
    throw new Error('development signing key DID update returned a different DID')
  }
}

/**
 * Credo signs "through the DID" by mapping the verification method to a KMS key via the created
 * DidRecord's `keys` entries (`didDocumentRelativeKeyId` → `kmsKeyId`) — the `kid` published in the
 * DID document is never consulted, and the fallback is a legacy base58 key id no Askar backend
 * holds. Registrars do not maintain that mapping on `dids.update` (did:webvh drops `options.keys`
 * entirely), so record it on the DidRecord directly — also when the method itself is already
 * published, which repairs documents written by earlier builds.
 */
async function ensureCreatedDidRecordKeyMapping(
  agent: DevelopmentDidAgent,
  did: string,
  methodId: string,
  kmsKeyId: string,
): Promise<void> {
  const agentContext = agent.dependencyManager.resolve(AgentContext)
  const didRepository = agent.dependencyManager.resolve(DidRepository)
  const didRecord = await didRepository.findCreatedDid(agentContext, did)
  if (!didRecord) throw new Error('development signing key DID record was not found')

  const didDocumentRelativeKeyId = methodId.slice(did.length)
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
  agent: CertificateAgent,
  configured: NonNullable<OpenId4VcSigningOptions['configured']>,
): Promise<SigningCertificateHandle> {
  if (configured.certificateChain.length === 0) {
    throw new Error('configured certificate chain must not be empty')
  }

  const chain = configured.certificateChain.map(encoded => X509Certificate.fromEncodedCertificate(encoded))
  assertCertificateChainUsable(chain)
  const configuredChainEndpoint = configured.certificateChain[configured.certificateChain.length - 1]

  // This trust endpoint is operator-configured signing material, never a peer-provided chain.
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
  agent: CertificateAgent,
  development: NonNullable<OpenId4VcSigningOptions['development']>,
  publicApiBaseUrl?: string,
  role: SigningRole = 'issuer',
): Promise<SigningCertificateHandle> {
  if (development.enabled !== true) {
    throw new Error('development certificate mode must be explicitly enabled')
  }
  if (!agent.did || !tryParseDid(agent.did)) {
    throw new Error('development certificate mode requires an agent DID')
  }
  if (!publicApiBaseUrl) {
    throw new Error('development certificate mode requires publicApiBaseUrl')
  }

  const hostname = hostnameFromPublicApiBaseUrl(publicApiBaseUrl)
  const recordId = developmentRecordId(agent.did, hostname, development.commonName, role)
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
      // A KMS backend fault is not stale state: recreating on it would rotate a
      // healthy certificate and break fingerprints pinned by verifiers.
      if (error instanceof Kms.KeyManagementError && !(error instanceof Kms.KeyManagementKeyNotFoundError)) {
        throw error
      }
      // Development certificates are disposable. An expired certificate, an
      // identity that no longer matches the DID or host, or a key id no KMS
      // backend holds (records written by older builds) must not wedge the
      // agent: drop the record and mint a fresh certificate below.
      await agent.genericRecords.deleteById(recordId)
    }
  }

  const { keyId, publicJwk } = await agent.kms.createKey({ type: { kty: 'EC', crv: 'P-256' } })
  const authorityKey = Kms.PublicJwk.fromPublicJwk(publicJwk)
  const now = new Date()
  const certificate = await agent.x509.createCertificate({
    serialNumber: createHash('sha256').update(keyId).digest('hex').slice(0, 32),
    authorityKey,
    issuer: { commonName: development.commonName },
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

export function assertCertificateChainUsable(chain: X509Certificate[], now = new Date()): void {
  for (const certificate of chain) {
    if (certificate.data.notAfter.getTime() < now.getTime()) {
      throw new Error('certificate chain contains an expired certificate')
    }
    if (certificate.data.notBefore.getTime() > now.getTime()) {
      throw new Error('certificate chain contains a certificate that is not yet valid')
    }
  }
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

function hostnameFromPublicApiBaseUrl(publicApiBaseUrl: string): string {
  try {
    const hostname = new URL(publicApiBaseUrl).hostname
    if (!hostname) throw new Error()
    return hostname
  } catch {
    throw new Error('development certificate mode requires a valid publicApiBaseUrl')
  }
}

function developmentRecordId(did: string, hostname: string, commonName: string, role: SigningRole): string {
  const suffix = createHash('sha256').update(`${did}\0${hostname}\0${commonName}\0${role}`).digest('hex')
  return `${DEVELOPMENT_RECORD_PREFIX}:${suffix}`
}

function parseDevelopmentRecord(content: Record<string, unknown>): DevelopmentCertificateRecord {
  if (typeof content.certificate !== 'string' || typeof content.keyId !== 'string') {
    throw new Error('stored development certificate record is invalid')
  }

  return { certificate: content.certificate, keyId: content.keyId }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
