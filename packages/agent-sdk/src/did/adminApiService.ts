import { DidDocument, DidDocumentService } from '@credo-ts/core'

const ADMIN_API_SERVICE_TYPE = 'VsAgentAdminAPI'

export function applyAdminApiServiceEntry(didDocument: DidDocument, adminApiServiceEndpoint?: string): void {
  didDocument.service = (didDocument.service ?? []).filter(service => service.type !== ADMIN_API_SERVICE_TYPE)
  if (adminApiServiceEndpoint) {
    didDocument.service.push(
      new DidDocumentService({
        id: `${didDocument.id}#admin-api`,
        type: ADMIN_API_SERVICE_TYPE,
        serviceEndpoint: adminApiServiceEndpoint,
      }),
    )
  }
}
