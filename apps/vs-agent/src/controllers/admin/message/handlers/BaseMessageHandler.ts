import type { MessageHandler } from '../MessageHandler'

import { AnonCredsRequestedAttribute } from '@credo-ts/anoncreds'
import { JsonTransformer, utils } from '@credo-ts/core'
import {
  DidCommAutoAcceptCredential,
  DidCommAutoAcceptProof,
  DidCommConnectionRecord,
  DidCommMessageSender,
  DidCommOutboundMessageContext,
  DidCommOutOfBandInvitation,
  DidCommOutOfBandRepository,
} from '@credo-ts/didcomm'
import { Inject, Injectable } from '@nestjs/common'
import {
  CredentialIssuanceMessage,
  CredentialRevocationMessage,
  IBaseMessage,
  IdentityProofRequestMessage,
  IdentityProofResultMessage,
  InvitationMessage,
  MessageType,
  RequestedCredential,
  TerminateConnectionMessage,
  VerifiableCredentialRequestedProofItem,
} from '@verana-labs/vs-agent-model'
import { VsAgent } from '@verana-labs/vs-agent-sdk'

import { validateSchema } from '../../../../utils'
import { CredentialTypesService } from '../../credentials'

@Injectable()
export class BaseMessageHandler implements MessageHandler {
  constructor(@Inject(CredentialTypesService) private readonly credentialService: CredentialTypesService) {}

  readonly supportedTypes: MessageType[] = [
    MessageType.InvitationMessage,
    MessageType.TerminateConnectionMessage,
    MessageType.CredentialIssuanceMessage,
    MessageType.CredentialRevocationMessage,
    MessageType.IdentityProofRequestMessage,
    MessageType.IdentityProofResultMessage,
  ]

