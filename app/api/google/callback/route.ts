import { getRawDb } from "../../../../db";
import {
  encryptSecret,
  exchangeAuthorizationCode,
  googleAccountEmail,
  googleConfigured,
} from "../../../../lib/google-calendar";
import {
  secureHeaders,
  sha256Hex,
  workspaceForRequest,
} from "../../../../lib/workspace-server";

export const dynamic = "force-dynamic";

function backToApp(request: Request, result: string) {
  const url = new URL("/", request.url);
  url.searchParams.set("google", result);
  return new Response(null, {
    status: 302,
    headers: secureHeaders({ Location: url.toString() }),
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    if (!googleConfigured()) return backToApp(request, "not-configured");
    const workspace = await workspaceForRequest(request);
    if (!workspace) return backToApp(request, "session-expired");
    const state = url.searchParams.get("state") || "";
    const code = url.searchParams.get("code") || "";
    if (!state || !code || url.searchParams.has("error")) {
      return backToApp(request, "cancelled");
    }
    const stateHash = await sha256Hex(`google-oauth-state:v1:${state}`);
    const oauthState = await getRawDb()
      .prepare(
        `SELECT workspace_id, interviewer_id, login_hint, code_verifier, expires_at
         FROM scheduler_google_oauth_states
         WHERE state_hash = ?
         LIMIT 1`,
      )
      .bind(stateHash)
      .first<{
        workspace_id: string;
        interviewer_id: string;
        login_hint: string;
        code_verifier: string;
        expires_at: number;
      }>();
    await getRawDb()
      .prepare("DELETE FROM scheduler_google_oauth_states WHERE state_hash = ?")
      .bind(stateHash)
      .run();
    if (
      !oauthState ||
      oauthState.workspace_id !== workspace.id ||
      oauthState.expires_at <= Math.floor(Date.now() / 1000)
    ) {
      return backToApp(request, "invalid-state");
    }

    const tokens = await exchangeAuthorizationCode({
      request,
      code,
      codeVerifier: oauthState.code_verifier,
    });
    const googleEmail = await googleAccountEmail(tokens.access_token);
    if (oauthState.login_hint && googleEmail !== oauthState.login_hint.toLowerCase()) {
      return backToApp(request, "wrong-account");
    }
    const duplicate = await getRawDb()
      .prepare(
        `SELECT interviewer_id
         FROM scheduler_google_connections
         WHERE workspace_id = ? AND google_email = ? AND interviewer_id != ?
         LIMIT 1`,
      )
      .bind(workspace.id, googleEmail, oauthState.interviewer_id)
      .first<{ interviewer_id: string }>();
    if (duplicate) return backToApp(request, "duplicate-account");

    const encryptedAccess = await encryptSecret(tokens.access_token);
    const encryptedRefresh = tokens.refresh_token
      ? await encryptSecret(tokens.refresh_token)
      : null;
    const existing = await getRawDb()
      .prepare(
        `SELECT refresh_token_cipher, refresh_token_iv
         FROM scheduler_google_connections
         WHERE workspace_id = ? AND interviewer_id = ?
         LIMIT 1`,
      )
      .bind(workspace.id, oauthState.interviewer_id)
      .first<{ refresh_token_cipher: string | null; refresh_token_iv: string | null }>();
    const expiresAt =
      Math.floor(Date.now() / 1000) + Math.max(60, Number(tokens.expires_in) || 3600);
    await getRawDb()
      .prepare(
        `INSERT INTO scheduler_google_connections
         (workspace_id, interviewer_id, google_email, access_token_cipher, access_token_iv,
          refresh_token_cipher, refresh_token_iv, expires_at, scope, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(workspace_id, interviewer_id) DO UPDATE SET
           google_email = excluded.google_email,
           access_token_cipher = excluded.access_token_cipher,
           access_token_iv = excluded.access_token_iv,
           refresh_token_cipher = excluded.refresh_token_cipher,
           refresh_token_iv = excluded.refresh_token_iv,
           expires_at = excluded.expires_at,
           scope = excluded.scope,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .bind(
        workspace.id,
        oauthState.interviewer_id,
        googleEmail,
        encryptedAccess.cipher,
        encryptedAccess.iv,
        encryptedRefresh?.cipher || existing?.refresh_token_cipher || null,
        encryptedRefresh?.iv || existing?.refresh_token_iv || null,
        expiresAt,
        tokens.scope || "",
      )
      .run();
    return backToApp(request, "connected");
  } catch (error) {
    console.error("Google OAuth callback failed", error instanceof Error ? error.message : "unknown");
    return backToApp(request, "error");
  }
}
