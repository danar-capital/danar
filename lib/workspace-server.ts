import { getRawDb } from "../db";

const COOKIE_NAME = "interview_team_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;

export type WorkspaceSession = {
  id: string;
  stateJson: string;
  revision: number;
  updatedAt: string;
};

export function secureHeaders(extra?: HeadersInit) {
  const headers = new Headers(extra);
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  return headers;
}

export function secureJson(body: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(body, { status, headers: secureHeaders(headers) });
}

export function sameOriginJsonMutation(request: Request) {
  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim();
  return (
    origin === expectedOrigin &&
    (!fetchSite || fetchSite === "same-origin") &&
    contentType === "application/json"
  );
}

export async function readSmallJson(request: Request, maxBytes = 32_000) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw new Error("REQUEST_TOO_LARGE");
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("INVALID_JSON");
  }
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function randomUrlSafe(bytesLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(bytesLength));
  return bytesToBase64Url(bytes);
}

export function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function getCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

export function oauthCompatibleSessionCookie(request: Request) {
  const token = getCookie(request, COOKIE_NAME);
  if (!/^[a-f0-9]{64}$/.test(token)) return "";
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`;
}

export async function workspaceForRequest(request: Request) {
  const token = getCookie(request, COOKIE_NAME);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = await sha256Hex(`interview-session:v1:${token}`);
  const row = await getRawDb()
    .prepare(
      `SELECT w.id, w.state_json, w.revision, w.updated_at
       FROM scheduler_sessions AS s
       INNER JOIN scheduler_workspaces AS w ON w.id = s.workspace_id
       WHERE s.token_hash = ? AND s.expires_at > ?
       LIMIT 1`,
    )
    .bind(tokenHash, Math.floor(Date.now() / 1000))
    .first<{
      id: string;
      state_json: string;
      revision: number;
      updated_at: string;
    }>();
  return row
    ? {
        id: row.id,
        stateJson: row.state_json,
        revision: row.revision,
        updatedAt: row.updated_at,
      }
    : null;
}