  readonly openApiExamples: Record<string, { summary: string; description: string; value: object }> = {
    credentialIssuance: {
      summary: 'Credential Issuance',
      description:
        '#### Credential Issuance\n\nBy sending this message, a Verifiable Credential is effectively issued and sent to the destination connection.\n\nThis message could be sent as a response to a Credential Request. In such case, `threadId` is used to identify credential details. But it can also start a new Credential Issuance flow, and specify\n\nParameters:\n\n- (optional) Credential Definition ID\n- (optional) Credential Schema ID\n- (optional) Revocation Definition ID\n- (optional) Revocation Index\n- (optional) Claims\n\n**Note:** When using revocation parameters (`revocationRegistryDefinitionId` and `revocationRegistryIndex`), it is crucial to preserve both values as they were originally generated with the credential. Each revocation registry has a finite capacity for credentials (default is 1000), and the `revocationRegistryIndex` uniquely identifies the specific credential within the registry. Failing to maintain these parameters correctly may lead to issues during the credential revocation process.\n\nAnother configuration mode is available when a `credentialSchemaId` is provided instead of a `credentialDefinitionId`. This option can only be used if the credential was initially issued through the VS Agent, and it is required when offering credentials to DIDComm connections that do not involve any chatbot.',
      value: {
        type: 'credential-issuance',
        credentialDefinitionId: 'id',
        revocationRegistryDefinitionId: 'id',
        revocationRegistryIndex: 1,
        claims: [{ name: 'claim-name', mimeType: 'mime-type', value: 'claim-value' }],
      },
    },
    credentialRevocation: {
      summary: 'Credential Revocation',
      description:
        '#### Credential Revocation\n\nBy sending this message, a Verifiable Credential is effectively revoked and a notification is sent to the DIDComm connection it has been issued to.\n\nIn this context, `threadId` is used to identify the details of the credential',
      value: { type: 'credential-revocation' },
    },
    credentialReception: {
      summary: 'Credential Reception',
      description:
        "#### Credential Reception\n\nBy sending this message, a recipient acknowledges the reception of a Verifiable Credential (or informs they declined it).\n\nThis message is sent as a response to a Credential Issue. `threadId` is used to identify credential details.\n\nThe state can be one of 'done', 'declined' or 'abandoned', depending on how the flow went.\n\nParameters:\n\n- State: final state of the flow. 'done' in case that the recipient accepted and stored the credential, and 'declined' if they refused to receive it. 'abandoned' may be thrown in case of an error",
      value: { type: 'credential-reception', state: 'done' },
    },
    credentialRequest: {
      summary: 'Credential Request',
      description:
        '#### Credential Request\n\nThis message starts a Credential Issuance flow. The requested credential type is defined by its `credentialDefinitionId`, which must be known beforehand by the requester. Optionally, requester can define some claims about themselves (if not defined, the issuer will get them from other messages (e.g. by requesting proofs or asking through text messages).\n\nParameters:\n\n- Credential Definition ID\n- (optional) Claims (name, phoneNumber, subscriptionId, etc) if needed',
      value: {
        type: 'credential-request',
        credentialDefinitionId: 'id',
        claims: [{ name: 'claim-name', mimeType: 'mime-type', value: 'claim-value' }],
      },
    },
    identityProofRequest: {
      summary: 'Identity Proof Request',
      description:
        '#### Identity Proof Request\n\nStarts an Identity Verification flow, requesting a certain number of identity proofing items. It is usually sent by an issuer to a potential holder before the credential is actually issued.',
      value: {
        type: 'identity-proof-request',
        requestedProofItems: [
          { id: 'UUID', type: 'RequestedProofItemType', 'specific-field': 'SpecificFieldType' },
        ],
      },
    },
    identityProofResult: {
      summary: 'Identity Proof Result',
      description:
        '#### Identity Proof Result\n\nThis message is used to inform about the result of the processing of a certain identity proof item.',
      value: {
        type: 'identity-proof-result',
        proofItemResults: [
          { id: 'UUID', type: 'SubmittedProofItemType', 'specific-field': 'SpecificFieldType' },
        ],
      },
    },
    identityProofSubmit: {
      summary: 'Identity Proof Submit',
      description:
        '#### Identity Proof Submit\n\nThis message is used to inform about the submission of a certain proof identity proof item.',
      value: {
        type: 'identity-proof-submit',
        submittedProofItems: [
          { id: 'UUID', type: 'SubmittedProofItemType', 'specific-field': 'SpecificFieldType' },
        ],
      },
    },
    invitation: {
      summary: 'Invitation',
      description:
        '#### Invitation\n\nCreates an Out of Band invitation message and sends it through an already established DIDComm channel. This is used mostly to generate sub-connections, but can also be used to forward an invitation to a public resolvable DID (passed optionally as a parameter).\n\nIf no `did` specified, a new pairwise connection will be created. The newly created connection will be related to the one where it has been sent (this concept is referred to as `sub-connections`.\n\n`label` and `imageUrl` are optional but recommended. URL is given as a Data URL (it can be either a link or base64-encoded).\n\nThe generated message Id will be used as invitationId un subsequent Connection State Update events. This can be used to correlate connections.',
      value: { type: 'invitation', label: 'string', imageUrl: 'string', did: 'string' },
    },
    terminateConnection: {
      summary: 'Terminate Connection',
      description:
        "#### Terminate Connection\n\nTerminates a particular connection, notifying the other party through a 'Hangup' message. No further messages will be allowed after this action.",
      value: { type: 'terminate-connection' },
    },
  }

