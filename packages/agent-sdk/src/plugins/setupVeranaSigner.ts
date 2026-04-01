import { AnonCredsModule } from '@credo-ts/anoncreds'
import { AskarModule, AskarModuleConfigStoreOptions } from '@credo-ts/askar'
import { DidsModule, W3cCredentialsModule } from '@credo-ts/core'
import { WebVhAnonCredsRegistry, WebVhDidRegistrar, WebVhDidResolver } from '@credo-ts/webvh'
import { anoncreds } from '@hyperledger/anoncreds-nodejs'
import { askar } from '@openwallet-foundation/askar-nodejs'
import { DidWebAnonCredsRegistry } from 'credo-ts-didweb-anoncreds'

import { BaseAgentModules } from '../agent/types'
import { FullTailsFileService } from '../credentials/FullTailsFileService'
import { defaultDocumentLoader } from '../did/CachedDocumentLoader'
import { CachedWebDidResolver } from '../did/CachedWebDidResolver'
import { WebDidRegistrar } from '../did/WebDidRegistrar'

export interface SignerPluginOptions {
  walletConfig: AskarModuleConfigStoreOptions
  publicApiBaseUrl: string
  masterListCscaLocation?: string
}

export interface SignerPlugin {
  modules: BaseAgentModules
}

/**
 * Sets up the base Verana signer modules: wallet, DID, AnonCreds, W3C credentials.
 * Use this for services that need to sign credentials without DIDComm.
 */
export function setupVeranaSigner(options: SignerPluginOptions): SignerPlugin {
  return {
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
      dids: new DidsModule({
        resolvers: [
          new CachedWebDidResolver({ publicApiBaseUrl: options.publicApiBaseUrl }),
          new WebVhDidResolver(),
        ],
        registrars: [new WebDidRegistrar(), new WebVhDidRegistrar()],
      }),
      w3cCredentials: new W3cCredentialsModule({
        documentLoader: defaultDocumentLoader,
      }),
    },
  }
}
