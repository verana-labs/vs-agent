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
export const DEFAULT_AGENT_ENDPOINTS = ['ws://localhost:3001']

export const AGENT_PUBLIC_DID = process.env.AGENT_PUBLIC_DID
export const PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL
export const DEFAULT_PUBLIC_API_BASE_URL = 'http://localhost:3001'

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

export const AGENT_DIDCOMM_VERSIONS = (process.env.AGENT_DIDCOMM_VERSIONS ?? 'v1,v2')
  .split(',')
  .map(v => v.trim().toLowerCase())
  .filter(v => v.length > 0)

// Advanced settings
export const AGENT_INVITATION_BASE_URL = process.env.AGENT_INVITATION_BASE_URL ?? 'https://hologram.zone/'
export const REDIRECT_DEFAULT_URL_TO_INVITATION_URL =
  process.env.REDIRECT_DEFAULT_URL_TO_INVITATION_URL !== 'false'
export const USER_PROFILE_AUTODISCLOSE = process.env.USER_PROFILE_AUTODISCLOSE === 'true'

// Values for Organization credential
export const SELF_ISSUED_VTC_ORG_TYPE = process.env.SELF_ISSUED_VTC_ORG_TYPE ?? 'PUBLIC'
export const SELF_ISSUED_VTC_ORG_COUNTRYCODE = process.env.SELF_ISSUED_VTC_ORG_COUNTRYCODE ?? 'EE'
export const SELF_ISSUED_VTC_ORG_REGISTRYID = process.env.SELF_ISSUED_VTC_ORG_REGISTRYID ?? 'ID-123'
export const SELF_ISSUED_VTC_ORG_REGISTRYURL =
  process.env.SELF_ISSUED_VTC_ORG_REGISTRYURL ?? 'https://example.com/registry'
export const SELF_ISSUED_VTC_ORG_ADDRESS = process.env.SELF_ISSUED_VTC_ORG_ADDRESS ?? 'Some address'

// Values for Service credential
export const SELF_ISSUED_VTC_SERVICE_TYPE =
  process.env.SELF_ISSUED_VTC_SERVICE_TYPE?.replace(' ', '_') ?? 'WEB_PORTAL'
export const SELF_ISSUED_VTC_SERVICE_DESCRIPTION =
  process.env.SELF_ISSUED_VTC_SERVICE_DESCRIPTION ?? 'Some description'
export const SELF_ISSUED_VTC_SERVICE_MINIMUMAGEREQUIRED = Number(
  process.env.SELF_ISSUED_VTC_SERVICE_MINIMUMAGEREQUIRED ?? 18,
)
// unset means the agent serves its own placeholder, resolved against publicApiBaseUrl at startup:
// the self-issued credentials hash these resources, so they must be fetchable
export const SELF_ISSUED_VTC_SERVICE_LOGOURI =
  process.env.SELF_ISSUED_VTC_SERVICE_LOGOURI ?? AGENT_INVITATION_IMAGE_URL
export const SELF_ISSUED_VTC_SERVICE_TERMSANDCONDITIONS =
  process.env.SELF_ISSUED_VTC_SERVICE_TERMSANDCONDITIONS
export const SELF_ISSUED_VTC_SERVICE_PRIVACYPOLICY = process.env.SELF_ISSUED_VTC_SERVICE_PRIVACYPOLICY

export const DEFAULT_SELF_ISSUED_VTC_RESOURCES = {
  logoUri: (baseUrl: string) => `${baseUrl}/vt/default/logo.svg`,
  termsAndConditions: (baseUrl: string) => `${baseUrl}/vt/default/terms.html`,
  privacyPolicy: (baseUrl: string) => `${baseUrl}/vt/default/privacy.html`,
}

// Utils params
export const MASTER_LIST_CSCA_LOCATION = process.env.MASTER_LIST_CSCA_LOCATION

//Storage update configuration sqlite
export const AGENT_AUTO_UPDATE_STORAGE_ON_STARTUP =
  process.env.AGENT_AUTO_UPDATE_STORAGE_ON_STARTUP !== 'false'

export const AGENT_BACKUP_BEFORE_STORAGE_UPDATE = process.env.AGENT_BACKUP_BEFORE_STORAGE_UPDATE !== 'false' // removed on credo-ts v0.6.0

// Verana network
export const VERANA_INDEXER_BASE_URL = process.env.VERANA_INDEXER_BASE_URL
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
//   'messaging' — base MessageController + credential/proof handlers (always required)
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
