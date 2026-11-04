import {
  IndexerActivity,
  IndexerHandlerContext,
  IndexerHandlerRegistry,
  ParticipantDto,
  ParticipantRole,
  ParticipantState,
  resolveJsonSchemaCredentialId,
  VeranaIndexerService,
  VsAgent,
} from '@verana-labs/vs-agent-sdk'
import { classifyEcsSchema } from '@verana-labs/vs-agent-model'

/** The part of CredentialTypesService this module needs. */
export interface CredentialDefinitionRegistrar {
  findAnonCredsCredentialDefinition(options: { relatedJsonSchemaCredentialId?: string }): Promise<unknown>
  getOrRegisterAnonCredsSchema(options: {
    relatedJsonSchemaCredentialId?: string
  }): Promise<{ schema?: { name: string; version: string } | null; schemaId?: string | null }>
  registerAnonCredsCredentialDefinition(options: {
    name: string
    version?: string
    schemaId: string
    supportRevocation?: boolean
    relatedJsonSchemaCredentialId?: string
  }): Promise<unknown>
}

interface Logger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/** Chain messages after which an ISSUER entry of this agent may have become usable. */
const ISSUER_READY_MSGS = [
  'SetParticipantOPToValidated',
  'SelfCreateParticipant',
  'SetParticipantEffectiveUntil',
]

/** A reconciliation scheduled for an entry that becomes active later runs this long after it. */
const FUTURE_ENTRY_MARGIN_MS = 5_000
/** Entries that start further away than this are left to the next event or the next start. */
const FUTURE_ENTRY_HORIZON_MS = 60 * 60 * 1000

/**
 * Creates the AnonCreds credential definition of each schema this agent may issue, so that an
 * issuer needs no Admin API call before it can issue over DIDComm.
 *
 * For every active ISSUER entry whose DID is this agent's, whose vs_operator is this agent's
 * account and whose schema is not an ECS schema, the agent creates one credential definition
 * governed by the VTJSC of that schema, unless one exists already. This is the call an operator
 * made by hand with POST /v2/anoncreds/credential-definitions. ECS credentials are self-issued
 * W3C credentials and take no credential definition.
 *
 * An entry created with a future effective_from is not active when its creation event arrives;
 * the agent then runs again shortly after the entry starts.
 */
export class IssuerCredentialDefinitions {
  private queue: Promise<void> = Promise.resolve()
  private readonly scheduled = new Set<number>()

  public constructor(
    private readonly agent: VsAgent,
    private readonly indexer: VeranaIndexerService,
    private readonly registrar: CredentialDefinitionRegistrar,
    private readonly logger: Logger,
  ) {}

  /** Wraps the handlers of the ready messages, keeping the handler already registered for each. */
  public registerHandlers(registry: IndexerHandlerRegistry): void {
    for (const msg of ISSUER_READY_MSGS) {
      const original = registry.get(msg)
      registry.register({
        msg,
        handle: async (activity: IndexerActivity, ctx: IndexerHandlerContext) => {
          if (original) await original.handle(activity, ctx)
          await this.reconcile()
        },
      })
    }
  }

  /** Runs one reconciliation after the ones already queued. */
  public reconcile(): Promise<void> {
    this.queue = this.queue
      .then(() => this.reconcileOnce())
      .catch((error: Error) => this.logger.error(`[IssuerCredDef] reconciliation failed: ${error.message}`))
    return this.queue
  }

  private async reconcileOnce(): Promise<void> {
    const chain = this.agent.veranaChain
    if (!this.agent.did || !chain) return

    const own = (entry: ParticipantDto) =>
      !entry.revoked && !entry.slashed && entry.vs_operator === chain.address

    const future = await this.indexer.listParticipants({
      did: this.agent.did,
      role: ParticipantRole.Issuer,
      participantState: ParticipantState.Future,
    })
    for (const entry of future.filter(own)) this.scheduleAt(entry)

    const active = await this.indexer.listParticipants({
      did: this.agent.did,
      role: ParticipantRole.Issuer,
      participantState: ParticipantState.Active,
    })
    for (const entry of active.filter(own)) {
      try {
        await this.ensureFor(entry, chain.getChainId)
      } catch (error) {
        this.logger.warn(
          `[IssuerCredDef] no credential definition yet for ISSUER entry ${entry.id} (schema ${entry.schema_id}): ${(error as Error).message}`,
        )
      }
    }
  }

  private async ensureFor(entry: ParticipantDto, chainId: string): Promise<void> {
    const schema = await this.indexer.getCredentialSchema(entry.schema_id)
    if (await classifyEcsSchema(schema.json_schema)) return

    const relatedJsonSchemaCredentialId = await resolveJsonSchemaCredentialId(
      this.agent,
      this.indexer,
      entry.schema_id,
      chainId,
    )
    if (await this.registrar.findAnonCredsCredentialDefinition({ relatedJsonSchemaCredentialId })) return

    const { schema: anonCredsSchema, schemaId } = await this.registrar.getOrRegisterAnonCredsSchema({
      relatedJsonSchemaCredentialId,
    })
    if (!anonCredsSchema || !schemaId) {
      throw new Error(`no AnonCreds schema could be resolved for ${relatedJsonSchemaCredentialId}`)
    }
    await this.registrar.registerAnonCredsCredentialDefinition({
      name: anonCredsSchema.name,
      version: anonCredsSchema.version,
      schemaId,
      supportRevocation: false,
      relatedJsonSchemaCredentialId,
    })
    this.logger.info(
      `[IssuerCredDef] created the credential definition of schema ${entry.schema_id} (ISSUER entry ${entry.id}, ${relatedJsonSchemaCredentialId})`,
    )
  }

  private scheduleAt(entry: ParticipantDto): void {
    if (this.scheduled.has(entry.id) || !entry.effective_from) return
    const delay = Date.parse(entry.effective_from) - Date.now() + FUTURE_ENTRY_MARGIN_MS
    if (!Number.isFinite(delay) || delay > FUTURE_ENTRY_HORIZON_MS) return
    this.scheduled.add(entry.id)
    const timer = setTimeout(
      () => {
        this.scheduled.delete(entry.id)
        void this.reconcile()
      },
      Math.max(delay, 0),
    )
    timer.unref?.()
  }
}
