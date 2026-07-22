import type {
  TrustClientOptions,
  TrustEvidence,
  TrustResolution,
  TrustRole,
  TrustVerdict,
  VeranaTrustStatus,
} from './types'

import { computeVerdict } from './verdict'

const TRUST_STATUSES = new Set<VeranaTrustStatus>(['TRUSTED', 'PARTIAL', 'UNTRUSTED'])

export class TrustClient {
  private readonly resolverUrl: URL

  public constructor(
    private readonly options: TrustClientOptions,
    private readonly fetchImplementation: typeof fetch = globalThis.fetch,
  ) {
    const resolverUrl = new URL(options.resolverUrl)
    if (resolverUrl.username || resolverUrl.password) {
      throw new Error('resolver URL must not contain credentials')
    }

    this.resolverUrl = resolverUrl
  }

  public async resolve(did: string): Promise<TrustResolution> {
    const url = this.endpoint('resolve', { did })

    try {
      const { response, body } = await this.request(url)
      if (response.status === 404) return { status: 'not_found' }
      if (!response.ok) return { status: 'unreachable' }

      if (!isRecord(body) || !isVeranaTrustStatus(body.trustStatus)) {
        return { status: 'unreachable' }
      }

      return { status: 'ok', trustStatus: body.trustStatus }
    } catch {
      return { status: 'unreachable' }
    }
  }

  public async checkAuthorization(role: TrustRole, did: string, vtjscId: string): Promise<boolean | null> {
    const url = this.endpoint(`${role}-authorization`, { did, vtjscId })

    try {
      const { response, body } = await this.request(url)
      if (response.status === 404) return false
      if (!response.ok) return null

      return isRecord(body) && typeof body.authorized === 'boolean' ? body.authorized : null
    } catch {
      return null
    }
  }

  public async verdictFor(
    role: TrustRole,
    did: string | null,
    vtjscId: string | null,
  ): Promise<TrustVerdict> {
    if (!did) {
      return {
        verdict: 'UNTRUSTED',
        evidence: {
          did,
          trustStatus: null,
          vtjscId,
          authorized: null,
          queries: [],
          note: 'no DID was available for trust resolution',
        },
      }
    }

    const resolutionUrl = this.endpoint('resolve', { did })
    const resolution = await this.resolve(did)
    const evidence: TrustEvidence = {
      did,
      trustStatus: resolution.status === 'ok' ? resolution.trustStatus : null,
      vtjscId,
      authorized: null,
      queries: [resolutionUrl.toString()],
    }

    if (resolution.status !== 'ok' || resolution.trustStatus !== 'TRUSTED') {
      return { verdict: computeVerdict(resolution, null), evidence }
    }

    if (!vtjscId) {
      return {
        verdict: 'TRUSTED_NOT_AUTHORIZED',
        evidence: { ...evidence, note: 'no VTJSC identifier was available for authorization' },
      }
    }

    const authorizationUrl = this.endpoint(`${role}-authorization`, { did, vtjscId })
    const authorized = await this.checkAuthorization(role, did, vtjscId)
    evidence.authorized = authorized
    evidence.queries.push(authorizationUrl.toString())

    return { verdict: computeVerdict(resolution, authorized), evidence }
  }

  private endpoint(pathSegment: string, query: Record<string, string>): URL {
    const url = new URL(this.resolverUrl)
    const basePathSegments = url.pathname.split('/').filter(Boolean)
    url.pathname = `/${[...basePathSegments, pathSegment].join('/')}`
    url.search = ''
    url.hash = ''

    const searchParams = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) searchParams.set(key, value)
    url.search = searchParams.toString()

    return url
  }

  private async request(url: URL): Promise<{ response: Response; body?: unknown }> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs)

    try {
      const response = await this.fetchImplementation(url, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      })
      const body: unknown = response.ok ? await response.json() : undefined

      return { response, body }
    } finally {
      clearTimeout(timeout)
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isVeranaTrustStatus(value: unknown): value is VeranaTrustStatus {
  return typeof value === 'string' && TRUST_STATUSES.has(value as VeranaTrustStatus)
}
