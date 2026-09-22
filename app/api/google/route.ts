import { getRawDb } from "../../../db";
import {
  authorizationUrl,
  googleConfigured,
  pkceChallenge,
} from "../../../lib/google-calendar";
import {
  randomUrlSafe,
  readSmallJson,
  oauthCompatibleSessionCookie,
  sameOriginJsonMutation,
  secureJson,
  sha256Hex,
  workspaceForRequest,
} from "../../../lib/workspace-server";

export const dynamic = "force-dynamic";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,300}$/;

export async function GET(request: Request) {
  try {
    const workspace = await workspaceForRequest(request);
    if (!workspace) return secureJson({ error: "locked" }, 401);
    const connections = await getRawDb()
      .prepare(
        `SELECT interviewer_id, google_email, created_at, updated_at
         FROM scheduler_google_connections
         WHERE workspace_id = ?
         ORDER BY created_at ASC`,
      )
      .bind(workspace.id)
      .all<{
        interviewer_id: string;
        google_email: string;
        created_at: string;
        updated_at: string;
      }>();
    return secureJson({
      configured: googleConfigured(),
      connections: (connections.results || []).map((connection) => ({
        interviewerId: connection.interviewer_id,
        email: connection.google_email,
        connectedAt: connection.created_at,
        updatedAt: connection.updated_at,
      })),
    });
  } catch (error) {
    console.error("Google connection status failed", error instanceof Error ? error.message : "unknown");
    return secureJson({ error: "تعذر تحميل حالة حسابات Google." }, 500);
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOriginJsonMutation(request)) {
      return secureJson({ error: "الطلب غير مسموح من هذا المصدر." }, 403);
    }
    const workspace = await workspaceForRequest(request);
    if (!workspace) return secureJson({ error: "locked" }, 401);
    if (!googleConfigured()) {
      return secureJson({ error: "إعداد Google غير مكتمل بعد." }, 503);
    }
    const body = await readSmallJson(request);
    const interviewerId = typeof body.interviewerId === "string" ? body.interviewerId : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!ID_PATTERN.test(interviewerId) || (email && !EMAIL_PATTERN.test(email))) {
      return secureJson({ error: "بيانات حساب Google غير صالحة." }, 400);
    }

    const parsedState = JSON.parse(workspace.stateJson) as { interviewers?: Array<{ id?: string }> };
    if (!parsedState.interviewers?.some((interviewer) => interviewer.id === interviewerId)) {
      return secureJson({ error: "الموظف غير موجود في مساحة الفريق." }, 404);
    }

    const state = randomUrlSafe(32);
    const stateHash = await sha256Hex(`google-oauth-state:v1:${state}`);
    const codeVerifier = randomUrlSafe(64);
    const expiresAt = Math.floor(Date.now() / 1000) + 10 * 60;
    await getRawDb().batch([
      getRawDb()
        .prepare("DELETE FROM scheduler_google_oauth_states WHERE expires_at <= ?")
        .bind(Math.floor(Date.now() / 1000)),
      getRawDb()
        .prepare(
          `INSERT INTO scheduler_google_oauth_states
           (state_hash, workspace_id, interviewer_id, login_hint, code_verifier, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        )
        .bind(stateHash, workspace.id, interviewerId, email, codeVerifier, expiresAt),
    ]);
    const refreshedSessionCookie = oauthCompatibleSessionCookie(request);
    return secureJson(
      {
        authUrl: authorizationUrl({
          request,
          state,
          codeChallenge: await pkceChallenge(codeVerifier),
          loginHint: email,
        }),
      },
      200,
      refreshedSessionCookie ? { "Set-Cookie": refreshedSessionCookie } : undefined,
    );
  } catch (error) {
    console.error("Google connection start failed", error instanceof Error ? error.message : "unknown");
    return secureJson({ error: "تعذر بدء ربط Google. حاول مرة أخرى." }, 500);
  }
}

export async function DELETE(request: Request) {
  try {
    if (!sameOriginJsonMutation(request)) {
      return secureJson({ error: "الطلب غير مسموح من هذا المصدر." }, 403);
    }
    const workspace = await workspaceForRequest(request);
    if (!workspace) return secureJson({ error: "locked" }, 401);
    const body = await readSmallJson(request);
    const interviewerId = typeof body.interviewerId === "string" ? body.interviewerId : "";
    if (!ID_PATTERN.test(interviewerId)) {
      return secureJson({ error: "الموظف غير صالح." }, 400);
    }
    await getRawDb().batch([
      getRawDb()
        .prepare(
          "DELETE FROM scheduler_google_meetings WHERE workspace_id = ? AND interviewer_id = ?",
        )
        .bind(workspace.id, interviewerId),
      getRawDb()
        .prepare(
          "DELETE FROM scheduler_google_connections WHERE workspace_id = ? AND interviewer_id = ?",
        )
        .bind(workspace.id, interviewerId),
    ]);
    return secureJson({ ok: true });
  } catch (error) {
    console.error("Google disconnect failed", error instanceof Error ? error.message : "unknown");
    return secureJson({ error: "تعذر فصل حساب Google." }, 500);
  }
}
