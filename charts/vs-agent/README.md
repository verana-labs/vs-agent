# VS Agent Helm Chart

This Helm chart deploys **VS Agent** application with a StatefulSet, supporting private and public ingress, persistent storage, and configurable environment variables. It is designed to be flexible, supporting PostgreSQL and Redis integrations.

## Features

* Deploys VS-Agent with configurable replicas
* Supports private and public ingress with TLS certificates via cert-manager
* Persistent storage using PersistentVolumeClaim with customizable storage class and size
* Configurable environment variables for agent ports, endpoints, and external services
* Optional PostgreSQL and Redis support
* Sensitive environment variable injection via pre-existing Kubernetes Secrets using `extraEnv[].valueFrom`

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
| `eventsWebhookUrl`         | URL the agent posts every event to. Empty delivers no event | `""`                |
| `didcommInvitationImageUrl`  | URL for the agent invitation image               | `https://example.com/invitation.png` |
| `publicDidMethod`          | DID method to use for public DID: 'web' or 'webvh' | `webvh` |
| `veranaCorporationId`      | VPR `Corporation.id` the agent belongs to. **Required** | `""` |
| `veranaRpcEndpointUrl`     | Verana blockchain RPC endpoint URL. **Required** | `""` |
| `veranaIndexerBaseUrl`     | Verana indexer API URL. **Required**             | `""` |
| `veranaChainId`            | Chain ID. Required for the VS-CONN-VS trust gate | `""` |
| `agentMode`                | How the agent obtains its ECS credentials: `standalone` or `delegated` | `standalone` |
| `trustedEcsEcosystemDids`  | Comma-separated ECS ecosystem DIDs. Required when `agentMode` is `standalone` | `""` |
| `delegatedParentVsDid`     | DID of the parent Verifiable Service. Required when `agentMode` is `delegated` | `""` |
| `extraEnv`                 | Additional environment variables for the agent   | `[]`                            |

### Secrets Management

This chart does not create Kubernetes Secrets. Sensitive values must be stored in a pre-existing Secret (created manually, via External Secrets Operator, Vault, Sealed Secrets, etc.) and referenced through `extraEnv[].valueFrom`.

```yaml
extraEnv:
  - name: AGENT_WALLET_KEY
    valueFrom:
      secretKeyRef:
        name: my-existing-secret
        key: AGENT_WALLET_KEY
```

`VERANA_ACCOUNT_MNEMONIC`, the BIP-39 mnemonic of the agent's `vs_operator` account, is
**required** and must be supplied the same way:

```yaml
extraEnv:
  - name: VERANA_ACCOUNT_MNEMONIC
    valueFrom:
      secretKeyRef:
        name: my-existing-secret
        key: VERANA_ACCOUNT_MNEMONIC
```

Both direct values and secret references can be mixed in `extraEnv`:

```yaml
extraEnv:
  - name: AGENT_WALLET_ID
    value: "my-wallet"
  - name: AGENT_WALLET_KEY
    valueFrom:
      secretKeyRef:
        name: my-existing-secret
        key: AGENT_WALLET_KEY
```

---

### Database Configuration (Optional)

| Parameter                  | Description                                                                 | Default              |
| -------------------------- | --------------------------------------------------------------------------- | -------------------- |
| `database.enabled`         | Enable PostgreSQL sidecar                                                   | `false`              |
| `database.existingSecret`  | Name of a pre-existing Secret containing the PostgreSQL password            | `""`                 |
| `database.user`            | PostgreSQL username (plain value)                                           | `""`                 |
| `database.secretPwdKey`    | Key name for the password inside `database.existingSecret`                  | `POSTGRES_PASSWORD`  |

### Redis Configuration (Optional)

| Parameter                  | Description                                      | Default                          |
| -------------------------- | ------------------------------------------------ | -------------------------------- |
| `redis.enabled`            | Enable Redis                                     | `false`                         |
| `redis.image`              | Redis container image (pin a tag for reproducible deploys) | `redis:alpine`       |
| `redis.maxmemory`          | Redis `maxmemory`; set `""` for unlimited        | `80mb`                          |
| `redis.maxmemoryPolicy`    | Redis `maxmemory-policy` (applied only when `maxmemory` is set) | `noeviction`     |
| `redis.extraArgs`          | Additional `redis-server` flags (list)          | `[]`                            |

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

#### ECS Credential Claims (Optional)

The agent gets the claims of its own ECS credentials from the `ECS_CLAIMS_*` variables. The
chart has no value for them. Set them with `extraEnv`.

In the `standalone` agent mode, the agent needs these seven variables. The agent stops at
startup if one of them is absent:

| Variable | Claim |
| --- | --- |
| `ECS_CLAIMS_SERVICE_NAME` | `name` |
| `ECS_CLAIMS_SERVICE_TYPE` | `type` |
| `ECS_CLAIMS_SERVICE_DESCRIPTION` | `description` |
| `ECS_CLAIMS_SERVICE_LOGO_URI` | `logoUri` |
| `ECS_CLAIMS_SERVICE_MINIMUM_AGE_REQUIRED` | `minimumAgeRequired` |
| `ECS_CLAIMS_SERVICE_TERMS_AND_CONDITIONS_URI` | `termsAndConditionsUri` |
| `ECS_CLAIMS_SERVICE_PRIVACY_POLICY_URI` | `privacyPolicyUri` |

`ECS_CLAIMS_SERVICE_MINIMUM_AGE_REQUIRED` must be an integer.

The agent reads each `*_URI` variable and calculates the digest of the response. Therefore,
each URI must be available. The agent serves three placeholder resources at
`/vt/default/logo.svg`, `/vt/default/terms.html` and `/vt/default/privacy.html`. A URI can
point to one of them.

`extraEnv` does not accept Helm templates. Write the full host in each URI.

```yaml
extraEnv:
  - name: ECS_CLAIMS_SERVICE_NAME
    value: My Service
  - name: ECS_CLAIMS_SERVICE_TYPE
    value: WEB_PORTAL
  - name: ECS_CLAIMS_SERVICE_DESCRIPTION
    value: A verifiable service
  - name: ECS_CLAIMS_SERVICE_MINIMUM_AGE_REQUIRED
    value: "18"
  - name: ECS_CLAIMS_SERVICE_LOGO_URI
    value: https://vs-agent.example.io/vt/default/logo.svg
  - name: ECS_CLAIMS_SERVICE_TERMS_AND_CONDITIONS_URI
    value: https://vs-agent.example.io/vt/default/terms.html
  - name: ECS_CLAIMS_SERVICE_PRIVACY_POLICY_URI
    value: https://vs-agent.example.io/vt/default/privacy.html
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