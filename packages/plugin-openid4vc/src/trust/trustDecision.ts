import type { PresentationDecision } from '../services/presentationVerification'
import type { DidResolverAgent } from './keyBinding'
import type { TrustEvidence, TrustVerdictName } from './types'
import type { SdJwtVc } from '@credo-ts/core'
import type { DidTrustResolver } from '@verana-labs/vs-agent-sdk'

import { getPublicJwkFromVerificationMethod, Kms, tryParseDid } from '@credo-ts/core'
import {
  AnonCredsTrustError,
  AnonCredsTrustErrorReason,
  digestOfBytes,
  getDidWebHttpsBaseUrl,
  ParticipantRole,
  TrustErrorCode,
} from '@verana-labs/vs-agent-sdk'

import { isReservedClaimName } from '../config'
import { didFromValidatedCertificate } from '../services/CertificateService'
import { isRecord } from '../utils/isRecord'

import { boundVerificationMethod, resolveDidDocument, withTimeout } from './keyBinding'

/** The Verifiable Trust resolution reads the DID Document, its linked VPs and the VPR; 5 s is too tight. */
const TRUST_RESOLUTION_TIMEOUT_MS = 15_000

// verre answers these codes for a read that failed, not for a rule the DID broke.
const UNAVAILABLE_RESOLUTION_CODES: readonly TrustErrorCode[] = [
  TrustErrorCode.INVALID,
  TrustErrorCode.INVALID_REQUEST,
]

/** What the verification session stored when it created the request ([VSA-ADM-OID-PR-CREATE]). */
export interface PresentationTrustRequest {
  jsonSchemaCredentialId: string
  credentialSchemaId: number
}

export interface PresentationTrustDependencies {
  agent: DidResolverAgent
  /** Reads the Type Metadata document at a `vct`, under the network boundary of step 3. */
  readTypeMetadata: (vct: string) => Promise<Uint8Array>
  /** Step 7: the Verifiable Trust resolution of a DID, the one the agent applies to a DIDComm peer. */
  resolveDidTrust: DidTrustResolver
  /** Step 7: the ISSUER `Participant` check of the agent; throws an `AnonCredsTrustError` otherwise. */
  assertAuthorized: (options: {
    did: string
    role: ParticipantRole
    credentialSchemaId: number
  }) => Promise<void>
}

/**
 * [VSA-VTI-FLOW-VERIFY-OID] steps 2 to 8 on a credential that passed step 1: credo verified the
 * response, the holder binding, the disclosures, the signature, the validity period and the `status`
 * claim (step 6) before the session reached `ResponseVerified`. Every step fails closed. A step the
 * agent cannot complete answers `RESOLVER_UNAVAILABLE`, which the caller never stores, so the next
 * read retries it.
 */
export async function decidePresentationTrust(
  credential: SdJwtVc,
  request: PresentationTrustRequest,
  dependencies: PresentationTrustDependencies,
): Promise<PresentationDecision> {
  const evidence: TrustEvidence = {
    did: null,
    trustStatus: null,
    jsonSchemaCredentialId: request.jsonSchemaCredentialId,
    credentialSchemaId: request.credentialSchemaId,
    authorized: null,
    queries: [],
  }
  const verdict = await runSteps(credential, request, dependencies, evidence)
  return {
    cryptographicVerified: true,
    accepted: verdict === 'TRUSTED_AUTHORIZED',
    trust: { verdict, evidence },
    credential: presentedCredential(credential),
  }
}

class StepFailure extends Error {
  public constructor(
    public readonly verdict: TrustVerdictName,
    note: string,
  ) {
    super(note)
    this.name = 'StepFailure'
  }
}

