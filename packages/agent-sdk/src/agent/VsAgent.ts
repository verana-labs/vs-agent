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
  BaseLogger,
  convertPublicKeyToX25519,
  CredoError,
  DidCommV1Service,
  DidDocument,
  DidDocumentKey,
  DidDocumentRole,
  DidRepository,
  DidsModule,
  InitConfig,
  Kms,
  NewDidCommV2Service,
  NewDidCommV2ServiceEndpoint,
  ParsedDid,
  parseDid,
  W3cCredentialsModule,
} from '@credo-ts/core'
import {
  DidCommCredentialsModuleConfigOptions,
  DidCommCredentialV2Protocol,
  DidCommFeatureQueryOptions,
  DidCommJsonLdCredentialFormatService,
  DidCommModule,
  DidCommModuleConfigOptions,
  DidCommProofsModuleConfigOptions,
  DidCommProofV2Protocol,
} from '@credo-ts/didcomm'
import { VtFlowModule } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { multibaseEncode, MultibaseEncoding } from 'didwebvh-ts'

import { AuthorizationService } from '../blockchain/AuthorizationService'
import { VeranaChainService } from '../blockchain/VeranaChainService'
import { VeranaIndexerService } from '../blockchain/VeranaIndexerService'
import { applyAdminApiServiceEntry } from '../did/adminApiService'
import { applyArtifactServices, artifactServicesMatch } from '../did/artifactServices'
import {
  authenticationHasUpdateKey,
  hasLegacyVerificationMethods,
  migrateLegacyDidRecord,
} from '../did/migrations'
import { baseMessageEvents } from '../events/BaseMessageEvents'
import { connectionEvents } from '../events/ConnectionEvents'
import { vtFlowEvents } from '../events/VtFlowEvents'
import { EcsClaims } from '../utils/ecsClaims'

const MANAGED_DIDCOMM_SERVICE_TYPES: readonly string[] = [DidCommV1Service.type, NewDidCommV2Service.type]

type VsAgentDidCommModule = DidCommModule<
  DidCommModuleConfigOptions & {
    credentials: DidCommCredentialsModuleConfigOptions<
      [
        DidCommCredentialV2Protocol<
          [
            LegacyIndyDidCommCredentialFormatService,
            AnonCredsDidCommCredentialFormatService,
            DidCommJsonLdCredentialFormatService,
          ]
        >,
      ]
    >
    proofs: DidCommProofsModuleConfigOptions<
      [DidCommProofV2Protocol<[LegacyIndyDidCommProofFormatService, AnonCredsDidCommProofFormatService]>]
    >
  }
>

export type BaseAgentModules = {
  askar: AskarModule
  anoncreds: AnonCredsModule
  dids: DidsModule
  w3cCredentials: W3cCredentialsModule
  didcomm: VsAgentDidCommModule
  vtFlow: VtFlowModule
}

interface AgentOptions<TModules extends BaseAgentModules> {
  config: InitConfig
  modules?: TModules
  dependencies: AgentDependencies
}

export class VsAgent<TModules extends BaseAgentModules = BaseAgentModules> extends Agent<TModules> {
  public did?: string
  public autoDiscloseUserProfile?: boolean
  public publicApiBaseUrl: string
  public adminApiServiceEndpoint?: string
  public displayPictureUrl?: string
  public label: string
  public veranaChain?: VeranaChainService
  public indexer: VeranaIndexerService
  public trustedEcosystemDids?: string[]
  public ecsClaims?: EcsClaims
  public authorizationService?: AuthorizationService
  public discoveryOptions?: DidCommFeatureQueryOptions[]

  public constructor(
    options: AgentOptions<TModules> & {
      did?: string
      autoDiscloseUserProfile?: boolean
      publicApiBaseUrl: string
      adminApiServiceEndpoint?: string
      displayPictureUrl?: string
      label: string
      veranaChain?: VeranaChainService
      indexer: VeranaIndexerService
      trustedEcosystemDids?: string[]
      ecsClaims?: EcsClaims
      authorizationService?: AuthorizationService
      discoveryOptions?: DidCommFeatureQueryOptions[]
    },
  ) {
    super(options)
    this.did = options.did
    this.autoDiscloseUserProfile = options.autoDiscloseUserProfile
    this.publicApiBaseUrl = options.publicApiBaseUrl
    this.adminApiServiceEndpoint = options.adminApiServiceEndpoint
    this.displayPictureUrl = options.displayPictureUrl
    this.label = options.label
    this.veranaChain = options.veranaChain
    this.indexer = options.indexer
    this.trustedEcosystemDids = options.trustedEcosystemDids
    this.ecsClaims = options.ecsClaims
    this.authorizationService = options.authorizationService
    this.discoveryOptions = options.discoveryOptions
  }

  private get hasUserProfile(): boolean {
    return 'userProfile' in this.modules
  }

