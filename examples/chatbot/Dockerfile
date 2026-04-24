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
COPY packages/agent-sdk/package.json packages/agent-sdk/package.json
COPY packages/plugin-mrtd/package.json packages/plugin-mrtd/package.json
COPY examples/chatbot/package.json examples/chatbot/package.json

RUN pnpm install --frozen-lockfile

COPY packages/model/src ./packages/model/src
COPY packages/model/tsconfig.json packages/model/tsconfig.json
COPY packages/model/tsconfig.build.json packages/model/tsconfig.build.json

COPY packages/client/src ./packages/client/src
COPY packages/client/tsconfig.json packages/client/tsconfig.json
COPY packages/client/tsconfig.build.json packages/client/tsconfig.build.json

COPY packages/agent-sdk/src ./packages/agent-sdk/src
COPY packages/agent-sdk/tsconfig.json packages/agent-sdk/tsconfig.json
COPY packages/agent-sdk/tsconfig.build.json packages/agent-sdk/tsconfig.build.json

COPY packages/plugin-mrtd/src ./packages/plugin-mrtd/src
COPY packages/plugin-mrtd/tsconfig.json packages/plugin-mrtd/tsconfig.json
COPY packages/plugin-mrtd/tsconfig.build.json packages/plugin-mrtd/tsconfig.build.json

COPY examples/chatbot/tsconfig.json examples/chatbot/tsconfig.json
COPY examples/chatbot/data.ts examples/chatbot/data.ts
COPY examples/chatbot/index.ts examples/chatbot/index.ts

RUN pnpm --filter @verana-labs/vs-agent-model build && \
    pnpm --filter @verana-labs/vs-agent-client build && \
    pnpm --filter @verana-labs/vs-agent-sdk build && \
    pnpm --filter @verana-labs/vs-agent-plugin-mrtd build && \
    pnpm --filter demo-chatbot build

FROM node:22.19-alpine AS final

ENV COREPACK_INTEGRITY_KEYS=0

RUN corepack enable && \
    corepack prepare pnpm@9.15.3 --activate

WORKDIR /www
ENV RUN_MODE="docker"

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

COPY --from=build /www/packages/model/package.json ./packages/model/package.json
COPY --from=build /www/packages/model/build ./packages/model/build
COPY --from=build /www/packages/client/package.json ./packages/client/package.json
COPY --from=build /www/packages/client/build ./packages/client/build
COPY --from=build /www/packages/agent-sdk/package.json ./packages/agent-sdk/package.json
COPY --from=build /www/packages/agent-sdk/build ./packages/agent-sdk/build
COPY --from=build /www/packages/plugin-mrtd/package.json ./packages/plugin-mrtd/package.json
COPY --from=build /www/packages/plugin-mrtd/build ./packages/plugin-mrtd/build
COPY examples/chatbot/package.json ./examples/chatbot/package.json
COPY --from=build /www/examples/chatbot/build ./examples/chatbot/build
COPY examples/chatbot/public/ ./examples/chatbot/public/

RUN pnpm install --prod --frozen-lockfile

CMD ["node", "examples/chatbot/build/index.js"]
