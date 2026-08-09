const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function assertEnvironment(env) {
  for (const name of ["NETWORK_GATE_TOKEN", "SUPABASE_MANAGEMENT_TOKEN", "SUPABASE_PROJECT_REF"]) {
    if (typeof env[name] !== "string" || env[name].length < 1) {
      throw new Error(`missing Worker configuration: ${name}`);
    }
  }
  if (env.NETWORK_GATE_TOKEN.length < 32) {
    throw new Error("NETWORK_GATE_TOKEN must contain at least 32 characters");
  }
  if (!/^[a-z]{20}$/.test(env.SUPABASE_PROJECT_REF)) {
    throw new Error("SUPABASE_PROJECT_REF has an invalid format");
  }
}

async function constantTimeEqual(left, right) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

async function isAuthorised(request, expectedToken) {
  const authorization = request.headers.get("authorization") || "";
  const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return constantTimeEqual(suppliedToken, expectedToken);
}

function parseIpv4(value) {
  if (typeof value !== "string" || !/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    return null;
  }
  const octets = value.split(".").map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) {
    return null;
  }
  const [first, second] = octets;
  const isNonPublic =
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168);
  return isNonPublic ? null : octets.join(".");
}

function normaliseCidrs(cidrs) {
  return [...cidrs].map(String).sort();
}

function policyMatches(payload, expectedIpv4, expectedIpv6) {
  const actualIpv4 = normaliseCidrs(payload?.config?.dbAllowedCidrs || []);
  const actualIpv6 = normaliseCidrs(payload?.config?.dbAllowedCidrsV6 || []);
  const applied = payload?.status === "applied" || payload?.appliedSuccessfully === true;
  return (
    applied &&
    JSON.stringify(actualIpv4) === JSON.stringify(normaliseCidrs(expectedIpv4)) &&
    JSON.stringify(actualIpv6) === JSON.stringify(normaliseCidrs(expectedIpv6))
  );
}

function managementUrl(env, suffix = "") {
  return `https://api.supabase.com/v1/projects/${encodeURIComponent(env.SUPABASE_PROJECT_REF)}/network-restrictions${suffix}`;
}

async function managementRequest(env, method, suffix = "", body) {
  const response = await fetch(managementUrl(env, suffix), {
    method,
    headers: {
      authorization: `Bearer ${env.SUPABASE_MANAGEMENT_TOKEN}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Supabase Management API returned HTTP ${response.status}`);
  }
  return response.json();
}

async function waitForPolicy(env, ipv4, ipv6) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = await managementRequest(env, "GET");
    if (policyMatches(current, ipv4, ipv6)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Supabase did not confirm the expected network policy within 60 seconds");
}

async function applyPolicy(env, ipv4) {
  const ipv6 = [];
  await managementRequest(env, "POST", "/apply", {
    dbAllowedCidrs: ipv4,
    dbAllowedCidrsV6: ipv6,
  });
  await waitForPolicy(env, ipv4, ipv6);
}

async function handleRequest(request, env) {
  assertEnvironment(env);
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }
  if (!(await isAuthorised(request, env.NETWORK_GATE_TOKEN))) {
    return jsonResponse({ ok: false, error: "unauthorised" }, 401);
  }

  const path = new URL(request.url).pathname;
  if (path === "/v1/close") {
    await applyPolicy(env, []);
    return jsonResponse({ ok: true, state: "closed" });
  }
  if (path === "/v1/open") {
    const runnerIp = parseIpv4(request.headers.get("cf-connecting-ip"));
    if (!runnerIp) {
      return jsonResponse({ ok: false, error: "public_ipv4_required" }, 400);
    }
    const entitlement = await managementRequest(env, "GET");
    if (entitlement?.entitlement !== "allowed") {
      return jsonResponse({ ok: false, error: "network_restrictions_unavailable" }, 409);
    }
    const runnerCidr = `${runnerIp}/32`;
    await applyPolicy(env, [runnerCidr]);
    return jsonResponse({ ok: true, state: "open", runnerCidr });
  }
  return jsonResponse({ ok: false, error: "not_found" }, 404);
}

export { handleRequest, parseIpv4, policyMatches };

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error("network gate failure", error instanceof Error ? error.message : "unknown error");
      return jsonResponse({ ok: false, error: "upstream_failure" }, 502);
    }
  },
};
