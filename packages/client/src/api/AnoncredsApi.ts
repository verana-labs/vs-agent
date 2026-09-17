import { HttpClient } from '../http'
import {
  CreateCredentialDefinitionBody,
  CreateRevocationRegistryBody,
  CreateRevocationRegistryResponse,
  CredentialDefinition,
  CredentialDefinitionPackage,
  DeleteCredentialDefinitionQuery,
  ListRevocationRegistriesQuery,
  Page,
  PaginationQuery,
  RevokeCredentialBody,
  RevokeCredentialResponse,
} from '../types'

export class AnoncredsApi {
  public constructor(private readonly http: HttpClient) {}

  public listCredentialDefinitions(query?: PaginationQuery): Promise<Page<CredentialDefinition>> {
    return this.http.request('GET', '/anoncreds/credential-definitions', { query })
  }

  public createCredentialDefinition(body: CreateCredentialDefinitionBody): Promise<CredentialDefinition> {
    return this.http.request('POST', '/anoncreds/credential-definitions', { body })
  }

  public importCredentialDefinition(body: CredentialDefinitionPackage): Promise<CredentialDefinition> {
    return this.http.request('POST', '/anoncreds/credential-definitions/import', { body })
  }

  public exportCredentialDefinition(credentialDefinitionId: string): Promise<CredentialDefinitionPackage> {
    return this.http.request(
      'GET',
      `/anoncreds/credential-definitions/${encodeURIComponent(credentialDefinitionId)}/export`,
    )
  }

  public deleteCredentialDefinition(
    credentialDefinitionId: string,
    query?: DeleteCredentialDefinitionQuery,
  ): Promise<void> {
    return this.http.request(
      'DELETE',
      `/anoncreds/credential-definitions/${encodeURIComponent(credentialDefinitionId)}`,
      { query },
    )
  }

  public listRevocationRegistries(query?: ListRevocationRegistriesQuery): Promise<Page<string>> {
    return this.http.request('GET', '/anoncreds/revocation-registries', { query })
  }

  public createRevocationRegistry(
    body: CreateRevocationRegistryBody,
  ): Promise<CreateRevocationRegistryResponse> {
    return this.http.request('POST', '/anoncreds/revocation-registries', { body })
  }

  public deleteRevocationRegistry(revocationRegistryDefinitionId: string): Promise<void> {
    return this.http.request(
      'DELETE',
      `/anoncreds/revocation-registries/${encodeURIComponent(revocationRegistryDefinitionId)}`,
    )
  }

  public revokeCredential(body: RevokeCredentialBody): Promise<RevokeCredentialResponse> {
    return this.http.request('POST', '/anoncreds/revoke-credential', { body })
  }
}
