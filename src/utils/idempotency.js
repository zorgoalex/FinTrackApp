function normalizeForStableJson(value) {
  if (Array.isArray(value)) return value.map(normalizeForStableJson);
  if (!value || typeof value !== 'object') return value;

  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = normalizeForStableJson(value[key]);
      return result;
    }, {});
}

export function stableRequestKey(kind, payload) {
  return `${kind}:${JSON.stringify(normalizeForStableJson(payload))}`;
}

export function createIdempotencyTracker(randomUUID = () => globalThis.crypto.randomUUID()) {
  const pending = new Map();

  return {
    acquire(kind, payload) {
      const key = stableRequestKey(kind, payload);
      let requestId = pending.get(key);
      if (!requestId) {
        requestId = randomUUID();
        pending.set(key, requestId);
      }
      return { key, requestId };
    },
    complete(key) {
      pending.delete(key);
    },
    clear() {
      pending.clear();
    },
  };
}
