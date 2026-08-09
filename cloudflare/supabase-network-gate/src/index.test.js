import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import worker, { parseIpv4, policyMatches } from "./index.js";

const originalFetch = globalThis.fetch;
const env = {
  NETWORK_GATE_TOKEN: "test-gate-token-with-at-least-32-characters",
  SUPABASE_MANAGEMENT_TOKEN: "test-management-token",
  SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function gateRequest(path, { token = env.NETWORK_GATE_TOKEN, ip = "8.8.8.8" } = {}) {
  return new Request(`https://gate.example${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "cf-connecting-ip": ip,
    },
  });
}

test("rejects an invalid bearer token before contacting Supabase", async () => {
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("unexpected request");
  };
  const response = await worker.fetch(gateRequest("/v1/open", { token: "wrong" }), env);
  assert.equal(response.status, 401);
  assert.equal(fetchCalls, 0);
});

test("opens access only for the Cloudflare-observed runner IPv4", async () => {
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (init.method === "POST") {
      return Response.json({ status: "stored" }, { status: 201 });
    }
    if (requests.length === 1) {
      return Response.json({ entitlement: "allowed", config: {}, status: "applied" });
    }
    return Response.json({
      entitlement: "allowed",
      config: { dbAllowedCidrs: ["8.8.8.8/32"], dbAllowedCidrsV6: [] },
      status: "applied",
    });
  };

  const response = await worker.fetch(gateRequest("/v1/open"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, state: "open", runnerCidr: "8.8.8.8/32" });
  const applyRequest = requests.find(({ init }) => init.method === "POST");
  assert.deepEqual(JSON.parse(applyRequest.init.body), {
    dbAllowedCidrs: ["8.8.8.8/32"],
    dbAllowedCidrsV6: [],
  });
  assert.equal(applyRequest.init.headers.authorization, "Bearer test-management-token");
});

test("close applies an empty IPv4 and IPv6 allowlist", async () => {
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (init.method === "POST") {
      return Response.json({ status: "stored" }, { status: 201 });
    }
    return Response.json({
      config: { dbAllowedCidrs: [], dbAllowedCidrsV6: [] },
      status: "applied",
    });
  };

  const response = await worker.fetch(gateRequest("/v1/close"), env);
  assert.equal(response.status, 200);
  const applyRequest = requests.find(({ init }) => init.method === "POST");
  assert.deepEqual(JSON.parse(applyRequest.init.body), {
    dbAllowedCidrs: [],
    dbAllowedCidrsV6: [],
  });
});

test("rejects a non-public or malformed source address", () => {
  assert.equal(parseIpv4("10.0.0.1"), null);
  assert.equal(parseIpv4("169.254.1.1"), null);
  assert.equal(parseIpv4("2001:db8::1"), null);
  assert.equal(parseIpv4("8.8.4.4"), "8.8.4.4");
});

test("policy comparison requires an applied exact match", () => {
  assert.equal(
    policyMatches(
      { config: { dbAllowedCidrs: ["8.8.8.8/32"], dbAllowedCidrsV6: [] }, status: "applied" },
      ["8.8.8.8/32"],
      [],
    ),
    true,
  );
  assert.equal(
    policyMatches(
      { config: { dbAllowedCidrs: ["0.0.0.0/0"], dbAllowedCidrsV6: [] }, status: "applied" },
      ["8.8.8.8/32"],
      [],
    ),
    false,
  );
});
