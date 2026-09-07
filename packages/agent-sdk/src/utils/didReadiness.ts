import { Logger } from '@credo-ts/core'

import { VsAgent } from '../agent/VsAgent'

// On a fresh deployment, the ingress route to this agent's own public endpoint
// can lag a few seconds behind the process becoming ready (e.g. a k8s Service
// has not finished propagating the new pod IP yet). A peer resolves our DID as
// part of processing any message we send it, so we wait for our own DID
// document to be publicly fetchable before reaching out to one.
const OWN_DID_READY_TIMEOUT_MS = 60_000
const OWN_DID_READY_POLL_INTERVAL_MS = 2_000

/**
 * Waits until this agent's own DID document is fetchable at its public endpoint, so a peer
 * can resolve it as soon as we reach out. Checks the same file a peer's resolver would fetch:
 * did.jsonl for did:webvh, did.json for did:web. Logs and returns if the deadline passes,
 * rather than blocking the caller forever on a misconfigured deployment.
 */
export async function waitUntilOwnDidIsPubliclyResolvable(agent: VsAgent, logger: Logger): Promise<void> {
  const did = agent.did
  if (!did || !agent.publicApiBaseUrl) return

  const documentFile = did.startsWith('did:web:') ? 'did.json' : 'did.jsonl'
  const baseUrl = agent.publicApiBaseUrl.replace(/\/+$/, '')
  // A path-based DID location serves its document at <base>/did.json(l), not under /.well-known
  const hasPath = new URL(baseUrl).pathname !== '/'
  const url = hasPath ? `${baseUrl}/${documentFile}` : `${baseUrl}/.well-known/${documentFile}`

  const deadline = Date.now() + OWN_DID_READY_TIMEOUT_MS
  let lastStatus: number | string = 'unreachable'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
      lastStatus = response.status
    } catch (error) {
      lastStatus = (error as Error).message
    }
    await new Promise(resolve => setTimeout(resolve, OWN_DID_READY_POLL_INTERVAL_MS))
  }
  logger.warn(
    `[DidReadiness] own DID document at ${url} was not publicly resolvable after ${OWN_DID_READY_TIMEOUT_MS}ms (last: ${lastStatus}); proceeding anyway`,
  )
}
