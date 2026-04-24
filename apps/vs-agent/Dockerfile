FROM node:22.19-slim AS base
ENV COREPACK_INTEGRITY_KEYS=0
RUN corepack enable && corepack prepare pnpm@9.15.3 --activate

# Build: base agent (no plugins)
FROM base AS build-base
WORKDIR /www
ENV RUN_MODE="docker"

COPY patches ./patches
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.json tsconfig.build.json ./
COPY packages/model/package.json packages/model/package.json
COPY packages/agent-sdk/package.json packages/agent-sdk/package.json
COPY apps/vs-agent/package.json apps/vs-agent/package.json
COPY apps/vs-agent-ui/package.json apps/vs-agent-ui/package.json

# plugin-chat and plugin-mrtd package.json intentionally absent — pnpm skips optional workspace:* deps
RUN pnpm install --no-frozen-lockfile

COPY packages/model/src packages/model/src
COPY packages/model/tsconfig.json packages/model/tsconfig.build.json packages/model/
COPY packages/agent-sdk/src packages/agent-sdk/src
COPY packages/agent-sdk/tsconfig.json packages/agent-sdk/tsconfig.build.json packages/agent-sdk/
COPY apps/vs-agent/src apps/vs-agent/src
COPY apps/vs-agent/discovery.json apps/vs-agent/tsconfig.json apps/vs-agent/tsconfig.build.json apps/vs-agent/nest-cli.json apps/vs-agent/
COPY apps/vs-agent-ui/src apps/vs-agent-ui/src
COPY apps/vs-agent-ui/index.html apps/vs-agent-ui/vite.config.js apps/vs-agent-ui/tsconfig.json apps/vs-agent-ui/

RUN pnpm --filter @verana-labs/vs-agent-model build && \
    pnpm --filter @verana-labs/vs-agent-sdk build && \
    pnpm --filter @verana-labs/vs-agent-ui build && \
    pnpm --filter @verana-labs/vs-agent build

RUN --mount=type=bind,source=scripts/docker-cleanup.sh,target=/tmp/cleanup.sh sh /tmp/cleanup.sh

# Build: chat plugin
FROM base AS build-chat
WORKDIR /www
ENV RUN_MODE="docker"

COPY patches ./patches
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.json tsconfig.build.json ./
COPY packages/model/package.json packages/model/package.json
COPY packages/agent-sdk/package.json packages/agent-sdk/package.json
COPY packages/plugin-chat/package.json packages/plugin-chat/package.json
COPY apps/vs-agent/package.json apps/vs-agent/package.json
COPY apps/vs-agent-ui/package.json apps/vs-agent-ui/package.json

# plugin-mrtd package.json intentionally absent — its deps won't be installed
RUN pnpm install --no-frozen-lockfile

COPY packages/model/src packages/model/src
COPY packages/model/tsconfig.json packages/model/tsconfig.build.json packages/model/
COPY packages/agent-sdk/src packages/agent-sdk/src
COPY packages/agent-sdk/tsconfig.json packages/agent-sdk/tsconfig.build.json packages/agent-sdk/
COPY packages/plugin-chat/src packages/plugin-chat/src
COPY packages/plugin-chat/tsconfig.build.json packages/plugin-chat/
COPY apps/vs-agent/src apps/vs-agent/src
COPY apps/vs-agent/discovery.json apps/vs-agent/tsconfig.json apps/vs-agent/tsconfig.build.json apps/vs-agent/nest-cli.json apps/vs-agent/
COPY apps/vs-agent-ui/src apps/vs-agent-ui/src
COPY apps/vs-agent-ui/index.html apps/vs-agent-ui/vite.config.js apps/vs-agent-ui/tsconfig.json apps/vs-agent-ui/

RUN pnpm --filter @verana-labs/vs-agent-model build && \
    pnpm --filter @verana-labs/vs-agent-sdk build && \
    pnpm --filter @verana-labs/vs-agent-plugin-chat build && \
    pnpm --filter @verana-labs/vs-agent-ui build && \
    pnpm --filter @verana-labs/vs-agent build

RUN --mount=type=bind,source=scripts/docker-cleanup.sh,target=/tmp/cleanup.sh sh /tmp/cleanup.sh

# Build: chat + mrtd plugins
FROM base AS build-mrtd
WORKDIR /www
ENV RUN_MODE="docker"

COPY patches ./patches
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.json tsconfig.build.json ./
COPY packages/model/package.json packages/model/package.json
COPY packages/agent-sdk/package.json packages/agent-sdk/package.json
COPY packages/plugin-chat/package.json packages/plugin-chat/package.json
COPY packages/plugin-mrtd/package.json packages/plugin-mrtd/package.json
COPY apps/vs-agent/package.json apps/vs-agent/package.json
COPY apps/vs-agent-ui/package.json apps/vs-agent-ui/package.json

RUN pnpm install --frozen-lockfile

COPY packages/model/src ./packages/model/src
COPY packages/model/tsconfig.json ./packages/model/tsconfig.build.json packages/model/
COPY packages/agent-sdk/src ./packages/agent-sdk/src
COPY packages/agent-sdk/tsconfig.json ./packages/agent-sdk/tsconfig.build.json packages/agent-sdk/
COPY packages/plugin-chat/src ./packages/plugin-chat/src
COPY packages/plugin-chat/tsconfig.build.json ./packages/plugin-chat/
COPY packages/plugin-mrtd/src ./packages/plugin-mrtd/src
COPY packages/plugin-mrtd/tsconfig.json ./packages/plugin-mrtd/tsconfig.build.json packages/plugin-mrtd/
COPY apps/vs-agent/src ./apps/vs-agent/src
COPY apps/vs-agent/discovery.json ./apps/vs-agent/tsconfig.json apps/vs-agent/tsconfig.build.json apps/vs-agent/nest-cli.json apps/vs-agent/
COPY apps/vs-agent-ui/src ./apps/vs-agent-ui/src
COPY apps/vs-agent-ui/index.html ./apps/vs-agent-ui/vite.config.js apps/vs-agent-ui/tsconfig.json apps/vs-agent-ui/

