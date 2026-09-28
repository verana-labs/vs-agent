import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import {
  ActionMenuOption,
  ApiClient,
  CredentialService,
  EventEnvelope,
  EventHandler,
  isEventEnvelope,
  UnknownEventEnvelope,
  VS_AGENT_CLIENT,
} from '@verana-labs/vs-agent-nestjs-client'
import { I18nService } from 'nestjs-i18n'
import { Repository } from 'typeorm'

import { Cmd, StateStep } from './common'
import { SessionEntity } from './models'

@Injectable()
export class CoreService implements EventHandler, OnModuleInit {
  private readonly logger = new Logger(CoreService.name)

  constructor(
    @InjectRepository(SessionEntity)
    private readonly sessionRepository: Repository<SessionEntity>,
    private readonly i18n: I18nService,
    private readonly configService: ConfigService,
    private readonly credentialService: CredentialService,
    @Inject(VS_AGENT_CLIENT) private readonly client: ApiClient,
  ) {}

  async onModuleInit(): Promise<void> {
    const jsonSchemaCredentialId = this.configService.get<string>('appConfig.jsonSchemaCredentialId')
    if (!jsonSchemaCredentialId) {
      this.logger.warn('JSON_SCHEMA_CREDENTIAL_ID is not set, credential issuance is disabled')
      return
    }
    await this.credentialService.createCredentialDefinition(jsonSchemaCredentialId, {
      supportRevocation: true,
      maximumCredentialNumber: 5,
    })
  }

  async onEvent(envelope: EventEnvelope | UnknownEventEnvelope): Promise<void> {
    if (!isEventEnvelope(envelope)) return
    const event = envelope
    switch (event.type) {
      case 'didcomm.basic-messages.message-received':
      case 'didcomm.action-menu.perform-received':
      case 'didcomm.user-profile.profile-received':
      case 'didcomm.media-sharing.share-media-received':
      case 'didcomm.mrtd.mrz-data-received':
      case 'didcomm.mrtd.emrtd-data-received':
      case 'didcomm.mrtd.problem-report-received':
        break
      default:
        return
    }

    this.logger.debug(`onEvent: ${JSON.stringify(event)}`)
    let content: string = null
    const session = await this.handleSession(event.data.connectionId)

    try {
      switch (event.type) {
        case 'didcomm.basic-messages.message-received':
          content = event.data.content.trim() || null
          break
        case 'didcomm.action-menu.perform-received':
          await this.handleContextualAction(event.data.name, session)
          break
        case 'didcomm.user-profile.profile-received':
          session.lang = event.data.profile.preferredLanguage
          await this.welcomeMessage(session.connectionId)
          break
        case 'didcomm.media-sharing.share-media-received':
          content = 'media'
          break
        default:
          this.logger.log(`${event.type}: ${JSON.stringify(event.data)}`)
      }
    } catch (error) {
      this.logger.error(`onEvent: ${error}`)
    }
    await this.handleStateInput(content, session)
  }

  /**
   * Handles the `ConnectionStateUpdated` event for establishing a new connection.
   *
   * @param event - The event containing connection update details.
   */
  async newConnection(connectionId: string): Promise<void> {
    const session = await this.handleSession(connectionId)
    await this.sendContextualMenu(session)
  }

  /**
   * Handles the `ConnectionStateUpdated` event to close an active connection.
   *
   * This method is part of the event handler implementation for managing
   * connection lifecycle events. It ensures that the session associated with
   * the given connection is updated and purged of sensitive or user-specific data
   * before finalizing the connection closure.
   *
   * Steps:
   * 1. Retrieves the session associated with the `connectionId` from the event.
   * 2. Purges user-specific data from the session using `purgeUserData`,
   *    resetting the session state and clearing sensitive fields.
   *
   * @param event - The `ConnectionStateUpdated` event containing details of
   *                the connection to be closed (e.g., `connectionId`).
   *
   * @returns {Promise<void>} - Resolves when the connection is successfully closed
   *                            and the session is updated.
   *
   * @note This method ensures that the session's `connectionId` and other essential
   *       metadata remain intact while cleaning up unnecessary or sensitive data.
   */
  async closeConnection(connectionId: string): Promise<void> {
    const session = await this.handleSession(connectionId)
    await this.purgeUserData(session)
  }