async function runSteps(
  credential: SdJwtVc,
  request: PresentationTrustRequest,
  dependencies: PresentationTrustDependencies,
  evidence: TrustEvidence,
): Promise<TrustVerdictName> {
  try {
    const did = issuerDidOf(credential)
    evidence.did = did
    await assertIssuerKeyBound(credential, did, dependencies, evidence)
    await assertTypeMetadataBound(credential, request.jsonSchemaCredentialId, dependencies, evidence)
    await assertIssuerTrusted(did, dependencies, evidence)
    await assertIssuerAuthorized(did, request.credentialSchemaId, dependencies, evidence)
    return 'TRUSTED_AUTHORIZED'
  } catch (error) {
    if (!(error instanceof StepFailure)) throw error
    evidence.note = error.message
    return error.verdict
  }
}

// Step 2, [VT-CRED-SDJWT-6]: `iss` when it is a DID, else the URI SAN of the leaf of `x5c`.
function issuerDidOf(credential: SdJwtVc): string {
  const issuer = credential.issuer
  if (issuer.method === 'did')
    return tryParseDid(issuer.didUrl)?.did ?? fail('UNTRUSTED', 'the issuer DID URL is no DID')
  const fromIss =
    typeof credential.payload.iss === 'string' ? tryParseDid(credential.payload.iss)?.did : undefined
  if (fromIss) return fromIss
  try {
    return didFromValidatedCertificate(issuer.x5c[0])
  } catch {
    return fail(
      'UNTRUSTED',
      'the credential carries no DID in iss nor in the URI SAN of its leaf certificate',
    )
  }
}

// Steps 3 and 4: a well-formed did:web or did:webvh, resolved under the network boundary, whose
// DID Document authorizes the issuer key under assertionMethod.
async function assertIssuerKeyBound(
  credential: SdJwtVc,
  did: string,
  dependencies: PresentationTrustDependencies,
  evidence: TrustEvidence,
): Promise<void> {
  if (!isDidWeb(did)) fail('UNTRUSTED', `the issuer DID "${did}" is no did:web nor did:webvh`)

  evidence.queries.push(`resolve ${did}`)
  const didDocument = await resolveDidDocument(dependencies.agent, did)
  if (didDocument === 'unresolvable') {
    fail('RESOLVER_UNAVAILABLE', `the issuer DID "${did}" could not be resolved`)
  }
  if (didDocument === 'other-id') {
    fail('UNTRUSTED', `the DID Document of the issuer DID "${did}" carries another id`)
  }

  const issuer = credential.issuer
  let issuerKey: Kms.PublicJwk
  if (issuer.method === 'x5c') {
    issuerKey = issuer.x5c[0].publicJwk
  } else {
    try {
      issuerKey = getPublicJwkFromVerificationMethod(didDocument.dereferenceVerificationMethod(issuer.didUrl))
    } catch {
      return fail('UNTRUSTED', `the issuer DID Document names no key at "${issuer.didUrl}"`)
    }
  }

  if (!boundVerificationMethod(didDocument, issuerKey, ['assertionMethod'])) {
    fail('UNTRUSTED', `the issuer DID Document does not authorize the signing key under assertionMethod`)
  }
}

// Step 5, [VT-CRED-SDJWT-3] and [VT-CRED-SDJWT-4]: the Type Metadata document at `vct` hashes to
// `vct#integrity` and names the VTJSC of the request.
async function assertTypeMetadataBound(
  credential: SdJwtVc,
  jsonSchemaCredentialId: string,
  dependencies: PresentationTrustDependencies,
  evidence: TrustEvidence,
): Promise<void> {
  const { vct, 'vct#integrity': integrity } = credential.payload
  if (typeof vct !== 'string') fail('UNTRUSTED', 'the credential carries no vct')
  if (typeof integrity !== 'string') fail('UNTRUSTED', 'the credential carries no vct#integrity')

  evidence.queries.push(`GET ${vct}`)
  let document: Uint8Array
  try {
    document = await dependencies.readTypeMetadata(vct)
  } catch (error) {
    return fail(
      'RESOLVER_UNAVAILABLE',
      `the Type Metadata at "${vct}" could not be read: ${messageOf(error)}`,
    )
  }
  if (digestOfBytes(document) !== integrity) {
    fail('UNTRUSTED', `the Type Metadata at "${vct}" does not hash to the vct#integrity of the credential`)
  }

  const related = relatedJsonSchemaCredentialIdOf(document)
  if (related !== jsonSchemaCredentialId) {
    fail(
      'UNTRUSTED',
      `the Type Metadata at "${vct}" names the VTJSC "${related}", not "${jsonSchemaCredentialId}"`,
    )
  }
}

