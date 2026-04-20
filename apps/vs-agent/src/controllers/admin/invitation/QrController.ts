import { Controller, Get, HttpException, HttpStatus, Query, Res } from '@nestjs/common'
import { ApiQuery, ApiTags } from '@nestjs/swagger'
import { createInvitation } from '@verana-labs/vs-agent-sdk'
import { Response } from 'express'
import QRCode from 'qrcode'

import { AGENT_INVITATION_BASE_URL } from '../../../config'
import { VsAgentService } from '../../../services/VsAgentService'

@ApiTags('qr')
@Controller({
  path: 'qr',
  version: '1',
})
export class QrController {
  constructor(private readonly agentService: VsAgentService) {}

  @Get('/')
  @ApiQuery({ name: 'size', required: false, type: Number })
  @ApiQuery({ name: 'padding', required: false, type: String })
  @ApiQuery({ name: 'level', required: false, type: String })
  @ApiQuery({ name: 'bcolor', required: false, type: String })
  @ApiQuery({ name: 'fcolor', required: false, type: String })
  @ApiQuery({ name: 'legacy', required: false, type: Boolean })
  public async getQrCode(
    @Res() res: Response,
    @Query('size') size?: number,
    @Query('padding') padding?: number,
    @Query('level') level?: string,
    @Query('bcolor') bcolor?: string,
    @Query('fcolor') fcolor?: string,
    @Query('legacy') useLegacyDid?: boolean,
  ) {
    const { url: invitationUrl } = await createInvitation({
      agent: await this.agentService.getAgent(),
      useLegacyDid,
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
      return res.status(200).contentType('image/png; charset=utf-8').send(qr)
    } catch (error) {
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          error: `something went wrong: ${error}`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
        {
          cause: error,
        },
      )
    }
  }
}