  public async initialize() {
    await super.initialize()

    const logger = this.config.logger as BaseLogger
    await connectionEvents(this, { discoveryOptions: this.discoveryOptions, logger })
    await baseMessageEvents(this as VsAgent, logger)
    await vtFlowEvents(this as VsAgent, logger)

    if (this.hasUserProfile) {
      // Make sure default User Profile corresponds to settings in environment variables
      const imageUrl = this.displayPictureUrl
      const displayPicture = imageUrl ? { links: [imageUrl], mimeType: 'image/png' } : undefined

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.modules as any).userProfile.updateUserProfileData({
        displayName: this.label,
        displayPicture,
      }) // TODO: Move this logic to the ChatPlugin
    }

    const parsedDid = this.did ? parseDid(this.did) : null
    if (parsedDid) {
      // If a public did is specified, check if it's already stored in the wallet. If it's not the case,
      // create a new one and generate keys for DIDComm (if there are endpoints configured)
      // TODO: Make DIDComm version, keys, etc. configurable. Keys can also be imported
      // The configured DID is always SCID-less: its id is the location (domain[%3Aport][:path...])
      const location = parsedDid.id
      const [domain, ...pathSegments] = location.split(':')
      const path = pathSegments.length ? pathSegments.join('/') : undefined

      const existingRecord = await this.findCreatedDid(parsedDid)

      if (!existingRecord) {
        const otherMethod = parsedDid.method === 'webvh' ? 'web' : 'webvh'
        const foreignRecord = await this.findCreatedDid({ ...parsedDid, method: otherMethod })
        if (foreignRecord) {
          throw new CredoError(
            `Persisted public DID '${foreignRecord.did}' was created with method '${otherMethod}', but AGENT_PUBLIC_DID_METHOD is now '${parsedDid.method}'. Refusing to start: creating a second DID would discard the credentials, Participant entries and permissions bound to the persisted one.`,
          )
        }
      }

      if (existingRecord) {
        const persistedLocation =
          parsedDid.method === 'webvh'
            ? (existingRecord.getTag('domain') as string | undefined)
            : parseDid(existingRecord.did).id
        if (persistedLocation !== location) {
          throw new CredoError(
            `Persisted public DID '${existingRecord.did}' was created for location '${persistedLocation}', but PUBLIC_API_BASE_URL now derives location '${location}'. Refusing to start: restore the previous URL or deliberately reset the wallet.`,
          )
        }
      }

      // DID has not been created yet. Let's do it
      if (!existingRecord) {
        if (parsedDid.method === 'web') {
          const didDocument = new DidDocument({ id: parsedDid.did })
          const didCommKey = await this.createAndAddDidCommKeysAndServices(didDocument)

          // Add Self TR
          await this.createAndAddLinkedVpServices(didDocument)

          applyArtifactServices(didDocument, { method: 'web', publicApiBaseUrl: this.publicApiBaseUrl })

          this.applyAdminApiService(didDocument)

          const createResult = await this.dids.create({
            method: 'web',
            domain: location,
            didDocument,
            keys: [didCommKey],
          })
          if (createResult.didState.state !== 'finished') {
            throw new CredoError(
              `Failed to create did:web record: ${(createResult.didState as { reason?: string }).reason ?? 'unknown reason'}`,
            )
          }
          this.did = parsedDid.did
        } else if (parsedDid.method === 'webvh') {
          // If there is an existing did:web with the same domain, this could be an
          // upgrade. There should be no problem on removing did:web record since we
          // can use newer keys for DIDComm bootstrapping, but we should at least warn
          // about that
          const didRepository = this.dependencyManager.resolve(DidRepository)
          const existingDidWebRecord = await didRepository.findCreatedDid(this.context, `did:web:${location}`)
          if (existingDidWebRecord) {
            this.logger.warn('Existing record for legacy did:web found. Removing it')
            await didRepository.delete(this.context, existingDidWebRecord)
          }

          const createResult = await this.dids.create({ method: 'webvh', domain, path })
          const { did: publicDid, didDocument } = createResult.didState
          if (!publicDid || !didDocument) {
            throw new CredoError(
              `Failed to create did:webvh record: ${(createResult.didState as { reason?: string }).reason ?? 'unknown reason'}`,
            )
          }

          // Add DIDComm services and keys
          const didCommKey = await this.createAndAddDidCommKeysAndServices(didDocument)

          // Add Linked VP services
          await this.createAndAddLinkedVpServices(didDocument)

          applyArtifactServices(didDocument, { method: 'webvh', publicApiBaseUrl: this.publicApiBaseUrl })

          didDocument.alsoKnownAs = [`did:web:${location}`]

          // The webvh registrar doesn't merge new keys into the DidRecord on update,
          // so persist the DIDComm key mapping directly on the existing record.
          await this.persistDidDocumentKey(publicDid, didCommKey)

          this.applyAdminApiService(didDocument)

          const result = await this.dids.update({ did: publicDid, didDocument })
          if (result.didState.state !== 'finished') {
            throw new CredoError(
              `Cannot update DID ${publicDid}: ${(result.didState as { reason?: string }).reason ?? 'unknown reason'}`,
            )
          }
          this.logger?.debug('Public did:webvh record created')
          this.did = publicDid
        } else {
          throw new CredoError(`Agent DID method not supported: ${parsedDid.method}`)
        }

        return
      }

      await migrateLegacyDidRecord(this.agentContext, existingRecord, {
        method: parsedDid.method,
        location,
        logger: this.logger,
      })

      // DID Already exists: update it in case that agent parameters have been changed. At the moment, we can only update
      //  DIDComm endpoints, so we'll only replace the service (if different from previous)
      const didDocument = existingRecord.didDocument!
      const hasLegacyMethods = hasLegacyVerificationMethods(didDocument)
      const ed25519VerificationMethodId = this.findEd25519VerificationMethodId(didDocument)
      const servicesChanged =
        !ed25519VerificationMethodId ||
        JSON.stringify(didDocument.didCommServices) !==
          JSON.stringify(this.getDidCommServices(didDocument.id, ed25519VerificationMethodId))
      const authHasUpdateKey = authenticationHasUpdateKey(
        didDocument,
        parsedDid.method,
        ed25519VerificationMethodId,
      )
      const currentAdminEntry = (didDocument.service ?? []).find(s => s.type === 'VsAgentAdminAPI')
      const adminEntryChanged = currentAdminEntry?.serviceEndpoint !== this.adminApiServiceEndpoint
      // A record from an earlier version may still carry the service of the other method.
      const artifactMethod = parsedDid.method === 'webvh' ? 'webvh' : 'web'
      const artifactServicesChanged = !artifactServicesMatch(didDocument, {
        method: artifactMethod,
        publicApiBaseUrl: this.publicApiBaseUrl,
      })
      if (
        hasLegacyMethods ||
        servicesChanged ||
        authHasUpdateKey ||
        adminEntryChanged ||
        artifactServicesChanged
      ) {
        if (servicesChanged && ed25519VerificationMethodId) {
          didDocument.service = [
            ...(didDocument.service
              ? didDocument.service.filter(service => !MANAGED_DIDCOMM_SERVICE_TYPES.includes(service.type))
              : []),
            ...this.getDidCommServices(didDocument.id, ed25519VerificationMethodId),
          ]
        }
        applyArtifactServices(didDocument, {
          method: artifactMethod,
          publicApiBaseUrl: this.publicApiBaseUrl,
        })
        this.applyAdminApiService(didDocument)
        const newKeys: DidDocumentKey[] = []
        if (hasLegacyMethods) {
          newKeys.push(await this.createAndAddDidCommKeysAndServices(didDocument))
        }

        if (authHasUpdateKey) didDocument.authentication = [ed25519VerificationMethodId!]

        if (newKeys.length && parsedDid.method === 'webvh') {
          // webvh registrar doesn't accept keys in update options; persist directly
          for (const key of newKeys) await this.persistDidDocumentKey(didDocument.id, key)
        }

        // The webvh registrar returns state:"failed" WITHOUT throwing, so an unchecked update
        // silently no-ops. Check the result and surface the reason instead of assuming success.
        const updateResult = await this.dids.update({
          did: didDocument.id,
          didDocument,
          ...(newKeys.length && parsedDid.method === 'web' ? { keys: newKeys } : {}),
        })
        if (updateResult.didState.state !== 'finished') {
          this.logger?.error('Public did record update failed to persist', {
            did: didDocument.id,
            state: updateResult.didState.state,
            reason: (updateResult.didState as { reason?: string }).reason,
          })
        } else {
          this.logger?.debug('Public did record updated')
        }
      } else {
        this.logger?.debug('Existing DID record found. No updates')
      }
      this.did = existingRecord.did
    }
  }

  private async findCreatedDid(parsedDid: ParsedDid) {
    const didRepository = this.dependencyManager.resolve(DidRepository)

    // Method-scoped on purpose: a location change must surface as a mismatch error in
    // initialize, never as a lookup miss that silently mints a second DID
    return await didRepository.findSingleByQuery(this.context, {
      method: parsedDid.method,
      role: DidDocumentRole.Created,
    })
  }

  // Prefer Ed25519VerificationKey2020 over Multikey: webvh's update Multikey is not ours to use.
  private findEd25519VerificationMethodId(didDocument: DidDocument): string | undefined {
    const vms = didDocument.verificationMethod ?? []
    const preferred = vms.find(vm => vm.type === 'Ed25519VerificationKey2020')
    if (preferred) return preferred.id
    const fallback = vms.find(
      vm =>
        vm.type === 'Ed25519VerificationKey2018' ||
        (vm.type === 'Multikey' &&
          typeof vm.publicKeyMultibase === 'string' &&
          vm.publicKeyMultibase.startsWith('z6Mk')),
    )
    return fallback?.id
  }

  private getDidCommServices(publicDid: string, ed25519VerificationMethodId: string) {
    const didcommVersions = this.didcomm!.config.didcommVersions
    const includeV1 = didcommVersions.includes('v1')
    const includeV2 = didcommVersions.includes('v2')
    const services: (DidCommV1Service | NewDidCommV2Service)[] = []

    this.didcomm!.config.endpoints.forEach((endpoint, index) => {
      if (includeV1) {
        services.push(
          new DidCommV1Service({
            id: `${publicDid}#did-communication`,
            serviceEndpoint: endpoint,
            priority: index,
            routingKeys: [], // TODO: Support mediation
            recipientKeys: [ed25519VerificationMethodId],
            accept: ['didcomm/aip2;env=rfc19'],
          }),
        )
      }
      if (includeV2) {
        services.push(
          new NewDidCommV2Service({
            id: `${publicDid}#didcomm-messaging-${index}`,
            serviceEndpoint: new NewDidCommV2ServiceEndpoint({
              uri: endpoint,
              accept: ['didcomm/v2'],
            }),
          }),
        )
      }
    })

    return services
  }

  private async persistDidDocumentKey(did: string, key: DidDocumentKey) {
    const didRepository = this.agentContext.resolve(DidRepository)
    const [record] = await didRepository.findByQuery(this.agentContext, { did })
    if (!record) return
    const existing = record.keys ?? []
    if (existing.some(k => k.didDocumentRelativeKeyId === key.didDocumentRelativeKeyId)) return
    record.keys = [...existing, key]
    await didRepository.update(this.agentContext, record)
  }

  private async createAndAddDidCommKeysAndServices(didDocument: DidDocument): Promise<DidDocumentKey> {
    const publicDid = didDocument.id

    const context = [
      'https://w3id.org/security/multikey/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
      'https://w3id.org/security/suites/x25519-2019/v1',
    ]
    const keyAgreementId = `${publicDid}#key-agreement-1`
    const kms = this.agentContext.resolve(Kms.KeyManagementApi)

    // Create didcomm keys
    const key = await kms.createKey({ type: { kty: 'OKP', crv: 'Ed25519' } })
    const publicKeyBytes = Kms.PublicJwk.fromPublicJwk(key.publicJwk).publicKey.publicKey
    const publicKeyMultibase = multibaseEncode(
      new Uint8Array([0xed, 0x01, ...publicKeyBytes]),
      MultibaseEncoding.BASE58_BTC,
    )
    const didDocumentKey: DidDocumentKey = {
      kmsKeyId: key.keyId,
      didDocumentRelativeKeyId: `#${publicKeyMultibase}`,
    }
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

    const didcommServices = this.getDidCommServices(publicDid, verificationMethodId)

    const currentContexts = Array.isArray(didDocument.context)
      ? didDocument.context
      : didDocument.context
        ? [didDocument.context]
        : []
    didDocument.context = [
      ...new Set([...currentContexts.filter(ctx => !legacyContexts.includes(ctx)), ...context]),
    ]
    didDocument.verificationMethod = [...filteredMethods, ...verificationMethods]
    // Replace (not merge): keeps did:webvh's update key out of DIDComm relations.
    // Same pattern as didcomm-mediator/src/agent/DidCommMediatorAgent.ts.
    didDocument.authentication = [authentication]
    didDocument.assertionMethod = [assertionMethod]
    didDocument.keyAgreement = [keyAgreement]
    didDocument.service = [
      ...(didDocument.service
        ? didDocument.service.filter(service => !MANAGED_DIDCOMM_SERVICE_TYPES.includes(service.type))
        : []),
      ...didcommServices,
    ]

    return didDocumentKey
  }

  private async createAndAddLinkedVpServices(didDocument: DidDocument) {
    didDocument.context = [
      ...(didDocument.context ?? []),
      'https://identity.foundation/linked-vp/contexts/v1',
    ]
  }

  private applyAdminApiService(didDocument: DidDocument): void {
    applyAdminApiServiceEntry(didDocument, this.adminApiServiceEndpoint)
  }
}

export interface VsAgentOptions {
  config: InitConfig
  did?: string
  autoDiscloseUserProfile?: boolean
  dependencies: AgentDependencies
  publicApiBaseUrl: string
  adminApiServiceEndpoint?: string
  masterListCscaLocation?: string
  endpoints: string[]
  walletConfig: AskarModuleConfigStoreOptions
  displayPictureUrl?: string
  label: string
}