// Step 7, first half: the Verifiable Trust resolution answers TRUSTED for the issuer DID.
async function assertIssuerTrusted(
  did: string,
  dependencies: PresentationTrustDependencies,
  evidence: TrustEvidence,
): Promise<void> {
  evidence.queries.push(`resolveDID ${did}`)
  let resolution: Awaited<ReturnType<DidTrustResolver>>
  try {
    resolution = await withTimeout(
      dependencies.resolveDidTrust(did),
      TRUST_RESOLUTION_TIMEOUT_MS,
      'the trust resolution timed out',
    )
  } catch (error) {
    return fail('RESOLVER_UNAVAILABLE', `the trust resolution of "${did}" failed: ${messageOf(error)}`)
  }
  if (resolution.trusted) {
    evidence.trustStatus = 'TRUSTED'
    return
  }
  // verre does not throw when a registry or an endpoint does not answer: the outcome is INVALID
  // with a code of a failed read, and the next read of the session retries it
  if (resolution.errorCode && UNAVAILABLE_RESOLUTION_CODES.includes(resolution.errorCode)) {
    fail(
      'RESOLVER_UNAVAILABLE',
      `the trust resolution of "${did}" could not complete: ${resolution.errorMessage ?? resolution.errorCode}`,
    )
  }
  evidence.trustStatus = 'UNTRUSTED'
  fail(
    'UNTRUSTED',
    `the trust resolution of "${did}" answered UNTRUSTED${resolution.errorMessage ? `: ${resolution.errorMessage}` : ''}`,
  )
}

// Step 7, second half: an active ISSUER Participant of the issuer DID for the CredentialSchema.
async function assertIssuerAuthorized(
  did: string,
  credentialSchemaId: number,
  dependencies: PresentationTrustDependencies,
  evidence: TrustEvidence,
): Promise<void> {
  evidence.queries.push(`listParticipants did=${did} role=ISSUER schema_id=${credentialSchemaId}`)
  try {
    await dependencies.assertAuthorized({ did, role: ParticipantRole.Issuer, credentialSchemaId })
  } catch (error) {
    if (!(error instanceof AnonCredsTrustError)) throw error
    if (error.reason === AnonCredsTrustErrorReason.NotAuthorized) {
      evidence.authorized = false
      fail('TRUSTED_NOT_AUTHORIZED', error.message)
    }
    fail('RESOLVER_UNAVAILABLE', error.message)
  }
  evidence.authorized = true
}

function presentedCredential(credential: SdJwtVc): NonNullable<PresentationDecision['credential']> {
  const disclosedClaims = Object.fromEntries(
    Object.entries(credential.prettyClaims).filter(([name]) => !isReservedClaimName(name)),
  )
  return { vct: String(credential.payload.vct), disclosedClaims }
}

function isDidWeb(did: string): boolean {
  try {
    return getDidWebHttpsBaseUrl(did) !== undefined
  } catch {
    return false
  }
}

function relatedJsonSchemaCredentialIdOf(document: Uint8Array): string | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(document).toString('utf8'))
    return isRecord(parsed) && typeof parsed.relatedJsonSchemaCredentialId === 'string'
      ? parsed.relatedJsonSchemaCredentialId
      : undefined
  } catch {
    return undefined
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function fail(verdict: TrustVerdictName, note: string): never {
  throw new StepFailure(verdict, note)
}
