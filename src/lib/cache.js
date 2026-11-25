const store = new Map();

/** In-memory TTL cache for a single serverless instance. Cuts repeat Mongo work. */
export async function cached(key, ttlMs, loader) {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value;

  if (hit?.pending) return hit.pending;

  const pending = Promise.resolve()
    .then(loader)
    .then((value) => {
      store.set(key, { value, expires: Date.now() + Math.max(1000, ttlMs) });
      return value;
    })
    .catch((error) => {
      store.delete(key);
      throw error;
    });

  store.set(key, { value: hit?.value, expires: 0, pending });
  return pending;
}

export function invalidate(...keys) {
  for (const key of keys) store.delete(key);
}

export function invalidatePrefix(prefix) {
  for (const key of store.keys()) {
    if (key === prefix || key.startsWith(prefix)) store.delete(key);
  }
}

export function invalidateCatalog() {
  invalidatePrefix("products:");
  invalidatePrefix("categories:");
  invalidatePrefix("colors:");
  invalidatePrefix("sizes:");
  invalidate("soldUnits");
  invalidatePrefix("analytics:");
}

export function invalidateStorefront() {
  invalidateCatalog();
  invalidatePrefix("announcements:");
  invalidate("store:settings");
  invalidatePrefix("policy:");
}
