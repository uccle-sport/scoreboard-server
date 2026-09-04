import { describe, expect, it } from "bun:test";
import { buildFlowrHeaders } from "./socket.js";

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
