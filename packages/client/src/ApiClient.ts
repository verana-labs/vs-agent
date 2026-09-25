import { AgentApi } from './api/AgentApi'
import { AnoncredsApi } from './api/AnoncredsApi'
import { AuthApi } from './api/AuthApi'
import { DidcommApi } from './api/DidcommApi'
import { VtApi } from './api/VtApi'
import { ApiClientOptions, HttpClient } from './http'

export class ApiClient {
  public readonly auth: AuthApi
  public readonly agent: AgentApi
  public readonly didcomm: DidcommApi
  public readonly anoncreds: AnoncredsApi
  public readonly vt: VtApi

  public constructor(baseUrl: string, options: ApiClientOptions = {}) {
    const http = new HttpClient(baseUrl, options)
    this.auth = new AuthApi(http)
    this.agent = new AgentApi(http)
    this.didcomm = new DidcommApi(http)
    this.anoncreds = new AnoncredsApi(http)
    this.vt = new VtApi(http)
  }
}
