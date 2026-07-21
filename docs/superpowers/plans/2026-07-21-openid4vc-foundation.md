# OpenID4VC Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure, configurable SD-JWT VC issuer and verifier plugin to VS Agent using OpenID4VCI and OpenID4VP, with fail-closed Verana authorization and no production holder API.

**Architecture:** One `OpenId4VcPlugin` instance owns the Credo modules, authenticated NestJS control-plane controllers, and public Express protocol router. Configured X.509 chains authenticate protocol parties, DID-document key binding authenticates the DID asserted in a URI SAN, and the Verana resolver makes the final trust and schema-authorization decision.

**Tech Stack:** TypeScript, NestJS 10, Express 4, Credo `0.7.1-pr-2704-20260630143332`, `@credo-ts/openid4vc`, `@credo-ts/core` X.509/KMS modules, Vitest, pnpm, Docker.

## Global Constraints

- Base all work on `origin/main` commit `a56bc20` or a newer fetched `origin/main`; never modify the dirty `feature/openid4vc-plugin` checkout.
- Ship issuer and verifier capabilities only. A holder may exist only in test helpers.
- Emit `dc+sd-jwt`; do not emit legacy `vc+sd-jwt`.
- Public routes are limited to wallet-facing OpenID4VC protocol and metadata endpoints.
- Offer creation, presentation request creation, and result access use existing VS Agent admin routing and authentication boundaries.
- Never accept the certificate chain supplied by the peer as its own trust anchor.
- Only a validated or explicitly pinned certificate may supply a DID from a URI SAN.
- The certificate signing key must be bound to the asserted DID document before querying Verana authorization.
- Resolver failures, timeouts, malformed responses, untrusted DIDs, and unauthorized DIDs all fail closed.
- Wallet attestation metadata is absent unless attestation certificate validation is configured.
- Do not add W3C VCDM, mdoc, revocation, authorization-code issuance, an embedded CA, or production holder routes.
- Preserve the six unrelated `apps/vs-agent/tests/trustService.test.ts` JSON-LD context failures as the recorded upstream baseline.
- Do not push or open the draft pull request until Maxime reviews the implementation, verification evidence, title, and body.

---

## File Structure

### New plugin package

- `packages/plugin-openid4vc/package.json`: package metadata and pinned dependencies.
- `packages/plugin-openid4vc/tsconfig.json`: test-time TypeScript configuration.
- `packages/plugin-openid4vc/tsconfig.build.json`: publishable source build.
- `packages/plugin-openid4vc/vitest.config.ts`: serial Credo integration tests with Askar setup.
- `packages/plugin-openid4vc/src/index.ts`: public exports only.
- `packages/plugin-openid4vc/src/types.ts`: configuration and result contracts.
- `packages/plugin-openid4vc/src/config.ts`: fail-fast configuration validation and claim parsing.
- `packages/plugin-openid4vc/src/sdk/setupOpenId4Vc.ts`: Credo OpenID4VC/X.509 module and public router construction.
- `packages/plugin-openid4vc/src/nestjs/OpenId4VcPlugin.ts`: single plugin lifecycle and dependency wiring.
- `packages/plugin-openid4vc/src/nestjs/IssuerController.ts`: authenticated issuance control plane.
- `packages/plugin-openid4vc/src/nestjs/VerifierController.ts`: authenticated presentation control plane.
- `packages/plugin-openid4vc/src/nestjs/dto.ts`: validated controller DTOs.
- `packages/plugin-openid4vc/src/services/CertificateService.ts`: configured key import, certificate parsing, and explicit development certificate handling.
- `packages/plugin-openid4vc/src/services/IssuerService.ts`: issuer registration, offers, and SD-JWT mapping.
- `packages/plugin-openid4vc/src/services/VerifierService.ts`: DCQL requests and verified result evaluation.
- `packages/plugin-openid4vc/src/trust/CertificateTrust.ts`: trust-anchor selection and URI SAN extraction.
- `packages/plugin-openid4vc/src/trust/TrustClient.ts`: timeout-bounded Verana resolver client.
- `packages/plugin-openid4vc/src/trust/keyBinding.ts`: certificate-public-key to DID-document binding.
- `packages/plugin-openid4vc/src/trust/types.ts`: fail-closed verdict and evidence types.
- `packages/plugin-openid4vc/src/trust/verdict.ts`: pure verdict mapping.
- `packages/plugin-openid4vc/tests/**`: unit, integration, and security regression tests.
- `packages/plugin-openid4vc/README.md`: operator-facing plugin documentation.

### Existing integration points

- `packages/agent-sdk/src/types.ts`: asynchronous initialization and public middleware hooks.
- `apps/vs-agent/src/utils/pluginLifecycle.ts`: pure helpers that reuse one plugin instance across Credo, NestJS, and Express.
- `apps/vs-agent/src/utils/setupAgent.ts`: consume Credo modules from the already-created plugin list.
- `apps/vs-agent/src/main.ts`: load optional modules once, initialize before listening, and mount public middleware.
- `apps/vs-agent/src/config/openid4vc.ts`: load and validate structured plugin configuration from `OID4VC_CONFIG_FILE`.
- `apps/vs-agent/src/config/constants.ts`: expose only the config-file path and advertise the plugin name.
- `apps/vs-agent/package.json`: optional dependency on the new package.
- `apps/vs-agent/Dockerfile`: OpenID4VC build and runtime target.
- `.github/workflows/ci.yml`: build the new Docker target.
- `README.md` and `apps/vs-agent/README.md`: plugin selection and runtime configuration.
- `docs/openid4vc-w3c-follow-up.md`: bounded W3C VCDM and other deferred work.

---

### Task 1: Package scaffold and typed configuration

**Files:**

- Create: `packages/plugin-openid4vc/package.json`
- Create: `packages/plugin-openid4vc/tsconfig.json`
- Create: `packages/plugin-openid4vc/tsconfig.build.json`
- Create: `packages/plugin-openid4vc/vitest.config.ts`
- Create: `packages/plugin-openid4vc/src/types.ts`
- Create: `packages/plugin-openid4vc/src/config.ts`
- Create: `packages/plugin-openid4vc/tests/config.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Produces: `OpenId4VcPluginOptions`, `OpenId4VcCredentialConfiguration`, `OpenId4VcVerifierPolicy`, `OpenId4VcSigningOptions`, `validateOpenId4VcOptions()`, `findCredentialConfiguration()`, `findVerifierPolicy()`, and `parseOfferClaims()`.
- Consumes: `Kms.KmsJwkPrivateEc` from `@credo-ts/core` for P-256 private signing keys.

- [ ] **Step 1: Write configuration tests first**

Create `packages/plugin-openid4vc/tests/config.test.ts` with fixtures covering one valid issuer/verifier configuration and these explicit failures: neither role enabled, non-HTTPS public URL outside test mode, duplicate credential IDs, non-`dc+sd-jwt` format, empty claims, disclosure outside the claim allowlist, invalid TTL, unknown policy configuration, missing verifier trust anchors, wallet attestation required without attestation anchors, and both configured and development signing modes selected.

```ts
import { describe, expect, it } from 'vitest'

