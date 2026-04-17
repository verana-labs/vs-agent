import { utils } from '@credo-ts/core'
import { DidCommDidExchangeState } from '@credo-ts/didcomm'
import { Body, Controller, HttpException, HttpStatus, Logger, Post } from '@nestjs/common'
import {
  ApiBody,
  ApiTags,
  ApiOkResponse,
  ApiInternalServerErrorResponse,
  getSchemaPath,
} from '@nestjs/swagger'
import { BaseMessage } from '@verana-labs/vs-agent-model'
import { VsAgent } from '@verana-labs/vs-agent-sdk'

import { VsAgentService } from '../../../services/VsAgentService'

import { BaseMessageDto } from './dto/base-message.dto'
import { MessageServiceFactory } from './services/MessageServiceFactory'

@ApiTags('message')
@Controller({ path: 'message', version: '1' })
export class MessageController {
  private readonly logger = new Logger(MessageController.name)

  constructor(
    private readonly messageServiceFactory: MessageServiceFactory,
    private readonly agentService: VsAgentService,
  ) {}

  @Post('/')
  @ApiBody({
    type: BaseMessageDto,
    description: [
      '## Messaging',
      '',
      'Messages are submitted in a JSON format, whose base is as follows:',
      '',
      '```json',
      '{',
      '    "connectionId": UUID',
      '    "id": UUID,',
      '    "timestamp": NumericDate,',
      '    "threadId": UUID,',
      '    "type": MessageType,',
      '}',
      '```',
      '',
      '### Messaging to/from other agents',
      '',
      'To message other agents, a single endpoint is used (`/message`), which receives by POST a JSON body containing the message.',
      '',
      'Response from VS-A will generally result in a 200 HTTP response code and include a JSON object with the details of the submission.',
      '',
      '```json',
      '{',
      '  "message": string (optional, in case of error)',
      '  "id": UUID (submitted message id)',
      '}',
      '```',
      '',
      'Available message types depend on the enabled plugins (see `VS_AGENT_PLUGINS` env var).',
    ].join('\n'),

    schema: { allOf: [{ $ref: getSchemaPath(BaseMessageDto) }] },
    // Examples are injected dynamically at startup from registered MessageHandler instances.
    // See commonAppConfig in setupAgent.ts.
    examples: {
      callAccept: {
        summary: 'Call Accept',
        description:
          '#### Call Accept\n\nAccept a call offer from a third party to initiate a WebRTC call. This message will return a `threadId`, which can be used to track the subsequent status of the call. Additional parameters related to the `wsUrl` of the WebRTC server connection are expected to notify the other party.',
        value: {
          type: 'call-accept',
          parameters: {
            key: 'value',
          },
        },
      },
      callReject: {
        summary: 'Call Reject',
        description:
          '#### Call Reject\n\nReject a call offer from a third party to initiate a WebRTC call. This message will return a `threadId`, which can be used to identify which offer has been terminated.',
        value: {
          type: 'call-reject',
        },
      },
      callEnd: {
        summary: 'Call End',
        description:
          '#### Call End\n\nEnd a call offer from a third party to initiate a WebRTC call. This message will return a `threadId`, which can be used to identify which offer has been terminated.',
        value: {
          type: 'call-end',
        },
      },
      callOffer: {
        summary: 'Call Offer',
        description:
          '#### Call Offer\n\nCreate a call offer from a service to initiate a WebRTC call and notify the other party of the created request. This message will return a `threadId`, which can be used to track the subsequent status of the call. Additional parameters related to the `wsUrl` of the WebRTC server connection are expected to notify the other party.',
        value: {
          type: 'call-offer',
          parameters: {
            key: 'value',
          },
        },
      },
      contextualMenuRequest: {
        summary: 'Contextual Menu Request',
        description:
          '#### Contextual Menu Request\n\nRequests a destination agent context menu root (if any). The other side should always respond with a [Context Menu Update](#contextual-menu-update) even if no context menu is available (in such case, an empty payload will be sent).',
        value: {
          type: 'contextual-menu-request',
        },
      },
      contextualMenuSelect: {
        summary: 'Contextual Menu Select',
        description: '#### Contextual Menu Select\n\nSubmits the selected item of context menu.',
        value: {
          type: 'contextual-menu-select',
          selectionId: 'string',
        },
      },
      contextualMenuUpdate: {
        summary: 'Contextual Menu Update',
        description:
          '#### Contextual Menu Update\n\nSends or updates the contents for the contextual menu to destination agent.',
        value: {
          type: 'contextual-menu-update',
          payload: {
            title: 'string',
            description: 'string',
            options: [
              {
                id: 'string',
                title: 'string',
                description: 'string',
              },
            ],
          },
        },
      },
      credentialIssuance: {
        summary: 'Credential Issuance',
        description:
          '#### Credential Issuance\n\nBy sending this message, a Verifiable Credential is effectively issued and sent to the destination connection.\n\nThis message could be sent as a response to a Credential Request. In such case, `threadId` is used to identify credential details. But it can also start a new Credential Issuance flow, and specify\n\nParameters:\n\n- (optional) Credential Definition ID\n- (optional) Credential Schema ID\n- (optional) Revocation Definition ID\n- (optional) Revocation Index\n- (optional) Claims\n\n**Note:** When using revocation parameters (`revocationRegistryDefinitionId` and `revocationRegistryIndex`), it is crucial to preserve both values as they were originally generated with the credential. Each revocation registry has a finite capacity for credentials (default is 1000), and the `revocationRegistryIndex` uniquely identifies the specific credential within the registry. Failing to maintain these parameters correctly may lead to issues during the credential revocation process.\n\nAnother configuration mode is available when a `credentialSchemaId` is provided instead of a `credentialDefinitionId`. This option can only be used if the credential was initially issued through the VS Agent, and it is required when offering credentials to DIDComm connections that do not involve any chatbot.',
        value: {
          type: 'credential-issuance',
          credentialDefinitionId: 'id',
          revocationRegistryDefinitionId: 'id',
          revocationRegistryIndex: 1,
          claims: [
            {
              name: 'claim-name',
              mimeType: 'mime-type',
              value: 'claim-value',
            },
          ],
        },
      },
      credentialRevocation: {
        summary: 'Credential Revocation',
        description:
          '#### Credential Revocation\n\nBy sending this message, a Verifiable Credential is effectively revoked and a notification is sent to the DIDComm connection it has been issued to.\n\nIn this context, `threadId` is used to identify the details of the credential',
        value: {
          type: 'credential-revocation',
        },
      },
      credentialReception: {
        summary: 'Credential Reception',
        description:
          "#### Credential Reception\n\nBy sending this message, a recipient acknowledges the reception of a Verifiable Credential (or informs they declined it).\n\nThis message is sent as a response to a Credential Issue. `threadId` is used to identify credential details.\n\nThe state can be one of 'done', 'declined' or 'abandoned', depending on how the flow went.\n\nParameters:\n\n- State: final state of the flow. 'done' in case that the recipient accepted and stored the credential, and 'declined' if they refused to receive it. 'abandoned' may be thrown in case of an error",
        value: {
          type: 'credential-reception',
          state: 'done',
        },
      },
      credentialRequest: {
        summary: 'Credential Request',
        description:
          '#### Credential Request\n\nThis message starts a Credential Issuance flow. The requested credential type is defined by its `credentialDefinitionId`, which must be known beforehand by the requester. Optionally, requester can define some claims about themselves (if not defined, the issuer will get them from other messages (e.g. by requesting proofs or asking through text messages).\n\nParameters:\n\n- Credential Definition ID\n- (optional) Claims (name, phoneNumber, subscriptionId, etc) if needed',
        value: {
          type: 'credential-request',
          credentialDefinitionId: 'id',
          claims: [
            {
              name: 'claim-name',
              mimeType: 'mime-type',
              value: 'claim-value',
            },
          ],
        },
      },
      emrtdDataRequest: {
        summary: 'eMRTD Data Request',
        description:
          '#### eMRTD Data Request\n\nRequest the other party to read and provide eMRTD (Electronic Machine Readable Travel Document) data from a compatible electronic document.',
        value: {
          type: 'emrtd-data-request',
        },
      },
      emrtdDataSubmit: {
        summary: 'eMRTD Data Submit',
        description:
          "#### eMRTD Data Submit\n\nSubmit data retrieved from an electronic Machine Readable Travel Document. This message may be sent either individually or as a response to an eMRTD Data Request.\n\nThe state can be one of 'submitted', 'declined', 'timeout' or 'error', depending on how the flow went. The latter is used for unspecified errors (e.g. User Agent not capable of handling the request).",
        value: {
          type: 'emrtd-data-submit',
          state: 'MrtdSubmitState',
          dataGroups: 'EMrtdData',
        },
      },
      identityProofRequest: {
        summary: 'Identity Proof Request',
        description:
          '#### Identity Proof Request\n\nStarts an Identity Verification flow, requesting a certain number of identity proofing items. It is usually sent by an issuer to a potential holder before the credential is actually issued.',
        value: {
          type: 'identity-proof-request',
          requestedProofItems: [
            {
              id: 'UUID',
              type: 'RequestedProofItemType',
              'specific-field': 'SpecificFieldType',
            },
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
            {
              id: 'UUID',
              type: 'SubmittedProofItemType',
              'specific-field': 'SpecificFieldType',
            },
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
            {
              id: 'UUID',
              type: 'SubmittedProofItemType',
              'specific-field': 'SpecificFieldType',
            },
          ],
        },
      },
      invitation: {
        summary: 'Invitation',
        description:
          '#### Invitation\n\nCreates an Out of Band invitation message and sends it through an already established DIDComm channel. This is used mostly to generate sub-connections, but can also be used to forward an invitation to a public resolvable DID (passed optionally as a parameter).\n\nIf no `did` specified, a new pairwise connection will be created. The newly created connection will be related to the one where it has been sent (this concept is referred to as `sub-connections`.\n\n`label` and `imageUrl` are optional but recommended. URL is given as a Data URL (it can be either a link or base64-encoded).\n\nThe generated message Id will be used as invitationId un subsequent Connection State Update events. This can be used to correlate connections.',
        value: {
          type: 'invitation',
          label: 'string',
          imageUrl: 'string',
          did: 'string',
        },
      },
      media: {
        summary: 'Media',
        description:
          '#### Media\n\nShares media files to a destination. They might be previously encrypted and stored in an URL reachable by the destination agent.',
        value: {
          type: 'media',
          description: 'string',
          items: [
            {
              mimeType: 'string',
              filename: 'string',
              description: 'string',
              byteCount: 'number',
              uri: 'string',
              ciphering: {
                algorithm: 'string',
              },
              preview: 'string',
              width: 'number',
              height: 'number',
              duration: 'number',
              title: 'string',
              icon: 'string',
              openingMode: 'string',
              screenOrientaton: 'string',
            },
          ],
        },
      },
      mrzDataRequest: {
        summary: 'MRZ Data Request',
        description:
          '#### MRZ Data Request\n\nRequest the other party to provide the Machine Readable Zone string from a valid ID document.',
        value: {
          type: 'mrz-data-request',
        },
      },
      mrzDataSubmit: {
        summary: 'MRZ Data Submit',
        description: `
#### MRZ Data Submit

Submit Machine Readable Zone data. This message may be sent either individually or as a response to a MRZ Data Request.

The state can be one of \`submitted\`, \`declined\`, \`timeout\` or \`error\`, depending on how the flow went. The latter is used for unspecified errors (e.g. User Agent not capable of handling the request).

\`MrzData\` is a JSON object with two basic fields:

- \`raw\`: contains the raw data as sent by the other party (either an array of lines or a single string containing all lines, separated by \\n).
- \`parsed\`: interprets the contents and classifies the document in a format from ICAO 9303 document (TD1, TD2, TD3, etc.).

Example:

\`\`\`json
{
  "raw": [
    "I<UTOD23145890<1233<<<<<<<<<<<",
    "7408122F1204159UTO<<<<<<<<<<<6",
    "ERIKSSON<<ANNA<MARIA<<<<<<<<<<"
  ],
  "parsed": {
    "valid": false,
    "fields": {
      "documentCode": "I",
      "issuingState": null,
      "documentNumber": "D23145890123",
      "documentNumberCheckDigit": "3",
      "optional1": "1233",
      "birthDate": "740812",
      "birthDateCheckDigit": "2",
      "sex": "female",
      "expirationDate": "120415",
      "expirationDateCheckDigit": "9",
      "nationality": null,
      "optional2": "",
      "compositeCheckDigit": null,
      "lastName": "ERIKSSON",
      "firstName": "ANNA MARIA"
    },
    "format": "TD1"
  }
}
\`\`\`

More info about the meaning of each field (and validity) can be found in [MRZ](https://github.com/cheminfo/mrz), the underlying library we are using for MRZ parsing.
  `,
        value: {
          type: 'mrz-data-submit',
          state: 'MrtdSubmitState',
          mrzData: 'MrzData',
        },
      },
      menuDisplay: {
        summary: 'Menu Display',
        description: 'Menu Display\n\nAuto-generated example .',
        value: {
          type: 'menu-display',
          connectionId: 'REPLACE_WITH_CONNECTION_ID',
          timestamp: '2025-08-19T16:17:08.871Z',
        },
      },
      menuSelect: {
        summary: 'Menu Select',
        description:
          '#### Menu Select\n\nSubmits the selected item of a presented menu, defined in `threadId` field.',
        value: {
          type: 'menu-select',
          menuItems: [
            {
              id: 'string',
            },
          ],
          content: 'string',
        },
      },
      profile: {
        summary: 'Profile',
        description:
          '#### Profile\n\nSends User Profile to a particular connection. An Agent may have its default profile settings, but also override them and send any arbitrary value to each connection. All items are optional.\n\n> **Notes**:\n\n- Display Image and Contextual Menu Image are sent as a Data URL or regular URL\n- A null value means to delete any existing one. A missing value means to keep the previous one.',
        value: {
          type: 'profile',
          displayName: 'string',
          displayImageUrl: 'string',
          displayIconUrl: 'string',
        },
      },
      reaction: {
        summary: 'Reaction',
        description:
          '#### Reaction\n\nSends emoji reactions to previously received messages. Each reaction references a `message_id` and an `emoji`. Use `action: "react"` to add a reaction or `action: "unreact"` to remove it.',
        value: {
          type: 'reaction',
          reactions: [
            {
              message_id: 'uuid-of-original-message',
              emoji: '👍',
              action: 'react',
            },
          ],
        },
      },
      receipts: {
        summary: 'Receipts',
        description: '#### Receipts\n\nSends message updates for a number of messages.',
        value: {
          type: 'receipts',
          receipts: [
            {
              messageId: 'string',
              state: 'MessageState',
              timestamp: 'Date',
            },
          ],
        },
      },
      terminateConnection: {
        summary: 'Terminate Connection',
        description:
          "#### Terminate Connection\n\nTerminates a particular connection, notifying the other party through a 'Hangup' message. No further messages will be allowed after this action.",
        value: {
          type: 'terminate-connection',
        },
      },
      text: {
        summary: 'Text',
        description: '#### Text\n\nSends a simple text to a destination',
        value: {
          type: 'text',
          content: 'string',
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Message sent successfully',
    schema: { example: { id: '550e8400-e29b-41d4-a716-446655440000' } },
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error',
    schema: {
      example: {
        statusCode: 500,
        error: 'something went wrong: Error message here',
      },
    },
  })
  public async sendMessage(@Body() message: BaseMessage): Promise<{ id: string }> {
    try {
      const agent = await this.agentService.getAgent()
      await this.checkForDuplicateId(agent, message)
      const connection = await agent.didcomm.connections.findById(message.connectionId)

      if (!connection) throw new Error(`Connection with id ${message.connectionId} not found`)
      if (
        connection.state === DidCommDidExchangeState.Completed &&
        (!connection.did || !connection.theirDid)
      ) {
        throw new Error(`This connection has been terminated. No further messages are possible`)
      }

      const messageId = message.id ?? utils.uuid()
      message.id = messageId

      await this.messageServiceFactory.processMessage(message, connection)
      return { id: messageId }
    } catch (error) {
      this.logger.error(`Error: ${error.stack}`)
      throw new HttpException(
        {
          statusCode: error.statusCode ?? HttpStatus.INTERNAL_SERVER_ERROR,
          error: `something went wrong: ${error}`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
        {
          cause: error,
        },
      )
    }
  }

  private async checkForDuplicateId(agent: VsAgent, message: BaseMessage): Promise<void> {
    const records = message.id
      ? await agent.genericRecords.findAllByQuery({
          messageId: message.id,
          connectionId: message.connectionId,
        })
      : null

    if (records && records.length > 0) throw new Error(`Duplicated ID: ${message.id}`)
  }
}
