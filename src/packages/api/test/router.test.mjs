import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Deliberately the built bundle rather than the TypeScript sources. This is the
// artifact Terraform zips and Lambda runs, so testing anything else would leave
// the one thing that actually ships untested — and the bundler is a real part
// of the build, with real ways to go wrong.
import { handler, route } from "../dist/index.mjs";

const BUNDLE = new URL("../dist/index.mjs", import.meta.url);

/** A payload-format-2.0 request, with only the fields the handler reads. */
function request(routeKey, claims) {
  return {
    version: "2.0",
    routeKey,
    requestContext: {
      requestId: "test",
      http: { method: routeKey.split(" ")[0], path: routeKey.split(" ")[1] },
      ...(claims ? { authorizer: { jwt: { claims } } } : {}),
    },
  };
}

const body = (result) => JSON.parse(result.body);

test("health answers without a token", () => {
  const result = route(request("GET /v1/health"), Date.parse("2026-09-05T12:00:00Z"));
  assert.equal(result.statusCode, 200);
  assert.equal(body(result).status, "ok");
  assert.equal(body(result).time, "2026-09-05T12:00:00.000Z");
});

test("health names the environment it is running in", () => {
  // The point of the route: a 200 from the wrong account looks identical to a
  // 200 from the right one unless it says which it is.
  process.env.CALDER_ENVIRONMENT = "dev";
  try {
    assert.equal(body(route(request("GET /v1/health"))).environment, "dev");
  } finally {
    delete process.env.CALDER_ENVIRONMENT;
  }
  assert.equal(body(route(request("GET /v1/health"))).environment, "unknown");
});

test("health is never cached", () => {
  // A health check answered from a cache reports when the service was last up.
  const result = route(request("GET /v1/health"));
  assert.equal(result.headers["cache-control"], "no-store");
});

test("me returns the verified subject", () => {
  const result = route(request("GET /v1/me", { sub: "abc-123", token_use: "access" }));
  assert.equal(result.statusCode, 200);
  assert.deepEqual(body(result), { sub: "abc-123", userId: null, tokenUse: "access" });
});

test("me reports the ULID claim once something injects it", () => {
  const claims = { sub: "abc-123", "custom:uid": "01K4ABCDEFGHJKMNPQRSTVWXYZ" };
  assert.equal(body(route(request("GET /v1/me", claims))).userId, "01K4ABCDEFGHJKMNPQRSTVWXYZ");
});

test("me distinguishes a detached authoriser from a missing token", () => {
  // API Gateway answers 401 itself while the authoriser is attached, so the
  // handler only ever sees this when the route has lost it. A bare 401 would be
  // indistinguishable from the ordinary case and would hide a misconfiguration
  // that silently opens the route.
  const result = route(request("GET /v1/me"));
  assert.equal(result.statusCode, 401);
  assert.match(body(result).detail, /authoriser/);
});

test("a non-string claim is dropped rather than coerced", () => {
  // exp and iat are numbers. Nothing read here is, so anything non-string is a
  // surprise, and String(surprise) is how a "0" ends up being treated as an id.
  const result = route(request("GET /v1/me", { sub: 12345 }));
  assert.equal(result.statusCode, 401);
});

test("an unrouted key is a 404 that says what it was", () => {
  const result = route(request("GET /v1/nothing"));
  assert.equal(result.statusCode, 404);
  assert.equal(body(result).routeKey, "GET /v1/nothing");
});

test("a payload that is not format 2.0 is a 404 that says so", () => {
  // Format 1.0 has no routeKey. Without this the handler would answer 404 to
  // every request in production and look like a routing mistake.
  const result = route({ version: "1.0", requestContext: {} });
  assert.equal(result.statusCode, 404);
  assert.equal(body(result).routeKey, null);
});

test("the exported handler is async and returns the same result", async () => {
  const result = await handler(request("GET /v1/health"));
  assert.equal(result.statusCode, 200);
});

test("the bundle carries its dependencies rather than importing them", () => {
  // esbuild marking a workspace package external produces a bundle that imports
  // @calder/core at runtime, where node_modules does not exist. It runs
  // perfectly in every test and fails on the first invocation in AWS.
  const source = readFileSync(BUNDLE, "utf8");
  assert.doesNotMatch(source, /from\s*["']@calder\/core["']/);
  assert.doesNotMatch(source, /require\(["']@calder\/core["']\)/);
  assert.match(source, /export\s*\{/, "the bundle should be ESM with named exports");
});
