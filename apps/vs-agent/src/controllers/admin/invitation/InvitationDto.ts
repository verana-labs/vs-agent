import { ApiProperty } from '@nestjs/swagger'
import {
  ClaimOptions,
  CreateCredentialOfferOptions,
  CreatePresentationRequestOptions,
  RequestedCredential,
} from '@verana-labs/vs-agent-model'
import { IsIn, IsNotEmpty, IsOptional } from 'class-validator'

export class CreateInvitationDto {
  @ApiProperty({
    description: 'Use legacy did:web in case of did:webvh',
    example: 'false',
    required: false,
  })
  useLegacyDid?: boolean

  @ApiProperty({
    description:
      "DIDComm envelope version for the invitation. 'v2' requires AGENT_DIDCOMM_VERSIONS to include 'v2'. " +
      'When omitted, the agent infers the version from its configuration.',
    enum: ['v1', 'v2'],
    required: false,
  })
  @IsOptional()
  @IsIn(['v1', 'v2'])
  didCommVersion?: 'v1' | 'v2'
}

export class ReceiveInvitationDto {
  @IsNotEmpty()
  @ApiProperty({
    description: 'OOB invitation URL (https://) or implicit invitation DID (did:...)',
    example: 'https://example.com/?oob=eyJ0eXAiOiJKV1Qi...',
  })
  url!: string
}

export class CreatePresentationRequestDto implements CreatePresentationRequestOptions {
  @ApiProperty({
    description: 'Optional reference',
    example: '1234-5678',
  })
  ref?: string

  @ApiProperty({
    description: 'URL to be called when flow ends',
    example: 'https://myhost.com/mycallback',
  })
  callbackUrl?: string

  @IsNotEmpty()
  @ApiProperty({
    description: 'Requested credentials',
    example: '[{ credentialDefinitionId: "myCredentialDefinition", attributes: ["name","age"] }]',
  })
  requestedCredentials!: RequestedCredential[]

  @ApiProperty({
    description: 'Use legacy did:web in case of did:webvh',
    example: 'true',
  })
  useLegacyDid?: boolean

  @ApiProperty({
    description:
      'DIDComm envelope version for the invitation. v2 is rejected here because the request is attached to the OOB.',
    enum: ['v1', 'v2'],
    required: false,
  })
  @IsOptional()
  @IsIn(['v1', 'v2'])
  didCommVersion?: 'v1' | 'v2'
}

export class CreateCredentialOfferDto implements CreateCredentialOfferOptions {
  @ApiProperty({
    description: 'Credential Definition Id of the credential type',
    example:
      'did:webvh:QmaZYZF4aaHUTWzaKu23TowgvsX7JWfCRgQZX488EAssPQ:dm.chatbot.demos.dev.2060.io/resources/zQmevazUUyXBhGoXJwJNNEqXgvPPQ5WrwTE8G5MdhfWsmxM',
  })
  credentialDefinitionId!: string

  @ApiProperty({
    description:
      'ID of the Revocation Registry where the status of this credential will be present. Optional (only for revocable credentials).',
    example:
      'did:webvh:QmaZYZF4aaHUTWzaKu23TowgvsX7JWfCRgQZX488EAssPQ:dm.chatbot.demos.dev.2060.io/resources/zQmRDLcQ3jZvK4PfcDcf3sbvPzV4Ww5X7Sn2pzyHqUrZp2Z',
  })
  revocationRegistryDefinitionId?: string

  @ApiProperty({
    description:
      'Index to be used to identify this credential in the revocation registry. Optional (only for revocable credentials).',
    example: 1,
  })
  revocationRegistryIndex?: number

  @ApiProperty({
    description: 'Claims in name-value pairs',
    example: '[{ "name": "firstName", "value:" "John" }, { "name: "age", "value: "18" }]',
  })
  @IsNotEmpty()
  claims!: ClaimOptions[]

  @ApiProperty({
    description: 'Use legacy did:web in case of did:webvh',
    example: 'true',
  })
  useLegacyDid?: boolean

  @ApiProperty({
    description:
      'DIDComm envelope version for the invitation. v2 is rejected here because the offer is attached to the OOB.',
    enum: ['v1', 'v2'],
    required: false,
  })
  @IsOptional()
  @IsIn(['v1', 'v2'])
  didCommVersion?: 'v1' | 'v2'
}