import { parseOfferClaims, validateOpenId4VcOptions } from '../src/config'
import type { OpenId4VcPluginOptions } from '../src/types'

const validOptions = (): OpenId4VcPluginOptions => ({
  publicApiBaseUrl: 'https://agent.example',
  issuer: {
    id: 'issuer',
    displayName: 'Example Issuer',
    signing: { development: { enabled: true, commonName: 'Example Issuer' } },
  },
  verifier: {
    id: 'verifier',
    displayName: 'Example Verifier',
    signing: { development: { enabled: true, commonName: 'Example Verifier' } },
  },
  trust: {
    resolverUrl: 'https://resolver.example/v1/trust',
    timeoutMs: 5_000,
    credentialIssuerCertificates: ['MIIB-test-root'],
  },
  credentialConfigurations: [
    {
      id: 'employee',
      format: 'dc+sd-jwt',
      vct: 'https://agent.example/oid4vc/vct/employee',
      name: 'Employee credential',
      vtjscId: 'https://agent.example/vt/employee.json',
      claims: ['name', 'role'],
      disclosureFrame: ['name', 'role'],
      ttlSeconds: 3_600,
    },
  ],
  verifierPolicies: [
    { id: 'employee-check', credentialConfigurationId: 'employee', requestedClaims: ['name'] },
  ],
})

describe('validateOpenId4VcOptions', () => {
  it('accepts a valid issuer and verifier configuration', () => {
    expect(() => validateOpenId4VcOptions(validOptions())).not.toThrow()
  })

  it('rejects a plugin with no capability', () => {
    const options = validOptions()
    delete options.issuer
    delete options.verifier
    expect(() => validateOpenId4VcOptions(options)).toThrow('issuer or verifier')
  })

  it('rejects verifier mode without credential issuer trust anchors', () => {
    const options = validOptions()
    options.trust!.credentialIssuerCertificates = []
    expect(() => validateOpenId4VcOptions(options)).toThrow('credentialIssuerCertificates')
  })
})

describe('parseOfferClaims', () => {
  it('returns only allowed, non-empty claims', () => {
    const config = validOptions().credentialConfigurations[0]
    expect(parseOfferClaims(config, { name: 'Ada', role: 'engineer' })).toEqual({
      name: 'Ada',
      role: 'engineer',
    })
  })

  it('rejects missing and unknown claims', () => {
    const config = validOptions().credentialConfigurations[0]
    expect(() => parseOfferClaims(config, { name: 'Ada' })).toThrow("claim 'role'")
    expect(() => parseOfferClaims(config, { name: 'Ada', role: 'engineer', admin: true })).toThrow(
      "unknown claim 'admin'",
    )
  })
})
```

- [ ] **Step 2: Run the focused test and verify red**

Run: `pnpm --filter @verana-labs/vs-agent-plugin-openid4vc test -- config.test.ts`

Expected: FAIL because the package and configuration modules do not exist.

- [ ] **Step 3: Add the package and exact public configuration types**

Pin `@credo-ts/openid4vc` to `0.7.1-pr-2704-20260630143332`, use Express `^4.18.1`, and match the scripts and exports in `packages/plugin-mrtd/package.json`. Add the same OpenID4VC version to root `resolutions` and `pnpm.overrides`.

Define these contracts in `src/types.ts`:

```ts
import type { Kms } from '@credo-ts/core'

export interface OpenId4VcConfiguredSigningMaterial {
  certificateChain: string[]
  privateJwk: Kms.KmsJwkPrivateEc
}

export type OpenId4VcSigningOptions =
  | { configured: OpenId4VcConfiguredSigningMaterial; development?: never }
  | { configured?: never; development: { enabled: true; commonName: string } }

export interface OpenId4VcCredentialConfiguration {
  id: string
  format: 'dc+sd-jwt'
  vct: string
  name: string
  description?: string
  vtjscId: string
  claims: string[]
  disclosureFrame: string[]
  ttlSeconds: number
}

export interface OpenId4VcVerifierPolicy {
  id: string
  credentialConfigurationId: string
  requestedClaims: string[]
}

export interface OpenId4VcPluginOptions {
  publicApiBaseUrl: string
  issuer?: {
    id: string
    displayName: string
    signing: OpenId4VcSigningOptions
    requireWalletAttestation?: boolean
    walletAttestationCertificates?: string[]
  }
  verifier?: {
    id: string
    displayName: string
    signing: OpenId4VcSigningOptions
  }
  trust?: {
    resolverUrl: string
    timeoutMs: number
    credentialIssuerCertificates: string[]
    developmentCertificateFingerprints?: string[]
  }
  credentialConfigurations: OpenId4VcCredentialConfiguration[]
  verifierPolicies: OpenId4VcVerifierPolicy[]
}
```

Implement validation with these exact bounds: HTTPS public and resolver URLs unless `NODE_ENV === 'test'`; TTL from 60 through 31,536,000 seconds; unique non-empty IDs; HTTP(S) `vct` and `vtjscId`; non-empty unique claims; disclosure and requested claims must be subsets of configured claims; verifier requires `trust` plus at least one trusted certificate or development fingerprint; wallet attestation requirement requires at least one attestation certificate.

- [ ] **Step 4: Run configuration tests and package build**

Run:

```bash
pnpm install --frozen-lockfile=false
pnpm --filter @verana-labs/vs-agent-plugin-openid4vc test -- config.test.ts
pnpm --filter @verana-labs/vs-agent-plugin-openid4vc build
```

Expected: configuration tests PASS and the package compiles.

- [ ] **Step 5: Commit the package foundation**

```bash
git add package.json pnpm-lock.yaml packages/plugin-openid4vc
git commit -m "feat: add OpenID4VC plugin foundation"
```

---

### Task 2: Reuse one plugin instance across Credo, NestJS, and Express

**Files:**

- Modify: `packages/agent-sdk/src/types.ts`
- Create: `apps/vs-agent/src/utils/pluginLifecycle.ts`
- Create: `apps/vs-agent/tests/pluginLifecycle.test.ts`
- Modify: `apps/vs-agent/src/utils/setupAgent.ts`
- Modify: `apps/vs-agent/src/main.ts`

**Interfaces:**

- Produces: `VsAgentNestPlugin.initialize`, `VsAgentNestPlugin.publicMiddleware`, `credoPluginsFromNestPlugins()`, `mountPublicPluginMiddleware()`, and `initializeNestPlugins()`.
- Consumes: the existing `VsAgentNestPlugin.credoPlugin`, controllers, providers, message handlers, and `registerEvents` fields.

- [ ] **Step 1: Write lifecycle helper tests**

```ts
import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import { describe, expect, it, vi } from 'vitest'

