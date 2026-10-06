/** Server-side Upstash connection using the Vercel integration's environment variables. */
export async function redisCommand<T>(command: readonly (string | number)[]): Promise<T> {
  if (typeof window !== "undefined") {
    throw new Error("Redis is only available on the server.");
  }

  const url = process.env.KV_REST_API_URL?.trim();
  const token = process.env.KV_REST_API_TOKEN?.trim();
  if (!url || !token) {
    throw new Error("Set KV_REST_API_URL and KV_REST_API_TOKEN to connect Upstash Redis.");
  }

  let endpoint: URL;
  try {
    endpoint = new URL(url);
  } catch {
    throw new Error("KV_REST_API_URL must be a valid HTTPS URL.");
  }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) {
    throw new Error("KV_REST_API_URL must be an HTTPS URL without embedded credentials.");
  }

  // A redirected request must never forward the authorization token elsewhere.
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Upstash Redis request failed (HTTP ${response.status}).`);
  }

  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("result" in body) || "error" in body) {
    // Do not include response bodies: they can echo credentials or stored values.
    throw new Error("Upstash Redis returned an invalid or unsuccessful command response.");
  }
  return body.result as T;
}
