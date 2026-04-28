import { JsonTransformer, utils } from '@credo-ts/core'
import { DidCommAttachment } from '@credo-ts/didcomm'
import { describe, expect, it } from 'vitest'

import {
  CredentialStateChangeMessage,
  IssuanceRequestMessage,
  OobLinkMessage,
  VT_FLOW_CREDENTIAL_STATE_CHANGE_TYPE,
  VT_FLOW_ISSUANCE_REQUEST_TYPE,
  VT_FLOW_OOB_LINK_TYPE,
  VT_FLOW_VALIDATING_TYPE,
  VT_FLOW_VALIDATION_REQUEST_TYPE,
  ValidatingMessage,
  ValidationRequestMessage,
  VtCredentialState,
} from '../src'

const SESSION_UUID = utils.uuid()

describe('ValidationRequestMessage', () => {
  const baseOptions = {
    permId: 'perm-123',
    sessionUuid: SESSION_UUID,
    agentPermId: 'agent-perm-42',
    walletAgentPermId: 'wallet-agent-perm-42',
  }

  it('carries the spec @type URI', () => {
    expect(ValidationRequestMessage.type.messageTypeUri).toBe(VT_FLOW_VALIDATION_REQUEST_TYPE)
  })

  it('serialises required fields with snake_case wire names', () => {
    const msg = new ValidationRequestMessage(baseOptions)
    const json = JsonTransformer.toJSON(msg) as Record<string, unknown>

    expect(json['@type']).toBe(VT_FLOW_VALIDATION_REQUEST_TYPE)
    expect(json['@id']).toBe(msg.id)
    expect(json.perm_id).toBe('perm-123')
    expect(json.session_uuid).toBe(SESSION_UUID)
    expect(json.agent_perm_id).toBe('agent-perm-42')
    expect(json.wallet_agent_perm_id).toBe('wallet-agent-perm-42')
  })

  it('round-trips through JSON with optional claims + proofs~attach', () => {
    const proof = new DidCommAttachment({
      id: 'proof-1',
      mimeType: 'application/json',
      data: { base64: Buffer.from(JSON.stringify({ hello: 'world' })).toString('base64') },
    })

    const original = new ValidationRequestMessage({
      ...baseOptions,
      claims: { country: 'FR', legalName: 'Acme SAS' },
      proofsAttach: [proof],
    })
    // Mirror the spec wire example: first message sets ~thread.thid = @id.
    original.setThread({ threadId: original.id })

    const json = JsonTransformer.toJSON(original) as Record<string, unknown>
    expect(json['proofs~attach']).toBeDefined()
    expect(Array.isArray(json['proofs~attach'])).toBe(true)

    const parsed = JsonTransformer.fromJSON(json, ValidationRequestMessage)
    expect(parsed).toBeInstanceOf(ValidationRequestMessage)
    expect(parsed.id).toBe(original.id)
    expect(parsed.permId).toBe('perm-123')
    expect(parsed.sessionUuid).toBe(SESSION_UUID)
    expect(parsed.agentPermId).toBe('agent-perm-42')
    expect(parsed.walletAgentPermId).toBe('wallet-agent-perm-42')
    expect(parsed.claims).toEqual({ country: 'FR', legalName: 'Acme SAS' })
    expect(parsed.proofsAttach).toHaveLength(1)
    expect(parsed.proofsAttach?.[0]).toBeInstanceOf(DidCommAttachment)
    expect(parsed.thread?.threadId).toBe(original.id)
  })

  it('rejects a malformed session_uuid during validation', () => {
    const json = {
      '@type': VT_FLOW_VALIDATION_REQUEST_TYPE,
      '@id': utils.uuid(),
      perm_id: 'perm-x',
      session_uuid: 'not-a-uuid',
      agent_perm_id: 'a',
      wallet_agent_perm_id: 'w',
    }
    expect(() => JsonTransformer.fromJSON(json, ValidationRequestMessage)).toThrow()
  })
})

describe('IssuanceRequestMessage', () => {
  const baseOptions = {
    schemaId: 'vpr:schema:123',
    sessionUuid: SESSION_UUID,
    agentPermId: 'agent-perm-9',
    walletAgentPermId: 'wallet-agent-perm-9',
  }

  it('carries the spec @type URI', () => {
    expect(IssuanceRequestMessage.type.messageTypeUri).toBe(VT_FLOW_ISSUANCE_REQUEST_TYPE)
  })

  it('serialises schema_id instead of perm_id', () => {
    const msg = new IssuanceRequestMessage(baseOptions)
    const json = JsonTransformer.toJSON(msg) as Record<string, unknown>

    expect(json['@type']).toBe(VT_FLOW_ISSUANCE_REQUEST_TYPE)
    expect(json.schema_id).toBe('vpr:schema:123')
    expect(json).not.toHaveProperty('perm_id')
    expect(json.session_uuid).toBe(SESSION_UUID)
  })

  it('round-trips through JSON', () => {
    const original = new IssuanceRequestMessage({ ...baseOptions, claims: { age: 25 } })
    const json = JsonTransformer.toJSON(original)
    const parsed = JsonTransformer.fromJSON(json, IssuanceRequestMessage)

    expect(parsed).toBeInstanceOf(IssuanceRequestMessage)
    expect(parsed.schemaId).toBe('vpr:schema:123')
    expect(parsed.claims).toEqual({ age: 25 })
  })
})

