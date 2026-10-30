import type { OpenId4VcStatusListEntryRecord } from '../src/storage/StatusListEntryRecord'
import type { OpenId4VcStatusListRecord } from '../src/storage/StatusListRecord'

import { RecordDuplicateError } from '@credo-ts/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminApiErrorCode } from '@verana-labs/vs-agent-sdk'

import {
  STATUS_LIST_SIZE_DEFAULT,
  STATUS_LIST_TOKEN_LIFETIME_SECONDS,
  StatusListService,
  statusListTokenChainDiffers,
  statusListTokenNearsExpiry,
} from '../src/services/StatusListService'
import { OpenId4VcStatusListEntryRepository } from '../src/storage/StatusListEntryRecord'
import { OpenId4VcStatusListRepository } from '../src/storage/StatusListRecord'

import { issuerOptions, leafCertificate, rootCertificate } from './helpers/issuerServiceFixtures'

const LEAF = 'leaf-certificate'
const OTHER_LEAF = 'other-leaf-certificate'

function fakeJwt(header: Record<string, unknown>, payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'ES256', typ: 'statuslist+jwt', ...header })}.${encode(payload)}.c2ln`
}

function decodeJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const [header, payload] = token.split('.')
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString('utf8')),
    payload: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
  }
}

function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1_000)
}

/** In-memory stand-ins for the two repositories, keyed like askar: a duplicate id refuses the save. */
function repositories() {
  const lists = new Map<string, OpenId4VcStatusListRecord>()
  const entries = new Map<string, OpenId4VcStatusListEntryRecord>()
  const repositoryOf = <T extends { id: string }>(store: Map<string, T>) => ({
    save: vi.fn(async (_context: unknown, record: T) => {
      if (store.has(record.id)) throw new RecordDuplicateError(`duplicate ${record.id}`, { recordType: 'x' })
      store.set(record.id, record)
    }),
    update: vi.fn(async (_context: unknown, record: T) => {
      store.set(record.id, record)
    }),
    delete: vi.fn(async (_context: unknown, record: T) => {
      store.delete(record.id)
    }),
    findById: vi.fn(async (_context: unknown, id: string) => store.get(id) ?? null),
    getAll: vi.fn(async () => [...store.values()]),
    findByQuery: vi.fn(async (_context: unknown, query: Record<string, unknown>) =>
      [...store.values()].filter(record =>
        Object.entries(query).every(([key, value]) => (record as Record<string, unknown>)[key] === value),
      ),
    ),
  })
  return { lists, entries, listRepository: repositoryOf(lists), entryRepository: repositoryOf(entries) }
}

/** Credo's Token Status List API, reduced to what the service reads back: header, sub, iat, exp, statuses. */
function tokenStatusListApi() {
  return {
    createTokenStatusList: vi.fn(
      async (options: {
        statusListUri: string
        statusList: { statusListLength: number }
        signer: { x5c: { toString: () => string }[] }
        issuedAt: Date
        expiresAt: Date
      }) => ({
        format: 'jwt',
        statusList: fakeJwt(
          { x5c: options.signer.x5c.map(certificate => certificate.toString()) },
          {
            sub: options.statusListUri,
            iat: seconds(options.issuedAt),
            exp: seconds(options.expiresAt),
            status_list: { bits: 1, lst: '', size: options.statusList.statusListLength, revoked: [] },
          },
        ),
      }),
    ),
    updateTokenStatusList: vi.fn(
      async (options: {
        token: string
        status: { index: number; status: number }[]
        issuedAt: Date
        expiresAt: Date
      }) => {
        const { header, payload } = decodeJwt(options.token)
        const statusList = payload.status_list as { revoked: number[] }
        return {
          format: 'jwt',
          statusList: fakeJwt(header, {
            ...payload,
            iat: seconds(options.issuedAt),
            exp: seconds(options.expiresAt),
            status_list: {
              ...statusList,
              revoked: [...statusList.revoked, ...options.status.map(status => status.index)],
            },
          }),
        }
      },
    ),
  }
}

function revokedIndexes(token: string): number[] {
  return (decodeJwt(token).payload.status_list as { revoked: number[] }).revoked
}

function issuer(leaf = leafCertificate) {
  return {
    ensureInitialized: vi.fn(async () => {}),
    // the self-signed root never travels in x5c, so the chain of the lists is the leaf alone
    signingCertificate: () => ({
      certificate: leaf,
      chain: [leaf, rootCertificate],
      keyId: 'k',
      development: false,
    }),
  }
}

function service(stores = repositories(), api = tokenStatusListApi()) {
  const agent = {
    context: {
      dependencyManager: {
        resolve: (token: unknown) => {
          if (token === OpenId4VcStatusListRepository) return stores.listRepository
          if (token === OpenId4VcStatusListEntryRepository) return stores.entryRepository
          throw new Error('unexpected dependency')
        },
      },
    },
    tokenStatusList: api,
  }
  const statusLists = new StatusListService(agent as never, issuerOptions())
  const signer = issuer()
  statusLists.attachIssuer(signer as never)
  return { statusLists, stores, api, signer }
}

describe('StatusListService', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  describe('createStatusList', () => {
    it('signs an all-valid token of the default size with the issuer chain and stores the list', async () => {
      const { statusLists, stores, api, signer } = service()

      const list = await statusLists.createStatusList()

      expect(signer.ensureInitialized).toHaveBeenCalled()
      expect(api.createTokenStatusList).toHaveBeenCalledWith(
        expect.objectContaining({
          format: 'jwt',
          alg: 'ES256',
          statusList: { statusListLength: STATUS_LIST_SIZE_DEFAULT, bitsPerStatus: 1 },
          statusListUri: `https://agent.example/oid4vc/status-list/${list.id}`,
          signer: { method: 'x5c', x5c: [leafCertificate] },
        }),
      )
      expect(list).toMatchObject({
        uri: `https://agent.example/oid4vc/status-list/${list.id}`,
        size: STATUS_LIST_SIZE_DEFAULT,
      })
      const stored = stores.lists.get(list.id)
      expect(stored).toBeDefined()
      expect(
        new Date(stored?.tokenExpiresAt ?? 0).getTime() - new Date(stored?.tokenIssuedAt ?? 0).getTime(),
      ).toBe(STATUS_LIST_TOKEN_LIFETIME_SECONDS * 1_000)
      expect(list.updatedAt).toEqual(new Date(stored?.tokenIssuedAt ?? 0))
      expect(revokedIndexes(stored?.token ?? '')).toEqual([])
    })

    it.each([1_023, 16_777_217, 2_048.5, Number.NaN])('rejects a size of %s', async size => {
      const { statusLists, api } = service()

      await expect(statusLists.createStatusList({ size })).rejects.toMatchObject({
        code: AdminApiErrorCode.InvalidInput,
        status: 400,
      })
      expect(api.createTokenStatusList).not.toHaveBeenCalled()
    })
  })

  describe('bindIndex', () => {
    it('refuses an unknown list, an index out of range, and an index an earlier offer bound', async () => {
      const { statusLists } = service()
      const list = await statusLists.createStatusList({ size: 1_024 })

      await expect(
        statusLists.bindIndex({ statusListId: 'missing', statusListIndex: 0 }),
      ).rejects.toMatchObject({
        code: AdminApiErrorCode.UnknownId,
        status: 404,
      })
      await expect(
        statusLists.bindIndex({ statusListId: list.id, statusListIndex: 1_024 }),
      ).rejects.toMatchObject({ code: AdminApiErrorCode.InvalidInput, status: 400 })
      await expect(statusLists.bindIndex({ statusListId: list.id, statusListIndex: 7 })).resolves.toEqual({
        statusListId: list.id,
        statusListIndex: 7,
        uri: list.uri,
      })
      await expect(
        statusLists.bindIndex({ statusListId: list.id, statusListIndex: 7 }),
      ).rejects.toMatchObject({
        code: AdminApiErrorCode.InvalidState,
        status: 409,
      })
    })

    it('frees an index that is released, and keeps one whose binding is completed', async () => {
      const { statusLists, stores } = service()
      const list = await statusLists.createStatusList({ size: 1_024 })
      const coordinates = { statusListId: list.id, statusListIndex: 3 }

      await statusLists.bindIndex(coordinates)
      await statusLists.releaseIndex(coordinates)
      await statusLists.bindIndex(coordinates)
      await statusLists.completeBinding(coordinates, {
        issuanceSessionId: 'session-1',
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      })

      expect([...stores.entries.values()].map(entry => [entry.issuanceSessionId, entry.expiresAt])).toEqual([
        ['session-1', '2027-01-01T00:00:00.000Z'],
      ])
    })
  })

  describe('revokeCredential', () => {
    it('publishes the revoked index in a re-signed token and answers its iat', async () => {
      const { statusLists, stores, api } = service()
      const list = await statusLists.createStatusList({ size: 1_024 })
      await statusLists.bindIndex({ statusListId: list.id, statusListIndex: 5 })

      const revoked = await statusLists.revokeCredential({ statusListId: list.id, statusListIndex: 5 })

      expect(api.updateTokenStatusList).toHaveBeenCalledWith(
        expect.objectContaining({
          status: [{ index: 5, status: 1 }],
          signer: { method: 'x5c', x5c: [leafCertificate] },
        }),
      )
      const stored = stores.lists.get(list.id)
      expect(revokedIndexes(stored?.token ?? '')).toEqual([5])
      expect(revoked).toEqual({
        statusListId: list.id,
        statusListIndex: 5,
        revokedAt: new Date(stored?.tokenIssuedAt ?? 0),
      })
      expect(seconds(revoked.revokedAt)).toBe(decodeJwt(stored?.token ?? '').payload.iat)
      expect(stores.entries.get(`${list.id}#5`)?.revokedAt).toBe(stored?.tokenIssuedAt)
    })

    it('changes nothing on a second call, and answers the first revocation', async () => {
      const { statusLists, stores, api } = service()
      const list = await statusLists.createStatusList({ size: 1_024 })
      await statusLists.bindIndex({ statusListId: list.id, statusListIndex: 5 })
      const first = await statusLists.revokeCredential({ statusListId: list.id, statusListIndex: 5 })
      const token = stores.lists.get(list.id)?.token

      const second = await statusLists.revokeCredential({ statusListId: list.id, statusListIndex: 5 })

      expect(second).toEqual(first)
      expect(api.updateTokenStatusList).toHaveBeenCalledTimes(1)
      expect(stores.lists.get(list.id)?.token).toBe(token)
    })

    it('refuses an unknown list, an index out of range, and an index that no offer bound', async () => {
      const { statusLists, api } = service()
      const list = await statusLists.createStatusList({ size: 1_024 })

      await expect(
        statusLists.revokeCredential({ statusListId: 'missing', statusListIndex: 0 }),
      ).rejects.toMatchObject({ code: AdminApiErrorCode.UnknownId, status: 404 })
      await expect(
        statusLists.revokeCredential({ statusListId: list.id, statusListIndex: 4_096 }),
      ).rejects.toMatchObject({ code: AdminApiErrorCode.InvalidInput, status: 400 })
      await expect(
        statusLists.revokeCredential({ statusListId: list.id, statusListIndex: 0 }),
      ).rejects.toMatchObject({ code: AdminApiErrorCode.InvalidState, status: 409 })
      expect(api.updateTokenStatusList).not.toHaveBeenCalled()
    })
  })

  describe('deleteStatusList', () => {
    it('refuses while an index backs a live credential, and deletes the bindings with the list afterwards', async () => {
      const { statusLists, stores } = service()
      const list = await statusLists.createStatusList({ size: 1_024 })
      await statusLists.bindIndex({ statusListId: list.id, statusListIndex: 1 })
      await statusLists.completeBinding(
        { statusListId: list.id, statusListIndex: 1 },
        { issuanceSessionId: 'session-1', expiresAt: new Date(Date.now() + 60_000) },
      )

      await expect(statusLists.deleteStatusList(list.id)).rejects.toMatchObject({
        code: AdminApiErrorCode.InvalidState,
        status: 409,
      })

      await statusLists.revokeCredential({ statusListId: list.id, statusListIndex: 1 })
      await statusLists.deleteStatusList(list.id)

      expect(stores.lists.size).toBe(0)
      expect(stores.entries.size).toBe(0)
      await expect(statusLists.deleteStatusList(list.id)).rejects.toMatchObject({
        code: AdminApiErrorCode.UnknownId,
      })
    })

    it('treats an expired credential as gone, and an incomplete binding as live', async () => {
      const { statusLists } = service()
      const list = await statusLists.createStatusList({ size: 1_024 })
      await statusLists.bindIndex({ statusListId: list.id, statusListIndex: 1 })
      await statusLists.recordIssuance(
        { statusListId: list.id, statusListIndex: 1 },
        new Date(Date.now() - 1_000),
      )
      await statusLists.bindIndex({ statusListId: list.id, statusListIndex: 2 })

      await expect(statusLists.deleteStatusList(list.id)).rejects.toMatchObject({
        code: AdminApiErrorCode.InvalidState,
      })

      await statusLists.revokeCredential({ statusListId: list.id, statusListIndex: 2 })
      await expect(statusLists.deleteStatusList(list.id)).resolves.toBeUndefined()
    })
  })

  describe('getStatusListToken', () => {
    it('answers undefined for an unknown list and the stored token for a fresh one', async () => {
      const { statusLists, stores, api } = service()
      const list = await statusLists.createStatusList({ size: 1_024 })

      await expect(statusLists.getStatusListToken('missing')).resolves.toBeUndefined()
      await expect(statusLists.getStatusListToken(list.id)).resolves.toBe(stores.lists.get(list.id)?.token)
      expect(api.updateTokenStatusList).not.toHaveBeenCalled()
    })

    it('re-signs a token that passed half of its lifetime before it serves it', async () => {
      const { statusLists, stores, api } = service()
      const list = await statusLists.createStatusList({ size: 1_024 })
      const stored = stores.lists.get(list.id)
      if (!stored) throw new Error('list not stored')
      const issuedAt = new Date(Date.now() - (STATUS_LIST_TOKEN_LIFETIME_SECONDS / 2 + 1) * 1_000)
      stored.tokenIssuedAt = issuedAt.toISOString()
      stored.tokenExpiresAt = new Date(
        issuedAt.getTime() + STATUS_LIST_TOKEN_LIFETIME_SECONDS * 1_000,
      ).toISOString()
      const before = stored.token

      const served = await statusLists.getStatusListToken(list.id)

      expect(api.updateTokenStatusList).toHaveBeenCalledWith(
        expect.objectContaining({ token: before, status: [] }),
      )
      expect(served).toBe(stores.lists.get(list.id)?.token)
      expect(new Date(stores.lists.get(list.id)?.tokenIssuedAt ?? 0).getTime()).toBeGreaterThan(
        issuedAt.getTime(),
      )
      expect(seconds(new Date(stores.lists.get(list.id)?.tokenIssuedAt ?? 0))).toBe(
        decodeJwt(served ?? '').payload.iat,
      )
    })

    it('re-creates the token from the bindings when the signing certificate changed', async () => {
      const { statusLists, stores, api } = service()
      const list = await statusLists.createStatusList({ size: 1_024 })
      await statusLists.bindIndex({ statusListId: list.id, statusListIndex: 8 })
      await statusLists.revokeCredential({ statusListId: list.id, statusListIndex: 8 })
      const otherLeaf = { ...leafCertificate, toString: () => OTHER_LEAF }
      statusLists.attachIssuer(issuer(otherLeaf as never) as never)

      const served = await statusLists.getStatusListToken(list.id)

      expect(api.createTokenStatusList).toHaveBeenCalledTimes(2)
      expect(decodeJwt(served ?? '').header.x5c).toEqual([OTHER_LEAF])
      expect(revokedIndexes(served ?? '')).toEqual([8])
      expect(stores.lists.get(list.id)?.token).toBe(served)
    })
  })

  it('runs the writes of one list in sequence, so concurrent offers never share an index', async () => {
    const { statusLists } = service()
    const list = await statusLists.createStatusList({ size: 1_024 })

    const outcomes = await Promise.allSettled(
      [0, 0, 0, 1].map(statusListIndex => statusLists.bindIndex({ statusListId: list.id, statusListIndex })),
    )

    expect(outcomes.map(outcome => outcome.status)).toEqual([
      'fulfilled',
      'rejected',
      'rejected',
      'fulfilled',
    ])
  })
})

