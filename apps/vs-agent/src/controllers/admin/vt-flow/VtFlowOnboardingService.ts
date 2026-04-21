import type { VtFlowApi, VtFlowRecord } from '@verana-labs/credo-ts-didcomm-vt-flow'

import { utils } from '@credo-ts/core'
import {
  type DidCommConnectionStateChangedEvent,
  DidCommConnectionEventTypes,
  DidCommDidExchangeState,
} from '@credo-ts/didcomm'
import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common'
import { VtFlowRepository } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { firstValueFrom, timeout as rxTimeout } from 'rxjs'
import { filter, take } from 'rxjs/operators'

import { VsAgentService } from '../../../services/VsAgentService'

export interface VtFlowOnboardRequest {
  /** Opens a fresh connection via implicit invitation. Mutually exclusive with {@link connectionId}. */
  validatorDid?: string
  /** Use an existing connection. Mutually exclusive with {@link validatorDid}. */
  connectionId?: string
  /** §5.1 on-chain permission id. Mutually exclusive with {@link schemaId}. */
  permId?: string
  /** §5.2 Credential Schema id. Mutually exclusive with {@link permId}. */
  schemaId?: string
  agentPermId: string
  walletAgentPermId: string
  claims: Record<string, unknown>
  /** Passed to TrustService.createVtc on COMPLETED for auto-linking. */
  schemaBaseId: string
  /** Defaults to a fresh UUIDv4. */
  sessionUuid?: string
  /** Handshake timeout. Default 30s. */
  connectionTimeoutMs?: number
}

export interface VtFlowOnboardResponse {
  vtFlowRecordId: string
  threadId: string
  sessionUuid: string
  state: string
  connectionId: string
  errorMessage?: string
}

/** Applicant-side driver for `POST /v1/vt/onboard`. */
@Injectable()
export class VtFlowOnboardingService {
  private readonly logger = new Logger(VtFlowOnboardingService.name)

  public constructor(@Inject(VsAgentService) private readonly agentService: VsAgentService) {}

  public async startOnboarding(body: VtFlowOnboardRequest): Promise<VtFlowOnboardResponse> {
    this.validateRequest(body)

    const agent = await this.agentService.getAgent()
    const vtFlowApi = this.getVtFlowApi(agent)

    // Default credentialSubject.id to this agent's public DID; required
    // by TrustService.createVtc for the auto-link on COMPLETED.
    const claims: Record<string, unknown> = { ...(body.claims ?? {}) }
    if (typeof claims.id !== 'string' && typeof agent.did === 'string') {
      claims.id = agent.did
    }

    this.logger.log(
      `[vt-flow] starting onboarding — validatorDid=${body.validatorDid ?? '(connection-based)'} schemaBaseId=${body.schemaBaseId} subjectId=${claims.id ?? '(unset)'}`,
    )

    // Resolve or establish the DIDComm connection.
    let connectionId: string
    if (body.connectionId) {
      const connection = await agent.didcomm.connections.findById(body.connectionId)
      if (!connection) {
        throw new HttpException(
          `Connection '${body.connectionId}' not found on this agent`,
          HttpStatus.BAD_REQUEST,
        )
      }
      if (connection.state !== DidCommDidExchangeState.Completed) {
        await this.waitForConnectionCompleted(connection.id, body.connectionTimeoutMs ?? 30_000)
      }
      connectionId = connection.id
    } else {
      // Implicit invitation — requires a network-resolvable Validator DID.
      const { connectionRecord } = await agent.didcomm.oob.receiveImplicitInvitation({
        did: body.validatorDid as string,
        label: `vt-flow onboarding ${utils.uuid().slice(0, 8)}`,
      })
      if (!connectionRecord) {
        throw new HttpException(
          `DIDComm implicit invitation returned no connection record for ${body.validatorDid}`,
          HttpStatus.BAD_GATEWAY,
        )
      }
      if (connectionRecord.state !== DidCommDidExchangeState.Completed) {
        await this.waitForConnectionCompleted(connectionRecord.id, body.connectionTimeoutMs ?? 30_000)
      }
      connectionId = connectionRecord.id
    }

    const sessionUuid = body.sessionUuid ?? utils.uuid()
    const record: VtFlowRecord = body.permId
      ? await vtFlowApi.sendValidationRequest({
          connectionId,
          sessionUuid,
          permId: body.permId,
          agentPermId: body.agentPermId,
          walletAgentPermId: body.walletAgentPermId,
          claims,
        })
      : await vtFlowApi.sendIssuanceRequest({
          connectionId,
          sessionUuid,
          schemaId: body.schemaId as string,
          agentPermId: body.agentPermId,
          walletAgentPermId: body.walletAgentPermId,
          claims,
        })

    // Tag `schemaBaseId` + `validatorDid` for the COMPLETED listener.
    record.setTag('schemaBaseId', body.schemaBaseId)
    if (body.validatorDid) record.setTag('validatorDid', body.validatorDid)
    const repository = agent.context.dependencyManager.resolve(VtFlowRepository)
    await repository.update(agent.context, record)

    return this.toResponse(record)
  }

