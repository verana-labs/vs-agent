import { HttpClient } from '../http'
import {
  AddServiceEndpointBody,
  EditClaimsBody,
  ListFlowsQuery,
  Page,
  PaginationQuery,
  RevokeFlowCredentialBody,
  SendOobLinkBody,
  ServiceEndpoint,
  UpdateServiceEndpointBody,
  VtFlowRecord,
} from '../types'

export class VtApi {
  public constructor(private readonly http: HttpClient) {}

  public listFlows(query?: ListFlowsQuery): Promise<Page<VtFlowRecord>> {
    return this.http.request('GET', '/vt/flows', { query })
  }

  public getFlow(participantSessionId: string): Promise<VtFlowRecord> {
    return this.http.request('GET', `/vt/flows/${encodeURIComponent(participantSessionId)}`)
  }

  public editCredentialClaims(
    participantSessionId: string,
    body: EditClaimsBody,
  ): Promise<Record<string, unknown>> {
    return this.http.request('PUT', `/vt/flows/${encodeURIComponent(participantSessionId)}/claims`, { body })
  }

  public sendOobLink(participantSessionId: string, body: SendOobLinkBody): Promise<VtFlowRecord> {
    return this.http.request('POST', `/vt/flows/${encodeURIComponent(participantSessionId)}/oob-link`, {
      body,
    })
  }

  public validateFlow(participantSessionId: string): Promise<VtFlowRecord> {
    return this.http.request('POST', `/vt/flows/${encodeURIComponent(participantSessionId)}/validate`)
  }

  public revokeFlowCredential(
    participantSessionId: string,
    body?: RevokeFlowCredentialBody,
  ): Promise<VtFlowRecord> {
    return this.http.request(
      'POST',
      `/vt/flows/${encodeURIComponent(participantSessionId)}/revoke-credential`,
      { body },
    )
  }

  public listServiceEndpoints(query?: PaginationQuery): Promise<Page<ServiceEndpoint>> {
    return this.http.request('GET', '/vt/service-endpoints', { query })
  }

  public addServiceEndpoint(body: AddServiceEndpointBody): Promise<ServiceEndpoint> {
    return this.http.request('POST', '/vt/service-endpoints', { body })
  }

  public updateServiceEndpoint(
    serviceEndpointId: string,
    body: UpdateServiceEndpointBody,
  ): Promise<ServiceEndpoint> {
    return this.http.request('PATCH', `/vt/service-endpoints/${encodeURIComponent(serviceEndpointId)}`, {
      body,
    })
  }

  public deleteServiceEndpoint(serviceEndpointId: string): Promise<ServiceEndpoint> {
    return this.http.request('DELETE', `/vt/service-endpoints/${encodeURIComponent(serviceEndpointId)}`)
  }
}
