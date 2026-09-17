import { HttpClient } from '../http'
import {
  AcceptCallBody,
  BasicMessageRecord,
  CallThreadBody,
  ConnectionRecord,
  CreateCredentialOfferBody,
  CreateCredentialOfferResponse,
  CreatePresentationRequestBody,
  CreatePresentationRequestResponse,
  CredentialExchangeRecord,
  DeclineExchangeBody,
  ListBasicMessagesQuery,
  ListConnectionsQuery,
  OfferCallBody,
  Page,
  PaginationQuery,
  PresentationRecord,
  ProtocolModule,
  RequestMrtdBody,
  RequestProfileBody,
  SendBasicMessageBody,
  SendMenuBody,
  SendProfileBody,
  SendQuestionBody,
  SendReactionsBody,
  SendReceiptsBody,
  SentMessage,
  ShareMediaBody,
} from '../types'

export class DidcommApi {
  public constructor(private readonly http: HttpClient) {}

  public listProtocols(): Promise<ProtocolModule[]> {
    return this.http.request('GET', '/didcomm/protocols')
  }

  public listConnections(query?: ListConnectionsQuery): Promise<Page<ConnectionRecord>> {
    return this.http.request('GET', '/didcomm/connections', { query })
  }

  public getConnection(connectionId: string): Promise<ConnectionRecord> {
    return this.http.request('GET', `/didcomm/connections/${encodeURIComponent(connectionId)}`)
  }

  public deleteConnection(connectionId: string): Promise<void> {
    return this.http.request('DELETE', `/didcomm/connections/${encodeURIComponent(connectionId)}`)
  }

  // sendInvitation [VSA-ADM-DC-INV-SEND] lands with verana-labs/vs-agent#716

  public sendBasicMessage(body: SendBasicMessageBody): Promise<SentMessage> {
    return this.http.request('POST', '/didcomm/basic-messages', { body })
  }

  public listBasicMessages(query?: ListBasicMessagesQuery): Promise<Page<BasicMessageRecord>> {
    return this.http.request('GET', '/didcomm/basic-messages', { query })
  }

  public sendReceipts(body: SendReceiptsBody): Promise<SentMessage> {
    return this.http.request('POST', '/didcomm/receipts', { body })
  }

  public sendReactions(body: SendReactionsBody): Promise<SentMessage> {
    return this.http.request('POST', '/didcomm/reactions', { body })
  }

  public sendProfile(body: SendProfileBody): Promise<SentMessage> {
    return this.http.request('POST', '/didcomm/user-profile/send', { body })
  }

  public requestProfile(body: RequestProfileBody): Promise<SentMessage> {
    return this.http.request('POST', '/didcomm/user-profile/request', { body })
  }

  public shareMedia(body: ShareMediaBody): Promise<SentMessage> {
    return this.http.request('POST', '/didcomm/media-sharing', { body })
  }

  public offerCall(body: OfferCallBody): Promise<SentMessage> {
    return this.http.request('POST', '/didcomm/calls', { body })
  }

  public acceptCall(body: AcceptCallBody): Promise<SentMessage> {
    return this.http.request('POST', '/didcomm/calls/accept', { body })
  }

  public rejectCall(body: CallThreadBody): Promise<SentMessage> {
    return this.http.request('POST', '/didcomm/calls/reject', { body })
  }

  public endCall(body: CallThreadBody): Promise<SentMessage> {
    return this.http.request('POST', '/didcomm/calls/end', { body })
  }

  public sendMenu(body: SendMenuBody): Promise<SentMessage> {
    return this.http.request('POST', '/didcomm/action-menu', { body })
  }

  public sendQuestion(body: SendQuestionBody): Promise<SentMessage> {
    return this.http.request('POST', '/didcomm/question-answer', { body })
  }

  public requestMrz(body: RequestMrtdBody): Promise<SentMessage> {
    return this.http.request('POST', '/didcomm/mrtd/request-mrz', { body })
  }

  public requestEmrtdData(body: RequestMrtdBody): Promise<SentMessage> {
    return this.http.request('POST', '/didcomm/mrtd/request-emrtd', { body })
  }

  public createPresentationRequest(
    body: CreatePresentationRequestBody,
  ): Promise<CreatePresentationRequestResponse> {
    return this.http.request('POST', '/didcomm/presentation-request', { body })
  }

  public acceptPresentationRequest(proofExchangeId: string): Promise<PresentationRecord> {
    return this.http.request(
      'POST',
      `/didcomm/presentations/${encodeURIComponent(proofExchangeId)}/accept-request`,
    )
  }

  public acceptPresentation(proofExchangeId: string): Promise<PresentationRecord> {
    return this.http.request(
      'POST',
      `/didcomm/presentations/${encodeURIComponent(proofExchangeId)}/accept-presentation`,
    )
  }

  public declinePresentationExchange(
    proofExchangeId: string,
    body?: DeclineExchangeBody,
  ): Promise<PresentationRecord> {
    return this.http.request(
      'POST',
      `/didcomm/presentations/${encodeURIComponent(proofExchangeId)}/decline`,
      { body },
    )
  }

  public listPresentations(query?: PaginationQuery): Promise<Page<PresentationRecord>> {
    return this.http.request('GET', '/didcomm/presentations', { query })
  }

  public getPresentation(proofExchangeId: string): Promise<PresentationRecord> {
    return this.http.request('GET', `/didcomm/presentations/${encodeURIComponent(proofExchangeId)}`)
  }

  public deletePresentation(proofExchangeId: string): Promise<void> {
    return this.http.request('DELETE', `/didcomm/presentations/${encodeURIComponent(proofExchangeId)}`)
  }

  public createCredentialOffer(body: CreateCredentialOfferBody): Promise<CreateCredentialOfferResponse> {
    return this.http.request('POST', '/didcomm/credential-offer', { body })
  }

  public acceptCredentialOffer(credentialExchangeId: string): Promise<CredentialExchangeRecord> {
    return this.http.request(
      'POST',
      `/didcomm/credential-exchanges/${encodeURIComponent(credentialExchangeId)}/accept-offer`,
    )
  }

  public acceptCredentialRequest(credentialExchangeId: string): Promise<CredentialExchangeRecord> {
    return this.http.request(
      'POST',
      `/didcomm/credential-exchanges/${encodeURIComponent(credentialExchangeId)}/accept-request`,
    )
  }

  public acceptCredential(credentialExchangeId: string): Promise<CredentialExchangeRecord> {
    return this.http.request(
      'POST',
      `/didcomm/credential-exchanges/${encodeURIComponent(credentialExchangeId)}/accept-credential`,
    )
  }

  public declineCredentialExchange(
    credentialExchangeId: string,
    body?: DeclineExchangeBody,
  ): Promise<CredentialExchangeRecord> {
    return this.http.request(
      'POST',
      `/didcomm/credential-exchanges/${encodeURIComponent(credentialExchangeId)}/decline`,
      { body },
    )
  }

  public listCredentialExchanges(query?: PaginationQuery): Promise<Page<CredentialExchangeRecord>> {
    return this.http.request('GET', '/didcomm/credential-exchanges', { query })
  }

  public getCredentialExchange(credentialExchangeId: string): Promise<CredentialExchangeRecord> {
    return this.http.request(
      'GET',
      `/didcomm/credential-exchanges/${encodeURIComponent(credentialExchangeId)}`,
    )
  }

  // deleteCredentialExchange [VSA-ADM-DC-CE-DELETE] has no handler on main yet
}
