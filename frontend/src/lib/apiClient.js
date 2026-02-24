const DEFAULT_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";

function normalizeBaseUrl(value) {
  if (!value) return DEFAULT_BASE_URL;
  return value.replace(/\/$/, "");
}

export function getBaseUrl() {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("mister-logo-base-url");
    if (stored) return normalizeBaseUrl(stored);
  }
  return normalizeBaseUrl(DEFAULT_BASE_URL);
}

export function setBaseUrl(value) {
  if (typeof window === "undefined") return;
  localStorage.setItem("mister-logo-base-url", normalizeBaseUrl(value));
}

export async function apiRequest({
  path,
  method = "POST",
  body,
  token,
  headers = {},
  baseUrl,
}) {
  let url = `${baseUrl || getBaseUrl()}${path}`;
  const init = { method, headers: { ...headers } };
  if (/ngrok-free\.(app|dev)/i.test(url)) {
    init.headers["ngrok-skip-browser-warning"] = "true";
    url += (url.includes("?") ? "&" : "?") + "ngrok-skip-browser-warning=true";
  }
  if (token) init.headers.Authorization = `Bearer ${token}`;

  if (body instanceof FormData) {
    init.body = body;
  } else if (method !== "GET") {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body ?? {});
  }

  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
