import { AskarPostgresStorageConfig } from '@credo-ts/askar'
import { LogLevel } from '@credo-ts/core'
import { KdfMethod } from '@openwallet-foundation/askar-nodejs'
import dotenv from 'dotenv'

import packageJson from '../../package.json'

dotenv.config()

export const AGENT_VERSION: string = packageJson.version

// Basic parameters

export const AGENT_PORT = Number(process.env.AGENT_PORT || 3001)
export const ADMIN_PORT = Number(process.env.ADMIN_PORT || 3000)

export const AGENT_NAME = process.env.AGENT_NAME // This one is deprecated. Only used to throw error if it is defined
export const AGENT_LABEL = process.env.AGENT_LABEL || 'Test VS Agent'
export const UI_WELCOME_MESSAGE = process.env.UI_WELCOME_MESSAGE || 'Welcome to VS Agent'
export const AGENT_INVITATION_IMAGE_URL = process.env.AGENT_INVITATION_IMAGE_URL
export const AGENT_ENDPOINT = process.env.AGENT_ENDPOINT
export const AGENT_ENDPOINTS = process.env.AGENT_ENDPOINT
  ? [process.env.AGENT_ENDPOINT]
  : process.env.AGENT_ENDPOINTS?.replace(/\s+/g, '').split(',')

export const AGENT_PUBLIC_DID_METHOD = (process.env.AGENT_PUBLIC_DID_METHOD ?? 'webvh').trim().toLowerCase()
export const PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL

export const ADMIN_API_PUBLIC_URL = process.env.ADMIN_API_PUBLIC_URL
export const ADMIN_API_EXTERNAL_PORT = Number(process.env.ADMIN_API_EXTERNAL_PORT || 3010)
export const ADMIN_API_AUTH_MODE = (process.env.ADMIN_API_AUTH_MODE ?? '')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(s => s.length > 0)

export const EVENTS_BASE_URL = (process.env.EVENTS_BASE_URL || 'http://localhost:5000').replace(/\/+$/, '')

// Wallet and Database
export const AGENT_WALLET_ID = process.env.AGENT_WALLET_ID
export const AGENT_WALLET_KEY = process.env.AGENT_WALLET_KEY
export const AGENT_WALLET_KEY_DERIVATION_METHOD = process.env.AGENT_WALLET_KEY_DERIVATION_METHOD
export const POSTGRES_HOST = process.env.POSTGRES_HOST
export const POSTGRES_USER = process.env.POSTGRES_USER
export const POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD
export const POSTGRES_ADMIN_USER = process.env.POSTGRES_ADMIN_USER
export const POSTGRES_ADMIN_PASSWORD = process.env.POSTGRES_ADMIN_PASSWORD

export const askarPostgresConfig: AskarPostgresStorageConfig = {
  type: 'postgres',
  config: {
    host: POSTGRES_HOST as string,
    connectTimeout: 10,
  },
  credentials: {
    account: POSTGRES_USER as string,
    password: POSTGRES_PASSWORD as string,
    adminAccount: POSTGRES_USER as string,
    adminPassword: POSTGRES_PASSWORD as string,
  },
}

export const keyDerivationMethodMap: {
  [key: string]: `${KdfMethod.Argon2IInt}` | `${KdfMethod.Argon2IMod}` | `${KdfMethod.Raw}`
} = {
  ARGON2I_INT: KdfMethod.Argon2IInt,
  ARGON2I_MOD: KdfMethod.Argon2IMod,
  RAW: KdfMethod.Raw,
}

export const REDIS_HOST = process.env.REDIS_HOST
export const REDIS_PASSWORD = process.env.REDIS_PASSWORD

// Dev/debugging settings
export const AGENT_LOG_LEVEL = process.env.AGENT_LOG_LEVEL
  ? Number(process.env.AGENT_LOG_LEVEL)
  : LogLevel.Warn
export const ADMIN_LOG_LEVEL = process.env.ADMIN_LOG_LEVEL
  ? Number(process.env.ADMIN_LOG_LEVEL)
  : LogLevel.Info

export const USE_CORS = Boolean(process.env.USE_CORS || false)
export const ENABLE_PUBLIC_API_SWAGGER = !(process.env.ENABLE_PUBLIC_API_SWAGGER === 'false')

// Advanced settings
export const AGENT_INVITATION_BASE_URL = process.env.AGENT_INVITATION_BASE_URL ?? 'https://hologram.zone/'
export const REDIRECT_DEFAULT_URL_TO_INVITATION_URL =
  process.env.REDIRECT_DEFAULT_URL_TO_INVITATION_URL !== 'false'
