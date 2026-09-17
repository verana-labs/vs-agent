import { registerAs } from '@nestjs/config'

/**
 * Configuration for the application, including ports, database URIs, and service URLs.
 *
 * @returns {object} - An object containing the configuration settings for the application.
 */
export default registerAs('appConfig', () => ({
  /**
   * The port number on which the application will run.
   * Defaults to 5000 if APP_PORT is not set in the environment variables.
   * @type {number}
   */
  appPort: parseInt(process.env.AGENT_PORT) || 5000,

  /**
   * Hostname or IP address for the PostgreSQL database.
   * Defaults 'postgres' string if POSTGRES_HOST is not set in the environment variables.
   * @type {string}
   */
  postgresHost: process.env.POSTGRES_HOST || 'postgres',

  /**
   * Username for the PostgreSQL database.
   * Defaults 'unicid' string if POSTGRES_USER is not set in the environment variables.
   * @type {string}
   */
  postgresUser: process.env.POSTGRES_USER || 'demo',

  /**
   * Name for the PostgreSQL database.
   * Defaults 'unicid' string if POSTGRES_DB_NAME is not set in the environment variables.
   * @type {string}
   */
  postgresDbName: process.env.POSTGRES_DB_NAME || 'demo',

  /**
   * Password for the PostgreSQL database.
   * Defaults 'demo' string if POSTGRES_PASSWORD is not set in the environment variables.
   * @type {string}
   */
  postgresPassword: process.env.POSTGRES_PASSWORD || '2060demo',

  /**
   * Base URL for VS Agent Admin.
   * Defaults to 'http://localhost:3000' if VS_AGENT_ADMIN_URL is not set in the environment variables.
   * @type {string}
   */
  vsAgentAdminUrl: process.env.VS_AGENT_ADMIN_URL || 'http://localhost:3000',

  jsonSchemaCredentialId: process.env.JSON_SCHEMA_CREDENTIAL_ID,

  /**
   * Base URL for the application.
   * Defaults to 'http://localhost:2902' if PUBLIC_BASE_URL is not set.
   * @type {string}
   */
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:2902',
}))
