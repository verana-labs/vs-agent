import {
  Agent,
  AgentDependencies,
  convertPublicKeyToX25519,
  CredoError,
  DidCommV1Service,
  DidDocument,
  DidDocumentService,
  DidRepository,
  InitConfig,
  Kms,
  ParsedDid,
  parseDid,
} from '@credo-ts/core'
import { multibaseEncode, MultibaseEncoding } from 'didwebvh-ts'

import { defaultDocumentLoader } from '../did/CachedDocumentLoader'

import { BaseAgentModules, DidCommAgentModules } from './types'

interface AgentOptions<TModules extends BaseAgentModules> {
  config: InitConfig
  modules?: TModules
  dependencies: AgentDependencies
}

export class VsAgent<TModules extends BaseAgentModules = BaseAgentModules> extends Agent<TModules> {
  public did?: string
  public autoDiscloseUserProfile?: boolean
  public publicApiBaseUrl: string
  public displayPictureUrl?: string
  public label: string

  public constructor(
    options: AgentOptions<TModules> & {
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

  private get hasDidComm(): boolean {
    return 'didcomm' in this.modules
  }

  private get hasUserProfile(): boolean {
    return 'userProfile' in this.modules
  }

  public async initialize() {
    await super.initialize()

    if (this.hasUserProfile) {
      const imageUrl = this.displayPictureUrl
      const displayPicture = imageUrl ? { links: [imageUrl], mimeType: 'image/png' } : undefined

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.modules as any).userProfile.updateUserProfileData({
        displayName: this.label,
        displayPicture,
      })
    }

    const parsedDid = this.did ? parseDid(this.did) : null
    if (parsedDid) {
      const domain = parsedDid.id.includes(':') ? parsedDid.id.split(':')[1] : parsedDid.id

      const existingRecord = await this.findCreatedDid(parsedDid)

      if (!existingRecord) {
        if (parsedDid.method === 'web') {
          const didDocument = new DidDocument({ id: parsedDid.did })

          if (this.hasDidComm) {
            await this.createAndAddDidCommKeysAndServices(didDocument)
          }

          await this.createAndAddLinkedVpServices(didDocument)
          await this.createAndAddAnonCredsServices(didDocument)

          await this.dids.create({
            method: 'web',
            domain,
            didDocument,
          })
          this.did = parsedDid.did
        } else if (parsedDid.method === 'webvh') {
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

          if (this.hasDidComm) {
            await this.createAndAddDidCommKeysAndServices(didDocument)
          }

          await this.createAndAddLinkedVpServices(didDocument)
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

      if (
        parsedDid.method === 'webvh' &&
        !(existingRecord?.getTag('alternativeDids') as string[])?.includes(`did:web:${domain}`)
      ) {
        this.logger?.debug('Adding did:web form as an alternative DID')
        existingRecord.setTag('alternativeDids', [`did:web:${domain}`])
        const didRepository = this.dependencyManager.resolve(DidRepository)
        await didRepository.update(this.agentContext, existingRecord)
      }

      const didDocument = existingRecord.didDocument!
      const hasLegacyMethods = (didDocument.verificationMethod ?? []).some(vm =>
        ['Ed25519VerificationKey2018', 'X25519KeyAgreementKey2019'].includes(vm.type),
      )

      const servicesChanged =
        this.hasDidComm &&
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
        if (hasLegacyMethods && this.hasDidComm) await this.createAndAddDidCommKeysAndServices(didDocument)

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

    if (parsedDid.method === 'webvh') {
      const domain = parsedDid.id.includes(':') ? parsedDid.id.split(':')[1] : parsedDid.id
      return await didRepository.findSingleByQuery(this.context, { method: 'webvh', domain })
    }

    return await didRepository.findCreatedDid(this.context, parsedDid.did)
  }

  private getDidCommServices(publicDid: string) {
    const keyAgreementId = `${publicDid}#key-agreement-1`
    const didcommModules = this.modules as unknown as DidCommAgentModules

    return didcommModules.didcomm.config.endpoints.map((endpoint, index) => {
      return new DidCommV1Service({
        id: `${publicDid}#did-communication`,
        serviceEndpoint: endpoint,
        priority: index,
        routingKeys: [],
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

// Re-export defaultDocumentLoader for consumers
export { defaultDocumentLoader }

export interface VsAgentOptions {
  config: InitConfig
  did?: string
  autoDiscloseUserProfile?: boolean
  dependencies: AgentDependencies
  publicApiBaseUrl: string
  masterListCscaLocation?: string
  endpoints?: string[]
  walletConfig: import('@credo-ts/askar').AskarModuleConfigStoreOptions
  displayPictureUrl?: string
  label: string
}