  private async welcomeMessage(connectionId: string) {
    const lang = (await this.handleSession(connectionId)).lang
    await this.sendText(connectionId, 'WELCOME', lang)
  }

  private async sendText(connectionId: string, text: string, lang: string): Promise<void> {
    await this.client.didcomm.sendBasicMessage({ connectionId, content: this.getText(text, lang) })
  }

  /**
   * Retrieves localized text for the given key and language.
   *
   * @param text - The key for the desired text.
   * @param lang - The language of the text.
   */
  private getText(text: string, lang: string): string {
    return this.i18n.t(`msg.${text}`, { lang: lang })
  }

  private async handleContextualAction(selectionId: string, session: SessionEntity): Promise<SessionEntity> {
    switch (session.state) {
      case StateStep.START:
        if (selectionId === Cmd.CREDENTIAL) {
          const claims = {
            fullName: 'example',
            issuanceDate: new Date().toISOString().split('T')[0],
          }

          const offer = await this.credentialService.issue(claims, {
            connectionId: session.connectionId,
            refId: claims.fullName,
            revokeIfAlreadyIssued: true,
          })
          await this.client.didcomm.sendBasicMessage({
            connectionId: session.connectionId,
            content: offer.shortUrl,
          })
        }
        if (selectionId === Cmd.REVOKE) {
          await this.credentialService.revoke(session.connectionId)
        }
        break
      default:
        break
    }
    return await this.sessionRepository.save(session)
  }

  /**
   * Handles message input using a state machine.
   * Determines the next session state based on the message content.
   *
   * @param content - The content of the message.
   * @param session - The active session to update.
   */
  private async handleStateInput(content: any, session: SessionEntity): Promise<SessionEntity> {
    try {
    } catch (error) {
      this.logger.error('handleStateInput: ' + error)
    }
    return await this.sendContextualMenu(session)
  }

  /**
   * Retrieves or initializes the session associated with a specific connection.
   * Ensures consistent and secure operations.
   *
   * @param connectionId - Identifier of the active connection.
   */
  private async handleSession(connectionId: string): Promise<SessionEntity> {
    let session = await this.sessionRepository.findOneBy({
      connectionId: connectionId,
    })
    this.logger.debug('handleSession session: ' + JSON.stringify(session))

    if (!session) {
      session = this.sessionRepository.create({
        connectionId: connectionId,
        state: StateStep.START,
      })

      await this.sessionRepository.save(session)
      this.logger.debug('New session: ' + JSON.stringify(session))
    }
    return await this.sessionRepository.save(session)
  }

  // Special flows
  /**
   * Purges user-specific data from the provided session.
   *
   * This method resets the session's `state` to `StateStep.START` and ensures that
   * any additional parameters in the session (user-specific or sensitive data)
   * are set to `null`. It updates the session in the database, keeping the
   * `connectionId`, `id`, `lang`, and timestamps intact.
   *
   * @param session - The session entity to be purged.
   *                  It must be a valid session retrieved from the database.
   *
   * @returns {Promise<SessionEntity>} - The updated session entity after the purge.
   *
   * @note This method should be used to reset a session to its initial state
   *       while preserving its connection details and essential metadata.
   */
  private async purgeUserData(session: SessionEntity): Promise<SessionEntity> {
    session.state = StateStep.START
    // Additional sensitive data can be reset here if needed.
    return await this.sessionRepository.save(session)
  }

  private async sendContextualMenu(session: SessionEntity): Promise<SessionEntity> {
    const options: ActionMenuOption[] = []
    switch (session.state) {
      case StateStep.START:
        options.push(
          { name: Cmd.CREDENTIAL, title: this.getText('CMD.CREDENTIAL', session.lang), description: '' },
          { name: Cmd.REVOKE, title: this.getText('CMD.REVOKE', session.lang), description: '' },
        )
        break
      default:
        break
    }

    await this.client.didcomm.sendMenu({
      connectionId: session.connectionId,
      menu: { title: this.getText('ROOT_TITLE', session.lang), description: '', options },
    })
    return await this.sessionRepository.save(session)
  }
}
