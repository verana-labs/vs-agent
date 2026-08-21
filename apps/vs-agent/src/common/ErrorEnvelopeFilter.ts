import type { Request, Response } from 'express'

import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger } from '@nestjs/common'
import { BaseExceptionFilter } from '@nestjs/core'

import {
  ServiceEndpointError,
  ServiceEndpointErrorCode,
} from '../controllers/admin/service-endpoints/ServiceEndpointsService'

import { AdminApiError, AdminApiErrorCode } from './AdminApiError'

interface ErrorEnvelope {
  status: number
  code: string
  message: string
}

const INTERNAL_MESSAGE = 'the agent failed to complete the request'

@Catch()
export class ErrorEnvelopeFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(ErrorEnvelopeFilter.name)

  public catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const request = http.getRequest<Request>()

    if (!this.isV2Request(request)) {
      super.catch(exception, host)
      return
    }

    const envelope = this.envelopeFor(exception)
    if (envelope.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(`${request.method} ${this.pathOf(request)} failed`, exception as Error)
    }

    const response = http.getResponse<Response>()
    if (response.headersSent) return

    response.status(envelope.status).json({ error: { code: envelope.code, message: envelope.message } })
  }

  private isV2Request(request: Request): boolean {
    const path = this.pathOf(request)
    return path === '/v2' || path.startsWith('/v2/')
  }

  private pathOf(request: Request): string {
    return (request.originalUrl ?? request.url ?? '').split('?')[0]
  }

  private envelopeFor(exception: unknown): ErrorEnvelope {
    if (exception instanceof AdminApiError) {
      return { status: exception.status, code: exception.code, message: exception.message }
    }

    if (exception instanceof ServiceEndpointError) {
      return {
        status: this.statusForServiceEndpointCode(exception.code),
        code: this.codeForServiceEndpointCode(exception.code),
        message: exception.message,
      }
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      return {
        status,
        code: this.codeForStatus(status),
        message:
          status >= HttpStatus.INTERNAL_SERVER_ERROR
            ? INTERNAL_MESSAGE
            : this.messageOf(exception.getResponse(), exception.message),
      }
    }

    const status = this.statusOf(exception)
    if (status) {
      return {
        status,
        code: this.codeForStatus(status),
        message:
          status >= HttpStatus.INTERNAL_SERVER_ERROR
            ? INTERNAL_MESSAGE
            : ((exception as Error).message ?? INTERNAL_MESSAGE),
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: AdminApiErrorCode.Internal,
      message: INTERNAL_MESSAGE,
    }
  }

  private statusOf(exception: unknown): number | undefined {
    const candidate = exception as { status?: unknown; statusCode?: unknown } | null
    const status = typeof candidate?.status === 'number' ? candidate.status : candidate?.statusCode
    return typeof status === 'number' && status >= 400 && status <= 599 ? status : undefined
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return AdminApiErrorCode.Unauthenticated
      case HttpStatus.FORBIDDEN:
        return AdminApiErrorCode.Forbidden
      case HttpStatus.NOT_FOUND:
        return AdminApiErrorCode.UnknownId
      case HttpStatus.CONFLICT:
        return AdminApiErrorCode.InvalidState
      default:
        return status >= HttpStatus.INTERNAL_SERVER_ERROR
          ? AdminApiErrorCode.Internal
          : AdminApiErrorCode.InvalidInput
    }
  }

  private statusForServiceEndpointCode(code: ServiceEndpointErrorCode): number {
    switch (code) {
      case ServiceEndpointErrorCode.NotFound:
        return HttpStatus.NOT_FOUND
      case ServiceEndpointErrorCode.DuplicateId:
      case ServiceEndpointErrorCode.DidcommEntry:
      case ServiceEndpointErrorCode.LinkedVpEntry:
      case ServiceEndpointErrorCode.AdminApiEntry:
        return HttpStatus.CONFLICT
      default:
        return HttpStatus.BAD_REQUEST
    }
  }

  private codeForServiceEndpointCode(code: ServiceEndpointErrorCode): string {
    return code === ServiceEndpointErrorCode.NotFound ? AdminApiErrorCode.UnknownId : code
  }

  private messageOf(payload: string | object, fallback: string): string {
    if (typeof payload === 'string') return payload

    const message = (payload as { message?: unknown }).message
    if (typeof message === 'string') return message
    if (Array.isArray(message)) return message.join('; ')
    return fallback
  }
}
