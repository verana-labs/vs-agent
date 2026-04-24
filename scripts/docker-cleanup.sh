#!/bin/sh
# Remove build-time dependencies not needed at runtime
rm -rf \
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
    node_modules/@eslint \
    node_modules/react \
    node_modules/react-dom \
    node_modules/react-is \
    node_modules/@vitejs
