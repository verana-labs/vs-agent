import { DidRepository } from '@credo-ts/core'
import { INestApplication } from '@nestjs/common'
import { type BaseAgentModules, type VsAgent, migrateVtjscServiceIds } from '@verana-labs/vs-agent-sdk'
import { Subject } from 'rxjs'
import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'

import { TrustService } from '../src/controllers'

import { verifySignature } from '@verana-labs/verre'

import { startAgent, startServersTesting } from './__mocks__'
import { SubjectInboundTransport, SubjectOutboundTransport, type SubjectMessage } from './helpers'

/** verre, as a third-party resolver would run it, against the agent's own DID Document */
async function verreVerifies(agent: VsAgent<BaseAgentModules>, document: unknown) {
  const [didRecord] = await agent.dids.getCreatedDids({ did: agent.did })
  const resolver = {
    resolve: async () => ({
      didResolutionMetadata: {},
      didDocumentMetadata: {},
      didDocument: didRecord.didDocument!.toJSON(),
    }),
  }
  const silent = { debug() {}, info() {}, warn() {}, error() {} }
  return await verifySignature(document as never, resolver as never, silent)
}

describe('TrustService', () => {
  const faberMessages = new Subject<SubjectMessage>()
  const aliceMessages = new Subject<SubjectMessage>()
  const subjectMap = {
    'rxjs:faber': faberMessages,
    'rxjs:alice': aliceMessages,
  }

  describe('JSC creation and DID document references', () => {
    let jscFaberApp: INestApplication
    let jscFaberService: TrustService
    let jscFaberAgent: VsAgent<BaseAgentModules>

    beforeEach(async () => {
      jscFaberAgent = await startAgent({ label: 'Faber JSC Test', domain: 'faber' })
      jscFaberAgent.didcomm.registerInboundTransport(new SubjectInboundTransport(faberMessages))
      jscFaberAgent.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
      await jscFaberAgent.initialize()
      jscFaberApp = await startServersTesting(jscFaberAgent, { chat: false })
      jscFaberService = jscFaberApp.get<TrustService>(TrustService)
    })

    afterEach(async () => {
      await jscFaberApp.close()
      await jscFaberAgent.shutdown()
      vi.restoreAllMocks()
    })

    it('should add a service reference to the DID document after creating a JSC', async () => {
      await jscFaberService.createJsc(
        'org-schema',
        'https://dm.chatbot.demos.dev.2060.io/vt/cs/v1/js/ecs-org',
      )

      const [didRecord] = await jscFaberAgent.dids.getCreatedDids({ did: jscFaberAgent.did })
      const services = didRecord.didDocument?.service ?? []
      const serviceId = `${jscFaberAgent.did}#vpr-schemas-org-schema-vtjsc-vp`

      expect(services.some(s => s.id === serviceId)).toBe(true)
    })

    it('publishes the JSC as a VC Data Model 2.0 credential secured with Data Integrity proofs', async () => {
      await jscFaberService.createJsc(
        'org-schema',
        'https://dm.chatbot.demos.dev.2060.io/vt/cs/v1/js/ecs-org',
      )

      const [didRecord] = await jscFaberAgent.dids.getCreatedDids({ did: jscFaberAgent.did })
      const entries = Object.values(didRecord.metadata.get('_vt/jsc')!) as Array<Record<string, any>>
      const entry = entries.find(
        e => e.didDocumentServiceId === `${jscFaberAgent.did}#vpr-schemas-org-schema-vtjsc-vp`,
      )!

      // [VT-JSON-SCHEMA-CRED-W3C]: the v2 context, validity via validFrom, no issuanceDate
      expect(entry.credential['@context']).toContain('https://www.w3.org/ns/credentials/v2')
      expect(entry.credential.validFrom).toEqual(expect.any(String))
      expect(entry.credential).not.toHaveProperty('issuanceDate')
      expect(entry.credential.credentialSubject).toEqual(
        expect.objectContaining({ type: 'JsonSchema', digestSRI: expect.stringMatching(/^sha384-/) }),
      )
      expect(entry.credential.proof).toEqual(
        expect.objectContaining({
          type: 'DataIntegrityProof',
          cryptosuite: 'eddsa-jcs-2022',
          proofPurpose: 'assertionMethod',
        }),
      )
      // the linked VP wraps the secured credential and authenticates the holder
      expect(entry.verifiablePresentation['@context']).toEqual(['https://www.w3.org/ns/credentials/v2'])
      expect(entry.verifiablePresentation.verifiableCredential).toEqual([entry.credential])
      expect(entry.verifiablePresentation.proof).toEqual(
        expect.objectContaining({ type: 'DataIntegrityProof', proofPurpose: 'authentication' }),
      )
      expect(await verreVerifies(jscFaberAgent, entry.verifiablePresentation)).toEqual({ result: true })
    })

    it('renames pre-vtjsc service ids on migration without re-signing', async () => {
      const schemaBaseId = 'org-schema'
      await jscFaberService.createJsc(
        schemaBaseId,
        'https://dm.chatbot.demos.dev.2060.io/vt/cs/v1/js/ecs-org',
      )

      const [didRecord] = await jscFaberAgent.dids.getCreatedDids({ did: jscFaberAgent.did })
      const newId = `${jscFaberAgent.did}#vpr-schemas-org-schema-vtjsc-vp`
      const legacyId = `${jscFaberAgent.did}#vpr-schemas-org-schema-jsc-vp`
      const metadata = didRecord.metadata.get('_vt/jsc')!
      const entry = Object.values(metadata).find(e => e.didDocumentServiceId === newId)!
      entry.didDocumentServiceId = legacyId
      const service = didRecord.didDocument!.service!.find(s => s.id === newId)!
      service.id = legacyId
      didRecord.metadata.set('_vt/jsc', metadata)
      const didRepository = jscFaberAgent.context.dependencyManager.resolve(DidRepository)
      await didRepository.update(jscFaberAgent.context, didRecord)
      await jscFaberAgent.dids.update({ did: didRecord.did, didDocument: didRecord.didDocument! })

      await migrateVtjscServiceIds(jscFaberAgent)

      const [migrated] = await jscFaberAgent.dids.getCreatedDids({ did: jscFaberAgent.did })
      const migratedMeta = migrated.metadata.get('_vt/jsc')!
      expect(Object.values(migratedMeta).some(e => e.didDocumentServiceId === newId)).toBe(true)
      expect(migrated.didDocument?.service?.some(s => s.id === newId)).toBe(true)
      expect(migrated.didDocument?.service?.some(s => s.id === legacyId)).toBe(false)
    })

    it('should not create duplicate service references when the same JSC is created twice', async () => {
      const schemaBaseId = 'org-schema'
      const jsonSchemaRef = 'https://dm.chatbot.demos.dev.2060.io/vt/cs/v1/js/ecs-org'

      await jscFaberService.createJsc(schemaBaseId, jsonSchemaRef)
      await jscFaberService.createJsc(schemaBaseId, jsonSchemaRef)

      const [didRecord] = await jscFaberAgent.dids.getCreatedDids({ did: jscFaberAgent.did })
      const services = didRecord.didDocument?.service ?? []
      const serviceId = `${jscFaberAgent.did}#vpr-schemas-org-schema-vtjsc-vp`
      const matchingServices = services.filter(s => s.id === serviceId)

      expect(matchingServices).toHaveLength(1)
    })

    it('should maintain independent service references for different JSC schemas', async () => {
      await jscFaberService.createJsc(
        'org-schema',
        'https://dm.chatbot.demos.dev.2060.io/vt/cs/v1/js/ecs-org',
      )
      await jscFaberService.createJsc(
        'service-schema',
        'https://dm.chatbot.demos.dev.2060.io/vt/cs/v1/js/ecs-service',
      )

      const [didRecord] = await jscFaberAgent.dids.getCreatedDids({ did: jscFaberAgent.did })
      const services = didRecord.didDocument?.service ?? []
      const orgServiceId = `${jscFaberAgent.did}#vpr-schemas-org-schema-vtjsc-vp`
      const svcServiceId = `${jscFaberAgent.did}#vpr-schemas-service-schema-vtjsc-vp`

      expect(services.filter(s => s.id === orgServiceId)).toHaveLength(1)
      expect(services.filter(s => s.id === svcServiceId)).toHaveLength(1)
    })
  })
})
