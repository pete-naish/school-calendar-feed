// The Workers-runtime side of the API's types, kept out of types.ts so the
// tool's page can import that without the Workers globals.

// The Pages project's secrets, KV and R2 bindings (see tool/README.md). The
// bindings are all optional: without RATE_LIMITS the passcode check fails open,
// and without STATS subscribe clicks and rep usage aren't counted.
export interface Env {
  CLASS_PASSWORDS: string;
  ANTHROPIC_API_KEY: string;
  GITHUB_TOKEN: string;
  RATE_LIMITS?: KVNamespace;
  STATS?: KVNamespace;
  // Event posters (see posters.ts). Without it the tool doesn't offer them.
  POSTERS?: R2Bucket;
}

// The part of a Pages Functions context the endpoints use (the tests pass
// just request and env).
export interface ApiContext {
  request: Request;
  env: Env;
  waitUntil?: (promise: Promise<unknown>) => void;
}