describe('status list token staleness', () => {
  it('nears expiry once half of the lifetime has passed', () => {
    const list = {
      token: fakeJwt({ x5c: [LEAF] }, {}),
      tokenIssuedAt: '2026-01-01T00:00:00.000Z',
      tokenExpiresAt: '2026-01-02T00:00:00.000Z',
    }

    expect(statusListTokenNearsExpiry(list, new Date('2026-01-01T11:59:59.000Z'))).toBe(false)
    expect(statusListTokenNearsExpiry(list, new Date('2026-01-01T12:00:00.000Z'))).toBe(true)
    expect(statusListTokenNearsExpiry(list, new Date('2026-01-03T00:00:00.000Z'))).toBe(true)
  })

  it('reports a chain that differs from the x5c of the token', () => {
    const token = fakeJwt({ x5c: [LEAF, 'intermediate'] }, {})

    expect(statusListTokenChainDiffers(token, [LEAF, 'intermediate'])).toBe(false)
    expect(statusListTokenChainDiffers(token, [LEAF])).toBe(true)
    expect(statusListTokenChainDiffers(token, [OTHER_LEAF, 'intermediate'])).toBe(true)
    expect(statusListTokenChainDiffers(fakeJwt({}, {}), [LEAF])).toBe(true)
  })
})
