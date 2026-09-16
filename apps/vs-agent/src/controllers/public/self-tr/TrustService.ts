import { Logger, Inject, Injectable, HttpException, HttpStatus } from '@nestjs/common'
import {
  createJsc,
  createVtc,
  findMetadataEntry,
  getEcsSchemas,
  removeTrustCredential,
  type TrustCredential,
} from '@verana-labs/vs-agent-sdk'

import { VsAgentService } from '../../../services/VsAgentService'

@Injectable()
export class TrustService {
  private readonly logger = new Logger(TrustService.name)
  private ecsSchemas

  constructor(
    @Inject(VsAgentService) private readonly agentService: VsAgentService,
    @Inject('PUBLIC_API_BASE_URL') private readonly publicApiBaseUrl: string,
  ) {
    this.ecsSchemas = getEcsSchemas(publicApiBaseUrl)
  }

  private async getTrustCredential(key: '_vt/vtc' | '_vt/jsc', schemaId: string) {
    try {
      const { didRecord } = await this.getDidRecord()
      const metadata = findMetadataEntry(didRecord, key, schemaId)
      if (!metadata) {
        throw new HttpException('Schema not found', HttpStatus.NOT_FOUND)
      }
      return metadata.data
    } catch (error) {
      this.handleError(error, 'Failed to load schema')
    }
  }

  public async getVerifiableTrustCredential(schemaId: string) {
    return await this.getTrustCredential('_vt/vtc', schemaId)
  }

  public async getJsonSchemaCredential(schemaId: string) {
    return await this.getTrustCredential('_vt/jsc', schemaId)
  }

  private async removeCredentialByType(schemaId: string, key: '_vt/vtc' | '_vt/jsc') {
    try {
      const { agent } = await this.getDidRecord()
      await removeTrustCredential(agent, schemaId, key)

      this.logger.log(`Metadata ${schemaId} successfully removed`)
      return { success: true, message: `Metadata ${schemaId} removed` }
    } catch (error) {
      this.handleError(error, 'Failed to remove schema data')
    }
  }

  public async removeVerifiableTrustCredential(schemaId: string) {
    return await this.removeCredentialByType(schemaId, '_vt/vtc')
  }

  public async removeJsonSchemaCredential(schemaId: string) {
    return await this.removeCredentialByType(schemaId, '_vt/jsc')
  }

  public async createVtc(id: string, credential: TrustCredential) {
    try {
      const { agent } = await this.getDidRecord()
      const verifiablePresentation = await createVtc(agent, this.publicApiBaseUrl, id, credential)
      this.logger.log(`Metadata for "schemas-${id}-vtc-vp.json" updated successfully.`)
      return verifiablePresentation
    } catch (error) {
      this.handleError(error, 'Error create credential')
    }
  }

  public async createJsc(id: string, jsonSchemaRef: string) {
    try {
      const { agent } = await this.getDidRecord()
      return await createJsc(agent, this.publicApiBaseUrl, this.ecsSchemas, {
        schemaBaseId: id,
        jsonSchemaRef,
      })
    } catch (error) {
      this.handleError(error, 'Failed to create schema')
    }
  }

  // Helpers
  private async getDidRecord() {
    const agent = await this.agentService.getAgent()
    const [didRecord] = await agent.dids.getCreatedDids({ did: agent.did })
    return { agent, didRecord }
  }

  private handleError(error: any, defaultMsg: string): never {
    const message = error?.message ?? String(error)
    this.logger.error(`Error: ${message}`)
    if (error instanceof HttpException) throw error
    throw new HttpException(message || defaultMsg, HttpStatus.INTERNAL_SERVER_ERROR)
  }
}
