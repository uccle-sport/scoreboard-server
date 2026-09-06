import { describe, expect, it } from "bun:test";
import { buildFlowrHeaders, httpError } from "./socket.js";

// Flowr answers `HTTP 400 Content type '…' not supported` for any body that is
// not sent as application/json, so the Content-Type must survive a config that
// supplies headers of its own.
describe("buildFlowrHeaders", () => {
  it("defaults the Content-Type when the config has no headers", () => {
    expect(buildFlowrHeaders(undefined, undefined)).toEqual({
      "Content-Type": "application/json",
    });
  });

  it("keeps the Content-Type when the config sets unrelated headers", () => {
    expect(buildFlowrHeaders({ Accept: "application/json" }, undefined)).toEqual({
      Accept: "application/json",
      "Content-Type": "application/json",
    });
  });

  it("lets the config override the Content-Type, in any casing", () => {
    expect(buildFlowrHeaders({ "content-type": "application/json; charset=UTF-8" }, undefined))
      .toEqual({ "content-type": "application/json; charset=UTF-8" });
  });

  it("injects the bearer alongside the default Content-Type", () => {
    expect(buildFlowrHeaders({ Accept: "*/*" }, "tok")).toEqual({
      Accept: "*/*",
      "Content-Type": "application/json",
      Authorization: "Bearer tok",
    });
  });

  it("does not overwrite an Authorization the config already carries", () => {
    expect(buildFlowrHeaders({ authorization: "Bearer own" }, "tok")).toEqual({
      authorization: "Bearer own",
      "Content-Type": "application/json",
    });
  });
});

// The status alone never says why Flowr rejected a request; its JSON body does.
describe("httpError", () => {
  it("carries the response body into the message", async () => {
    const res = new Response(
      '{"status":400,"message":"Searching on invisible fields is forbidden"}',
      { status: 400 }
    );
    expect((await httpError(res)).message).toBe(
      'HTTP 400: {"status":400,"message":"Searching on invisible fields is forbidden"}'
    );
  });

  it("falls back to the bare status when the body is empty", async () => {
    expect((await httpError(new Response("", { status: 503 }))).message).toBe(
      "HTTP 503"
    );
  });

  it("truncates a long body", async () => {
    const err = await httpError(new Response("x".repeat(900), { status: 500 }));
    expect(err.message.length).toBe("HTTP 500: ".length + 500);
  });

  it("still reports the status when the body cannot be read", async () => {
    const res = new Response("ignored", { status: 502 });
    await res.text(); // consume it, so the second read throws
    expect((await httpError(res)).message).toBe("HTTP 502");
  });
});
