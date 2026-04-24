import type { AgentContext, DependencyManager, Module } from '@credo-ts/core'
import type { DidCommCredentialStateChangedEvent } from '@credo-ts/didcomm'

import { EventEmitter } from '@credo-ts/core'
import {
  DidCommCredentialEventTypes,
  DidCommCredentialExchangeRepository,
  DidCommCredentialState,
  DidCommCredentialsApi,
  DidCommFeatureRegistry,
  DidCommMessageHandlerRegistry,
  DidCommProtocol,
} from '@credo-ts/didcomm'

import { VtFlowApi } from './VtFlowApi'
import { VtFlowEventTypes, type VtFlowStateChangedEvent } from './VtFlowEvents'
import { VtFlowModuleConfig, type VtFlowModuleConfigOptions } from './VtFlowModuleConfig'
import { VtFlowRole } from './VtFlowRole'
import { VtFlowState } from './VtFlowState'
import { VtFlowVariant } from './VtFlowVariant'
import {
  CredentialStateChangeHandler,
  IssuanceRequestHandler,
  OobLinkHandler,
  ValidatingHandler,
  ValidationRequestHandler,
} from './handlers'
import { VT_FLOW_PROTOCOL_URI } from './messages'
import { VtFlowRepository } from './repository'
import { VtFlowService } from './services'

/** Credo-TS module implementing the vt-flow superprotocol (`https://didcomm.org/vt-flow/1.0`); wires handlers, feature registry, and subprotocol correlation on `~thread.pthid`. */
export class VtFlowModule implements Module {
  public readonly api = VtFlowApi
  public readonly config: VtFlowModuleConfig

  public constructor(options?: VtFlowModuleConfigOptions) {
    this.config = new VtFlowModuleConfig(options)
  }

  public register(dependencyManager: DependencyManager): void {
    dependencyManager.registerInstance(VtFlowModuleConfig, this.config)
    dependencyManager.registerContextScoped(VtFlowApi)
    dependencyManager.registerSingleton(VtFlowRepository)
    dependencyManager.registerSingleton(VtFlowService)
  }

