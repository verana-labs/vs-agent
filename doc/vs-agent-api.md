# VS Agent API

This document describes the main interface between a VS Agent instance and the backend that controls it.

VS Agent API consists on a REST-like interface that exposes endpoints to:

- Send messages to other agents
- Register new credential types on Verifiable Data Registry
- Query connections, credentials and messages emitted or received
- Configure agent

In addition, it supports a notification mechanism to subscribe to any event the consumer is interested in, through either HTTP Webhooks (POST endpoints exposed by the consumer) or a long-lived WebSocket connection.

- [VS Agent API](#vs-agent-api)
  - [Messaging](#messaging)
    - [Messaging to/from other agents](#messaging-tofrom-other-agents)
    - [Message types](#message-types)
      - [Credential Request](#credential-request)
      - [Credential Issuance](#credential-issuance)
      - [Credential Revocation](#credential-revocation)
      - [Credential Reception](#credential-reception)
      - [Identity Proof Request](#identity-proof-request)
      - [Identity Proof Submit](#identity-proof-submit)
      - [Identity Proof Result](#identity-proof-result)
      - [Text](#text)
      - [Media](#media)
      - [Reaction](#reaction)
      - [Receipts](#receipts)
      - [Contextual Menu Request](#contextual-menu-request)
      - [Contextual Menu Update](#contextual-menu-update)
      - [Contextual Menu Select](#contextual-menu-select)
      - [Display Menu](#display-menu)
      - [Menu Select](#menu-select)
      - [Invitation](#invitation)
      - [Profile](#profile)
      - [Terminate Connection](#terminate-connection)
      - [Call Offer](#call-offer)
      - [Call Accept](#call-accept)
      - [Call Reject](#call-reject)
      - [Call End](#call-end)
      - [MRZ Data Request](#mrz-data-request)
      - [MRZ Data Submit](#mrz-data-submit)
      - [eMRTD Data Request](#emrtd-data-request)
      - [eMRTD Data Submit](#emrtd-data-submit)
    - [Identity Proof Item types](#identity-proof-item-types)
      - [Verifiable Credential](#verifiable-credential)
        - [Request value](#request-value)
        - [Submit value](#submit-value)
        - [Result value](#result-value)
  - [Events](#events)
    - [Event topics](#event-topics)
      - [Connection State Updated](#connection-state-updated)
      - [Message State Updated](#message-state-updated)
      - [Message Received](#message-received)
    - [Subscribing to events](#subscribing-to-events)
  - [Invitations](#invitations)
    - [Connection Invitation](#connection-invitation)
    - [Presentation Request](#presentation-request)
      - [Presentation Callback API](#presentation-callback-api)
    - [Credential Offer](#credential-offer)
  - [Presentations](#presentations)
  - [Verifiable Data Registry Operations](#verifiable-data-registry-operations)
    - [Create Credential Type](#create-credential-type)

## Messaging

Messages are submitted in a JSON format, whose base is as follows:

```json
{
    "connectionId": UUID
    "id": UUID,
    "timestamp": NumericDate,
    "threadId": UUID,
    "type": MessageType,
}
```

### Messaging to/from other agents

To message other agents, a single endpoint is used (`/message`), which receives by POST a JSON body containing the message.

Response from VS-A will generally result in a 200 HTTP response code and include a JSON object with the details of the submission.

```json
{
  "message": string (optional, in case of error)
  "id": UUID (submitted message id)
}
```

Using the message `id`, the agent controller can subscribe and verify the message sending status.

To receive messages from other agents, the controller can subscribe to `message-received` topic.

### Message types

Currently, the following messages can be submitted and received:

- Credential Request (`credential-request`)
- Credential Issuance (`credential-issuance`)
- Identity Proof Request (`identity-proof-request`)
- Identity Proof Submit (`identity-proof-submit`)
- Text (`text`)
- Menu Display (`menu-display`)
- Menu Select (`menu-select`)
- Contextual Menu Request (`contextual-menu-request`)
- Contextual Menu Update (`contextual-menu-update`)
- Contextual Menu Select (`contextual-menu-select`)
- Media (`media`)
- Reaction (`reaction`)
- Receipts (`receipts`)
- Invitation (`invitation`)
- Profile (`profile`)
- Terminate Connection (`terminate-connection`)
- Call Offer (`call-offer`)
- Call Accept (`call-accept`)
- Call Reject (`call-reject`)
- Call End (`call-end`)

> **TODO**: Messages for:
>
> - System messages in topics
> - Message signaling (typing)

#### Credential Request

This message starts a Credential Issuance flow. The requested credential type is defined by its `credentialDefinitionId`, which must be known beforehand by the requester. Optionally, requester can define some claims about themselves (if not defined, the issuer will get them from other messages (e.g. by requesting proofs or asking through text messages).

Parameters:

- Credential Definition ID
- (optional) Claims (name, phoneNumber, subscriptionId, etc) if needed

```json
{
  "type": "credential-request",
  "credentialDefinitionId": "id",
  "claims": [{ "name": "claim-name", "mimeType": "mime-type", "value": "claim-value" }]
}
```

Example:

- Phone Number VC: `{ credentialDefinitionId: 'vc-issuer-1:TAG:1, claims: [phoneNumber: "+5731294956" ]}`
- Subscription VC: `{ credentialDefinitionId: 'vc-issuer-2:TAG:1 }`

#### Credential Issuance

By sending this message, a Verifiable Credential is effectively issued and sent to the destination connection.

This message could be sent as a response to a Credential Request. In such case, `threadId` is used to identify credential details. But it can also start a new Credential Issuance flow, and specify

Parameters:

- (optional) Credential Definition ID
- (optional) Credential Schema ID
- (optional) Revocation Definition ID
- (optional) Revocation Index
- (optional) Claims

**Note:** When using revocation parameters (`revocationRegistryDefinitionId` and `revocationRegistryIndex`), it is crucial to preserve both values as they were originally generated with the credential. Each revocation registry has a finite capacity for credentials (default is 1000), and the `revocationRegistryIndex` uniquely identifies the specific credential within the registry. Failing to maintain these parameters correctly may lead to issues during the credential revocation process.
```json
{
  "type": "credential-issuance",
  "credentialDefinitionId": "id",
  "revocationRegistryDefinitionId": "id",
  "revocationRegistryIndex": 1,
  "claims": [{ "name": "claim-name", "mimeType": "mime-type", "value": "claim-value" }]
}
```
Another configuration mode is available when a `credentialSchemaId` is provided instead of a `credentialDefinitionId`. This option can only be used if the credential was initially issued through the VS Agent, and it is required when offering credentials to DIDComm connections that do not involve any chatbot.

##### Creating and Using a Credential Schema
- Step 1: Create a credential schema
Use the following `curl` command to create a new credential schema.
```bash
curl -X 'POST' \
  'http://localhost:3000/vt/issue-credential' \
  -H 'accept: */*' \
  -H 'Content-Type: application/json' \
  -d '{
  "format": "anoncreds",
  "jsonSchemaCredential": "https://localhost:3001/vt/schemas-organization-jsc.json",
  "claims": {
    "id": "https://example.org/org/123",
    ...
  }
}'
```
This request returns a schema identifier, for example:
```bash
{
  ...,
  "credential": {
    "credentialExchangeId": "0e7e54ca-b71a-41d9-8a64-2e67270f0311"
  }
}
```
- Use the created credential schema in a DIDComm message
```bash
{
  "type": "credential-issuance",
  "connectionId": "6813b904-6f34-4ba1-b7dc-68548b689f57",
  "credentialSchemaId": "0e7e54ca-b71a-41d9-8a64-2e67270f0311"
}

```

#### Credential Revocation

By sending this message, a Verifiable Credential is effectively revoked and a notification is sent to the DIDComm connection it has been issued to.

In this context, `threadId` is used to identify the details of the credential

```json
{
  "type": "credential-revocation"
}
```

#### Credential Reception

By sending this message, a recipient acknowledges the reception of a Verifiable Credential (or informs they declined it).

This message is sent as a response to a Credential Issue. `threadId` is used to identify credential details.

The state can be one of 'done', 'declined' or 'abandoned', depending on how the flow went.

Parameters:

- State: final state of the flow. 'done' in case that the recipient accepted and stored the credential, and 'declined' if they refused to receive it. 'abandoned' may be thrown in case of an error

```json
{
  "type": "credential-reception",
  "state": "done"
}
```

#### Identity Proof Request

Starts an Identity Verification flow, requesting a certain number of identity proofing items. It is usually sent by an issuer to a potential holder before the credential is actually issued.

```json
{
  "type": "identity-proof-request",
  "requestedProofItems": [
    {
      "id": "UUID",
      "type": "RequestedProofItemType",
      "specific-field": "SpecificFieldType"
    }
  ]
}
```

Item `id` is an unique identifier of the requested item, which will be used as a reference when submitting it. Item `type` and other fields depend on the nature of the proof requested.

#### Identity Proof Submit

This message is used to inform about the submission of a certain proof identity proof item.

```json
{
  "type": "identity-proof-submit",
  "submittedProofItems": [
    {
      "id": "UUID",
      "type": "SubmittedProofItemType",
      "specific-field": "SpecificFieldType"
    }
  ]
}
```

Item `id` is an unique identifier of the requested item, which will be used as a reference when submitting it. Item `type` and other fields depend on the nature of the proof requested.

#### Identity Proof Result

This message is used to inform about the result of the processing of a certain identity proof item.

```json
{
  "type": "identity-proof-result",
  "proofItemResults": [
    {
      "id": "UUID",
      "type": "SubmittedProofItemType",
      "specific-field": "SpecificFieldType"
    }
  ]
}
```

Item `id` is an unique identifier of the requested item, which will be used as a reference when submitting it. Item `type` and other fields depend on the nature of the proof requested.

#### Text

Sends a simple text to a destination

```json
{
  "type": "text",
  "content": "string"
}
```

#### Media

Shares media files to a destination. They might be previously encrypted and stored in an URL reachable by the destination agent.

```json
{
  "type": "media",
  "description": "string",
  "items": [
    {
      "mimeType": "string",
      "filename": "string",
      "description": "string",
      "byteCount": "number",
      "uri": "string",
      "ciphering": { "algorithm": "string" },
      "preview": "string",
      "width": "number",
      "height": "number",
      "duration": "number",
      "title": "string",
      "icon": "string",
      "openingMode": "string",
      "screenOrientaton": "string"
    }
  ]
}
```

`mimeType` is mandatory and specifies the kind of media that is being shared. Some supported types are:

- `image/png` and `image/jpg` for images
- `video/*` for videos
- `audio/*` for voice notes
- `text/html` for links to websites

`filename`, `description` and `byteCount` are optional but recommended to make it easier for the receiving end to know information about the file about to be downloaded.

`ciphering` is optional but recommended. Other parameters are optional and depend on the nature of the media that is being shared. Namely:

- `preview`: is a string used mainly for video and images that includes a base64-encoded thumbnail
- `width` and `height` are used also for videos and images to let the other party know the actual dimensions of the media before downloading it (e.g. to pre-calculate the placeholder in their screen). They are measured in pixels
- `duration` is used in videos and audio files to specify the number of seconds they last

There are some parameters used in Links (`text/html` mimeType):

- title
- icon: URL or Data URI containing the icon to show as preview of the website
- openingMode: `embedded` or `fullScreen`
- screenOrientation: `portrait` or `landscape` in case it is requested to force a specific orientation (leave it undefined in case there is no need to force orientation)

> **Note**:
>
> - At the moment, only a single media file per message is supported. The list format is kept for future compatibility

#### Reaction

Sends emoji reactions to previously received messages, following the [DIDComm Reactions 1.0](https://didcomm.org/reactions/1.0) protocol. Each reaction references a `message_id` and an `emoji`. Use `action: "react"` to add a reaction or `action: "unreact"` to remove it.

```json
{
  "type": "reaction",
  "reactions": [
    {
      "message_id": "UUID",
      "emoji": "👍",
      "action": "react"
    }
  ]
}
```

> **Note**: Reactions are not plain text emoji messages. They are DIDComm protocol messages that explicitly reference a prior message by its `message_id`. A client sending a plain emoji character as a text message will still arrive as a `text` type, not as a `reaction`.

#### Receipts

Sends message updates for a number of messages.

```json
{
  "type": "receipts",
  "receipts": [
    {
      "messageId": "string",
      "state": "MessageState",
      "timestamp": "Date"
    }
  ]
}
```

#### Contextual Menu Request

Requests a destination agent context menu root (if any). The other side should always respond with a [Context Menu Update](#contextual-menu-update) even if no context menu is available (in such case, an empty payload will be sent).

```json
{
  "type": "contextual-menu-request"
}
```

Description fields are optional and used as a prompt to give more details about each option (and the contextual menu itself). ID fields are used to identify the selection when an agent interacts with the contextual menu.

#### Contextual Menu Update

Sends or updates the contents for the contextual menu to destination agent.

```json
{
  "type": "contextual-menu-update",
  "payload": {
    "title": "string",
    "description": "string",
    "options": [
      {
        "id": "string",
        "title": "string",
        "description": "string"
      }
    ]
  }
}
```

Description fields are optional and used as a prompt to give more details about each option (and the contextual menu itself). ID fields are used to identify the selection when an agent interacts with the contextual menu.

#### Contextual Menu Select

Submits the selected item of context menu.

```json
{
  "type": "contextual-menu-select",
  "selectionId": "string"
}
```

_selectionId_ field matches the id from the option that user has selected.

#### Display Menu

Sends a menu to display different actions in destination agent

```json
{

   "type": "menu-display",
   "prompt": "string"
   "menuItems" : [
   {
     "id": "string",
     "text": "string",
     "action": "Action"
   }],
}
```

For each item, `action` is an optional field used in case that an external action is required when the user chooses it. For instance, open a browsing session or connecting with another contact. Currently, `Action` items are not yet defined.

#### Menu Select

Submits the selected item of a presented menu, defined in `threadId` field.

```json
{
  "type": "menu-select",
  "menuItems": [
    {
      "id": "string"
    }
  ],
  "content": "string"
}
```

#### Invitation

Creates an Out of Band invitation message and sends it through an already established DIDComm channel. This is used mostly to generate sub-connections, but can also be used to forward an invitation to a public resolvable DID (passed optionally as a parameter).

If no `did` specified, a new pairwise connection will be created. The newly created connection will be related to the one where it has been sent (this concept is referred to as `sub-connections`.

`label` and `imageUrl` are optional but recommended. URL is given as a Data URL (it can be either a link or base64-encoded).

The generated message Id will be used as invitationId un subsequent Connection State Update events. This can be used to correlate connections.

```json
{
  "type": "invitation",
  "label": "string",
  "imageUrl": "string",
  "did": "string"
}
```

#### Profile

Sends User Profile to a particular connection. An Agent may have its default profile settings, but also override them and send any arbitrary value to each connection. All items are optional.

> **Notes**:

- Display Image and Contextual Menu Image are sent as a Data URL or regular URL
- A null value means to delete any existing one. A missing value means to keep the previous one.

```json
{
  "type": "profile",
  "displayName": "string",
  "displayImageUrl": "string",
  "displayIconUrl": "string"
}
```

#### Terminate Connection

Terminates a particular connection, notifying the other party through a 'Hangup' message. No further messages will be allowed after this action.

```json
{
  "type": "terminate-connection"
}
```

#### Call Offer

Create a call offer from a service to initiate a WebRTC call and notify the other party of the created request. This message will return a `threadId`, which can be used to track the subsequent status of the call. Additional parameters related to the `wsUrl` of the WebRTC server connection are expected to notify the other party.

```json
{
  "type": "call-offer",
  "parameters": {
    "key": "value"
  }
}
```

#### Call Accept

Accept a call offer from a third party to initiate a WebRTC call. This message will return a `threadId`, which can be used to track the subsequent status of the call. Additional parameters related to the `wsUrl` of the WebRTC server connection are expected to notify the other party.

```json
{
  "type": "call-accept",
  "parameters": {
    "key": "value"
  }
}
```

#### Call Reject

Reject a call offer from a third party to initiate a WebRTC call. This message will return a `threadId`, which can be used to identify which offer has been terminated.

```json
{
  "type": "call-reject"
}
```

#### Call End

End a call offer from a third party to initiate a WebRTC call. This message will return a `threadId`, which can be used to identify which offer has been terminated.

```json
{
  "type": "call-end"
}
```

#### MRZ Data Request

Request the other party to provide the Machine Readable Zone string from a valid ID document.

```json
{
  "type": "mrz-data-request"
}
```

#### MRZ Data Submit

Submit Machine Readable Zone data. This message may be sent either individually or as a response to a MRZ Data Request.

The state can be one of 'submitted', 'declined', 'timeout' or 'error', depending on how the flow went. The latter is used for unspecified errors (e.g. User Agent not capable of handling the request).

```json
{
  "type": "mrz-data-submit",
  "state": "MrtdSubmitState",
  "mrzData": "MrzData"
}
```

`MrzData` is a JSON object with two basic fields:

- `raw` contains the raw data as sent by the other party (either an array of lines or a single string containing all lines, separated by \n).

- `parsed` interprets the contents and classify the document in a format from ICAO 9303 document (TD1, TD2, TD3, etc.). Example:

```json
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
```

More info about the meaning of each field (and validity) can be found in [MRZ](https://github.com/cheminfo/mrz), the underlying library we are using for MRZ parsing.

#### eMRTD Data Request

Request the other party to read and provide eMRTD (Electronic Machine Readable Travel Document) data from a compatible electronic document.

```json
{
  "type": "emrtd-data-request"
}
```

> TODO: Add parameters once supported by @2060.io/credo-ts-didcomm-mrtd module

#### eMRTD Data Submit

Submit data retrieved from an electronic Machine Readable Travel Document. This message may be sent either individually or as a response to an eMRTD Data Request.

The state can be one of 'submitted', 'declined', 'timeout' or 'error', depending on how the flow went. The latter is used for unspecified errors (e.g. User Agent not capable of handling the request).

```json
{
  "type": "emrtd-data-submit",
  "state": "MrtdSubmitState",
  "dataGroups": "EMrtdData"
}
```

`dataGroups` is a JSON object with two basic fields:

- raw: object containing all data groups read from the chip in base64 format
- parsed: object containing all interpreted fields and a global 'valid' flag to indicate if the document structure and integrity has been properly validated

> TODO: Document better the interpreted fields or refer to the libraries to check the format.

### Identity Proof Item types

When a Credential Issuance is requested, the issuer might require the recipient to present certain identity proofing elements.

For instance:

- Verifiable Credential
- Documents (File uploads)
- Live video (file uploads)
- Video call
- In-Person Meeting

Currently, the following types are supported:

- Verifiable Credential: 'verifiable-credential'

#### Verifiable Credential

This proof type involves a [Present Proof](https://github.com/hyperledger/aries-rfcs/tree/main/features/0454-present-proof-v2) flow, where a Verifiable Presentation is created and sent by the _prover_.

##### Request value

When requesting a Verifiable Credential, the following fields must be included:

- description: human readable text string to prompt the user
- credentialDefinitionId
- (optional) attributes: names of the required claims from the credential. If not defined, all claims will be requested

##### Submit value

When a Verifiable Credential Presentation is submitted, the following fields may be included:

- proofExchangeId: reference to the proof exchange
- claims: list of received claims
- verified: boolean determining if the presentation is cryptographically valid
- errorCode: if any, it indicated that an error has ocurred in the flow. Known error codes are the following:
  - 'Request declined': user has refused to present credential
  - 'e.msg.no-compatible-credentials': user does not have a compatible credential to present

##### Result value

When a Verifiable Credential is processed, a result message may be generated. Its value will contain the following fields:

- code: 'ok', 'error'
- (optional) description: human readable description of the error produced

## Events

VS Agent Notification interface supports the following event topics:

- Connection State Updated (`connection-state-updated`): usually for new connections
- Message State Updated (`message-state-updated`): used to keep track of sent messages
- Message Received (`message-received`): for reception of any message

Events are JSON-encoded and include their underlying data in their payload field:

```json
{
  "timestamp": "NumericDate",
  "type": "EventType",
  "event-specific-field": "EventSpecificFieldType"
}
```

`EventType` is a string, while `EventSpecificFieldType` is a free structure dependant on the event type (there might be multiple fields for a given event)

### Event topics

#### Connection State Updated

Sent whenever a connection has been created or updated. Event format is as follows:

```json
{
  "type": "connection-state-updated",
  "connectionId": "UUID",
  "invitationId": "UUID",
  "state": "ConnectionState"
}
```

ConnectionState corresponds to the different states in [DID Exchange protocol](https://github.com/hyperledger/aries-rfcs/blob/main/features/0023-did-exchange/README.md).

#### Message State Updated

Sent when a message delivery status has been changed. Event format is as follows:

```json
{
  "type": "message-state-updated",
  "messageId": "UUID",
  "timestamp": "NumericDate",
  "connectionId": "UUID",
  "state": "MessageState"
}
```

MessageState corresponds to the different states specified in [Messaging](<[https://gitlab/messaging.md](https://gitlab.mobiera.com/2060/2060-spec/-/blob/master/messaging.md)>).

#### Message Received

Sent when a message is received. Event format is as follows:

```json
{
  "type": "message-received",
  "message": "Message"
}
```

Payload contains the message itself, as specified in the previous section.

### Subscribing to events

> **NOTE**: Not yet supported by VS Agent implementation
> Subscription to events is maanaged in a REST route (`/event-subscriptions`) that allows to list, create and remove Webhooks for different topics.

Subscriptions are composed by:

- (optional) type: EventType (or array of Event Types). If not specified, send all events to the endpoint
- (optional) filter: send only events that match specific fields. This only works when a particular EventType is defined in type
- endpoint: URL where VS Agent will connect to send the notifications (it could be HTTP or WS)

## Invitations

VS Agent supports the creation of invitation codes that are used to start flows with agents where a persistent DIDComm connection is not yet established. For that purpose, three types of invitations are provided:

- Connection Invitation: invite other agents to create a persistent, general purpose DIDComm connection. Codes created can be re-used by multiple agents that want to connect by processing it
- Presentation Request: invite other agent to start a Presentation Request flow. Codes created can only be used once
- Credential Offer: invite other agent to start a credential issuance flow. Codes created can only be used once

### Connection Invitation

It's a GET request to `/invitation`. It does not receive any parameter.

Response from VS Agent is a JSON object containing an URL-encoded invitation, ready to be rendered in a QR code or sent as a link for processing of an Aries-compatible DIDComm agent:

```json
{
  "url": "string containing long form URL-encoded invitation"
}
```

Note that the following VS Agent configuration environment variables are used when creating invitations:

- AGENT_INVITATION_BASE_URL: Base URL for invitations (e.g. <https://hologram.zone/>)
- AGENT_INVITATION_IMAGE_URL: An optional image URL to display along the connection invitation
- AGENT_LABEL: An optional label to show along the connection invitation

### Presentation Request

Presentation Request invitation codes are created by specifying details of the credentials required.

This means that a single presentation request can ask for a number of attributes present in a credential a holder might possess.
At the moment, credential requirements are only filtered by their `credentialDefinitionId`. If no `attributes` are specified,
then VS Agent will ask for all attributes in the credential.

It's a POST to `/invitation/presentation-request` which receives a JSON object in the body

```json
{
  "callbackUrl": "https://myhost.com/presentation_callback ",
  "ref": "1234-5678",
  "requestedCredentials": [
    {
      "credentialDefinitionId": "full credential definition identifier",
      "attributes": ["attribute-1", "attribute-2"]
    }
  ]
}
```

`callbackUrl` is an URL that will be called by VS Agent when the flow completes. The request follows the [Presentation Callback API](#presentation-callback-api).

`ref` is an optional, arbitrary string that will be included in the body of the request to the callback URL.

Response will include the invitation code in both short and long form URL format.

```json
{
  "url": "string containing long form URL-encoded invitation",
  "shortUrl": "string containing a shortened URL for the invitation",
  "proofExchangeId": "unique identifier for the flow"
}
```

Note that the following VS Agent configuration environment variables are used when creating presentation request invitations:

- AGENT_INVITATION_BASE_URL: Base URL for long-form invitations (e.g. <https://hologram.zone/>)
- AGENT_INVITATION_IMAGE_URL: An optional image URL to display along the connection invitation
- AGENT_LABEL: An optional label to show along the connection invitation
- PUBLIC_API_BASE_URL: Base URL for short URL creation (resulting something like `https://myHost.com/s?id=<uuid>`)

#### Presentation Callback API

When the presentation flow is completed (either successfully or not), VS Agent calls its `callbackUrl` as an HTTP POST with the following body:

```json
{
  "ref": "1234-5678",
  "presentationRequestId": "unique identifier for the flow",
  "status": "PresentationStatus",
  "claims": [
    { "name": "attribute-1", "value": "value-1" },
    { "name": "attribute-2", "value": "value-2" }
  ]
}
```

Possible values for PresentationStatus are:

- 'ok'
- 'connected'
- 'refused'
- 'no-compatible-credentials'
- 'verification-error'
- 'unspecified-error'

### Credential Offer

Credential offer invitation codes include a preview of the offered credential, meaning by that its `credentialDefinitionId` and claims.

It's a POST to `/invitation/credential-offer` which receives a JSON object in the body

```json
{
  "credentialDefinitionId": "full credential definition identifier",
  "claims": [
    { "name": "attribute-1", "value": "value-1" },
    { "name": "attribute-2", "value": "value-2" }
  ]
}
```

Response will include the invitation code in both short and long form URL format.

```json
{
  "url": "string containing long form URL-encoded invitation",
  "shortUrl": "string containing a shortened URL for the invitation",
  "credentialOfferId": "unique identifier for the flow"
}
```

Note that the following VS Agent configuration environment variables are used when creating credential offer invitations:

- AGENT_INVITATION_BASE_URL: Base URL for long-form invitations (e.g. <https://hologram.zone/>)
- AGENT_INVITATION_IMAGE_URL: An optional image URL to display along the connection invitation
- AGENT_LABEL: An optional label to show along the connection invitation
- PUBLIC_API_BASE_URL: Base URL for short URL creation (resulting something like `https://myHost.com/s?id=<uuid>`)

## Presentations

It is possible to query all presentation flows created by VS Agent through the endpoint `/presentations`, which will respond with records using the following format:

- proofExchangeId: flow identifier (the same as the one used in events and other responses)
- state: current state of the presentation flow (e.g. `request-sent` when it was just started, `done` when finished)
- claims: array containing the claims received within the presentation
- verified: boolean stating if the presentation is valid (only meaningful when state is `done`)
- threadId: DIDComm thread id (shared with the other party)
- updatedAt: last time activity was recorded for this flow

It is possible to query for a single presentation by executing a GET to `/presentations/<proofExchangeId>`.

## Verifiable Data Registry Operations

This section specifies the different endpoints provided by the VS Agent to operate with the VDR.

### Create Credential Type

This command allows to create a new credential format and publish it so credentials with this format can be requested by users and verifiers that are willing to use them.

It's a POST request to `/credential-types` which receives a JSON object in the body

```json
{
  "name": "string",
  "version": "string",
  "attributes": ["attribute-1", "attribute-2"]
}
```

Response from VS Agent will generally result in a 200 HTTP response code and include a JSON object with the details of the submission.

```json
{
  "message": "string (optional, only in case of error)",
  "id": "credential definition Id (as registered in VDR)"
}
```
