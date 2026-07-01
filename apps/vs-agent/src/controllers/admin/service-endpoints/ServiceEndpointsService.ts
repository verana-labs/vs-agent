import { DidDocument, DidDocumentService, DidRepository, NewDidCommV2Service } from '@credo-ts/core'
import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { VsAgent } from '@verana-labs/vs-agent-sdk'

import { VsAgentService } from '../../../services/VsAgentService'

export enum ServiceEndpointErrorCode {
  DidcommEntry = 'DIDCOMM_ENTRY',
  LinkedVpEntry = 'LINKED_VP_ENTRY',
  AdminApiEntry = 'ADMIN_API_ENTRY',
  DuplicateId = 'DUPLICATE_ID',
  InvalidServiceEndpoint = 'INVALID_SERVICE_ENDPOINT',
  NotFound = 'NOT_FOUND',
}

export class ServiceEndpointError extends Error {
  public constructor(
    public readonly code: ServiceEndpointErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ServiceEndpointError'
  }
}

export type ServiceEndpointValue = string | Record<string, unknown> | Array<string | Record<string, unknown>>

export interface ServiceEndpoint {
  id: string
  type: string
  serviceEndpoint: ServiceEndpointValue
}

export interface AddServiceEndpointInput {
  type: string
  serviceEndpoint: ServiceEndpointValue
  id?: string
}

export interface UpdateServiceEndpointInput {
  type?: string
  serviceEndpoint?: ServiceEndpointValue
}

const ADMIN_API_SERVICE_TYPE = 'VsAgentAdminAPI'
const LINKED_VP_SERVICE_TYPE = 'LinkedVerifiablePresentation'
const DIDCOMM_SERVICE_TYPE = NewDidCommV2Service.type

const INTERNAL_SERVICE_TYPES: readonly string[] = ['AnonCredsRegistry', 'relativeRef']

function reservedErrorCode(type: string): ServiceEndpointErrorCode | undefined {
  if (type === DIDCOMM_SERVICE_TYPE) return ServiceEndpointErrorCode.DidcommEntry
  if (type === LINKED_VP_SERVICE_TYPE) return ServiceEndpointErrorCode.LinkedVpEntry
  if (type === ADMIN_API_SERVICE_TYPE) return ServiceEndpointErrorCode.AdminApiEntry
  return undefined
}

function isManagedType(type: string): boolean {
  return reservedErrorCode(type) !== undefined || INTERNAL_SERVICE_TYPES.includes(type)
}

