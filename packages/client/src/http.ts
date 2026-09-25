export interface ApiClientOptions {
  token?: string
}

export class ApiError extends Error {
  public constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface RequestOptions {
  query?: object
  body?: unknown
}

export class HttpClient {
  private readonly baseUrl: string
  private readonly token?: string

  public constructor(baseUrl: string, options: ApiClientOptions) {
    this.baseUrl = `${baseUrl.replace(/\/+$/, '')}/v2`
    this.token = options.token
  }

  public async request<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    if (this.token) headers.Authorization = `Bearer ${this.token}`

    const response = await fetch(`${this.baseUrl}${path}${toQueryString(options.query)}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })

    const text = await response.text()
    if (response.ok) return (text === '' ? undefined : JSON.parse(text)) as T

    const error = parseErrorEnvelope(text)
    throw error
      ? new ApiError(error.code, response.status, error.message)
      : new ApiError('HTTP_ERROR', response.status, response.statusText)
  }
}

function toQueryString(query?: object): string {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value))
  }
  const encoded = params.toString()
  return encoded === '' ? '' : `?${encoded}`
}

function parseErrorEnvelope(text: string): { code: string; message: string } | undefined {
  try {
    const { error } = JSON.parse(text) as { error?: { code?: unknown; message?: unknown } }
    return typeof error?.code === 'string' && typeof error.message === 'string'
      ? { code: error.code, message: error.message }
      : undefined
  } catch {
    return undefined
  }
}