  public async initialize(agentContext: AgentContext): Promise<void> {
    const messageHandlerRegistry = agentContext.dependencyManager.resolve(DidCommMessageHandlerRegistry)
    const featureRegistry = agentContext.dependencyManager.resolve(DidCommFeatureRegistry)
    const service = agentContext.dependencyManager.resolve(VtFlowService)
    const eventEmitter = agentContext.dependencyManager.resolve(EventEmitter)

    messageHandlerRegistry.registerMessageHandlers([
      new ValidationRequestHandler(service),
      new IssuanceRequestHandler(service),
      new OobLinkHandler(service),
      new ValidatingHandler(service),
      new CredentialStateChangeHandler(service),
    ])

    featureRegistry.register(
      new DidCommProtocol({
        id: VT_FLOW_PROTOCOL_URI,
        roles: [VtFlowRole.Applicant, VtFlowRole.Validator],
      }),
    )

    eventEmitter.on<DidCommCredentialStateChangedEvent>(
      DidCommCredentialEventTypes.DidCommCredentialStateChanged,
      async ({ payload: { credentialExchangeRecord } }) => {
        if (!credentialExchangeRecord.parentThreadId) return

        const record = await service.findByThreadId(agentContext, credentialExchangeRecord.parentThreadId)
        if (!record) return

        await service.onSubprotocolStateChanged(agentContext, record, credentialExchangeRecord)

        const config = service.getModuleConfig()
        if (
          credentialExchangeRecord.state === DidCommCredentialState.CredentialReceived &&
          record.role === VtFlowRole.Applicant &&
          config.verifyCredential
        ) {
          try {
            const ok = await config.verifyCredential({
              agentContext,
              record,
              credentialExchangeRecord,
            })
            if (ok) {
              const credentialsApi = agentContext.dependencyManager.resolve(DidCommCredentialsApi)
              await credentialsApi.acceptCredential({
                credentialExchangeRecordId: credentialExchangeRecord.id,
              })
            }
          } catch (error) {
            service
              .getLogger()
              .error('[vt-flow] verifyCredential hook threw', error as Record<string, unknown>)
          }
        }

        if (
          credentialExchangeRecord.state === DidCommCredentialState.RequestReceived &&
          record.role === VtFlowRole.Validator &&
          config.autoIssueCredentialOnRequest
        ) {
          try {
            service
              .getLogger()
              .debug(`[vt-flow] auto-issuing credential for ${record.id} (autoIssueCredentialOnRequest=true)`)
            const credentialsApi = agentContext.dependencyManager.resolve(DidCommCredentialsApi)
            await credentialsApi.acceptRequest({
              credentialExchangeRecordId: credentialExchangeRecord.id,
            })
          } catch (error) {
            service
              .getLogger()
              .error(`[vt-flow] auto-issue threw for ${record.id}`, error as Record<string, unknown>)
          }
        }
      },
    )

    eventEmitter.on<VtFlowStateChangedEvent>(VtFlowEventTypes.VtFlowStateChanged, async ({ payload }) => {
      if (payload.state !== VtFlowState.Completed) return
      if (payload.previousState === VtFlowState.Completed) return

      const config = service.getModuleConfig()
      if (!config.onCompleted) return

      const record = await service.findById(agentContext, payload.vtFlowRecordId)
      if (!record || !record.credentialExchangeRecordId) return

      try {
        const credentialRepository = agentContext.dependencyManager.resolve(
          DidCommCredentialExchangeRepository,
        )
        const credentialExchangeRecord = await credentialRepository.findById(
          agentContext,
          record.credentialExchangeRecordId,
        )
        if (!credentialExchangeRecord) return

        await config.onCompleted({ agentContext, record, credentialExchangeRecord })
      } catch (error) {
        service.getLogger().error('[vt-flow] onCompleted hook threw', error as Record<string, unknown>)
      }
    })

    eventEmitter.on<VtFlowStateChangedEvent>(VtFlowEventTypes.VtFlowStateChanged, async ({ payload }) => {
      const config = service.getModuleConfig()

      const record = await service.findById(agentContext, payload.vtFlowRecordId)
      if (!record) return

      try {
        if (
          record.role === VtFlowRole.Applicant &&
          payload.state === VtFlowState.CredOffered &&
          config.autoAcceptCredentialOffer &&
          record.credentialExchangeRecordId
        ) {
          service
            .getLogger()
            .debug(
              `[vt-flow] auto-accepting credential offer for ${record.id} (autoAcceptCredentialOffer=true)`,
            )
          const credentialsApi = agentContext.dependencyManager.resolve(DidCommCredentialsApi)
          await credentialsApi.acceptOffer({
            credentialExchangeRecordId: record.credentialExchangeRecordId,
          })
          return
        }

        if (record.role !== VtFlowRole.Validator) return

        if (
          payload.state === VtFlowState.AwaitingVr &&
          payload.previousState === null &&
          config.autoAcceptValidationRequest
        ) {
          service
            .getLogger()
            .debug(`[vt-flow] auto-accepting VR for ${record.id} (autoAcceptValidationRequest=true)`)
          await service.acceptValidationRequest(agentContext, record.id)
          return
        }

        if (
          payload.state === VtFlowState.AwaitingIr &&
          payload.previousState === null &&
          config.autoAcceptIssuanceRequest
        ) {
          service
            .getLogger()
            .debug(`[vt-flow] auto-accepting IR for ${record.id} (autoAcceptIssuanceRequest=true)`)
          await service.acceptIssuanceRequest(agentContext, record.id)
          return
        }

        if (
          payload.state === VtFlowState.Validating &&
          config.autoMarkValidated &&
          record.variant === VtFlowVariant.ValidationProcess
        ) {
          service.getLogger().debug(`[vt-flow] auto-mark-validated for ${record.id} (autoMarkValidated=true)`)
          await service.markValidated(agentContext, record.id)
          return
        }

        const readyToOffer =
          (record.variant === VtFlowVariant.ValidationProcess && payload.state === VtFlowState.Validated) ||
          (record.variant === VtFlowVariant.DirectIssuance && payload.state === VtFlowState.Validating)
        if (readyToOffer && config.autoOfferCredential && config.buildCredentialOffer) {
          service
            .getLogger()
            .debug(`[vt-flow] auto-offering credential for ${record.id} (autoOfferCredential=true)`)
          const payload$ = await config.buildCredentialOffer({ agentContext, record })
          if (payload$) {
            const api = agentContext.dependencyManager.resolve(VtFlowApi)
            await api.offerCredentialForSession({
              vtFlowRecordId: record.id,
              credentialFormats: payload$.credentialFormats,
              comment: payload$.comment,
              goal: payload$.goal,
              goalCode: payload$.goalCode,
            })
          }
        }
      } catch (error) {
        service
          .getLogger()
          .error(`[vt-flow] auto-chain threw for ${record.id}`, error as Record<string, unknown>)
      }
    })
  }
}
