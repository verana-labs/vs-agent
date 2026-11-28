import {
  DecodedAdditionalPersonalData,
  DecodedImage,
  DecodedSecurtyObjectOfDocument,
} from '@li0ard/tsemrtd/dist/consts/interfaces'
import { MrtdEventTypes } from '@credo-ts/didcomm-mrtd'
import { describe, it, expect } from 'vitest'

import { EMrtdDataSubmitMessage, mrtdEvents, MrtdSubmitState } from '../src'

describe('EMrtdDataSubmitMessage', () => {
  const securityObjectOfDocument: DecodedSecurtyObjectOfDocument = {} as DecodedSecurtyObjectOfDocument
  const additionalPersonalData: DecodedAdditionalPersonalData = {} as DecodedAdditionalPersonalData
  const image: DecodedImage = {} as DecodedImage
  it('should initialize with correct type and state', () => {
    const rawMock = { someKey: 'someValue' }
    const parsedMock = {
      fields: {
        com: {
          ldsVersion: '1.7',
          unicodeVersion: '9.0',
          tags: Buffer.from('tagsData'),
        },
        mrzData: 'P<COLDOE<<JOHN<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<BC123456<2COL9001011M3005103CC12345678<<<<04',
        images: [
          {
            ...image,
            imageType: 1,
            imageData: Buffer.from('faceImage1'),
          },
        ],
        additionalPersonalData: {
          ...additionalPersonalData,
          nameOfHolder: 'John Doe',
          fullDateOfBirth: 19900101,
        },
        securityObjectOfDocument,
      },
      valid: true,
    }

    const message = new EMrtdDataSubmitMessage({
      id: '123',
      threadId: '456',
      timestamp: new Date(),
      connectionId: 'conn-1',
      state: MrtdSubmitState.Submitted,
      dataGroups: { raw: rawMock, parsed: parsedMock },
    })

    expect(message.dataGroups?.processed.documentType).toBe('TD3')
    expect(message.dataGroups?.processed.documentNumber).toBe('BC123456')
    expect(message.dataGroups?.processed.lastName).toBe('DOE')
    expect(message.dataGroups?.processed.firstName).toBe('JOHN')
    expect(message.dataGroups?.processed.dateOfBirth).toBe('19900101')
    expect(message.dataGroups?.processed.dateOfExpiry).toBe('20300510')
    expect(message.dataGroups?.processed.sex).toBe('M')
    expect(message.dataGroups?.processed.nationality).toBe('COL')
    expect(message.dataGroups?.processed.nameOfHolder).toBe('John Doe')
    expect(message.dataGroups?.processed.faceImages[0]).toContain('data:image/jp2;base64,')
  })
})

describe('mrtdEvents', () => {
  const fakeAgent = () => {
    const handlers = new Map<string, (event: { payload: unknown }) => unknown>()
    const emitted: unknown[] = []
    const agent = {
      context: {},
      events: {
        on: (type: string, handler: (event: { payload: unknown }) => unknown) => handlers.set(type, handler),
        emit: (_context: unknown, event: { payload: unknown }) => emitted.push(event.payload),
      },
    }
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
    mrtdEvents(agent as never, logger as never)
    return { emitted, emit: (type: string, payload: unknown) => handlers.get(type)?.({ payload }) }
  }
  const connection = { id: 'conn-1' }

  it('emits a module event for each received MRZ, eMRTD and problem report', async () => {
    const { emitted, emit } = fakeAgent()
    const dataGroups = { raw: { someKey: 'someValue' }, parsed: { valid: true } }

    await emit(MrtdEventTypes.MrzDataReceived, { connection, threadId: 't-1', mrzData: { raw: 'P<COL' } })
    await emit(MrtdEventTypes.EMrtdDataReceived, { connection, threadId: 't-2', dataGroups })
    await emit(MrtdEventTypes.MrtdProblemReport, {
      connection,
      threadId: 't-3',
      description: { code: 'e.p.emrtd-refused' },
    })

    expect(emitted).toEqual([
      {
        type: 'didcomm.mrtd.mrz-data-received',
        data: { connectionId: 'conn-1', threadId: 't-1', mrzData: { raw: 'P<COL' } },
      },
      {
        type: 'didcomm.mrtd.emrtd-data-received',
        data: { connectionId: 'conn-1', threadId: 't-2', dataGroups },
      },
      {
        type: 'didcomm.mrtd.problem-report-received',
        data: { connectionId: 'conn-1', threadId: 't-3', reason: 'e.p.emrtd-refused' },
      },
    ])
  })
})
