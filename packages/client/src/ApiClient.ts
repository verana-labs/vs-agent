// src/ApiClient.ts

import {
  CredentialTypeService,
  DidcommInvitationsService,
  InvitationService,
  MessageService,
  RevocationRegistryService,
  TrustCredentialService,
} from './services'
import { ApiVersion } from './types'

/**
 * `ApiClient` gives access to the Admin API of a VS Agent.
 *
 * Example:
 *
 * const apiClient = new ApiClient('http://localhost', ApiVersion.V1)
 * await apiClient.credentialTypes.getAll()
 * await apiClient.messages.send(message)
 * await apiClient.didcomm.invitations.send({ connectionId, label })
 *
 * Services:
 * - `messages`: send v1 messages.
 * - `credentialTypes`: create, import, export and list credential types.
 * - `revocationRegistries`: create and list revocation registries.
 * - `invitations`: create invitation codes.
 * - `trustCredentials`: issue and revoke Verifiable Trust credentials.
 * - `didcomm`: v2 DIDComm modules. `didcomm.invitations` sends an invitation on a connection.
 */
export class ApiClient {
  public readonly messages: MessageService
  public readonly credentialTypes: CredentialTypeService
  public readonly revocationRegistries: RevocationRegistryService
  public readonly invitations: InvitationService
  public readonly trustCredentials: TrustCredentialService
  public readonly didcomm: { invitations: DidcommInvitationsService }

  constructor(
    private baseURL: string,
    private version: ApiVersion = ApiVersion.V1,
  ) {
    this.invitations = new InvitationService(baseURL, version)
    this.messages = new MessageService(baseURL, version)
    this.credentialTypes = new CredentialTypeService(baseURL, version)
    this.revocationRegistries = new RevocationRegistryService(baseURL, version)
    this.trustCredentials = new TrustCredentialService(baseURL, version)
    this.didcomm = { invitations: new DidcommInvitationsService(baseURL) }
  }
}
