import {
  AgentContext,
  DidCreateOptions,
  DidCreateResult,
  DidDeactivateOptions,
  DidDeactivateResult,
  DidRegistrar,
  DidRepository,
  DidUpdateOptions,
  DidUpdateResult,
  DidDocument,
  DidRecord,
  DidDocumentRole,
  CredoError,
} from '@credo-ts/core'

interface WebDidCreateOptions extends DidCreateOptions {
  domain: string
}

interface WebDidUpdateOptions extends DidUpdateOptions {
  didDocument: DidDocument
  domain?: string
}

/**
 * DID Registrar implementation for the 'webvh' method.
 * Handles creation, update, and (future) deactivation of DIDs using the webvh method.
 */
export class WebDidRegistrar implements DidRegistrar {
  supportedMethods: string[] = ['web']

  /**
   * Creates a new DID document and saves it in the repository.
   * If services are provided, updates the DID document with those services.
   * @param agentContext The agent context.
   * @param options The creation options, including domain, endpoints, controller, signer, and verifier.
   * @returns The result of the DID creation, with error handling.
   */
  public async create(agentContext: AgentContext, options: WebDidCreateOptions): Promise<DidCreateResult> {
    try {
      const { domain } = options
      const did = options.did ?? `did:web:${domain}`
      const didDocument = options.didDocument ?? new DidDocument({ id: did })

      if (!did && !domain) {
        throw new CredoError('At least one of did or domain must be present')
      }
      const didRepository = agentContext.dependencyManager.resolve(DidRepository)
      const existingRecord = await didRepository.findSingleByQuery(agentContext, {
        $or: [{ did }, { domain, method: 'web' }],
      })
      if (existingRecord) return this.handleError(`A record for ${did} already exists.`)

      const didRecord = new DidRecord({
        did,
        didDocument,
        role: DidDocumentRole.Created,
      })
      didRecord.setTags({ domain })
      await didRepository.save(agentContext, didRecord)

      return {
        didDocumentMetadata: {},
        didRegistrationMetadata: {},
        didState: {
          state: 'finished',
          did,
          didDocument,
        },
      }
    } catch (error) {
      return this.handleError(error instanceof Error ? error.message : 'Unknown error occurred.')
    }
  }

  /**
   * Updates an existing DID document and its log in the repository.
   * Uses internal logic to validate verification methods and handle errors.
   * @param agentContext The agent context.
   * @param options The update options, including DID, log, signer, verifier, and services.
   * @returns The result of the DID update, with error handling and validation.
   */
  public async update(agentContext: AgentContext, options: WebDidUpdateOptions): Promise<DidUpdateResult> {
    try {
      const { domain } = options
      const did = options.did ?? `did:web:${domain}`
      const inputDidDocument = options.didDocument

      if (!did && !domain) {
        throw new CredoError('At least one of did or domain must be present')
      }

      const didRepository = agentContext.dependencyManager.resolve(DidRepository)
      const didRecord = await didRepository.findSingleByQuery(agentContext, {
        $or: [{ did }, { domain, method: 'web' }],
      })

      if (!didRecord) return this.handleError('Did not found')

      didRecord.didDocument = inputDidDocument

      await didRepository.update(agentContext, didRecord)

      return {
        didDocumentMetadata: {},
        didRegistrationMetadata: {},
        didState: {
          state: 'finished',
          did,
          didDocument: didRecord.didDocument,
        },
      }
    } catch (error) {
      return this.handleError(error instanceof Error ? error.message : 'Unknown error occurred.')
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  deactivate(agentContext: AgentContext, options: DidDeactivateOptions): Promise<DidDeactivateResult> {
    throw new Error('Method not implemented.')
  }

  private handleError(reason: string): DidUpdateResult | DidCreateResult {
    return {
      didDocumentMetadata: {},
      didRegistrationMetadata: {},
      didState: {
        state: 'failed',
        reason,
      },
    }
  }
}