RUN pnpm --filter @verana-labs/vs-agent-model build && \
    pnpm --filter @verana-labs/vs-agent-sdk build && \
    pnpm --filter @verana-labs/vs-agent-plugin-chat build && \
    pnpm --filter @verana-labs/vs-agent-plugin-mrtd build && \
    pnpm --filter @verana-labs/vs-agent-ui build && \
    pnpm --filter @verana-labs/vs-agent build

RUN --mount=type=bind,source=scripts/docker-cleanup.sh,target=/tmp/cleanup.sh sh /tmp/cleanup.sh

# Final: vs-agent (no plugins)
FROM node:22.19-slim AS vs-agent
WORKDIR /www
ENV RUN_MODE="docker"
ENV VS_AGENT_PLUGINS=messaging

COPY --from=build-base /www/node_modules ./node_modules
COPY --from=build-base /www/packages/model/package.json ./packages/model/package.json
COPY --from=build-base /www/packages/model/build ./packages/model/build
COPY --from=build-base /www/packages/agent-sdk/package.json ./packages/agent-sdk/package.json
COPY --from=build-base /www/packages/agent-sdk/build ./packages/agent-sdk/build
COPY --from=build-base /www/packages/agent-sdk/node_modules ./packages/agent-sdk/node_modules
COPY --from=build-base /www/apps/vs-agent/node_modules ./apps/vs-agent/node_modules
COPY apps/vs-agent/package.json ./apps/vs-agent/package.json
COPY --from=build-base /www/apps/vs-agent/build ./apps/vs-agent/build
COPY --from=build-base /www/apps/vs-agent/public ./apps/vs-agent/public
COPY apps/vs-agent/discovery.json ./apps/vs-agent/discovery.json

CMD ["node", "apps/vs-agent/build/src/main"]

# Final: vs-agent-chat (chat plugin)
FROM node:22.19-slim AS vs-agent-chat
WORKDIR /www
ENV RUN_MODE="docker"
ENV VS_AGENT_PLUGINS=messaging,chat

COPY --from=build-chat /www/node_modules ./node_modules
COPY --from=build-chat /www/packages/model/package.json ./packages/model/package.json
COPY --from=build-chat /www/packages/model/build ./packages/model/build
COPY --from=build-chat /www/packages/agent-sdk/package.json ./packages/agent-sdk/package.json
COPY --from=build-chat /www/packages/agent-sdk/build ./packages/agent-sdk/build
COPY --from=build-chat /www/packages/agent-sdk/node_modules ./packages/agent-sdk/node_modules
COPY --from=build-chat /www/packages/plugin-chat/package.json ./packages/plugin-chat/package.json
COPY --from=build-chat /www/packages/plugin-chat/build ./packages/plugin-chat/build
COPY --from=build-chat /www/packages/plugin-chat/node_modules ./packages/plugin-chat/node_modules
COPY --from=build-chat /www/apps/vs-agent/node_modules ./apps/vs-agent/node_modules
COPY apps/vs-agent/package.json ./apps/vs-agent/package.json
COPY --from=build-chat /www/apps/vs-agent/build ./apps/vs-agent/build
COPY --from=build-chat /www/apps/vs-agent/public ./apps/vs-agent/public
COPY apps/vs-agent/discovery.json ./apps/vs-agent/discovery.json

CMD ["node", "apps/vs-agent/build/src/main"]

# Final: vs-agent-mrtd (chat + mrtd plugins)
FROM node:22.19-slim AS vs-agent-mrtd
WORKDIR /www
ENV RUN_MODE="docker"
ENV VS_AGENT_PLUGINS=messaging,chat,mrtd

COPY --from=build-mrtd /www/node_modules ./node_modules
COPY --from=build-mrtd /www/packages/model/package.json ./packages/model/package.json
COPY --from=build-mrtd /www/packages/model/build ./packages/model/build
COPY --from=build-mrtd /www/packages/agent-sdk/package.json ./packages/agent-sdk/package.json
COPY --from=build-mrtd /www/packages/agent-sdk/build ./packages/agent-sdk/build
COPY --from=build-mrtd /www/packages/agent-sdk/node_modules ./packages/agent-sdk/node_modules
COPY --from=build-mrtd /www/packages/plugin-chat/package.json ./packages/plugin-chat/package.json
COPY --from=build-mrtd /www/packages/plugin-chat/build ./packages/plugin-chat/build
COPY --from=build-mrtd /www/packages/plugin-chat/node_modules ./packages/plugin-chat/node_modules
COPY --from=build-mrtd /www/packages/plugin-mrtd/package.json ./packages/plugin-mrtd/package.json
COPY --from=build-mrtd /www/packages/plugin-mrtd/build ./packages/plugin-mrtd/build
COPY --from=build-mrtd /www/packages/plugin-mrtd/node_modules ./packages/plugin-mrtd/node_modules
COPY --from=build-mrtd /www/apps/vs-agent/node_modules ./apps/vs-agent/node_modules
COPY apps/vs-agent/package.json ./apps/vs-agent/package.json
COPY --from=build-mrtd /www/apps/vs-agent/build ./apps/vs-agent/build
COPY --from=build-mrtd /www/apps/vs-agent/public ./apps/vs-agent/public
COPY apps/vs-agent/discovery.json ./apps/vs-agent/discovery.json

CMD ["node", "apps/vs-agent/build/src/main"]
