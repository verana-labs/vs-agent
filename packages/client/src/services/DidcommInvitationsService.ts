import { SendInvitationOptions, SendInvitationResult } from '@verana-labs/vs-agent-model'
import { Logger } from 'tslog'

const logger = new Logger({
  name: 'DidcommInvitationsService',
  type: 'pretty',
  prettyLogTemplate: '{{logLevelName}} [{{name}}]: ',
})

/**
 * `DidcommInvitationsService` sends an Out-of-Band invitation on a connection.
 * The invitation opens a sub-connection to this agent or a referral to a different service.
 */
export class DidcommInvitationsService {
  private url: string

  constructor(baseURL: string) {
    this.url = `${baseURL.replace(/\/$/, '')}/v2/didcomm/invitations`
  }

  public async send(options: SendInvitationOptions): Promise<SendInvitationResult> {
    logger.info(`send(): ${JSON.stringify(options)}`)

    const response = await fetch(this.url, {
      method: 'POST',
      body: JSON.stringify(options),
      headers: { accept: 'application/json', 'Content-Type': 'application/json' },
    })
    if (!response.ok) throw new Error(`Cannot send invitation: status ${response.status}`)

    return (await response.json()) as SendInvitationResult
  }
}
