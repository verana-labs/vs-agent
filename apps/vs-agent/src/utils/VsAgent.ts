import { DidCommCallsModule } from '@2060.io/credo-ts-didcomm-calls'
import { DidCommMediaSharingModule } from '@2060.io/credo-ts-didcomm-media-sharing'
import { DidCommMrtdModule } from '@2060.io/credo-ts-didcomm-mrtd'
import { DidCommReceiptsModule } from '@2060.io/credo-ts-didcomm-receipts'
import {
  DidCommUserProfileModule,
  DidCommUserProfileModuleConfig,
} from '@2060.io/credo-ts-didcomm-user-profile'
import { ActionMenuModule } from '@credo-ts/action-menu'
import {
  AnonCredsDidCommCredentialFormatService,
  AnonCredsModule,
  AnonCredsDidCommProofFormatService,
  LegacyIndyDidCommCredentialFormatService,
  LegacyIndyDidCommProofFormatService,
} from '@credo-ts/anoncreds'
import { AskarModule, AskarModuleConfigStoreOptions } from '@credo-ts/askar'
import {
  Agent,
  AgentDependencies,
  convertPublicKeyToX25519,
  CredoError,
  DidCommV1Service,
  DidDocument,
  DidDocumentService,
  DidRepository,
  DidsModule,
  InitConfig,
  Kms,
  ParsedDid,
  parseDid,
  W3cCredentialsModule,
} from '@credo-ts/core'
import {
  DidCommAutoAcceptCredential,
  DidCommAutoAcceptProof,
  DidCommCredentialsModuleConfigOptions,
  DidCommCredentialV2Protocol,
  DidCommHttpOutboundTransport,
  DidCommModule,
  DidCommModuleConfigOptions,
  DidCommProofsModuleConfigOptions,
  DidCommProofV2Protocol,
} from '@credo-ts/didcomm'
import { QuestionAnswerModule } from '@credo-ts/question-answer'
import { WebVhDidResolver, WebVhAnonCredsRegistry, WebVhDidRegistrar } from '@credo-ts/webvh'
import { anoncreds } from '@hyperledger/anoncreds-nodejs'
import { askar } from '@openwallet-foundation/askar-nodejs'
import { DidWebAnonCredsRegistry } from 'credo-ts-didweb-anoncreds'
import { multibaseEncode, MultibaseEncoding } from 'didwebvh-ts'

import { FullTailsFileService } from '../services/FullTailsFileService'

import { defaultDocumentLoader } from './CachedDocumentLoader'
import { CachedWebDidResolver } from './CachedWebDidResolver'
import { VsAgentWsOutboundTransport } from './VsAgentWsOutboundTransport'
import { WebDidRegistrar } from './WebDidRegistrar'

type VsAgentModules = {
  askar: AskarModule
  anoncreds: AnonCredsModule
  actionMenu: ActionMenuModule
  dids: DidsModule
  calls: DidCommCallsModule
  didcomm: DidCommModule<
    DidCommModuleConfigOptions & {
      credentials: DidCommCredentialsModuleConfigOptions<
        [
          DidCommCredentialV2Protocol<
            [LegacyIndyDidCommCredentialFormatService, AnonCredsDidCommCredentialFormatService]
          >,
        ]
      >
      proofs: DidCommProofsModuleConfigOptions<
        [DidCommProofV2Protocol<[LegacyIndyDidCommProofFormatService, AnonCredsDidCommProofFormatService]>]
      >
    }
  >
  media: DidCommMediaSharingModule
  mrtd: DidCommMrtdModule
  questionAnswer: QuestionAnswerModule
  receipts: DidCommReceiptsModule
  userProfile: DidCommUserProfileModule
  w3cCredentials: W3cCredentialsModule
}

interface AgentOptions<VsAgentModules> {
  config: InitConfig
  modules?: VsAgentModules
  dependencies: AgentDependencies
}