import {
  credoPluginsFromNestPlugins,
  initializeNestPlugins,
  mountPublicPluginMiddleware,
} from '../src/utils/pluginLifecycle'

describe('plugin lifecycle', () => {
  it('uses each Credo plugin exactly once', () => {
    const credoPlugin = { modules: { example: {} } }
    expect(credoPluginsFromNestPlugins([{ name: 'example', credoPlugin }])).toEqual([credoPlugin])
  })

  it('mounts only declared public middleware', () => {
    const use = vi.fn()
    const middleware = vi.fn()
    mountPublicPluginMiddleware({ use }, [
      { name: 'public', publicMiddleware: middleware },
      { name: 'admin-only' },
    ])
    expect(use).toHaveBeenCalledOnce()
    expect(use).toHaveBeenCalledWith(middleware)
  })

  it('awaits initialization and propagates failure', async () => {
    const initialize = vi.fn().mockRejectedValue(new Error('invalid certificate'))
    const plugins: VsAgentNestPlugin[] = [{ name: 'broken', initialize }]
    await expect(initializeNestPlugins(plugins, {} as never, {} as never)).rejects.toThrow(
      'invalid certificate',
    )
  })
})
```

- [ ] **Step 2: Run the test and verify red**

Run: `pnpm --filter @verana-labs/vs-agent test -- pluginLifecycle.test.ts`

Expected: FAIL because the lifecycle helpers and interface fields do not exist.

- [ ] **Step 3: Add lifecycle hooks and pure helpers**

Extend `VsAgentNestPlugin` with:

```ts
import type { RequestHandler } from 'express'

