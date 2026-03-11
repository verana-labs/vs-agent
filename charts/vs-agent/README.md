# VS Agent Helm Chart

This Helm chart deploys **VS Agent** application with a StatefulSet, supporting private and public ingress, persistent storage, and configurable environment variables. It is designed to be flexible, supporting PostgreSQL and Redis integrations.

## Features

* Deploys VS-Agent with configurable replicas
* Supports private and public ingress with TLS certificates via cert-manager
* Persistent storage using PersistentVolumeClaim with customizable storage class and size
* Configurable environment variables for agent ports, endpoints, and external services
* Optional PostgreSQL and Redis support
* Sensitive environment variable management via Kubernetes Secrets (`agentSecret`)
* Customizable deployment color label for easy versioning or environment differentiation

## Kubernetes Resources

* **Service:** Exposes two TCP ports, one for the agent (`didcomm`) and one for admin access.
* **Ingress:**
  * Public ingress for external access with TLS
* **PersistentVolumeClaim:** Provides persistent storage for agent data.
* **StatefulSet:** Runs the VS-Agent container(s) with configurable replicas.

## Configuration

### General

| Parameter                      | Description                                 | Default       |
| ------------------------------ | ------------------------------------------- | ------------- |
| `name`                         | Application name                            | `vs-agent`    |
| `namespace`                    | Kubernetes namespace                        | `default`     |
| `replicas`                     | Number of agent pods                        | `1`           |
| `domain`                       | Domain for ingress hosts                    | `example.com` |

### Ports

| Parameter     | Description                              | Default |
| ------------- | ---------------------------------------- | ------- |
| `adminPort`   | Port for admin interface                 | `3000`  |
| `didcommPort`   | Port for agent communication (`didcomm`) | `3001`  |

### Agent Configuration

| Parameter                  | Description                                      | Default                          |
| -------------------------- | ------------------------------------------------ | -------------------------------- |
| `didcommLabel`                | Label for the agent                              | `VS Agent`                      |
| `eventsBaseUrl`            | Base URL for events                              | `https://events.example.com`    |
| `didcommInvitationImageUrl`  | URL for the agent invitation image               | `https://example.com/invitation.png` |
| `publicDidMethod`          | DID method to use for public DID: 'web' or 'webvh' | `webvh` |
| `extraEnv`                 | Additional environment variables for the agent   | `[]`                            |

### Secrets Management

| Parameter                    | Description                                                      | Default |
| ---------------------------- | ---------------------------------------------------------------- | ------- |
| `agentSecret.create`         | If `true`, chart creates a Secret from `agentSecret.env`         | `false` |
| `agentSecret.existingSecret` | Name of a pre-existing Secret (`existingSecret` takes precedence) | `""`   |
| `agentSecret.env`            | Array of `{name, value}` entries written into the created Secret | `[]`    |

Each secret key must be explicitly mapped to an env var via `extraEnv`. The secret name is `<name>-secret` by default or the value of `existingSecret`.

```yaml
agentSecret:
  create: true
  env:
    - name: AGENT_WALLET_KEY
      value: "my-wallet-key"

extraEnv:
  - name: AGENT_WALLET_KEY
    valueFrom:
      secretKeyRef:
        name: <name>-secret
        key: AGENT_WALLET_KEY
```

For an external secret with different key names:

```yaml
agentSecret:
  existingSecret: "my-external-secret"

extraEnv:
  - name: AGENT_WALLET_KEY
    valueFrom:
      secretKeyRef:
        name: my-external-secret
        key: AGENT_WALLET_KEY_SECRET
```

---

### Database Configuration (Optional)

| Parameter                  | Description                                                                 | Default              |
| -------------------------- | --------------------------------------------------------------------------- | -------------------- |
| `database.enabled`         | Enable PostgreSQL sidecar                                                   | `false`              |
| `database.user`            | PostgreSQL username (plain value)                                           | `""`                 |
| `database.secretPwdKey`    | Key name for the password inside `agentSecret` (useful for external secrets with different key names) | `POSTGRES_PASSWORD` |

### Redis Configuration (Optional)

| Parameter                  | Description                                      | Default                          |
| -------------------------- | ------------------------------------------------ | -------------------------------- |
| `redis.enabled`            | Enable Redis                                     | `false`                         |
| `redis.host`               | Redis host                                       | `your-redis-host`               |
| `redis.password`           | Redis password                                   | `myRedisPass123`                |

### Persistent Storage

| Parameter                  | Description                                      | Default                          |
| -------------------------- | ------------------------------------------------ | -------------------------------- |
| `storage.size`             | Size of the persistent volume for the agent      | `1Gi`                           |
| `storage.storageClassName` | Storage class for the persistent volume          | `csi-cinder-high-speed`         |

### Ingress

| Parameter                      | Description                                 | Default       |
| ------------------------------ | ------------------------------------------- | ------------- |
| `ingress.public.enableCors`    | Enable CORS for public ingress              | `true`        |

### Extra Environment Variables

Add additional environment variables to the agent container with `extraEnv`:

```yaml
extraEnv:
  - name: CUSTOM_ENV_VAR
    value: custom-value
```

---

### Resources (New)

Configurable CPU/Memory requests and limits for the VS-Agent container and, if enabled, for PostgreSQL and Redis. Defaults are conservative and can be adjusted after observing real usage.

#### VS-Agent container

| Parameter                   | Description                    | Default |
| --------------------------- | ------------------------------ | ------- |
| `resources.requests.cpu`    | Minimum reserved CPU           | `100m`  |
| `resources.requests.memory` | Minimum reserved memory        | `256Mi` |
| `resources.limits.cpu`      | Maximum allowed CPU            | `500m`  |
| `resources.limits.memory`   | Maximum allowed memory         | `512Mi` |

#### PostgreSQL (optional)

> Applies only when `database.enabled: true`.

| Parameter                                  | Description              | Default |
| ------------------------------------------ | ------------------------ | ------- |
| `database.resources.requests.cpu`          | Minimum reserved CPU     | `150m`  |
| `database.resources.requests.memory`       | Minimum reserved memory  | `256Mi` |
| `database.resources.limits.cpu`            | Maximum allowed CPU      | `400m`  |
| `database.resources.limits.memory`         | Maximum allowed memory   | `512Mi` |

#### Redis (optional)

> Applies only when `redis.enabled: true`.

| Parameter                             | Description               | Default |
| ------------------------------------- | ------------------------- | ------- |
| `redis.resources.requests.cpu`        | Minimum reserved CPU      | `25m`   |
| `redis.resources.requests.memory`     | Minimum reserved memory   | `64Mi`  |
| `redis.resources.limits.cpu`          | Maximum allowed CPU       | `100m`  |
| `redis.resources.limits.memory`       | Maximum allowed memory    | `128Mi` |

#### Quick Helm overrides

```bash
helm upgrade --install vs-agent ./vs-agent-chart \
  -n your-namespace \
  --set resources.requests.cpu=100m \
  --set resources.requests.memory=256Mi \
  --set resources.limits.cpu=500m \
  --set resources.limits.memory=512Mi
```

## Usage

1. Update values in your `values.yaml` file as needed.
2. Install or upgrade the chart using Helm:

```bash
helm upgrade --install vs-agent ./vs-agent-chart -n your-namespace -f values.yaml
```

3. Monitor pods and ingress resources to ensure deployment success.

4. To uninstall and remove the deployment:

```bash
helm uninstall vs-agent -n your-namespace
```

This will delete all resources created by the chart in the specified namespace.