export class VsAgent extends Agent<VsAgentModules> {
  public did?: string
  public autoDiscloseUserProfile?: boolean
  public publicApiBaseUrl: string
  public displayPictureUrl?: string
  public label: string

  public constructor(
    options: AgentOptions<VsAgentModules> & {
      did?: string
      autoDiscloseUserProfile?: boolean
      publicApiBaseUrl: string
      displayPictureUrl?: string
      label: string
    },
  ) {
    super(options)
    this.did = options.did
    this.autoDiscloseUserProfile = options.autoDiscloseUserProfile
    this.publicApiBaseUrl = options.publicApiBaseUrl
    this.displayPictureUrl = options.displayPictureUrl
    this.label = options.label
  }

  public async initialize() {
    await super.initialize()

    // Make sure default User Profile corresponds to settings in environment variables
    const imageUrl = this.displayPictureUrl
    const displayPicture = imageUrl ? { links: [imageUrl], mimeType: 'image/png' } : undefined

    await this.modules.userProfile.updateUserProfileData({
      displayName: this.label,
      displayPicture,
    })

    const parsedDid = this.did ? parseDid(this.did) : null
    if (parsedDid) {
      // If a public did is specified, check if it's already stored in the wallet. If it's not the case,
      // create a new one and generate keys for DIDComm (if there are endpoints configured)
      // TODO: Make DIDComm version, keys, etc. configurable. Keys can also be imported
      const domain = parsedDid.id.includes(':') ? parsedDid.id.split(':')[1] : parsedDid.id

      const existingRecord = await this.findCreatedDid(parsedDid)

      // DID has not been created yet. Let's do it
      if (!existingRecord) {
        if (parsedDid.method === 'web') {
          const didDocument = new DidDocument({ id: parsedDid.did })
          await this.createAndAddDidCommKeysAndServices(didDocument)

          // Add Self TR
          await this.createAndAddLinkedVpServices(didDocument)

          // Add AnonCreds Services
          await this.createAndAddAnonCredsServices(didDocument)

          await this.dids.create({
            method: 'web',
            domain,
            didDocument,
          })
          this.did = parsedDid.did
        } else if (parsedDid.method === 'webvh') {
          // If there is an existing did:web with the same domain, this could be an
          // upgrade. There should be no problem on removing did:web record since we
          // can use newer keys for DIDComm bootstrapping, but we should at least warn
          // about that
          const didRepository = this.dependencyManager.resolve(DidRepository)
          const existingDidWebRecord = await didRepository.findCreatedDid(this.context, `did:web:${domain}`)
          if (existingDidWebRecord) {
            this.logger.warn('Existing record for legacy did:web found. Removing it')
            await didRepository.delete(this.context, existingDidWebRecord)
          }

          const {
            didState: { did: publicDid, didDocument },
          } = await this.dids.create({ method: 'webvh', domain })
          if (!publicDid || !didDocument) {
            this.logger.error('Failed to create did:webvh record')
            process.exit(1)
          }

          // Add DIDComm services and keys
          await this.createAndAddDidCommKeysAndServices(didDocument)

          // Add Linked VP services
          await this.createAndAddLinkedVpServices(didDocument)

          // Add implicit services
          await this.createAndAddWebVhImplicitServices(didDocument)

          didDocument.alsoKnownAs = [`did:web:${domain}`]

          const result = await this.dids.update({ did: publicDid, didDocument })
          if (result.didState.state !== 'finished') {
            this.logger.error(`Cannot update DID ${publicDid}`)
            process.exit(1)
          }
          this.logger?.debug('Public did:webvh record created')
          this.did = publicDid
        } else {
          throw new CredoError(`Agent DID method not supported: ${parsedDid.method}`)
        }

        return
      }

      // Make sure did:webvh record has the did:web form as an alternative, in order to support
      // implicit invitations
      if (
        parsedDid.method === 'webvh' &&
        !(existingRecord?.getTag('alternativeDids') as string[])?.includes(`did:web:${domain}`)
      ) {
        this.logger?.debug('Adding did:web form as an alternative DID')

        existingRecord.setTag('alternativeDids', [`did:web:${domain}`])
        const didRepository = this.dependencyManager.resolve(DidRepository)
        await didRepository.update(this.agentContext, existingRecord)
      }
      // DID Already exists: update it in case that agent parameters have been changed. At the moment, we can only update
      //  DIDComm endpoints, so we'll only replace the service (if different from previous)
      const didDocument = existingRecord.didDocument!
      const hasLegacyMethods = (didDocument.verificationMethod ?? []).some(vm =>
        ['Ed25519VerificationKey2018', 'X25519KeyAgreementKey2019'].includes(vm.type),
      )
      const servicesChanged =
        JSON.stringify(didDocument.didCommServices) !==
        JSON.stringify(this.getDidCommServices(didDocument.id))
      if (hasLegacyMethods || servicesChanged) {
        if (servicesChanged) {
          didDocument.service = [
            ...(didDocument.service
              ? didDocument.service.filter(service => ![DidCommV1Service.type].includes(service.type))
              : []),
            ...this.getDidCommServices(didDocument.id),
          ]
        }
        if (hasLegacyMethods) await this.createAndAddDidCommKeysAndServices(didDocument)

        await this.dids.update({ did: didDocument.id, didDocument })
        this.logger?.debug('Public did record updated')
      } else {
        this.logger?.debug('Existing DID record found. No updates')
      }
      this.did = existingRecord.did
    }
  }

