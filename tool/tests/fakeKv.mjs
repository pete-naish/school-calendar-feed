// A minimal stand-in for a Cloudflare Workers KV namespace, matching the
// get/put/delete surface auth.js uses. In-memory only; expirationTtl is
// recorded but not enforced (nothing here needs time to actually pass) -
// FakeKV.expireAll() simulates every entry's TTL having elapsed. Not
// exported as a *.test.mjs file, so `node --test tool/tests/*.test.mjs`
// never tries to run it as a suite of its own.
export class FakeKV {
  #store = new Map();

  async get(key) {
    return this.#store.has(key) ? this.#store.get(key).value : null;
  }

  async put(key, value, options = {}) {
    this.#store.set(key, { value, expirationTtl: options.expirationTtl ?? null });
  }

  async delete(key) {
    this.#store.delete(key);
  }

  // Test-only introspection, not part of the real KV API.
  has(key) {
    return this.#store.has(key);
  }

  expireAll() {
    this.#store.clear();
  }
}