export const USER_PROFILE_AUTODISCLOSE = process.env.USER_PROFILE_AUTODISCLOSE === 'true'

// [VSA-VTI-CFG-ENV-ECS] claims the agent proposes for its own ECS credentials.
// Every variable is optional here; the Service group is required in standalone mode and
// validateEcsClaimsConfig enforces that. id and the *DigestSri claims are derived, never read.
const env = (name: string): string | undefined => process.env[name]?.trim() || undefined

export const ECS_CLAIMS_ORG = {
  name: env('ECS_CLAIMS_ORG_NAME'),
  logoUri: env('ECS_CLAIMS_ORG_LOGO_URI'),
  registryId: env('ECS_CLAIMS_ORG_REGISTRY_ID'),
  registryUri: env('ECS_CLAIMS_ORG_REGISTRY_URI'),
  address: env('ECS_CLAIMS_ORG_ADDRESS'),
  countryCode: env('ECS_CLAIMS_ORG_COUNTRY_CODE'),
  legalJurisdiction: env('ECS_CLAIMS_ORG_LEGAL_JURISDICTION'),
  organizationKind: env('ECS_CLAIMS_ORG_ORGANIZATION_KIND'),
  lei: env('ECS_CLAIMS_ORG_LEI'),
}

export const ECS_CLAIMS_PERSONA = {
  name: env('ECS_CLAIMS_PERSONA_NAME'),
  description: env('ECS_CLAIMS_PERSONA_DESCRIPTION'),
  descriptionFormat: env('ECS_CLAIMS_PERSONA_DESCRIPTION_FORMAT'),
  avatarUri: env('ECS_CLAIMS_PERSONA_AVATAR_URI'),
  controllerCountryCode: env('ECS_CLAIMS_PERSONA_CONTROLLER_COUNTRY_CODE'),
  controllerJurisdiction: env('ECS_CLAIMS_PERSONA_CONTROLLER_JURISDICTION'),
}

export const ECS_CLAIMS_SERVICE = {
  name: env('ECS_CLAIMS_SERVICE_NAME'),
  type: env('ECS_CLAIMS_SERVICE_TYPE'),
  description: env('ECS_CLAIMS_SERVICE_DESCRIPTION'),
  descriptionFormat: env('ECS_CLAIMS_SERVICE_DESCRIPTION_FORMAT'),
  logoUri: env('ECS_CLAIMS_SERVICE_LOGO_URI'),
  minimumAgeRequired: env('ECS_CLAIMS_SERVICE_MINIMUM_AGE_REQUIRED'),
  termsAndConditionsUri: env('ECS_CLAIMS_SERVICE_TERMS_AND_CONDITIONS_URI'),
  privacyPolicyUri: env('ECS_CLAIMS_SERVICE_PRIVACY_POLICY_URI'),
}

// Placeholder resources the agent serves under /vt/default (by
// DefaultResourcesController) and hashed for the corresponding *DigestSri
// self-tr claim (see main.ts). Defined here, once, so both sides use the
// exact same bytes without the agent having to fetch its own public URL over
// HTTP to hash content it already has in memory — self-fetching that URL at
// startup raced the ingress and 503'd intermittently right after a restart.
// kept in sync with apps/vs-agent-ui/src/assets/logo.svg
export const DEFAULT_LOGO_SVG = `<svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Matches Tailwind's bg-gradient-to-br from #763EF0 to #9F7AEA -->
    <linearGradient id="veranaHeaderGradient" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#763EF0"/>
      <stop offset="100%" stop-color="#9F7AEA"/>
    </linearGradient>
  </defs>

  <!-- Purple gradient capsule -->
  <rect x="0" y="0" width="64" height="64" rx="12" fill="url(#veranaHeaderGradient)"/>

  <!-- White Verana mark scaled to the header proportion -->
  <g transform="translate(32 33) scale(0.76923) translate(-27 -27)" fill="white">
    <path d="M26.9932 51.6972L5.805 11.0977L2.91263 16.2161L0 10.6048L5.98725 0L26.9932 40.2483L47.9993 0L54 10.6217L51.0773 16.2161L48.1849 11.0977L26.9932 51.6972Z"/>
    <path d="M13.696 0L26.9935 25.4637L39.9367 0H13.696Z"/>
  </g>
</svg>
`

