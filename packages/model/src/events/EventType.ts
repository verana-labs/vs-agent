export enum EventType {
  ConnectionStateUpdated = 'didcomm.connections.state-updated',
  MessageReceived = 'didcomm.basic-messages.message-received',
  ReceiptsMessageReceived = 'didcomm.receipts.message-received',
  PresentationStateUpdated = 'didcomm.presentations.state-updated',
  CredentialExchangeStateUpdated = 'didcomm.credential-exchanges.state-updated',
  VtFlowStateUpdated = 'vt.flows.state-updated',
  IndexerNotification = 'indexer-notification',
}
