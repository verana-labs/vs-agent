import { Injectable } from '@nestjs/common'
import { verifyAdr036Signature } from '@verana-labs/vs-agent-sdk'
import { randomBytes } from 'crypto'

const NONCE_TTL_MS = 120_000
const MAX_PENDING_NONCES = 1_000
const TOKEN_TTL_MS = 900_000

export const challengePayload = (nonce: string): string => `vs-agent-admin-auth:${nonce}`

@Injectable()
export class AdminAuthService {
  private readonly nonces = new Map<string, { account: string; expiresAt: number }>()
  private readonly tokens = new Map<string, { account: string; expiresAt: number }>()

  createChallenge(account: string): { nonce: string; expiresAt: string } {
    this.prune()
    if (this.nonces.size >= MAX_PENDING_NONCES) {
      this.nonces.delete(this.nonces.keys().next().value as string)
    }
    const nonce = randomBytes(32).toString('base64url')
    const expiresAt = Date.now() + NONCE_TTL_MS
    this.nonces.set(nonce, { account, expiresAt })
    return { nonce, expiresAt: new Date(expiresAt).toISOString() }
  }

  async issueToken(input: {
    account: string
    pubKey: string
    signature: string
    nonce: string
  }): Promise<{ token: string; expiresAt: string } | undefined> {
    this.prune()
    const challenge = this.nonces.get(input.nonce)
    if (!challenge || challenge.account !== input.account || challenge.expiresAt < Date.now()) {
      return undefined
    }
    this.nonces.delete(input.nonce)

    const valid = await verifyAdr036Signature({
      signer: input.account,
      pubKey: input.pubKey,
      signature: input.signature,
      data: challengePayload(input.nonce),
    })
    if (!valid) return undefined

    const token = randomBytes(32).toString('base64url')
    const expiresAt = Date.now() + TOKEN_TTL_MS
    this.tokens.set(token, { account: input.account, expiresAt })
    return { token, expiresAt: new Date(expiresAt).toISOString() }
  }

  resolveAccount(token: string): string | undefined {
    const entry = this.tokens.get(token)
    if (!entry) return undefined
    if (entry.expiresAt < Date.now()) {
      this.tokens.delete(token)
      return undefined
    }
    return entry.account
  }

  private prune(): void {
    const now = Date.now()
    for (const [key, value] of this.nonces) if (value.expiresAt < now) this.nonces.delete(key)
    for (const [key, value] of this.tokens) if (value.expiresAt < now) this.tokens.delete(key)
  }
}
