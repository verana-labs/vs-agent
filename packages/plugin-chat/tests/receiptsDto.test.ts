import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { describe, expect, it } from 'vitest'

import { SendReceiptsBodyDto } from '../src/nestjs/dto'

const check = (body: unknown) =>
  validateSync(plainToInstance(SendReceiptsBodyDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  })

describe('sendReceipts body validation', () => {
  it('accepts a valid body', () => {
    expect(
      check({
        connectionId: 'conn-1',
        receipts: [{ messageId: 'm1', state: 'viewed', timestamp: '2026-09-07T12:00:00.000Z' }],
      }),
    ).toHaveLength(0)
  })

  it('refuses every shape the spec forbids', () => {
    expect(check({ receipts: [{ messageId: 'm', state: 'viewed' }] }).length).toBeGreaterThan(0)
    expect(check({ connectionId: 'c' }).length).toBeGreaterThan(0)
    expect(check({ connectionId: 'c', receipts: [] }).length).toBeGreaterThan(0)
    expect(
      check({ connectionId: 'c', receipts: [{ messageId: 'm', state: 'nonsense' }] }).length,
    ).toBeGreaterThan(0)
    expect(check({ connectionId: 'c', receipts: [{ state: 'viewed' }] }).length).toBeGreaterThan(0)
    expect(
      check({ connectionId: 'c', receipts: [{ messageId: 'm', state: 'viewed', timestamp: 'nope' }] }).length,
    ).toBeGreaterThan(0)
    expect(
      check({ connectionId: 'c', receipts: [{ messageId: 'm', state: 'viewed' }], extra: 1 }).length,
    ).toBeGreaterThan(0)
  })

  it('accepts every state the spec names', () => {
    for (const state of ['created', 'submitted', 'received', 'viewed', 'deleted']) {
      expect(check({ connectionId: 'c', receipts: [{ messageId: 'm', state }] })).toHaveLength(0)
    }
  })
})
