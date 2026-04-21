import type { AgentContext, Logger } from '@credo-ts/core'
import type {
  DidCommEncryptedMessage,
  DidCommInboundTransport,
  DidCommOutboundPackage,
  DidCommOutboundTransport,
  DidCommTransportSession,
} from '@credo-ts/didcomm'
import type { Subscription } from 'rxjs'

import { EventEmitter, InjectionSymbols, CredoError, utils } from '@credo-ts/core'
import { DidCommMessageReceiver, DidCommTransportService } from '@credo-ts/didcomm'
import { Subject, take, takeUntil } from 'rxjs'

/**
 * Minimal rxjs-based DIDComm transports for in-process two-agent
 * integration tests. Copied in spirit from
 * `apps/vs-agent/tests/__mocks__/SubjectInboundTransport.ts` so vt-flow
 * tests don't reach out into the apps/ workspace.
 */

export type SubjectMessage = {
  message: DidCommEncryptedMessage
  replySubject?: Subject<SubjectMessage>
}

export class SubjectInboundTransport implements DidCommInboundTransport {
  public readonly ourSubject: Subject<SubjectMessage>
  private subscription?: Subscription

  public constructor(ourSubject: Subject<SubjectMessage> = new Subject()) {
    this.ourSubject = ourSubject
  }

  public async start(agentContext: AgentContext): Promise<void> {
    const logger = agentContext.config.logger
    const transportService = agentContext.dependencyManager.resolve(DidCommTransportService)
    const messageReceiver = agentContext.dependencyManager.resolve(DidCommMessageReceiver)
    const eventEmitter = agentContext.dependencyManager.resolve(EventEmitter)

    this.subscription = this.ourSubject.subscribe({
      next: async ({ message, replySubject }: SubjectMessage) => {
        logger.debug('[subject] inbound message received')

        let session: SubjectTransportSession | undefined
        if (replySubject) {
          session = new SubjectTransportSession(`subject-session-${utils.uuid()}`, replySubject)
          replySubject.subscribe({
            complete: () => session && transportService.removeSession(session),
          })
        }

        try {
          await messageReceiver.receiveMessage(message, { session })
        } catch (error) {
          eventEmitter.emit(agentContext, {
            type: 'AgentReceiveMessageError',
            payload: error,
          })
        }
      },
    })
  }

  public async stop(): Promise<void> {
    this.subscription?.unsubscribe()
  }
}

class SubjectTransportSession implements DidCommTransportSession {
  public readonly type = 'subject'
  public constructor(
    public id: string,
    private readonly replySubject: Subject<SubjectMessage>,
  ) {}

  public async send(_ctx: AgentContext, message: DidCommEncryptedMessage): Promise<void> {
    this.replySubject.next({ message })
  }

  public async close(): Promise<void> {
    this.replySubject.complete()
  }
}

export class SubjectOutboundTransport implements DidCommOutboundTransport {
  public readonly supportedSchemes = ['rxjs']
  private logger!: Logger
  private agentContext!: AgentContext
  private stop$!: Subject<boolean>

  public constructor(private readonly subjectMap: Record<string, Subject<SubjectMessage>>) {}

  public async start(agentContext: AgentContext): Promise<void> {
    this.agentContext = agentContext
    this.logger = agentContext.dependencyManager.resolve(InjectionSymbols.Logger)
    this.stop$ = agentContext.dependencyManager.resolve(InjectionSymbols.Stop$)
  }

  public async stop(): Promise<void> {
    /* no-op */
  }

  public async sendMessage(outboundPackage: DidCommOutboundPackage): Promise<void> {
    const messageReceiver = this.agentContext.dependencyManager.resolve(DidCommMessageReceiver)
    const { payload, endpoint } = outboundPackage

    if (!endpoint) {
      throw new CredoError('Cannot send message to subject without endpoint')
    }

    const subject = this.subjectMap[endpoint]
    if (!subject) {
      throw new CredoError(`No subject registered for endpoint ${endpoint}`)
    }

    const replySubject = new Subject<SubjectMessage>()
    this.stop$.pipe(take(1)).subscribe(() => !replySubject.closed && replySubject.complete())
    replySubject.pipe(takeUntil(this.stop$)).subscribe({
      next: async ({ message }: SubjectMessage) => {
        this.logger.debug('[subject] reply received')
        await messageReceiver
          .receiveMessage(message)
          .catch(err => this.logger.error('Error processing reply', err as Record<string, unknown>))
      },
    })

    subject.next({ message: payload, replySubject })
  }
}