initialize?: (agent: VsAgent<BaseAgentModules>, logger: BaseLogger) => Promise<void>
publicMiddleware?: RequestHandler
```

Implement `pluginLifecycle.ts`:

```ts
import type { BaseAgentModules, VsAgent, VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'
import type { BaseLogger } from '@credo-ts/core'
import type { Express } from 'express'

export const credoPluginsFromNestPlugins = (plugins: VsAgentNestPlugin[]) =>
  plugins.flatMap(plugin => (plugin.credoPlugin ? [plugin.credoPlugin] : []))

export const mountPublicPluginMiddleware = (
  app: Pick<Express, 'use'>,
  plugins: VsAgentNestPlugin[],
): void => {
  for (const plugin of plugins) {
    if (plugin.publicMiddleware) app.use(plugin.publicMiddleware)
  }
}

export const initializeNestPlugins = async (
  plugins: VsAgentNestPlugin[],
  agent: VsAgent<BaseAgentModules>,
  logger: BaseLogger,
): Promise<void> => {
  for (const plugin of plugins) await plugin.initialize?.(agent, logger)
}
```

Change `setupAgent` to accept `nestPlugins: VsAgentNestPlugin[]`, remove its dynamic imports, and append `...credoPluginsFromNestPlugins(nestPlugins)` to `createVsAgent({ plugins })`. In `main.ts`, construct the plugin list before `setupAgent`, pass the list into `setupAgent`, await `initializeNestPlugins()` after `agent.initialize()` and before `startServers()`, then call `mountPublicPluginMiddleware()` before static UI middleware.

- [ ] **Step 4: Verify existing plugins and lifecycle tests**

Run:

```bash
pnpm --filter @verana-labs/vs-agent test -- pluginLifecycle.test.ts
pnpm --filter @verana-labs/vs-agent-plugin-chat build
pnpm --filter @verana-labs/vs-agent-plugin-mrtd test
pnpm --filter @verana-labs/vs-agent build
```

Expected: all commands PASS; chat and MRTD still receive their Credo modules from the same Nest plugin objects.

- [ ] **Step 5: Commit the lifecycle cleanup**

```bash
git add packages/agent-sdk/src/types.ts apps/vs-agent/src/utils apps/vs-agent/src/main.ts apps/vs-agent/tests/pluginLifecycle.test.ts
git commit -m "refactor: unify plugin lifecycle wiring"
```

---

### Task 3: Certificate material and trust anchors

**Files:**

- Create: `packages/plugin-openid4vc/src/services/CertificateService.ts`
- Create: `packages/plugin-openid4vc/src/trust/CertificateTrust.ts`
- Create: `packages/plugin-openid4vc/tests/CertificateService.test.ts`
- Create: `packages/plugin-openid4vc/tests/CertificateTrust.test.ts`
- Create: `packages/plugin-openid4vc/tests/helpers/certificates.ts`

**Interfaces:**

- Produces: `SigningCertificateHandle`, `loadSigningCertificate()`, `trustedCertificatesForVerification()`, `didFromValidatedCertificate()`, and `certificateFingerprint()`.
- Consumes: validated `OpenId4VcSigningOptions`, Credo KMS, `X509Certificate`, and X.509 verification categories.

- [ ] **Step 1: Write certificate security tests**

Test these invariants with deterministic P-256 fixture keys and a root/intermediate/leaf chain generated in `tests/helpers/certificates.ts`:

```ts
it('loads a configured leaf-first chain and imports the matching P-256 key', async () => {
  const handle = await loadSigningCertificate(agent, configuredSigning)
  expect(handle.chain).toHaveLength(2)
  expect(handle.certificate.equal(handle.chain[0])).toBe(true)
  expect(handle.keyId).toBeTruthy()
})

it('rejects a private key that does not match the leaf certificate', async () => {
  await expect(loadSigningCertificate(agent, mismatchedSigning)).rejects.toThrow(
    'does not match the leaf certificate',
  )
})

it('never returns the peer-provided chain as a trust anchor', () => {
  const anchors = trustedCertificatesForVerification(options, {
    type: 'credential',
    certificateChain: attackerChain,
  })
  expect(anchors).toEqual(options.trust?.credentialIssuerCertificates)
  expect(anchors).not.toEqual(attackerChain)
})

it('returns no wallet attestation anchors when the feature is not configured', () => {
  expect(
    trustedCertificatesForVerification(options, {
      type: 'oauth2ClientAttestation',
      certificateChain: attackerChain,
    }),
  ).toBeUndefined()
})
```

Also test expired certificates, a self-signed configured leaf outside explicit development mode, missing URI SAN, a non-DID URI SAN, exact development fingerprint acceptance, and a different self-signed fingerprint rejection.

- [ ] **Step 2: Run certificate tests and verify red**

Run: `pnpm --filter @verana-labs/vs-agent-plugin-openid4vc test -- Certificate`

Expected: FAIL because the certificate services do not exist.

- [ ] **Step 3: Implement configured and development signing modes**

`loadSigningCertificate()` must:

1. Parse configured strings with `X509Certificate.fromEncodedCertificate()`.
2. Reject an empty chain and reject a configured self-signed leaf.
3. Import the supplied P-256 private JWK using `agent.kms.importKey()` or reuse its stable `kid` after comparing the stored public key.
4. Compare the imported public JWK to the leaf certificate public JWK with canonical `kty`, `crv`, `x`, and `y` fields.
5. Set `leaf.keyId` to the KMS key identifier and return a leaf-first chain.
6. For explicit development mode only, create and persist one self-signed P-256 certificate in `agent.genericRecords`, including a DID URI SAN and DNS SAN derived from `publicApiBaseUrl`.

Use this return contract:

```ts
export interface SigningCertificateHandle {
  certificate: X509Certificate
  chain: X509Certificate[]
  keyId: string
  development: boolean
}
```

`trustedCertificatesForVerification()` must switch only on Credo's verification type. A peer leaf may be returned only after its SHA-256 fingerprint exactly matches an explicitly configured development pin:

```ts
export function trustedCertificatesForVerification(
  options: OpenId4VcPluginOptions,
  verification: { type: string; certificateChain: X509Certificate[] },
): string[] | undefined {
  if (verification.type === 'credential') {
    if (options.trust?.credentialIssuerCertificates.length) {
      return options.trust.credentialIssuerCertificates
    }
    const leaf = verification.certificateChain[0]
    const fingerprint = leaf ? certificateFingerprint(leaf) : undefined
    return fingerprint && options.trust?.developmentCertificateFingerprints?.includes(fingerprint)
      ? [leaf.toString('base64')]
      : undefined
  }
  if (verification.type === 'oauth2ClientAttestation') {
    return options.issuer?.walletAttestationCertificates?.length
      ? options.issuer.walletAttestationCertificates
      : undefined
  }
  return undefined
}
```

- [ ] **Step 4: Run certificate tests and build**

Run:

```bash
pnpm --filter @verana-labs/vs-agent-plugin-openid4vc test -- Certificate
pnpm --filter @verana-labs/vs-agent-plugin-openid4vc build
```

Expected: PASS with the spoofed and mismatched certificate cases rejected.

- [ ] **Step 5: Commit certificate handling**

```bash
git add packages/plugin-openid4vc/src/services/CertificateService.ts packages/plugin-openid4vc/src/trust/CertificateTrust.ts packages/plugin-openid4vc/tests
git commit -m "feat: validate OpenID4VC certificate trust"
```

---

### Task 4: Fail-closed Verana trust and DID key binding

**Files:**

- Create: `packages/plugin-openid4vc/src/trust/types.ts`
- Create: `packages/plugin-openid4vc/src/trust/verdict.ts`
- Create: `packages/plugin-openid4vc/src/trust/TrustClient.ts`
- Create: `packages/plugin-openid4vc/src/trust/keyBinding.ts`
- Create: `packages/plugin-openid4vc/tests/TrustClient.test.ts`
- Create: `packages/plugin-openid4vc/tests/keyBinding.test.ts`

**Interfaces:**

- Produces: `TrustVerdictName`, `TrustEvidence`, `TrustVerdict`, `TrustClient.verdictFor()`, `verifyKeyBoundToDid()`, and `blockingBindingVerdict()`.
- Consumes: resolver URL and timeout from `OpenId4VcPluginOptions.trust`, credential `vtjscId`, the validated leaf certificate public JWK, and the agent DID resolver.

- [ ] **Step 1: Write trust and spoofing tests**

Cover the complete truth table:

```ts
expect(computeVerdict({ status: 'unreachable' }, null)).toBe('RESOLVER_UNAVAILABLE')
expect(computeVerdict({ status: 'not_found' }, null)).toBe('UNTRUSTED')
expect(computeVerdict({ status: 'ok', trustStatus: 'UNTRUSTED' }, false)).toBe('UNTRUSTED')
expect(computeVerdict({ status: 'ok', trustStatus: 'TRUSTED' }, null)).toBe('RESOLVER_UNAVAILABLE')
expect(computeVerdict({ status: 'ok', trustStatus: 'TRUSTED' }, false)).toBe('TRUSTED_NOT_AUTHORIZED')
expect(computeVerdict({ status: 'ok', trustStatus: 'TRUSTED' }, true)).toBe('TRUSTED_AUTHORIZED')
```

Use an injected `fetch` implementation to prove 404, 500, thrown network errors, invalid JSON, non-boolean `authorized`, and an `AbortError` all fail closed. Verify URLs are generated with `URL` and `URLSearchParams`, not string concatenation.

For `verifyKeyBoundToDid()`, test an exact assertion-method key, a dereferenced method, a wrong key under the same DID, a key present only under `authentication`, a dangling reference, and resolution failure. The wrong-key test must be named `rejects a trusted DID asserted by an attacker certificate`.

- [ ] **Step 2: Run trust tests and verify red**

Run: `pnpm --filter @verana-labs/vs-agent-plugin-openid4vc test -- TrustClient.test.ts keyBinding.test.ts`

Expected: FAIL because trust modules do not exist.

- [ ] **Step 3: Implement the verdict model and timeout-bounded client**

Use these public verdict names:

```ts
export type TrustVerdictName =
  | 'TRUSTED_AUTHORIZED'
  | 'TRUSTED_NOT_AUTHORIZED'
  | 'UNTRUSTED'
  | 'RESOLVER_UNAVAILABLE'
```

`TrustClient` must create one `AbortController` per request, abort after the configured timeout, clear the timer in `finally`, accept `trustStatus` only when it equals `TRUSTED`, `PARTIAL`, or `UNTRUSTED`, and accept `authorized` only when it is a boolean. `verdictFor('issuer', did, vtjscId)` queries `/resolve` first and queries `/issuer-authorization` only after a trusted resolution. No resolver query is made when certificate/DID key binding has already failed.

`verifyKeyBoundToDid()` compares canonical public JWK components and accepts issuer keys only through the DID document's `assertionMethod` relationship.

- [ ] **Step 4: Run trust tests and build**

Run:

```bash
pnpm --filter @verana-labs/vs-agent-plugin-openid4vc test -- TrustClient.test.ts keyBinding.test.ts
pnpm --filter @verana-labs/vs-agent-plugin-openid4vc build
```

Expected: PASS; no negative state can become `TRUSTED_AUTHORIZED`.

- [ ] **Step 5: Commit the trust boundary**

```bash
git add packages/plugin-openid4vc/src/trust packages/plugin-openid4vc/tests/TrustClient.test.ts packages/plugin-openid4vc/tests/keyBinding.test.ts
git commit -m "feat: add fail-closed Verana trust checks"
```

---

### Task 5: Single-instance OpenID4VC module and fail-fast initialization

**Files:**

- Create: `packages/plugin-openid4vc/src/sdk/setupOpenId4Vc.ts`
- Create: `packages/plugin-openid4vc/src/nestjs/OpenId4VcPlugin.ts`
- Create: `packages/plugin-openid4vc/tests/setupOpenId4Vc.test.ts`
- Create: `packages/plugin-openid4vc/tests/OpenId4VcPlugin.test.ts`
- Create: `packages/plugin-openid4vc/src/index.ts`

**Interfaces:**

- Produces: `setupOpenId4Vc()`, `OpenId4VcPlugin()`, `OpenId4VcAgentModules`, and one non-global Express router per plugin instance.
- Consumes: lifecycle hooks from Task 2, certificate trust from Task 3, and validated options from Task 1.

- [ ] **Step 1: Write module and lifecycle tests**

```ts
it('creates isolated routers for two plugin instances', () => {
  const first = OpenId4VcPlugin(validOptions())
  const second = OpenId4VcPlugin(validOptions())
  expect(first.publicMiddleware).not.toBe(second.publicMiddleware)
})

it('does not advertise wallet attestation by default', async () => {
  const response = await request(appFor(validOptions())).get('/.well-known/oauth-authorization-server')
  expect(response.body.token_endpoint_auth_methods_supported).not.toContain('attest_jwt_client_auth')
})

it('advertises attestation only when trusted attestation roots are configured', async () => {
  const options = validOptions()
  options.issuer!.requireWalletAttestation = true
  options.issuer!.walletAttestationCertificates = ['MIIB-wallet-root']
  const response = await request(appFor(options)).get('/.well-known/oauth-authorization-server')
  expect(response.body.token_endpoint_auth_methods_supported).toContain('attest_jwt_client_auth')
})

it('propagates issuer initialization failure instead of logging and continuing', async () => {
  await expect(plugin.initialize?.(agentWithMismatchedKey, logger)).rejects.toThrow(
    'does not match the leaf certificate',
  )
})
```

- [ ] **Step 2: Run module tests and verify red**

Run: `pnpm --filter @verana-labs/vs-agent-plugin-openid4vc test -- setupOpenId4Vc.test.ts OpenId4VcPlugin.test.ts`

Expected: FAIL because the SDK and Nest plugin factory do not exist.

- [ ] **Step 3: Build the per-instance module and router**

`setupOpenId4Vc()` creates a fresh `express()` application for each plugin instance, configures issuer base URL as `${publicApiBaseUrl}/oid4vci`, verifier base URL as `${publicApiBaseUrl}/oid4vp`, and constructs:

```ts
const moduleOptions: OpenId4VcModuleConfigOptions = {
  app: router,
  ...(options.issuer
    ? {
        issuer: {
          baseUrl: `${options.publicApiBaseUrl}/oid4vci`,
          credentialRequestToCredentialMapper: input => getIssuerService().mapCredentialRequest(input),
        },
      }
    : {}),
  ...(options.verifier ? { verifier: { baseUrl: `${options.publicApiBaseUrl}/oid4vp` } } : {}),
}

const openId4Vc = new OpenId4VcModule(moduleOptions)
```

Add `X509Module` with `getTrustedCertificatesForVerification` delegating only to `trustedCertificatesForVerification()`. Do not return `certificateChain` from the callback.

`OpenId4VcPlugin()` validates options synchronously, creates one router, keeps issuer and verifier service references inside its closure, exposes provider factories that return those exact references, and awaits both `ensureInitialized()` calls from its `initialize` hook. It exposes controllers only for enabled roles and never exposes a holder controller.

- [ ] **Step 4: Run module tests and build**

Run:

```bash
pnpm --filter @verana-labs/vs-agent-plugin-openid4vc test -- setupOpenId4Vc.test.ts OpenId4VcPlugin.test.ts
pnpm --filter @verana-labs/vs-agent-plugin-openid4vc build
```

Expected: PASS with isolated routers and fail-fast initialization.

- [ ] **Step 5: Commit the plugin lifecycle**

```bash
git add packages/plugin-openid4vc/src/sdk packages/plugin-openid4vc/src/nestjs/OpenId4VcPlugin.ts packages/plugin-openid4vc/src/index.ts packages/plugin-openid4vc/tests
git commit -m "feat: initialize OpenID4VC plugin safely"
```

---

### Task 6: SD-JWT VC issuer and authenticated offer API

**Files:**

- Create: `packages/plugin-openid4vc/src/services/IssuerService.ts`
- Create: `packages/plugin-openid4vc/src/nestjs/IssuerController.ts`
- Create: `packages/plugin-openid4vc/src/nestjs/dto.ts`
- Create: `packages/plugin-openid4vc/tests/IssuerService.test.ts`
- Create: `packages/plugin-openid4vc/tests/IssuerController.test.ts`

**Interfaces:**

- Produces: `IssuerService.ensureInitialized()`, `IssuerService.createOffer()`, `IssuerService.getOfferState()`, `IssuerService.getVctMetadata()`, and `IssuerService.mapCredentialRequest()`.
- Consumes: `SigningCertificateHandle`, validated claims, Credo issuer API, `ClaimFormat.SdJwtDc`, and authenticated Nest registration from Task 5.

- [ ] **Step 1: Write issuer tests**

Assert that initialization creates or updates the configured issuer, advertises only `dc+sd-jwt`, ES256, JWK holder binding, and configured display data. Assert offer creation uses pre-authorized code, stores only validated claims in `issuanceMetadata`, and does not log or publish the offer through a public convenience route.

```ts
it('maps a request to a short-lived dc+sd-jwt credential', async () => {
  const mapped = await service.mapCredentialRequest({
    credentialConfigurationId: 'employee',
    issuanceSession: { id: 'session', issuanceMetadata: { name: 'Ada', role: 'engineer' } },
    holderBinding: { keys: [{ method: 'jwk', jwk: holderJwk }] },
  } as never)
  expect(mapped.type).toBe('credentials')
  expect(mapped.format).toBe(ClaimFormat.SdJwtDc)
  expect(mapped.credentials[0].headerType).toBe('dc+sd-jwt')
  expect(mapped.credentials[0].payload.exp - mapped.credentials[0].payload.iat).toBe(3_600)
  expect(mapped.credentials[0].payload).not.toHaveProperty('admin')
})
```

Controller tests must verify `POST /v1/oid4vc/offers`, `GET /v1/oid4vc/offers/:id`, DTO rejection of unknown claims, and absence of those routes from the public application.

- [ ] **Step 2: Run issuer tests and verify red**

Run: `pnpm --filter @verana-labs/vs-agent-plugin-openid4vc test -- Issuer`

Expected: FAIL because issuer service and controller do not exist.

- [ ] **Step 3: Implement the issuer**

The credential payload is exactly:

```ts
const issuedAt = Math.floor(Date.now() / 1_000)
const payload = {
  vct: configuration.vct,
  iat: issuedAt,
  exp: issuedAt + configuration.ttlSeconds,
  ...claims,
}
```

The mapper uses the configured leaf-first `x5c` chain, issuer identifier `publicApiBaseUrl`, per-holder JWK or DID binding supplied by Credo, configured disclosure frame, `ClaimFormat.SdJwtDc`, and `headerType: 'dc+sd-jwt'`.

Issuer initialization requires `agent.did` and verifies that the certificate public key is already present under that DID document's `assertionMethod`. Missing or unresolvable binding aborts initialization. The plugin does not silently mutate or claim publication of an externally managed DID document.

Register VCT metadata at `/oid4vc/vct/:configurationId` on the public router. The response contains `vct`, `name`, optional description, display metadata, and claim paths. It contains no schema claim pretending that SD-JWT VC is W3C VCDM.

Use class-validator DTOs:

```ts
export class CreateOpenId4VcOfferDto {
  @IsString()
  @IsNotEmpty()
  credentialConfigurationId!: string

  @IsObject()
  claims!: Record<string, unknown>
}
```

Rely on the existing admin guard's default `INTERNAL` access mode for plugin controllers. Do not mark any control method `PUBLIC` and do not make the plugin package import application-only decorators.

- [ ] **Step 4: Run issuer tests and build**

Run:

```bash
pnpm --filter @verana-labs/vs-agent-plugin-openid4vc test -- Issuer
pnpm --filter @verana-labs/vs-agent-plugin-openid4vc build
```

Expected: PASS; only `dc+sd-jwt` is emitted and arbitrary claims are rejected.

- [ ] **Step 5: Commit the issuer**

```bash
git add packages/plugin-openid4vc/src/services/IssuerService.ts packages/plugin-openid4vc/src/nestjs packages/plugin-openid4vc/tests
git commit -m "feat: issue SD-JWT credentials over OpenID4VCI"
```

---

### Task 7: OID4VP verifier and trusted result API

**Files:**

- Create: `packages/plugin-openid4vc/src/services/VerifierService.ts`
- Create: `packages/plugin-openid4vc/src/nestjs/VerifierController.ts`
- Modify: `packages/plugin-openid4vc/src/nestjs/dto.ts`
- Create: `packages/plugin-openid4vc/tests/VerifierService.test.ts`
- Create: `packages/plugin-openid4vc/tests/VerifierController.test.ts`

**Interfaces:**

- Produces: `VerifierService.ensureInitialized()`, `VerifierService.createRequest()`, `VerifierService.getResult()`, `OpenId4VcVerificationResult`, and `UnknownVerificationSessionError`.
- Consumes: configured verifier certificate, DCQL policies, Credo verifier API, certificate/DID key binding, and `TrustClient`.

- [ ] **Step 1: Write verifier tests**

Assert request creation uses `x509_hash`, `direct_post.jwt`, configured VCT and requested claim paths. Assert a non-verified session returns no credential or trust result and performs zero resolver queries.

For `ResponseVerified`, test all four outcomes:

```ts
expect(trustedResult).toMatchObject({
  state: 'ResponseVerified',
  cryptographicVerified: true,
  accepted: true,
  trust: { verdict: 'TRUSTED_AUTHORIZED' },
  credential: { vct: employeeVct, disclosedClaims: { name: 'Ada' } },
})

expect(spoofedSanResult).toMatchObject({
  cryptographicVerified: true,
  accepted: false,
  trust: { verdict: 'UNTRUSTED' },
})

expect(unauthorizedResult).toMatchObject({
  cryptographicVerified: true,
  accepted: false,
  trust: { verdict: 'TRUSTED_NOT_AUTHORIZED' },
})

expect(resolverDownResult).toMatchObject({
  cryptographicVerified: true,
  accepted: false,
  trust: { verdict: 'RESOLVER_UNAVAILABLE' },
})
```

- [ ] **Step 2: Run verifier tests and verify red**

Run: `pnpm --filter @verana-labs/vs-agent-plugin-openid4vc test -- Verifier`

Expected: FAIL because verifier service and controller do not exist.

- [ ] **Step 3: Implement verifier request and result evaluation**

Create authorization requests with:

```ts
requestSigner: {
  method: 'x5c',
  x5c: certificate.chain,
  clientIdPrefix: 'x509_hash',
},
responseMode: 'direct_post.jwt',
dcql: {
  query: {
    credentials: [
      {
        id: policy.credentialConfigurationId,
        format: 'dc+sd-jwt',
        meta: { vct_values: [configuration.vct] },
        claims: policy.requestedClaims.map(name => ({ path: [name] })),
      },
    ],
  },
},
```

`getResult()` calls `getVerifiedAuthorizationResponse()` only after state `ResponseVerified`. It extracts the first presentation under the configured credential ID, obtains the leaf certificate and DID URI SAN, verifies the leaf public key is an `assertionMethod` of that DID, then queries issuer trust and issuer authorization for the configuration's `vtjscId`. It sets `accepted` to `true` only when Credo verified the response and the verdict is exactly `TRUSTED_AUTHORIZED`.

Verifier initialization requires `agent.did` and verifies that its request-signing certificate key is present under that DID document's `authentication` relationship. Missing or unresolvable binding aborts initialization.

Return only configured disclosed claims. Do not return the encoded credential, pre-authorized code, certificate private material, or complete authorization response.

Expose `POST /v1/oid4vc/verifier/requests` with `{ policyId }` and `GET /v1/oid4vc/verifier/sessions/:id`. Unknown policies are 400 and unknown sessions are 404. Both remain internal admin routes.

- [ ] **Step 4: Run verifier tests and build**

Run:

```bash
pnpm --filter @verana-labs/vs-agent-plugin-openid4vc test -- Verifier
pnpm --filter @verana-labs/vs-agent-plugin-openid4vc build
```

Expected: PASS; spoofed SANs and all resolver failures remain rejected.

- [ ] **Step 5: Commit the verifier**

```bash
git add packages/plugin-openid4vc/src/services/VerifierService.ts packages/plugin-openid4vc/src/nestjs packages/plugin-openid4vc/tests
git commit -m "feat: verify SD-JWT presentations over OpenID4VP"
```

---

### Task 8: In-process issuance and presentation interoperability

**Files:**

- Create: `packages/plugin-openid4vc/tests/setup.askar.ts`
- Create: `packages/plugin-openid4vc/tests/helpers/testAgent.ts`
- Create: `packages/plugin-openid4vc/tests/helpers/didResolver.ts`
- Create: `packages/plugin-openid4vc/tests/helpers/resolverStub.ts`
- Create: `packages/plugin-openid4vc/tests/flow.integration.test.ts`

**Interfaces:**

- Produces: a test-only holder built directly from Credo APIs and a complete OpenID4VCI-to-OpenID4VP regression suite.
- Consumes: issuer and verifier services, deterministic certificate fixtures, a map-backed DID resolver, and a local Verana resolver stub.

- [ ] **Step 1: Write the end-to-end tests with the holder confined to tests**

Create three in-memory Credo agents: plugin issuer, direct-Credo holder, and plugin verifier. The holder helper may call `resolveCredentialOffer`, `requestToken`, `requestCredentials`, `resolveOpenId4VpAuthorizationRequest`, `selectCredentialsForDcqlRequest`, and `acceptOpenId4VpAuthorizationRequest`; it must not be exported from `src/`.

Test:

1. A pre-authorized offer issues a stored `dc+sd-jwt` with expected claims and expiration.
2. The holder presents it to a verifier using DCQL and the verifier returns `accepted: true`.
3. Changing the issuer DID document to a different P-256 key keeps Credo crypto valid but returns `accepted: false` and `UNTRUSTED`.
4. Removing issuer authorization returns `TRUSTED_NOT_AUTHORIZED`.
5. Stopping the resolver returns `RESOLVER_UNAVAILABLE`.
6. Replaying a completed authorization response is rejected by Credo.
7. No source file named `WalletController.ts` or `WalletService.ts` exists in the package.

- [ ] **Step 2: Run the flow test and verify red**

Run: `pnpm --filter @verana-labs/vs-agent-plugin-openid4vc test -- flow.integration.test.ts`

Expected: FAIL until the test holder helpers and any missing integration seams are complete.

- [ ] **Step 3: Complete only the integration seams exposed by the failing test**

Register Askar before Credo snapshots its binding, serialize test files, close all HTTP servers and agents in `afterAll`, and keep resolver fixtures local to `127.0.0.1`. Do not add a holder role or holder controller to production source.

- [ ] **Step 4: Run the complete plugin suite**

Run:

```bash
pnpm --filter @verana-labs/vs-agent-plugin-openid4vc test -- --run
pnpm --filter @verana-labs/vs-agent-plugin-openid4vc build
```

Expected: all plugin tests PASS with no open handles.

- [ ] **Step 5: Commit the full protocol regression**

```bash
git add packages/plugin-openid4vc/tests packages/plugin-openid4vc/vitest.config.ts
git commit -m "test: cover OpenID4VC issuance and presentation"
```

---

### Task 9: VS Agent configuration and Docker integration

**Files:**

- Create: `apps/vs-agent/src/config/openid4vc.ts`
- Create: `apps/vs-agent/tests/openid4vcConfig.test.ts`
- Modify: `apps/vs-agent/src/config/constants.ts`
- Modify: `apps/vs-agent/src/config/index.ts`
- Modify: `apps/vs-agent/src/main.ts`
- Modify: `apps/vs-agent/package.json`
- Modify: `apps/vs-agent/Dockerfile`
- Modify: `.github/workflows/ci.yml`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Produces: `loadOpenId4VcOptions(configPath, publicApiBaseUrl)`, `loadOptionalOpenId4VcPlugin(enabledPlugins, configPath, publicApiBaseUrl)`, and Docker target `vs-agent-openid4vc`.
- Consumes: `OID4VC_CONFIG_FILE`, `VS_AGENT_PLUGINS=messaging,chat,openid4vc`, and `OpenId4VcPlugin()`.

- [ ] **Step 1: Write config-file and startup tests**

Use a temporary JSON fixture containing an issuer, verifier, trust policy, credential configuration, and verifier policy. Assert the loader injects `publicApiBaseUrl`, rejects unknown top-level keys, rejects missing files, and does not include private JWK values in thrown messages.

```ts
it('loads OpenID4VC options only when the plugin is enabled', () => {
  expect(loadOptionalOpenId4VcPlugin(['messaging'], undefined, 'https://agent.example')).toBeUndefined()
  expect(() =>
    loadOptionalOpenId4VcPlugin(['messaging', 'openid4vc'], undefined, 'https://agent.example'),
  ).toThrow('OID4VC_CONFIG_FILE is required')
})
```

- [ ] **Step 2: Run application config tests and verify red**

Run: `pnpm --filter @verana-labs/vs-agent test -- openid4vcConfig.test.ts`

Expected: FAIL because the loader does not exist.

- [ ] **Step 3: Wire one optional plugin instance**

Add:

```ts
export const OID4VC_CONFIG_FILE = process.env.OID4VC_CONFIG_FILE
```

When `openid4vc` is enabled, dynamic import failure is fatal rather than a warning, because an explicitly enabled security protocol must not silently disappear. Load the JSON file, validate through the package, build one `OpenId4VcPlugin`, add that object to `nestPlugins`, and let Tasks 2 and 5 supply its Credo module, initialization, controllers, and public router.

Declare `@verana-labs/vs-agent-plugin-openid4vc` as an optional workspace dependency. Add a separate Docker build stage and final target with:

```dockerfile
ENV VS_AGENT_PLUGINS=messaging,chat,openid4vc
```

Copy only the OpenID4VC package sources, build output, and dependencies needed by that target. Add the target to the CI Docker matrix without changing the default `vs-agent` or `vs-agent-mrtd` images.

- [ ] **Step 4: Verify app and container integration**

Run:

```bash
pnpm --filter @verana-labs/vs-agent test -- openid4vcConfig.test.ts pluginLifecycle.test.ts
pnpm --filter @verana-labs/vs-agent build
docker build --target vs-agent-openid4vc -t vs-agent-openid4vc:test -f apps/vs-agent/Dockerfile .
```

Expected: tests and build PASS; Docker image contains the OpenID4VC package and starts with the plugin disabled only when its target is not selected.

- [ ] **Step 5: Commit app and Docker wiring**

```bash
git add apps/vs-agent .github/workflows/ci.yml pnpm-lock.yaml
git commit -m "feat: wire OpenID4VC into VS Agent"
```

---

### Task 10: Operator documentation and explicit follow-ups

**Files:**

- Create: `packages/plugin-openid4vc/README.md`
- Create: `docs/openid4vc-w3c-follow-up.md`
- Modify: `README.md`
- Modify: `apps/vs-agent/README.md`

**Interfaces:**

- Produces: configuration reference, trust model, endpoint ownership table, Docker instructions, interoperability matrix, and bounded follow-up scope.
- Consumes: final option names, routes, Docker target, and verified behavior from Tasks 1 through 9.

- [ ] **Step 1: Write the package README from verified behavior**

Include:

- issuer and verifier capabilities;
- `dc+sd-jwt`, pre-authorized code, DCQL, `direct_post.jwt`, and `x509_hash` support;
- the exact admin and public route split;
- a complete redacted `openid4vc.json` example using development signing mode;
- a production example showing certificate chain strings and a redacted P-256 private JWK object;
- the certificate-chain, URI SAN, DID-key, and Verana authorization trust sequence;
- a warning that development self-signed mode is not HAIP-conformant;
- a warning that the plugin is implementation groundwork, not EUDI certification;
- tested wallet/tool versions and dates only after live verification.

- [ ] **Step 2: Write the follow-up document**

`docs/openid4vc-w3c-follow-up.md` must classify these as not implemented in this PR: W3C VCDM JWT VC, W3C Data Integrity/JSON-LD, ISO mdoc, status lists, authorization-code issuance, wallet attestation trust-list distribution, production reader/issuer PKI onboarding, and formal conformance testing. Explain that SD-JWT VC is a Verifiable Digital Credential distinct from W3C VCDM and link the authoritative specifications.

- [ ] **Step 3: Update repository and app plugin tables**

Add `openid4vc` and `vs-agent-openid4vc` alongside existing `chat` and `mrtd` entries. Do not describe deferred formats as supported.

- [ ] **Step 4: Format and review documentation**

Run:

```bash
pnpm exec prettier --check packages/plugin-openid4vc/README.md docs/openid4vc-w3c-follow-up.md README.md apps/vs-agent/README.md
rg -n "EUDI compliant|certified|full HAIP|W3C credential support" packages/plugin-openid4vc/README.md docs README.md apps/vs-agent/README.md
```

Expected: formatting PASS; the claim scan returns no unsupported conformance claim.

- [ ] **Step 5: Commit documentation**

```bash
git add packages/plugin-openid4vc/README.md docs/openid4vc-w3c-follow-up.md README.md apps/vs-agent/README.md
git commit -m "docs: document OpenID4VC foundation"
```

---

### Task 11: Repository verification and real-wallet evidence

**Files:**

- Modify if evidence supports it: `packages/plugin-openid4vc/README.md`
- Create outside the PR if screenshots/logs are needed: `/Users/samsepiol/Downloads/GithubRepos/Work/Verana/verana-fides-integrations/evidence/openid4vc-vs-agent/`

**Interfaces:**

- Produces: reproducible automated verification, secret-safe device or online-tool evidence, known limitation list, and a review-ready local branch.
- Consumes: connected Android device, official EUDI tools, or an approved HTTPS preview environment.

- [ ] **Step 1: Run narrow static and automated checks**

```bash
pnpm --filter @verana-labs/vs-agent-plugin-openid4vc test -- --run
pnpm --filter @verana-labs/vs-agent-plugin-openid4vc build
pnpm exec eslint packages/plugin-openid4vc/src packages/plugin-openid4vc/tests apps/vs-agent/src apps/vs-agent/tests
pnpm exec prettier --check "packages/plugin-openid4vc/**/*.{ts,md,json}" "apps/vs-agent/**/*.{ts,md,json}"
pnpm check-types
```

Expected: all commands PASS with zero warnings introduced by this branch.

- [ ] **Step 2: Run affected and workspace checks**

```bash
pnpm build
pnpm test
docker build --target vs-agent-openid4vc -t vs-agent-openid4vc:test -f apps/vs-agent/Dockerfile .
git diff --check origin/main...HEAD
```

Expected: build and Docker PASS. Full tests may reproduce only the six recorded upstream JSON-LD context failures; no plugin or newly affected test may fail.

- [ ] **Step 3: Inspect the connected device before choosing a live path**

```bash
adb devices -l
adb shell pm list packages | rg -i 'eudi|wallet'
```

Expected: one authorized device and the installed EUDI wallet package are visible. If no authorized device is present, use only official online tools and record that device verification was unavailable.

- [ ] **Step 4: Exercise real issuance and presentation without weakening trust**

Use an existing approved HTTPS preview or request approval before creating one. Exercise:

1. VS Agent issuer to Android EUDI wallet issuance.
2. Android EUDI wallet to VS Agent verifier presentation.
3. An untrusted certificate path.
4. A trusted but unauthorized Verana DID.

Capture timestamps, tool or wallet version, public endpoint, final state, and sanitized error/result. Never retain private JWKs, pre-authorized codes, bearer tokens, mnemonics, complete credentials, or device identifiers. If a wallet rejects the verifier because its reader certificate is absent from the wallet trust store, record that exact boundary and do not enable accept-any behavior.

- [ ] **Step 5: Perform final security and scope review**

```bash
rg -n "holderEnabled|WalletController|WalletService|certificateChain\.map|return certificateChain|vc\+sd-jwt|credentialSchema|attest_jwt_client_auth" packages/plugin-openid4vc apps/vs-agent
git diff --stat origin/main...HEAD
git log --oneline origin/main..HEAD
git status --short --branch
```

Expected: no production holder implementation, no peer-chain-as-anchor pattern, no emitted `vc+sd-jwt`, no W3C `credentialSchema` claim, and attestation metadata only behind configured validation.

- [ ] **Step 6: Commit only evidence-backed documentation corrections**

If live verification changes the documented matrix:

```bash
git add packages/plugin-openid4vc/README.md
git commit -m "docs: record OpenID4VC interoperability"
```

If the README already matches the evidence, do not create an empty commit.

---

### Task 12: Human draft PR preparation

**Files:**

- No repository file required.

**Interfaces:**

- Produces: final diff summary, known limitations, draft PR title/body, and issue-comment draft for Maxime's review.
- Consumes: all verification and interoperability evidence from Task 11.

- [ ] **Step 1: Re-fetch and check divergence without rewriting history**

```bash
git fetch --prune origin fork
git rev-list --left-right --count origin/main...HEAD
git status --short --branch
```

Expected: clean working tree. If `origin/main` advanced, inspect the new commits and merge or rebase only after reviewing conflicts and rerunning Task 11.

- [ ] **Step 2: Prepare human PR copy**

Use this title shape:

```text
feat: add OpenID4VC issuer and verifier foundation
```

The body starts with `Relates to #518`, uses two or three short paragraphs, names SD-JWT VC/OpenID4VCI/OpenID4VP directly, describes the fail-closed certificate/DID/Verana trust boundary, and states the tested wallet or tool evidence plus known limitations. It must not contain a generic Summary/Test Plan template, metric table, checklist, certification claim, or claim that W3C VCDM is implemented.

- [ ] **Step 3: Present the local branch and PR copy to Maxime**

Provide the exact commit list, changed-file summary, commands run, baseline failures, device/tool evidence, limitations, title, and body. Wait for Maxime's manual review.

- [ ] **Step 4: Push only after explicit approval**

After Maxime explicitly approves pushing in the current conversation:

```bash
git push -u fork codex/openid4vc-foundation
```

- [ ] **Step 5: Open the draft PR only after explicit approval**

After Maxime explicitly approves opening it:

```bash
gh pr create --repo verana-labs/vs-agent --base main --head AirKyzzZ:codex/openid4vc-foundation --draft --title "feat: add OpenID4VC issuer and verifier foundation" --body-file /tmp/vs-agent-openid4vc-pr-body.md
```

Expected: a draft PR linked to #518. Do not post the issue comment until Maxime separately approves its final wording.
