import { Controller, Get, Query, Res, HttpStatus, HttpException } from '@nestjs/common'
import { PresentationStatus, PresentationStatusUpdated } from '@verana-labs/vs-agent-model'
import { createInvitation, emitVsAgentEvent, VsAgentEventTypes } from '@verana-labs/vs-agent-sdk'
import { Response } from 'express'
import QRCode from 'qrcode'

import { AGENT_INVITATION_BASE_URL, REDIRECT_DEFAULT_URL_TO_INVITATION_URL } from '../../../config/constants'
import { VsAgentService } from '../../../services/VsAgentService'

@Controller()
export class InvitationRoutesController {
  constructor(private readonly agentService: VsAgentService) {}

  @Get('/s')
  async getShortUrl(@Query('id') id: string, @Res() res: Response) {
    const agent = await this.agentService.getAgent()
    try {
      if (!id) {
        throw new HttpException('Id required', HttpStatus.NOT_FOUND)
      }

      const shortUrlRecord = await agent.genericRecords.findById(id)
      const longUrl = shortUrlRecord?.content.longUrl as string
      if (!longUrl) {
        throw new HttpException('Long URL not found', HttpStatus.NOT_FOUND)
      }

      if (res.req.accepts('json')) {
        const connRecord = shortUrlRecord?.getTag('relatedFlowId') as string

        // If a related proof record ID exists, fetch the proof and trigger the callback event if exist.
        if (connRecord) {
          const proofRecord = await agent.didcomm.proofs.findById(connRecord)
          const callbackParameters = proofRecord?.metadata.get('_2060/callbackParameters') as
            | { ref?: string; callbackUrl?: string }
            | undefined
          if (proofRecord && callbackParameters && callbackParameters.callbackUrl) {
            emitVsAgentEvent(
              agent,
              VsAgentEventTypes.PresentationStateUpdated,
              new PresentationStatusUpdated({
                proofExchangeId: proofRecord.id,
                callbackUrl: callbackParameters.callbackUrl,
                status: PresentationStatus.SCANNED,
                ref: callbackParameters.ref,
              }),
            )
          }
        }
        const invitation = await agent.didcomm.oob.parseInvitation(longUrl)
        const invitationJson = invitation.v2Invitation?.toJSON() ?? invitation.toJSON()
        res.send(invitationJson).end()
      } else {
        res.status(302).location(longUrl).end()
      }
    } catch (error) {
      agent.config.logger.error(`Error executing short url: ${error}`)
      throw new HttpException('Internal Server Error', HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }

  @Get('/invitation')
  async getInvitation(@Res() res: Response, @Query('legacy') legacy?: boolean) {
    const agent = await this.agentService.getAgent()
    const { url: invitationUrl } = await createInvitation({
      agent,
      useLegacyDid: legacy,
      invitationBaseUrl: AGENT_INVITATION_BASE_URL,
    })

    if (REDIRECT_DEFAULT_URL_TO_INVITATION_URL) res.redirect(invitationUrl)
    else res.send(invitationUrl)
  }

  @Get('/qr')
  async getQr(
    @Res() res: Response,
    @Query('fcolor') fcolor?: string,
    @Query('bcolor') bcolor?: string,
    @Query('size') size?: number,
    @Query('padding') padding?: number,
    @Query('level') level?: string,
    @Query('legacy') legacy?: boolean,
  ) {
    const agent = await this.agentService.getAgent()
    const { url: invitationUrl } = await createInvitation({
      agent,
      useLegacyDid: legacy,
      invitationBaseUrl: AGENT_INVITATION_BASE_URL,
    })

    function isQRCodeErrorCorrectionLevel(input?: string): input is QRCode.QRCodeErrorCorrectionLevel {
      return input ? ['low', 'medium', 'quartile', 'high', 'L', 'M', 'Q', 'H'].includes(input) : false
    }
    const errorCorrectionLevel: QRCode.QRCodeErrorCorrectionLevel = isQRCodeErrorCorrectionLevel(level)
      ? level
      : 'L'

    try {
      const qr = await QRCode.toBuffer(invitationUrl, {
        color: {
          dark: fcolor ? `#${fcolor}` : undefined,
          light: bcolor ? `#${bcolor}` : undefined,
        },
        errorCorrectionLevel,
        width: size,
        margin: padding,
      })
      res.header('Content-Type', 'image/png; charset=utf-8')
      res.send(qr)
    } catch (error) {
      throw new HttpException('Internal Server Error', HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }
}
