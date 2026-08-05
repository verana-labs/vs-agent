# VS Agent

VS Agent is the reference implementation of a **Verifiable Service (VS)**: a
self-hosted container that packs everything a service needs to be verifiable
under the [Verifiable Trust model](https://verana-labs.github.io/verifiable-trust-spec/versions/v4/) -
a resolvable DID, credential lifecycle management, trust resolution against
the [Verana](https://verana.io) infrastructure, and secure peer-to-peer
communication over [DIDComm](https://didcomm.org) and
[OpenID4VC](https://openid.net/sg/openid4vc/).

Run it alongside your backend and expose any service shape under one
verified identity: a conversational DIDComm agent, an MCP tool server, an
A2A agent, or a plain HTTP API. Peers resolve your DID, verify who operates
the service and under which governance, and only then connect.

---

## Features

- **Verifiable Trust built in**: the agent maintains its DID Document with
  Linked Verifiable Presentations of its ECS credentials (what the service
  is, who operates it), and resolves the trust of every peer before
  exchanging data.
- **Holder, issuer and verifier in one runtime**: issue, hold and verify
  credentials under ecosystem accreditation, with revocation support.
- **Dual transport**:
  - **DIDComm** (v1 and v2 envelopes): Issue Credential v2, Present Proof v2,
    and the [vt-flow protocol](https://github.com/verana-labs/verana-spec/blob/main/v4/vt-flow-protocol/spec.md)
    for ecosystem-driven flows - onboarding triggers issuance, on-chain
    revocation is pushed to holders and cleaned up automatically.
  - **OpenID4VCI / OpenID4VP** (`openid4vc` plugin): `dc+sd-jwt` issuance
    and presentation with DCQL and Presentation Exchange, IETF Token Status
    List revocation, and Verana trust checks before any presentation is
    accepted. See the [operator documentation](./packages/plugin-openid4vc/README.md).
- **The right credential format for each use**: W3C JSON-LD credentials for
  public credentials (digest-anchored on the Verana ledger), AnonCreds for
  private credentials that must stay unlinkable (ZKP, selective disclosure),
  and IETF SD-JWT VC for OpenID4VC interoperability.
- **Simple REST API and typed clients**: send messages, issue credentials
  and receive events without knowing anything about DIDComm - all the
  complexity is managed internally. A [NestJS client](./packages/nestjs-client/)
  and a [base JS client](./packages/client) are provided.
- **Plugin architecture**: load only the features you need (`chat`, `mrtd`,
  `openid4vc`) via `VS_AGENT_PLUGINS`.

---

## Quick Start

The easiest way to get started with VS Agent is by using Docker. Pull the image from Docker Hub:

```
docker pull veranalabs/vs-agent
```

Or build it directly from this repo:

```
docker build -t vs-agent:dev -f ./apps/vs-agent/Dockerfile .
```

Then, you can just run it. Don't forget to set the environment variables as required! See [VS Agent Configuration](./apps/vs-agent/README.md#configuration) for a detailed description:

```
docker run --env-file ./env-vars veranalabs/vs-agent
```

Once your VS Agent is up and running, you can manage it from your backend basically in three different ways

### Using NestJS Client (preferred way)

[NestJS client](./packages/nestjs-client/) can be imported as a module in your backend, and it will implement all endpoints required to handle event coming from VS Agent. It also provides some extra models to manage credential revocation, use statistics and handling user profile (including useful information such as preferred language). See [NestJS client documentation]((./packages/nestjs-client/README.md) for more details.

### Using basic client

[Base client](./packages/client) provides a basic model for every VS API message and event, and it is handy when you want to create a simple backend based on NodeJS, especially if you use Express. See [JS client documentation](./packages/client/README.md) for more details.

### Using VS Agent REST API

This can be used regardless the software stack you use in your backend. See [VS Agent API reference](./doc/vs-agent-api.md) for a detailed guide about all endpoints.


---

## Example implementations

See [examples](./examples) for fully working demos that can be run locally using Docker.

---

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/your-feature`)
3. Commit your changes (`git commit -m 'Add feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

Please follow the code style and write tests for new features.

---

## License

This project is pulished under Apache license. See [LICENSE](LICENSE) for more information.

---

## Contact

For questions or support, you are welcome to open an issue.