  private async findCreatedDid(parsedDid: ParsedDid) {
    const didRepository = this.dependencyManager.resolve(DidRepository)

    // Particular case of webvh: parsedDid might not include the SCID, so we'll need to find it by domain
    if (parsedDid.method === 'webvh') {
      const domain = parsedDid.id.includes(':') ? parsedDid.id.split(':')[1] : parsedDid.id
      return await didRepository.findSingleByQuery(this.context, { method: 'webvh', domain })
    }

    return await didRepository.findCreatedDid(this.context, parsedDid.did)
  }

  private getDidCommServices(publicDid: string) {
    const keyAgreementId = `${publicDid}#key-agreement-1`

    return this.didcomm.config.endpoints.map((endpoint, index) => {
      return new DidCommV1Service({
        id: `${publicDid}#did-communication`,
        serviceEndpoint: endpoint,
        priority: index,
        routingKeys: [], // TODO: Support mediation
        recipientKeys: [keyAgreementId],
        accept: ['didcomm/aip2;env=rfc19'],
      })
    })
  }

  private async createAndAddDidCommKeysAndServices(didDocument: DidDocument) {
    const publicDid = didDocument.id

    const context = [
      'https://w3id.org/security/multikey/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
      'https://w3id.org/security/suites/x25519-2019/v1',
    ]
    const keyAgreementId = `${publicDid}#key-agreement-1`
    const kms = this.agentContext.resolve(Kms.KeyManagementApi)
    const didRepository = this.agentContext.resolve(DidRepository)

    // Create didcomm keys
    const key = await kms.createKey({ type: { kty: 'OKP', crv: 'Ed25519' } })
    const publicKeyBytes = Kms.PublicJwk.fromPublicJwk(key.publicJwk).publicKey.publicKey
    const publicKeyMultibase = multibaseEncode(
      new Uint8Array([0xed, 0x01, ...publicKeyBytes]),
      MultibaseEncoding.BASE58_BTC,
    )
    const [record] = await didRepository.findByQuery(this.agentContext, { did: publicDid })
    record.keys?.push({
      kmsKeyId: key.keyId,
      didDocumentRelativeKeyId: `#${publicKeyMultibase}`,
    })
    await didRepository.update(this.agentContext, record)
    const verificationMethodId = `${publicDid}#${publicKeyMultibase}`
    const publicKeyX25519 = convertPublicKeyToX25519(publicKeyBytes)
    const x25519Key = Kms.PublicJwk.fromPublicKey({ kty: 'OKP', crv: 'X25519', publicKey: publicKeyX25519 })

    // Remove legacy if exist
    const legacyContexts = ['https://w3id.org/security/suites/ed25519-2018/v1']
    const legacyAuthId = (didDocument.verificationMethod ?? []).find(vm =>
      ['Ed25519VerificationKey2018'].includes(vm.type),
    )?.id
    if (legacyAuthId) {
      didDocument.authentication = (didDocument.authentication ?? []).filter(id => id !== legacyAuthId)
      didDocument.assertionMethod = (didDocument.assertionMethod ?? []).filter(id => id !== legacyAuthId)
    }
    const filteredMethods = (didDocument.verificationMethod ?? []).filter(
      vm => !['Ed25519VerificationKey2018', 'X25519KeyAgreementKey2019'].includes(vm.type),
    )

    const verificationMethods = [
      {
        controller: publicDid,
        id: verificationMethodId,
        publicKeyMultibase,
        type: 'Ed25519VerificationKey2020',
      },
      {
        controller: publicDid,
        id: keyAgreementId,
        publicKeyMultibase: x25519Key.fingerprint,
        type: 'Multikey',
      },
    ]

    const authentication = verificationMethodId
    const assertionMethod = verificationMethodId
    const keyAgreement = keyAgreementId

    const didcommServices = this.getDidCommServices(publicDid)

    const currentContexts = Array.isArray(didDocument.context)
      ? didDocument.context
      : didDocument.context
        ? [didDocument.context]
        : []
    didDocument.context = [
      ...new Set([...currentContexts.filter(ctx => !legacyContexts.includes(ctx)), ...context]),
    ]
    didDocument.verificationMethod = [...filteredMethods, ...verificationMethods]
    didDocument.authentication = [...new Set([...(didDocument.authentication ?? []), authentication])]
    didDocument.assertionMethod = [...new Set([...(didDocument.assertionMethod ?? []), assertionMethod])]
    didDocument.keyAgreement = [...new Set([...(didDocument.keyAgreement ?? []), keyAgreement])]
    didDocument.service = [
      ...(didDocument.service
        ? didDocument.service.filter(service => ![DidCommV1Service.type].includes(service.type))
        : []),
      ...didcommServices,
    ]
  }

