import type { DidRecord } from '@credo-ts/core'

import { ConsoleLogger, DidDocument, LogLevel, VerificationMethod } from '@credo-ts/core'
import { describe, expect, it } from 'vitest'

import { getVerificationMethodId } from '../src/utils/setupSelfTr'

const DID = 'did:webvh:QmScid:agent.example'
const MULTIBASE = 'z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG'
const logger = new ConsoleLogger(LogLevel.Off)

function didRecord(type: string, publicKeyMultibase = MULTIBASE): DidRecord {
  return {
    did: DID,
    didDocument: new DidDocument({
      id: DID,
      verificationMethod: [
        new VerificationMethod({ id: `${DID}#key-1`, type, controller: DID, publicKeyMultibase }),
      ],
      assertionMethod: [`${DID}#key-1`],
    }),
  } as DidRecord
}

describe('getVerificationMethodId', () => {
  it.each([
    'Ed25519VerificationKey2020',
    'Ed25519VerificationKey2018',
    'Multikey',
  ])('accepts the assertionMethod key published as %s', type => {
    expect(getVerificationMethodId(logger, didRecord(type))).toBe(`${DID}#key-1`)
  })

  it('refuses a Multikey that is not an Ed25519 key', () => {
    expect(() =>
      getVerificationMethodId(
        logger,
        didRecord('Multikey', 'zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169'),
      ),
    ).toThrow('Cannot find a suitable Ed25519 verification method in DID Document')
  })
})