  public async getState(vtFlowRecordId: string): Promise<VtFlowOnboardResponse> {
    const agent = await this.agentService.getAgent()
    const vtFlowApi = this.getVtFlowApi(agent)
    const record = await vtFlowApi.findById(vtFlowRecordId)
    if (!record) {
      throw new HttpException('vt-flow record not found', HttpStatus.NOT_FOUND)
    }
    return this.toResponse(record)
  }

  private validateRequest(body: VtFlowOnboardRequest): void {
    const hasDid = Boolean(body.validatorDid)
    const hasConn = Boolean(body.connectionId)
    if (!hasDid && !hasConn) {
      throw new HttpException(
        'Either validatorDid (implicit invitation) or connectionId (explicit OOB) MUST be supplied.',
        HttpStatus.BAD_REQUEST,
      )
    }
    if (hasDid && hasConn) {
      throw new HttpException('validatorDid and connectionId are mutually exclusive.', HttpStatus.BAD_REQUEST)
    }
    if (!body.permId === !body.schemaId) {
      throw new HttpException('Exactly one of { permId, schemaId } MUST be supplied.', HttpStatus.BAD_REQUEST)
    }
    if (!body.schemaBaseId) {
      throw new HttpException('schemaBaseId is required for auto-linking.', HttpStatus.BAD_REQUEST)
    }
  }

  private getVtFlowApi(agent: { modules: Record<string, unknown> }): VtFlowApi {
    const api = agent.modules.vtFlow as VtFlowApi | undefined
    if (!api) {
      throw new HttpException(
        'vt-flow module is not registered on this agent. Set VS_AGENT_PLUGINS to include "vt-flow".',
        HttpStatus.BAD_REQUEST,
      )
    }
    return api
  }

  private toResponse(record: VtFlowRecord): VtFlowOnboardResponse {
    return {
      vtFlowRecordId: record.id,
      threadId: record.threadId,
      sessionUuid: record.sessionUuid,
      state: record.state,
      connectionId: record.connectionId,
      errorMessage: record.errorMessage,
    }
  }

  private async waitForConnectionCompleted(connectionId: string, timeoutMs: number): Promise<void> {
    const agent = await this.agentService.getAgent()
    const completed$ = agent.events
      .observable<DidCommConnectionStateChangedEvent>(
        DidCommConnectionEventTypes.DidCommConnectionStateChanged,
      )
      .pipe(
        filter(
          (event: DidCommConnectionStateChangedEvent) =>
            event.payload.connectionRecord.id === connectionId &&
            event.payload.connectionRecord.state === DidCommDidExchangeState.Completed,
        ),
        take(1),
        rxTimeout({ each: timeoutMs }),
      )

    await firstValueFrom(completed$)
  }
}
