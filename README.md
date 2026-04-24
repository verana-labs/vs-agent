# VS Agent

VS Agent is a web application that can be used as a framework for building conversational **Verifiable Services (VS)** that integrate seamlessly with the [Hologram Messaging App](https://hologram.chat) and other compatible [DIDCommm](https://didcomm.org) agents. It enables developers to create, deploy, and manage agents that provide trustworthy, verifiable information and actions in chat conversations.

---

## Features

- Simple REST API to send messages and receive events from connected users. No need to have knowledge on DIDComm: all the complexity is managed internally!
- Issue and verify AnonCreds credentials, with revocation support
- Built-in [Verifiable Trust](https://verana.foundation/page/learn-vt-demystified/) implementation
- Hands-on client for easy integrations in existing backends using NestJS
- Plugin architecture: load only the features you need (`chat`, `mrtd`) via `VS_AGENT_PLUGINS`

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
