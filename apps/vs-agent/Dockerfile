FROM node:22 AS base

# Setup pnpm version
RUN corepack enable

# AFJ specifc setup
WORKDIR /www
ENV RUN_MODE="docker"

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

COPY packages/model/package.json packages/model/package.json
COPY apps/vs-agent/package.json apps/vs-agent/package.json
COPY patches ./patches

# Run install after copying only depdendency file
# to make use of docker layer caching
RUN pnpm install

# Copy other depdencies
COPY packages/model/src ./packages/model/src
COPY apps/vs-agent/src ./apps/vs-agent/src

COPY tsconfig.json tsconfig.json
COPY tsconfig.build.json tsconfig.build.json
COPY apps/vs-agent/discovery.json apps/vs-agent/discovery.json

COPY packages/model/tsconfig.json packages/model/tsconfig.json
COPY packages/model/tsconfig.build.json packages/model/tsconfig.build.json

COPY apps/vs-agent/tsconfig.json apps/vs-agent/tsconfig.json
COPY apps/vs-agent/tsconfig.build.json apps/vs-agent/tsconfig.build.json
COPY apps/vs-agent/nest-cli.json apps/vs-agent/nest-cli.json


RUN pnpm build
CMD ["pnpm", "--filter", "@verana-labs/vs-agent", "start:prod"]