function isUri(value: string): boolean {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

function isValidServiceEndpoint(value: unknown): value is ServiceEndpointValue {
  if (typeof value === 'string') return value.length > 0 && isUri(value)
  if (Array.isArray(value)) {
    return value.length > 0 && value.every(v => (typeof v === 'string' ? isUri(v) : isPlainObject(v)))
  }
  return isPlainObject(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length > 0
}

function fullServiceId(agentDid: string, id: string): string {
  if (id.startsWith('did:')) return id
  if (id.startsWith('#')) return `${agentDid}${id}`
  return `${agentDid}#${id}`
}

function generateServiceId(agentDid: string, existing: ReadonlySet<string>, type: string): string {
  const base =
    type
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'service'
  let candidate = `${agentDid}#${base}`
  let suffix = 2
  while (existing.has(candidate)) candidate = `${agentDid}#${base}-${suffix++}`
  return candidate
}

function toServiceEndpoint(service: DidDocumentService): ServiceEndpoint {
  return {
    id: service.id,
    type: service.type,
    serviceEndpoint: service.serviceEndpoint as ServiceEndpointValue,
  }
}

function getServiceEndpoints(didDocument: DidDocument): ServiceEndpoint[] {
  return (didDocument.service ?? []).filter(s => !isManagedType(s.type)).map(toServiceEndpoint)
}

function planAddServiceEndpoint(
  agentDid: string,
  services: readonly DidDocumentService[],
  input: AddServiceEndpointInput,
): { services: DidDocumentService[]; added: ServiceEndpoint } {
  const reserved = reservedErrorCode(input.type)
  if (reserved) {
    throw new ServiceEndpointError(
      reserved,
      `Service type '${input.type}' is managed automatically by the agent`,
    )
  }
  if (!isValidServiceEndpoint(input.serviceEndpoint)) {
    throw new ServiceEndpointError(
      ServiceEndpointErrorCode.InvalidServiceEndpoint,
      'serviceEndpoint does not conform to the DID-CORE shape (URI string, object, or array thereof)',
    )
  }

  const existingIds = new Set(services.map(s => s.id))
  const id = input.id
    ? fullServiceId(agentDid, input.id)
    : generateServiceId(agentDid, existingIds, input.type)
  if (existingIds.has(id)) {
    throw new ServiceEndpointError(
      ServiceEndpointErrorCode.DuplicateId,
      `A service entry with id '${id}' already exists`,
    )
  }

  const service = new DidDocumentService({ id, type: input.type, serviceEndpoint: input.serviceEndpoint })
  return { services: [...services, service], added: toServiceEndpoint(service) }
}

function planUpdateServiceEndpoint(
  agentDid: string,
  services: readonly DidDocumentService[],
  id: string,
  input: UpdateServiceEndpointInput,
): { services: DidDocumentService[]; updated: ServiceEndpoint } {
  const target = findConsumableTarget(agentDid, services, id)

  if (input.type !== undefined) {
    const reserved = reservedErrorCode(input.type)
    if (reserved) {
      throw new ServiceEndpointError(
        reserved,
        `Cannot change a service entry to managed type '${input.type}'`,
      )
    }
  }
  if (input.serviceEndpoint !== undefined && !isValidServiceEndpoint(input.serviceEndpoint)) {
    throw new ServiceEndpointError(
      ServiceEndpointErrorCode.InvalidServiceEndpoint,
      'serviceEndpoint does not conform to the DID-CORE shape (URI string, object, or array thereof)',
    )
  }

  const updated = new DidDocumentService({
    id: target.id,
    type: input.type ?? target.type,
    serviceEndpoint: input.serviceEndpoint ?? target.serviceEndpoint,
  })
  return {
    services: services.map(s => (s.id === target.id ? updated : s)),
    updated: toServiceEndpoint(updated),
  }
}

function planDeleteServiceEndpoint(
  agentDid: string,
  services: readonly DidDocumentService[],
  id: string,
): { services: DidDocumentService[]; deleted: ServiceEndpoint } {
  const target = findConsumableTarget(agentDid, services, id)
  return { services: services.filter(s => s.id !== target.id), deleted: toServiceEndpoint(target) }
}

function findConsumableTarget(
  agentDid: string,
  services: readonly DidDocumentService[],
  id: string,
): DidDocumentService {
  const target = services.find(s => s.id === fullServiceId(agentDid, id))
  if (!target)
    throw new ServiceEndpointError(ServiceEndpointErrorCode.NotFound, `No service entry with id '${id}'`)

  const reserved = reservedErrorCode(target.type)
  if (reserved) {
    throw new ServiceEndpointError(
      reserved,
      `Service entry '${target.id}' is managed automatically by the agent`,
    )
  }
  if (isManagedType(target.type)) {
    throw new ServiceEndpointError(ServiceEndpointErrorCode.NotFound, `No service entry with id '${id}'`)
  }
  return target
}

async function loadDidRecord(agent: VsAgent) {
  const [didRecord] = await agent.dids.getCreatedDids({ did: agent.did })
  if (!didRecord?.didDocument) {
    throw new ServiceEndpointError(
      ServiceEndpointErrorCode.NotFound,
      `No DID Document found for '${agent.did}'`,
    )
  }
  return didRecord
}

@Injectable()
export class ServiceEndpointsService {
  public constructor(@Inject(VsAgentService) private readonly agentService: VsAgentService) {}

  public async list(): Promise<ServiceEndpoint[]> {
    const agent = await this.requireAgentWithDid()
    const didRecord = await loadDidRecord(agent)
    return getServiceEndpoints(didRecord.didDocument!)
  }

  public async add(input: AddServiceEndpointInput): Promise<ServiceEndpoint> {
    const agent = await this.requireAgentWithDid()
    const didRecord = await loadDidRecord(agent)
    const { services, added } = planAddServiceEndpoint(
      agent.did!,
      didRecord.didDocument!.service ?? [],
      input,
    )
    didRecord.didDocument!.service = services
    await this.publishDidDocument(agent, didRecord)
    return added
  }

  public async update(id: string, input: UpdateServiceEndpointInput): Promise<ServiceEndpoint> {
    const agent = await this.requireAgentWithDid()
    const didRecord = await loadDidRecord(agent)
    const { services, updated } = planUpdateServiceEndpoint(
      agent.did!,
      didRecord.didDocument!.service ?? [],
      id,
      input,
    )
    didRecord.didDocument!.service = services
    await this.publishDidDocument(agent, didRecord)
    return updated
  }

  public async delete(id: string): Promise<ServiceEndpoint> {
    const agent = await this.requireAgentWithDid()
    const didRecord = await loadDidRecord(agent)
    const { services, deleted } = planDeleteServiceEndpoint(
      agent.did!,
      didRecord.didDocument!.service ?? [],
      id,
    )
    didRecord.didDocument!.service = services
    await this.publishDidDocument(agent, didRecord)
    return deleted
  }

  private async requireAgentWithDid(): Promise<VsAgent> {
    const agent = await this.agentService.getAgent()
    if (!agent.did) throw new BadRequestException('Agent has no public DID')
    return agent
  }

  private async publishDidDocument(
    agent: VsAgent,
    didRecord: Awaited<ReturnType<typeof loadDidRecord>>,
  ): Promise<void> {
    const didRepository = agent.context.dependencyManager.resolve(DidRepository)
    await didRepository.update(agent.context, didRecord)
    await agent.dids.update({ did: didRecord.did, didDocument: didRecord.didDocument! })
    await this.triggerResolverAfterMutation(agent)
  }

  private async triggerResolverAfterMutation(agent: VsAgent): Promise<void> {
    const chain = agent.veranaChain
    if (!chain || !chain.autoTriggerResolverEnabled || !agent.did) return
    try {
      const participantId = await chain.findActiveHolderParticipantIdByDid(agent.did)
      if (participantId === undefined) return
      await chain.triggerResolver(participantId)
    } catch (error) {
      agent.config.logger.warn('[ServiceEndpoints] TriggerResolver failed; will refresh on next change', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