  private async createAndAddLinkedVpServices(didDocument: DidDocument) {
    const publicDid = didDocument.id
    didDocument.service = [
      ...(didDocument.service ?? []),
      ...[
        new DidDocumentService({
          id: `${publicDid}#vpr-ecs-service-c-vp`,
          serviceEndpoint: `${this.publicApiBaseUrl}/vt/ecs-service-c-vp.json`,
          type: 'LinkedVerifiablePresentation',
        }),
        new DidDocumentService({
          id: `${publicDid}#vpr-ecs-org-c-vp`,
          serviceEndpoint: `${this.publicApiBaseUrl}/vt/ecs-org-c-vp.json`,
          type: 'LinkedVerifiablePresentation',
        }),
      ],
    ]

    didDocument.context = [
      ...(didDocument.context ?? []),
      'https://identity.foundation/linked-vp/contexts/v1',
    ]
  }

  /**
   * Basic implicit webvh services, for the moment pointing to the service VP
   * and public base URL
   */
  private async createAndAddWebVhImplicitServices(didDocument: DidDocument) {
    const publicDid = didDocument.id
    didDocument.service = [
      ...(didDocument.service ?? []),
      ...[
        new DidDocumentService({
          id: `${publicDid}#whois`,
          serviceEndpoint: `${this.publicApiBaseUrl}/vt/ecs-service-c-vp.json`,
          type: 'LinkedVerifiablePresentation',
        }),
        new DidDocumentService({
          id: `${publicDid}#files`,
          serviceEndpoint: `${this.publicApiBaseUrl}`,
          type: 'relativeRef',
        }),
      ],
    ]
  }

