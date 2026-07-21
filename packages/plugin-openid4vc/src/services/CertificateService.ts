import type { OpenId4VcSigningOptions } from '../types'

import { type BaseAgent, Kms, tryParseDid, X509Certificate, X509KeyUsage } from '@credo-ts/core'
import { createHash } from 'node:crypto'

const DEVELOPMENT_CERTIFICATE_VALIDITY_MS = 365 * 24 * 60 * 60 * 1_000
const DEVELOPMENT_RECORD_PREFIX = 'openid4vc-development-signing'
type SigningRole = 'issuer' | 'verifier'

type CertificateAgent = Pick<BaseAgent, 'genericRecords' | 'kms' | 'x509'> & {
  did?: string
  publicApiBaseUrl?: string
}

interface DevelopmentCertificateRecord {
  certificate: string
  keyId: string
}

export interface SigningCertificateHandle {
  certificate: X509Certificate
  chain: X509Certificate[]
  keyId: string
  development: boolean
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