  async handle(
    agent: VsAgent<any>,
    message: IBaseMessage,
    connection: DidCommConnectionRecord,
  ): Promise<string | undefined> {
    const messageType = message.type
    let messageId: string | undefined

    if (messageType === InvitationMessage.type) {
      const msg = JsonTransformer.fromJSON(message, InvitationMessage)
      const { label, imageUrl, did } = msg

      const messageSender = agent.context.dependencyManager.resolve(DidCommMessageSender)

      if (did) {
        const json = {
          '@type': DidCommOutOfBandInvitation.type.messageTypeUri,
          '@id': utils.uuid(),
          label: label ?? '',
          imageUrl: imageUrl,
          services: [did],
          handshake_protocols: ['https://didcomm.org/didexchange/1.0'],
        }

        const invitation = DidCommOutOfBandInvitation.fromJson(json)
        invitation.setThread({ parentThreadId: did })

        await messageSender.sendMessage(
          new DidCommOutboundMessageContext(invitation, { agentContext: agent.context, connection }),
        )

        messageId = invitation.id
      } else {
        const outOfBandRecord = await agent.didcomm.oob.createInvitation({ label, imageUrl })
        outOfBandRecord.setTag('parentConnectionId', connection.id)
        await agent.dependencyManager
          .resolve(DidCommOutOfBandRepository)
          .update(agent.context, outOfBandRecord)

        await messageSender.sendMessage(
          new DidCommOutboundMessageContext(outOfBandRecord.outOfBandInvitation, {
            agentContext: agent.context,
            connection,
          }),
        )

        messageId = outOfBandRecord.id
      }
    } else if (messageType === TerminateConnectionMessage.type) {
      JsonTransformer.fromJSON(message, TerminateConnectionMessage)
      await agent.didcomm.connections.hangup({ connectionId: connection.id })
    } else if (messageType === CredentialIssuanceMessage.type) {
      const msg = JsonTransformer.fromJSON(message, CredentialIssuanceMessage)
      let credential
      if (message.threadId)
        [credential] = await agent.didcomm.credentials.findAllByQuery({ threadId: message.threadId })

      if (credential) {
        await agent.didcomm.credentials.acceptProposal({
          credentialExchangeRecordId: credential.id,
          autoAcceptCredential: DidCommAutoAcceptCredential.Always,
        })
      } else {
        let attributes: { name: string; mimeType?: string; value: string }[] = []
        const revocationRegistryDefinitionId = msg.revocationRegistryDefinitionId
        const revocationRegistryIndex = msg.revocationRegistryIndex
        let credentialDefinitionId = msg.credentialDefinitionId
        if (!credentialDefinitionId && msg.jsonSchemaCredentialId) {
          ;({ credentialDefinitionId } =
            await this.credentialService.getOrRegisterAnonCredsCredentialDefinition({
              relatedJsonSchemaCredentialId: msg.jsonSchemaCredentialId,
            }))
        }

        if (!credentialDefinitionId) {
          throw new Error(
            'credentialDefinitionId or jsonSchemaCredentialId must be provided to issue a credential',
          )
        }

        if (msg.claims) {
          const providedAttributes = msg.claims.map(item => ({
            name: item.name,
            mimeType: item.mimeType,
            value: item.value,
          }))

          if (msg.jsonSchemaCredentialId) {
            const { parsedSchema, attrNames } = await this.credentialService.parseJsonSchemaCredential(
              msg.jsonSchemaCredentialId,
            )
            const claimsRecord = Object.fromEntries(providedAttributes.map(a => [a.name, a.value]))
            validateSchema(parsedSchema, claimsRecord)
            attributes = this.credentialService.buildAnonCredsAttributes(attrNames, providedAttributes)
          } else {
            attributes = providedAttributes
          }
        }

        if (attributes.length) {
          const record = await agent.didcomm.credentials.offerCredential({
            connectionId: msg.connectionId,
            credentialFormats: {
              anoncreds: {
                attributes,
                credentialDefinitionId,
                revocationRegistryDefinitionId,
                revocationRegistryIndex,
              },
            },
            protocolVersion: 'v2',
            autoAcceptCredential: DidCommAutoAcceptCredential.Always,
          })
          messageId = record.threadId
        } else {
          throw new Error(
            'Claims and credentialDefinitionId attributes must be present if a credential without related thread is to be issued',
          )
        }
      }
    } else if (messageType === CredentialRevocationMessage.type) {
      const msg = JsonTransformer.fromJSON(message, CredentialRevocationMessage)

      let credentials = await agent.didcomm.credentials.findAllByQuery({ threadId: msg.threadId })
      if (!credentials?.length && msg.threadId) {
        const record = await agent.genericRecords.findById(msg.threadId)
        const threadId = record?.getTag('messageId') as string
        credentials = await agent.didcomm.credentials.findAllByQuery({ threadId })
      }
      if (credentials && credentials.length > 0) {
        for (const credential of credentials) {
          const isRevocable = Boolean(
            credential.getTag('anonCredsRevocationRegistryId') &&
              credential.getTag('anonCredsCredentialRevocationId'),
          )
          if (!isRevocable) throw new Error(`Credential for threadId ${msg.threadId} is not revocable)`)

          const uptStatusListResult = await agent.modules.anoncreds.updateRevocationStatusList({
            revocationStatusList: {
              revocationRegistryDefinitionId: credential.getTag('anonCredsRevocationRegistryId') as string,
              revokedCredentialIndexes: [Number(credential.getTag('anonCredsCredentialRevocationId'))],
            },
            options: {},
          })
          if (!uptStatusListResult.revocationStatusListState.revocationStatusList) {
            throw new Error(`Failed to update revocation status list`)
          }

          await agent.didcomm.credentials.sendRevocationNotification({
            credentialExchangeRecordId: credential.id,
            revocationFormat: 'anoncreds',
            revocationId: `${credential.getTag('anonCredsRevocationRegistryId')}::${credential.getTag('anonCredsCredentialRevocationId')}`,
          })
        }
      } else {
        throw new Error(`No credentials were found for connection: ${msg.connectionId}.`)
      }
    } else if (messageType === IdentityProofRequestMessage.type) {
      const msg = JsonTransformer.fromJSON(message, IdentityProofRequestMessage)

      for (const item of msg.requestedProofItems) {
        if (item.type === 'verifiable-credential') {
          const vcItem = item as VerifiableCredentialRequestedProofItem

          const credentialDefinitionId = vcItem.credentialDefinitionId as string
          let attributes = vcItem.attributes as string[]

          if (!credentialDefinitionId) {
            throw Error('Verifiable credential request must include credentialDefinitionId')
          }

          if (attributes && !Array.isArray(attributes)) {
            throw new Error('Received attributes is not an array')
          }

          const { credentialDefinition } =
            await agent.modules.anoncreds.getCredentialDefinition(credentialDefinitionId)

          if (!credentialDefinition) {
            throw Error(`Cannot find information about credential definition ${credentialDefinitionId}.`)
          }

          const { schema } = await agent.modules.anoncreds.getSchema(credentialDefinition.schemaId)

          if (!schema) {
            throw Error(`Cannot find information about schema ${credentialDefinition.schemaId}.`)
          }

          if (!attributes) attributes = schema.attrNames

          if (!attributes.every(item => schema.attrNames.includes(item))) {
            throw new Error(
              `Some attributes are not present in the requested credential type: Requested: ${attributes}, Present: ${schema.attrNames}`,
            )
          }

          const requestedAttributes: Record<string, AnonCredsRequestedAttribute> = {}
          requestedAttributes[schema.name] = {
            names: attributes,
            restrictions: [{ cred_def_id: credentialDefinitionId }],
          }

          const record = await agent.didcomm.proofs.requestProof({
            comment: vcItem.description as string,
            connectionId: msg.connectionId,
            proofFormats: {
              anoncreds: {
                name: 'proof-request',
                version: '1.0',
                requested_attributes: requestedAttributes,
              },
            },
            protocolVersion: 'v2',
            parentThreadId: msg.threadId,
            autoAcceptProof: DidCommAutoAcceptProof.Never,
          })
          messageId = record.threadId
          record.metadata.set('_2060/requestedCredentials', {
            credentialDefinitionId,
            attributes,
          } as RequestedCredential)
          await agent.didcomm.proofs.update(record)
        }
      }
    } else if (messageType === IdentityProofResultMessage.type) {
      throw new Error(`Identity proof Result not supported`)
    }

    return messageId
  }
}
