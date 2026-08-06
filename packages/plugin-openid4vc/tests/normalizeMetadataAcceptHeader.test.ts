import type { NextFunction, Request, Response } from "express";

import { describe, expect, it, vi } from "vitest";

import { normalizeMetadataAcceptHeader } from "../src/sdk/setupOpenId4Vc";

const run = (accept: string | undefined, overrides: Partial<Request> = {}) => {
  const request = {
    method: "GET",
    path: "/oid4vci/demo-did/.well-known/openid-credential-issuer",
    headers: accept === undefined ? {} : { accept },
    ...overrides,
  } as unknown as Request;
  const next = vi.fn() as unknown as NextFunction;
  normalizeMetadataAcceptHeader(request, {} as Response, next);
  return { accept: request.headers.accept, next };
};

describe("normalizeMetadataAcceptHeader", () => {
  it("serves JSON to a client naming both formats with a semicolon, the openid4vci-kt shape", () => {
    const { accept, next } = run("application/jwt; application/json");

    expect(accept).toBe("application/json");
    expect(next).toHaveBeenCalledOnce();
  });

  it("normalizes the root well-known path form too", () => {
    const { accept } = run("application/jwt; application/json", {
      path: "/.well-known/openid-credential-issuer/oid4vci/demo-did",
    });

    expect(accept).toBe("application/json");
  });

  it("normalizes the comma form as well, since either format satisfies it", () => {
    const { accept } = run("application/jwt, application/json");

    expect(accept).toBe("application/json");
  });

  it("leaves a client that asks for the JWT alone untouched", () => {
    const { accept } = run("application/jwt");

    expect(accept).toBe("application/jwt");
  });

  it("leaves other paths and absent headers untouched", () => {
    const other = run("application/jwt; application/json", {
      path: "/oid4vci/demo-did/credential",
    });
    const absent = run(undefined);

    expect(other.accept).toBe("application/jwt; application/json");
    expect(absent.accept).toBeUndefined();
  });
});
