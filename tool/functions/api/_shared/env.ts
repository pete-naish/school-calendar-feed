// The Workers-runtime side of the API's types, kept out of types.ts so the
// tool's page can import that without the Workers globals.

// The Pages project's secrets and KV bindings (see tool/README.md). Both KV
// bindings are optional: without RATE_LIMITS the passcode check fails open,
// and without STATS subscribe clicks aren't counted.
export interface Env {
  CLASS_PASSWORDS: string;
  ANTHROPIC_API_KEY: string;
  GITHUB_TOKEN: string;
  RATE_LIMITS?: KVNamespace;
  STATS?: KVNamespace;
}

// The part of a Pages Functions context the endpoints use (the tests pass
// just this).
export interface ApiContext {
  request: Request;
  env: Env;
}
