FROM node:22.19-alpine AS build

ENV COREPACK_INTEGRITY_KEYS=0

RUN apk add --no-cache python3 make g++ && \
    corepack enable && \
    corepack prepare pnpm@9.15.3 --activate

WORKDIR /www
ENV RUN_MODE="docker"

COPY patches ./patches
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.json tsconfig.build.json ./

COPY packages/model/package.json packages/model/package.json
COPY packages/client/package.json packages/client/package.json
COPY examples/verifier/package.json examples/verifier/package.json

RUN pnpm install --frozen-lockfile

COPY packages/model/src ./packages/model/src
COPY packages/model/tsconfig.json packages/model/tsconfig.json
COPY packages/model/tsconfig.build.json packages/model/tsconfig.build.json

COPY packages/client/src ./packages/client/src
COPY packages/client/tsconfig.json packages/client/tsconfig.json
COPY packages/client/tsconfig.build.json packages/client/tsconfig.build.json

COPY examples/verifier/tsconfig.json examples/verifier/tsconfig.json
COPY examples/verifier/index.ts examples/verifier/index.ts

RUN pnpm --filter @verana-labs/vs-agent-model build && \
    pnpm --filter @verana-labs/vs-agent-client build && \
    pnpm --filter demo-verifier build

FROM node:22.19-alpine AS final

WORKDIR /www
ENV RUN_MODE="docker"

COPY --from=build /www/node_modules ./node_modules
COPY --from=build /www/packages/model/node_modules ./packages/model/node_modules
COPY --from=build /www/packages/model/package.json ./packages/model/package.json
COPY --from=build /www/packages/model/build ./packages/model/build
COPY --from=build /www/packages/client/node_modules ./packages/client/node_modules
COPY --from=build /www/packages/client/package.json ./packages/client/package.json
COPY --from=build /www/packages/client/build ./packages/client/build
COPY --from=build /www/examples/verifier/node_modules ./examples/verifier/node_modules
COPY examples/verifier/package.json ./examples/verifier/package.json
COPY --from=build /www/examples/verifier/build ./examples/verifier/build

CMD ["node", "examples/verifier/build/index.js"]
