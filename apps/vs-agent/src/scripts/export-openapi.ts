import 'reflect-metadata'

import type { VsAgent, VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import { VersioningType } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { ChatPlugin } from '@verana-labs/vs-agent-plugin-chat'
import { OpenId4VcPlugin } from '@verana-labs/vs-agent-plugin-openid4vc'
import { mkdirSync, writeFileSync } from 'fs'
import { resolve } from 'path'

import { VsAgentModule } from '../admin.module'
import { ADMIN_V2_TAGS } from '../config/constants'
import { VtFlowNestPlugin } from '../plugins'
import { buildOpenApiDocument } from '../utils/setupAgent'

// Writes the Admin API OpenAPI document to docs/api/openapi.json without starting an agent:
// the Nest module is built around a placeholder agent that no provider touches at construction.
// The document is the one a running agent serves at /api with every optional scope enabled.
// docs.verana.io reads it from the repository; CI fails when the committed file is stale.
const out = process.argv[2] ?? resolve(__dirname, '..', '..', '..', '..', '..', 'docs', 'api', 'openapi.json')
const publicApiBaseUrl = 'https://agent.example'
// The vs-agent image does not build plugin-mrtd. A module name in a variable keeps tsc from
// resolving the package, as in main.ts. The export fails when the package is not built.
const mrtdPackage: string = '@verana-labs/vs-agent-plugin-mrtd'

async function main() {
  const agent = { toJSON: () => 'VsAgent (placeholder for the OpenAPI export)' } as unknown as VsAgent
  const { MrtdPlugin } = await import(mrtdPackage)
  const nestPlugins: VsAgentNestPlugin[] = [
    ChatPlugin(),
    MrtdPlugin(),
    OpenId4VcPlugin({ publicApiBaseUrl, credentialConfigurations: [] }),
    VtFlowNestPlugin,
  ]
  const app = await NestFactory.create(VsAgentModule.register(agent, publicApiBaseUrl, nestPlugins), {
    logger: false,
  })
  app.enableVersioning({ type: VersioningType.URI })
  const document = buildOpenApiDocument(app, ADMIN_V2_TAGS)
  mkdirSync(resolve(out, '..'), { recursive: true })
  writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`)
  await app.close()
  process.stdout.write(`wrote ${out} (${Object.keys(document.paths).length} paths)\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
  process.exit(1)
})
