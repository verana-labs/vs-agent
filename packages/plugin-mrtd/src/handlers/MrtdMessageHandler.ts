import type { MessageHandler } from '@verana-labs/vs-agent-sdk'

import { JsonTransformer } from '@credo-ts/core'
import { DidCommConnectionRecord } from '@credo-ts/didcomm'
import { Injectable } from '@nestjs/common'
import { IBaseMessage, MessageType } from '@verana-labs/vs-agent-model'
import { VsAgent } from '@verana-labs/vs-agent-sdk'

import { EMrtdDataRequestMessage } from '../model/EMrtdDataRequestMessage'
import { MrzDataRequestMessage } from '../model/MrzDataRequestMessage'

@Injectable()
export class MrtdMessageHandler implements MessageHandler {
  readonly supportedTypes: MessageType[] = [
    MessageType.MrzDataRequestMessage,
    MessageType.EMrtdDataRequestMessage,
  ]

  readonly openApiExamples: Record<string, { summary: string; description: string; value: object }> = {
    emrtdDataRequest: {
      summary: 'eMRTD Data Request',
      description:
        '#### eMRTD Data Request\n\nRequest the other party to read and provide eMRTD (Electronic Machine Readable Travel Document) data from a compatible electronic document.',
      value: { type: 'emrtd-data-request' },
    },
    emrtdDataSubmit: {
      summary: 'eMRTD Data Submit',
      description:
        "#### eMRTD Data Submit\n\nSubmit data retrieved from an electronic Machine Readable Travel Document. This message may be sent either individually or as a response to an eMRTD Data Request.\n\nThe state can be one of 'submitted', 'declined', 'timeout' or 'error', depending on how the flow went. The latter is used for unspecified errors (e.g. User Agent not capable of handling the request).",
      value: { type: 'emrtd-data-submit', state: 'MrtdSubmitState', dataGroups: 'EMrtdData' },
    },
    mrzDataRequest: {
      summary: 'MRZ Data Request',
      description:
        '#### MRZ Data Request\n\nRequest the other party to provide the Machine Readable Zone string from a valid ID document.',
      value: { type: 'mrz-data-request' },
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
      value: { type: 'mrz-data-submit', state: 'MrtdSubmitState', mrzData: 'MrzData' },
    },
  }

  async handle(
    agent: VsAgent<any>,
    message: IBaseMessage,
    connection: DidCommConnectionRecord,
  ): Promise<string | undefined> {
    const messageType = message.type
    let messageId: string | undefined

    if (messageType === MrzDataRequestMessage.type) {
      const msg = JsonTransformer.fromJSON(message, MrzDataRequestMessage)
      const requestMrz = await agent.modules.mrtd.requestMrzString({
        connectionId: connection.id,
        parentThreadId: msg.threadId,
      })
      messageId = requestMrz.messageId
    } else if (messageType === EMrtdDataRequestMessage.type) {
      const msg = JsonTransformer.fromJSON(message, EMrtdDataRequestMessage)
      const requestEMrtdData = await agent.modules.mrtd.requestEMrtdData({
        connectionId: connection.id,
        parentThreadId: msg.threadId,
      })
      messageId = requestEMrtdData.messageId
    }

    return messageId
  }
}
