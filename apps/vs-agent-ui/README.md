# @verana-labs/vs-agent-ui

Static dashboard UI for [vs-agent](../vs-agent). Built with React + Vite, served directly by the vs-agent HTTP server.

vs-agent-ui provides a lightweight read-only web interface to monitor a vs-agent node within the [Verana](https://verana.io) ecosystem — a decentralized trust infrastructure built on top of DIDComm and Verifiable Credentials.

## Dashboard

Everything shown about the service is resolved in the browser from the agent's own `/.well-known/did.json`: the `LinkedVerifiablePresentation` services (`vpr*-vtc-vp` and `vpr*-vtjsc-vp`) are fetched and their credentials classified by ECS type.

When an ECS-Service credential is presented, the page renders the **service profile**:

- Hero with the service name, logo, description, minimum age, terms and privacy policy links. The logo also becomes the favicon and the name the page title.
- **Operated by** card from the ECS-Organization or ECS-Persona credential. When the service presents none, the controller presented by the issuer of its ECS-Service credential is shown as *Inherited* (one hop, per the Verifiable Trust spec).
- **Trust information** card: presented credentials, the agent's Participant entries read live from the declared network's indexer (`/v4/participant/list`), and the presented JSON schema credentials.
- **Service endpoints** from the DID document.

Otherwise it falls back to a plain listing of the public DID, endpoints and credentials.

Click any `{ }` button to see the underlying JSON.

## Runtime configuration

vs-agent injects `window.__VS_AGENT__` into `index.html` when serving it (see `UI_*` in the [vs-agent README](../vs-agent/README.md#dashboard-ui-variables)): the build variant and version for the footer, the network badge, the placeholder banner flag, and the Verana network (`chainId`, `indexerBaseUrl`) used for accreditations and deep links. The page never derives a network from the presented credentials.

## Development

```bash
pnpm build          # outputs to ../vs-agent/public
pnpm build:watch    # watch mode
```