describe('OobLinkMessage', () => {
  const threadId = utils.uuid()

  it('carries the spec @type URI and sets ~thread.thid', () => {
    const msg = new OobLinkMessage({
      threadId,
      url: 'https://issuer.example/oob/abc?token=xyz',
      description: 'Upload proof of residence',
    })

    expect(OobLinkMessage.type.messageTypeUri).toBe(VT_FLOW_OOB_LINK_TYPE)
    expect(msg.threadId).toBe(threadId)
  })

  it('serialises expires_time as ISO string and round-trips back to a Date', () => {
    const expiresTime = new Date('2026-04-26T12:00:00Z')
    const original = new OobLinkMessage({
      threadId,
      url: 'https://issuer.example/oob/abc',
      description: 'Complete OOB step',
      expiresTime,
    })

    // `JsonTransformer.serialize` runs `JSON.stringify` which invokes
    // `Date.prototype.toJSON()` — that's the wire representation.
    const serialised = JsonTransformer.serialize(original)
    const wire = JSON.parse(serialised) as Record<string, unknown>
    expect(wire.expires_time).toBe('2026-04-26T12:00:00.000Z')

    const parsed = JsonTransformer.deserialize(serialised, OobLinkMessage)
    expect(parsed.expiresTime).toBeInstanceOf(Date)
    expect(parsed.expiresTime?.toISOString()).toBe('2026-04-26T12:00:00.000Z')
    expect(parsed.description).toBe('Complete OOB step')
  })

  it('rejects a non-HTTPS URL', () => {
    // Constructor itself is permissive; validation runs on serialise/parse.
    const msg = new OobLinkMessage({
      threadId,
      url: 'http://issuer.example/oob/abc',
      description: 'bad',
    })
    const json = JsonTransformer.toJSON(msg)
    expect(() => JsonTransformer.fromJSON(json, OobLinkMessage)).toThrow()
  })
})

describe('ValidatingMessage', () => {
  const threadId = utils.uuid()

  it('carries the spec @type URI', () => {
    expect(ValidatingMessage.type.messageTypeUri).toBe(VT_FLOW_VALIDATING_TYPE)
  })

  it('allows an optional comment and round-trips', () => {
    const original = new ValidatingMessage({
      threadId,
      comment: 'Validating applicant documentation.',
    })

    const json = JsonTransformer.toJSON(original) as Record<string, unknown>
    expect(json.comment).toBe('Validating applicant documentation.')

    const parsed = JsonTransformer.fromJSON(json, ValidatingMessage)
    expect(parsed).toBeInstanceOf(ValidatingMessage)
    expect(parsed.comment).toBe('Validating applicant documentation.')
    expect(parsed.threadId).toBe(threadId)
  })

  it('still round-trips when comment is omitted', () => {
    const original = new ValidatingMessage({ threadId })
    const json = JsonTransformer.toJSON(original)
    const parsed = JsonTransformer.fromJSON(json, ValidatingMessage)
    expect(parsed.comment).toBeUndefined()
  })
})

describe('CredentialStateChangeMessage', () => {
  const threadId = utils.uuid()
  const subprotocolThid = utils.uuid()

  it('carries the spec @type URI and renames subprotocol_thid', () => {
    const msg = new CredentialStateChangeMessage({
      threadId,
      subprotocolThid,
      state: VtCredentialState.Revoked,
      reason: 'Permission revoked on-chain.',
    })

    expect(CredentialStateChangeMessage.type.messageTypeUri).toBe(VT_FLOW_CREDENTIAL_STATE_CHANGE_TYPE)
    const json = JsonTransformer.toJSON(msg) as Record<string, unknown>
    expect(json.subprotocol_thid).toBe(subprotocolThid)
    expect(json.state).toBe('REVOKED')
    expect(json.reason).toBe('Permission revoked on-chain.')
  })

  it('round-trips a REVOKED message', () => {
    const original = new CredentialStateChangeMessage({
      threadId,
      subprotocolThid,
      state: VtCredentialState.Revoked,
    })

    const json = JsonTransformer.toJSON(original)
    const parsed = JsonTransformer.fromJSON(json, CredentialStateChangeMessage)

    expect(parsed).toBeInstanceOf(CredentialStateChangeMessage)
    expect(parsed.state).toBe('REVOKED')
    expect(parsed.subprotocolThid).toBe(subprotocolThid)
    expect(parsed.reason).toBeUndefined()
    expect(parsed.threadId).toBe(threadId)
  })

  it('accepts unknown state values for forward compatibility', () => {
    const json = {
      '@type': VT_FLOW_CREDENTIAL_STATE_CHANGE_TYPE,
      '@id': utils.uuid(),
      '~thread': { thid: threadId },
      subprotocol_thid: subprotocolThid,
      // Per spec §Messages => credential-state-change, unknown values MUST
      // be accepted. This test guards against accidental tightening to a
      // closed enum.
      state: 'REACTIVATED',
    }

    const parsed = JsonTransformer.fromJSON(json, CredentialStateChangeMessage)
    expect(parsed.state).toBe('REACTIVATED')
  })
})
