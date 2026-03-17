FROM node:22.19 AS build

ENV COREPACK_INTEGRITY_KEYS=0

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/* && \
    corepack enable && \
    corepack prepare pnpm@9.15.3 --activate

WORKDIR /www
ENV RUN_MODE="docker"

COPY patches ./patches
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.json tsconfig.build.json ./

COPY packages/model/package.json packages/model/package.json
COPY apps/vs-agent/package.json apps/vs-agent/package.json

RUN pnpm install --frozen-lockfile

COPY packages/model/src ./packages/model/src
COPY packages/model/tsconfig.json packages/model/tsconfig.json
COPY packages/model/tsconfig.build.json packages/model/tsconfig.build.json

COPY apps/vs-agent/src ./apps/vs-agent/src
COPY apps/vs-agent/discovery.json apps/vs-agent/discovery.json
COPY apps/vs-agent/tsconfig.json apps/vs-agent/tsconfig.json
COPY apps/vs-agent/tsconfig.build.json apps/vs-agent/tsconfig.build.json
COPY apps/vs-agent/nest-cli.json apps/vs-agent/nest-cli.json

RUN pnpm --filter @verana-labs/vs-agent-model build && \
    pnpm --filter @verana-labs/vs-agent build

RUN rm -rf \
    node_modules/@types \
    node_modules/@typescript-eslint \
    node_modules/@vitest \
    node_modules/eslint \
    node_modules/eslint-config-prettier \
    node_modules/eslint-import-resolver-typescript \
    node_modules/eslint-plugin-import \
    node_modules/eslint-plugin-prettier \
    node_modules/prettier \
    node_modules/rimraf \
    node_modules/supertest \
    node_modules/ts-node \
    node_modules/ts-node-dev \
    node_modules/tsconfig-paths \
    node_modules/typescript \
    node_modules/vitest \
    node_modules/@nestjs/cli \
    node_modules/@nestjs/schematics \
    node_modules/@nestjs/testing \
    node_modules/postinstall-postinstall \
    node_modules/@angular-devkit \
    node_modules/typeorm \
    node_modules/webpack \
    node_modules/fork-ts-checker-webpack-plugin \
    node_modules/terser-webpack-plugin \
    node_modules/caniuse-lite \
    node_modules/lightningcss \
    node_modules/lightningcss-linux-x64-musl \
    node_modules/lightningcss-linux-x64-gnu \
    node_modules/@unrs \
    node_modules/@rollup \
    node_modules/@babel \
    node_modules/vite \
    node_modules/@esbuild \
    node_modules/esbuild \
    node_modules/rollup \
    node_modules/terser \
    node_modules/@eslint

FROM node:22.19-slim AS final

WORKDIR /www
ENV RUN_MODE="docker"

COPY --from=build /www/node_modules ./node_modules
COPY --from=build /www/packages/model/package.json ./packages/model/package.json
COPY --from=build /www/packages/model/build ./packages/model/build
COPY --from=build /www/apps/vs-agent/node_modules ./apps/vs-agent/node_modules
COPY apps/vs-agent/package.json ./apps/vs-agent/package.json
COPY --from=build /www/apps/vs-agent/build ./apps/vs-agent/build
COPY apps/vs-agent/discovery.json ./apps/vs-agent/discovery.json

CMD ["node", "apps/vs-agent/build/src/main"]
