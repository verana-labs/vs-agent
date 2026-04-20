import {
  DecodedAdditionalPersonalData,
  DecodedImage,
  DecodedSecurtyObjectOfDocument,
} from '@li0ard/tsemrtd/dist/consts/interfaces'
import { describe, it, expect } from 'vitest'

import { EMrtdDataSubmitMessage, MrtdSubmitState } from '../src'

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
