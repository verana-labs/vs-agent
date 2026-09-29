import { readJsonSchema } from './util'

/** The URL of the SD-JWT VC Type Metadata of a `CredentialSchema`, per [VSA-PUB-VT-5]. */
export function typeMetadataUrl(publicApiBaseUrl: string, credentialSchemaId: string | number): string {
  return `${publicApiBaseUrl}/vt/vct/${credentialSchemaId}`
}

export interface TypeMetadataInput {
  /** The URL the document is served at; the document carries it as `vct`. */
  vct: string
  /** The JSON Schema of the `CredentialSchema` entry, as the VPR holds it. */
  jsonSchema: string | object
  /** The reference of the VTJSC to its on-chain `CredentialSchema` entry; the `name` without a title. */
  credentialSchemaRef: string
  /** The `id` of the VTJSC of the schema. */
  jsonSchemaCredentialId: string
}

/**
 * Composes the SD-JWT VC Type Metadata of a `CredentialSchema`, serialized, per [VSA-PUB-VT-5] and
 * [VT-CRED-SDJWT-3]. The result is what the agent serves at `vct`, byte for byte: every issuer the
 * Ecosystem accredits carries its integrity digest as `vct#integrity`, so the caller stores it once
 * and never composes it again for the same schema.
 */
export function composeTypeMetadata(input: TypeMetadataInput): string {
  const { title, description, attrNames } = readJsonSchema(input.jsonSchema)

  return JSON.stringify({
    vct: input.vct,
    name: title ?? input.credentialSchemaRef,
    ...(description ? { description } : {}),
    // every claim of an SD-JWT VTC is selectively disclosable, so the type says so to every issuer
    claims: attrNames.map(name => ({ path: [name], sd: 'always' })),
    relatedJsonSchemaCredentialId: input.jsonSchemaCredentialId,
  })
}
