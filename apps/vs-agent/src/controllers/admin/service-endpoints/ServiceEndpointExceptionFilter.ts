import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common'
import { ServiceEndpointError, ServiceEndpointErrorCode } from '@verana-labs/vs-agent-sdk'
import { Response } from 'express'

@Catch(ServiceEndpointError)
export class ServiceEndpointExceptionFilter implements ExceptionFilter<ServiceEndpointError> {
  public catch(exception: ServiceEndpointError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>()
    response.status(this.statusFor(exception.code)).json({ code: exception.code, reason: exception.message })
  }

  private statusFor(code: ServiceEndpointErrorCode): number {
    switch (code) {
      case ServiceEndpointErrorCode.NotFound:
        return HttpStatus.NOT_FOUND
      case ServiceEndpointErrorCode.DuplicateId:
        return HttpStatus.CONFLICT
      default:
        return HttpStatus.BAD_REQUEST
    }
  }
}
