// Runs for every /api/* request. Cloudflare Pages' _headers file only covers
// static files, so the API's own headers are set here:
//  - no-store: responses carry a class's events and are never worth caching
//    (the request body holds a passcode, so a cache key mustn't hold on to it
//    either);
//  - nosniff and noindex, as for the page itself (see ../../_headers).
//
// It also turns anything an endpoint throws (e.g. an unparseable
// CLASS_PASSWORDS secret) into a plain JSON 500 that goes through the same
// header step, rather than Cloudflare's own error page. The detail is logged.
const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};

export async function onRequest({ next }) {
  let response;
  try {
    response = await next();
  } catch (err) {
    console.error("Unhandled error in /api:", err);
    response = new Response(
      JSON.stringify({ error: "server_error", message: "Something went wrong - please try again in a moment." }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
  const withHeaders = new Response(response.body, response);
  for (const [name, value] of Object.entries(HEADERS)) withHeaders.headers.set(name, value);
  return withHeaders;
}
