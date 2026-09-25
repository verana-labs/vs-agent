import { HttpClient } from '../http'
import { AgentInfo, Liveness, Readiness } from '../types'

export class AgentApi {
  public constructor(private readonly http: HttpClient) {}

  public getAgentInfo(): Promise<AgentInfo> {
    return this.http.request('GET', '/agent/info')
  }

  public getLiveness(): Promise<Liveness> {
    return this.http.request('GET', '/agent/health/live')
  }

  public getReadiness(): Promise<Readiness> {
    return this.http.request('GET', '/agent/health/ready')
  }
}
