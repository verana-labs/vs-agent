import { PaginationQuery } from './common'

export interface CredentialDefinition {
  id: string
  name: string
  version: string
  attributes: string[]
  supportRevocation: boolean
  relatedJsonSchemaCredentialId: string
}

export interface CreateCredentialDefinitionBody {
  relatedJsonSchemaCredentialId: string
  supportRevocation?: boolean
}

export interface CredentialDefinitionPackageData {
  name?: string
  version?: string
  relatedJsonSchemaCredentialId?: string
  credentialDefinition?: unknown
  credentialDefinitionPrivate?: Record<string, unknown>
  keyCorrectnessProof?: Record<string, unknown>
  schema?: unknown
}

export interface CredentialDefinitionPackage {
  id: string
  data: CredentialDefinitionPackageData
}

export interface DeleteCredentialDefinitionQuery {
  deleteAssociatedRevocationRegistries?: boolean
}

export interface ListRevocationRegistriesQuery extends PaginationQuery {
  credentialDefinitionId?: string
}

export interface CreateRevocationRegistryBody {
  credentialDefinitionId: string
  maximumCredentialNumber?: number
}

export interface CreateRevocationRegistryResponse {
  revocationRegistryDefinitionId: string
}

export interface RevokeCredentialBody {
  revocationRegistryDefinitionId: string
  revocationRegistryIndex: number
}

export interface RevokeCredentialResponse {
  revocationRegistryDefinitionId: string
  revocationRegistryIndex: number
  revokedAt: string
}