  private async createAndAddAnonCredsServices(didDocument: DidDocument) {
    const publicDid = didDocument.id
    didDocument.service = [
      ...(didDocument.service ?? []),
      new DidDocumentService({
        id: `${publicDid}#anoncreds`,
        serviceEndpoint: `${this.publicApiBaseUrl}/anoncreds/v1`,
        type: 'AnonCredsRegistry',
      }),
    ]
  }
}

export interface VsAgentOptions {
  config: InitConfig
  did?: string
  autoDiscloseUserProfile?: boolean
  dependencies: AgentDependencies
  publicApiBaseUrl: string
  masterListCscaLocation?: string
  endpoints: string[]
  walletConfig: AskarModuleConfigStoreOptions
  displayPictureUrl?: string
  label: string
}

export const createVsAgent = (options: VsAgentOptions): VsAgent => {
  return new VsAgent({
    config: options.config,
    dependencies: options.dependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: options.walletConfig,
      }),
      anoncreds: new AnonCredsModule({
        anoncreds,
        tailsFileService: new FullTailsFileService({
          tailsServerBaseUrl: `${options.publicApiBaseUrl}/anoncreds/v1/tails`,
        }),
        registries: [
          new DidWebAnonCredsRegistry({
            cacheOptions: { allowCaching: true, cacheDurationInSeconds: 24 * 60 * 60 },
          }),
          new WebVhAnonCredsRegistry(),
        ],
      }),
      actionMenu: new ActionMenuModule({ strictStateChecking: false }),
      calls: new DidCommCallsModule(),
      dids: new DidsModule({
        resolvers: [
          new CachedWebDidResolver({ publicApiBaseUrl: options.publicApiBaseUrl }),
          new WebVhDidResolver(),
        ],
        registrars: [new WebDidRegistrar(), new WebVhDidRegistrar()],
      }),
      mrtd: new DidCommMrtdModule({ masterListCscaLocation: options.masterListCscaLocation }),
      didcomm: new DidCommModule({
        endpoints: options.endpoints,
        transports: {
          outbound: [new DidCommHttpOutboundTransport(), new VsAgentWsOutboundTransport()],
        },
        connections: { autoAcceptConnections: true },
        credentials: {
          autoAcceptCredentials: DidCommAutoAcceptCredential.ContentApproved,
          credentialProtocols: [
            new DidCommCredentialV2Protocol({
              credentialFormats: [
                new LegacyIndyDidCommCredentialFormatService(),
                new AnonCredsDidCommCredentialFormatService(),
              ],
            }),
          ],
        },
        proofs: {
          autoAcceptProofs: DidCommAutoAcceptProof.ContentApproved,
          proofProtocols: [
            new DidCommProofV2Protocol({
              proofFormats: [
                new LegacyIndyDidCommProofFormatService(),
                new AnonCredsDidCommProofFormatService(),
              ],
            }),
          ],
        },
      }),
      media: new DidCommMediaSharingModule(),
      questionAnswer: new QuestionAnswerModule(),
      receipts: new DidCommReceiptsModule(),
      // Disable module's auto disclose feature, since we are going to manage it in MessageEvents
      userProfile: new DidCommUserProfileModule(
        new DidCommUserProfileModuleConfig({ autoSendProfile: false }),
      ),
      w3cCredentials: new W3cCredentialsModule({
        documentLoader: defaultDocumentLoader,
      }),
    },
    did: options.did,
    autoDiscloseUserProfile: options.autoDiscloseUserProfile,
    publicApiBaseUrl: options.publicApiBaseUrl,
    displayPictureUrl: options.displayPictureUrl,
    label: options.label,
  })
}
