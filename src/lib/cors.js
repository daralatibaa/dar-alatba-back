const DEFAULT_ORIGINS = [
  "https://www.daralatba.com",
  "https://daralatba.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

function allowedOrigins() {
  const fromEnv = String(process.env.CORS_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ORIGINS, ...fromEnv]);
}

function originAllowed(origin) {
  if (!origin) return false;
  if (allowedOrigins().has(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    return host.endsWith(".vercel.app") && host.includes("dar-alatba");
  } catch {
    return false;
  }
}

export function corsHeaders(request) {
  const origin = String(request?.headers?.get?.("origin") || "");
  const allow = originAllowed(origin) ? origin : "https://www.daralatba.com";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function withCors(response, request) {
  const headers = corsHeaders(request);
  const next = new Headers(response.headers);
  Object.entries(headers).forEach(([key, value]) => next.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: next,
  });
}