const defaultResourcePage = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title></head>
<body><h1>${title}</h1><p>${body}</p></body>
</html>
`

export const DEFAULT_TERMS_HTML = defaultResourcePage(
  'Terms and Conditions',
  'This Verifiable Service has not published its own terms and conditions yet.',
)

export const DEFAULT_PRIVACY_HTML = defaultResourcePage(
  'Privacy Policy',
  'This Verifiable Service has not published its own privacy policy yet.',
)

// Swagger tags for the v2 admin scopes.
// TODO: remove once the methods are implemented
const v2ScopeTag = (summary: string) =>
  `${summary} Reserved for the v2 migration; no methods implemented yet.`

export const ADMIN_V2_TAGS: Record<string, string> = {
  'v2/auth': v2ScopeTag('Exchanges an account signature for a bearer token.'),
  'v2/agent': 'Identifies the agent and reports its state to an orchestrator.',
  'v2/didcomm': 'Operates on the wire-level DIDComm state of the agent.',
  'v2/openid4vc': v2ScopeTag('Operates on the OpenID4VC state of the agent.'),
  'v2/anoncreds': 'Manages the AnonCreds artifacts of the agent.',
  'v2/vt': 'Manages the Verifiable Trust state of the agent.',
}

// AnonCreds params

// Capacity of a revocation registry when the caller does not name one.
export const REVOCATION_REGISTRY_DEFAULT_CAPACITY = 1000

// Utils params
export const MASTER_LIST_CSCA_LOCATION = process.env.MASTER_LIST_CSCA_LOCATION

//Storage update configuration sqlite
export const AGENT_AUTO_UPDATE_STORAGE_ON_STARTUP =
  process.env.AGENT_AUTO_UPDATE_STORAGE_ON_STARTUP !== 'false'

export const AGENT_BACKUP_BEFORE_STORAGE_UPDATE = process.env.AGENT_BACKUP_BEFORE_STORAGE_UPDATE !== 'false' // removed on credo-ts v0.6.0

// Verana network
export const VERANA_INDEXER_BASE_URL = process.env.VERANA_INDEXER_BASE_URL ?? ''
export const VERANA_ACCOUNT_MNEMONIC = process.env.VERANA_ACCOUNT_MNEMONIC
export const VERANA_RPC_ENDPOINT_URL = process.env.VERANA_RPC_ENDPOINT_URL
export const VERANA_CHAIN_ID = process.env.VERANA_CHAIN_ID
export const VERANA_INDEXER_DEFAULT_HANDLERS_OVERRIDE: string[] = (
  process.env.VERANA_INDEXER_DEFAULT_HANDLERS_OVERRIDE ?? ''
)
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
export const VERANA_CORPORATION_ID = process.env.VERANA_CORPORATION_ID
export const VERANA_INDEXER_SUBSCRIPTION_SCOPE = (process.env.VERANA_INDEXER_SUBSCRIPTION_SCOPE ?? 'did')
  .trim()
  .toLowerCase()
export const VERANA_AUTO_TRIGGER_RESOLVER = process.env.VERANA_AUTO_TRIGGER_RESOLVER !== 'false'
export const VERANA_GAS_ADJUSTMENT = process.env.VERANA_GAS_ADJUSTMENT
  ? Number(process.env.VERANA_GAS_ADJUSTMENT)
  : undefined

export const TRUSTED_ECS_ECOSYSTEM_DIDS = (process.env.TRUSTED_ECS_ECOSYSTEM_DIDS ?? '')
  .split(',')
  .map(did => did.trim())
  .filter(Boolean)
export const AGENT_MODE = (process.env.AGENT_MODE ?? '').trim().toLowerCase() || 'standalone'
export const AGENT_DELEGATED_PARENT_VS_DID = process.env.AGENT_DELEGATED_PARENT_VS_DID

export const ADMIN_API_CORPORATION_ALLOWED_ACCOUNTS = (
  process.env.ADMIN_API_CORPORATION_ALLOWED_ACCOUNTS ?? ''
)
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

// Active plugins: comma-separated list of plugin names.
// Available:
//   'messaging' — base V1MessageController + credential/proof handlers (always required)
//   'chat'      — chat Credo modules + chat message handlers
//   'mrtd'      — eMRTD Credo module + MRTD message handlers
//
// In production this value is set by the Docker image (VS_AGENT_PLUGINS env in Dockerfile).
// Only override it in development environments.
export const ENABLED_PLUGINS: string[] = (process.env.VS_AGENT_PLUGINS ?? 'messaging,chat')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

if (!ENABLED_PLUGINS.includes('messaging')) ENABLED_PLUGINS.unshift('messaging')
