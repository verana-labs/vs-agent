FROM node:22-alpine as base

# Setup pnpm version
RUN corepack enable

# AFJ specifc setup
WORKDIR /www
ENV RUN_MODE="docker"

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.json tsconfig.build.json ./

COPY patches ./patches
COPY packages/model/package.json packages/model/package.json
COPY packages/client/package.json packages/client/package.json
COPY packages/agent-sdk/package.json packages/agent-sdk/package.json
COPY packages/plugin-mrtd/package.json packages/plugin-mrtd/package.json
COPY packages/nestjs-client/package.json packages/nestjs-client/package.json

COPY packages/model/src ./packages/model/src
COPY packages/client/src ./packages/client/src
COPY packages/agent-sdk/src ./packages/agent-sdk/src
COPY packages/plugin-mrtd/src ./packages/plugin-mrtd/src
COPY packages/nestjs-client/src ./packages/nestjs-client/src

COPY packages/model/tsconfig.json packages/model/tsconfig.json
COPY packages/model/tsconfig.build.json packages/model/tsconfig.build.json
COPY packages/client/tsconfig.json packages/client/tsconfig.json
COPY packages/client/tsconfig.build.json packages/client/tsconfig.build.json
COPY packages/agent-sdk/tsconfig.json packages/agent-sdk/tsconfig.json
COPY packages/agent-sdk/tsconfig.build.json packages/agent-sdk/tsconfig.build.json
COPY packages/plugin-mrtd/tsconfig.json packages/plugin-mrtd/tsconfig.json
COPY packages/plugin-mrtd/tsconfig.build.json packages/plugin-mrtd/tsconfig.build.json
COPY packages/nestjs-client/tsconfig.json packages/nestjs-client/tsconfig.json
COPY packages/nestjs-client/tsconfig.build.json packages/nestjs-client/tsconfig.build.json

COPY examples/nestjs-vs/ examples/nestjs-vs/

RUN pnpm install
RUN pnpm --filter @verana-labs/vs-agent-model build && \
    pnpm --filter @verana-labs/vs-agent-client build && \
    pnpm --filter @verana-labs/vs-agent-sdk build && \
    pnpm --filter @verana-labs/vs-agent-plugin-mrtd build && \
    pnpm --filter @verana-labs/vs-agent-nestjs-client build && \
    pnpm --filter nestjs-vs build

FROM base as final

# AFJ specifc setup
WORKDIR /www
ENV RUN_MODE="docker"

# Run install after copying only depdendency file
# to make use of docker layer caching
COPY --from=base /www/packages ./packages
COPY --from=base /www/examples ./examples

WORKDIR /www/examples/nestjs-vs/build
CMD ["node", "main.js"]
