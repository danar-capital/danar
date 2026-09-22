import { getRawDb } from "../../../db";

export const dynamic = "force-dynamic";

const COOKIE_NAME = "interview_team_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const MAX_REQUEST_BYTES = 1_900_000;
const CREATE_LIMIT_WINDOW_SECONDS = 60 * 60;
const CREATE_LIMIT_PER_WINDOW = 8;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CANDIDATE_STATUSES = new Set([
  "بانتظار الإرسال",
  "بانتظار التأكيد",
  "مؤكد",
  "طلب تغيير",
  "اعتذر",
  "لم يرد",
  "حضر",
  "لم يحضر",
  "مكتمل",
]);
const INTERVIEW_STATUSES = new Set(["لم تُجرَ بعد", "تمت المقابلة", "لم يحضر"]);
const WORK_PREFERENCES = new Set(["لم تُحدّد بعد", "يرغب بالعمل", "لا يرغب بالعمل"]);
const MEETING_SYNC_STATUSES = new Set([
  "not_created",
  "needs_update",
  "pending",
  "ready",
  "error",
]);

type WorkspaceRow = {
  id: string;
  state_json: string;
  revision: number;
  updated_at: string;
};

function securityHeaders(extra?: HeadersInit) {
  const headers = new Headers(extra);
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  return headers;
}

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(body, { status, headers: securityHeaders(headers) });
}

function normalizeCode(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s-]+/g, "");
}

function isValidCode(value: string) {
  return value.length === 20 && [...value].every((character) => CODE_ALPHABET.includes(character));
}

function generateCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const raw = Array.from(bytes, (byte) => CODE_ALPHABET[byte & 31]).join("");
  return raw.match(/.{1,4}/g)?.join("-") || raw;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function getCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function sessionCookie(request: Request, token: string, maxAge = SESSION_SECONDS) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

async function readJson(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_REQUEST_BYTES) throw new Error("REQUEST_TOO_LARGE");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
    throw new Error("REQUEST_TOO_LARGE");
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("INVALID_JSON");
  }
}

function isSameOriginMutation(request: Request, requireJson = false) {
  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin !== expectedOrigin || (fetchSite && fetchSite !== "same-origin")) return false;
  if (requireJson) {
    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim();
    if (contentType !== "application/json") return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isLimitedString(value: unknown, maxLength: number, allowEmpty = true) {
  return (
    typeof value === "string" &&
    value.length <= maxLength &&
    (allowEmpty || value.trim().length > 0)
  );
}

function isValidCandidate(value: unknown) {
  if (!isRecord(value)) return false;
  return (
    isLimitedString(value.id, 200, false) &&
    isLimitedString(value.name, 500, false) &&
    isLimitedString(value.phone, 100) &&
    isLimitedString(value.email, 500) &&
    isLimitedString(value.role, 500) &&
    isLimitedString(value.language, 100)
  );
}

function isValidScheduleRow(value: unknown) {
  if (!isValidCandidate(value) || !isRecord(value)) return false;
  return (
    isLimitedString(value.scheduleId, 300, false) &&
    (value.meetingId === undefined ||
      (typeof value.meetingId === "string" && /^\d{3,12}$/.test(value.meetingId))) &&
    typeof value.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
    typeof value.start === "string" &&
    /^\d{2}:\d{2}$/.test(value.start) &&
    typeof value.end === "string" &&
    /^\d{2}:\d{2}$/.test(value.end) &&
    isLimitedString(value.blockId, 300, false) &&
    isLimitedString(value.blockLabel, 200) &&
    isLimitedString(value.interviewerId, 300, false) &&
    isLimitedString(value.interviewer, 500, false) &&
    typeof value.status === "string" &&
    CANDIDATE_STATUSES.has(value.status) &&
    (value.interviewStatus === undefined ||
      (typeof value.interviewStatus === "string" && INTERVIEW_STATUSES.has(value.interviewStatus))) &&
    (value.workPreference === undefined ||
      (typeof value.workPreference === "string" && WORK_PREFERENCES.has(value.workPreference))) &&
    (value.googleEventId === undefined || isLimitedString(value.googleEventId, 500)) &&
    (value.meetLink === undefined || isLimitedString(value.meetLink, 2_000)) &&
    (value.calendarLink === undefined || isLimitedString(value.calendarLink, 2_000)) &&
    (value.meetingSyncStatus === undefined ||
      (typeof value.meetingSyncStatus === "string" &&
        MEETING_SYNC_STATUSES.has(value.meetingSyncStatus))) &&
    (value.meetingSyncError === undefined || isLimitedString(value.meetingSyncError, 1_000))
  );
}

function isValidInterviewer(value: unknown) {
  return (
    isRecord(value) &&
    isLimitedString(value.id, 300, false) &&
    isLimitedString(value.name, 500) &&
    isLimitedString(value.meetingLink, 2_000) &&
    (value.googleEmail === undefined || isLimitedString(value.googleEmail, 500))
  );
}

function isValidAvailability(value: unknown, interviewerIds: Set<string>) {
  if (!isRecord(value) || Object.keys(value).length > 500) return false;
  return Object.entries(value).every(([date, day]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isRecord(day)) return false;
    if (Object.keys(day).length > interviewerIds.size) return false;
    return Object.entries(day).every(([interviewerId, availability]) => {
      if (!interviewerIds.has(interviewerId) || !isRecord(availability)) return false;
      if (typeof availability.enabled !== "boolean" || !Array.isArray(availability.blocks)) {
        return false;
      }
      if (availability.blocks.length < 1 || availability.blocks.length > 24) return false;
      return availability.blocks.every(
        (block) =>
          isRecord(block) &&
          isLimitedString(block.id, 300, false) &&
          isLimitedString(block.label, 200) &&
          typeof block.start === "string" &&
          /^\d{2}:\d{2}$/.test(block.start) &&
          typeof block.end === "string" &&
          /^\d{2}:\d{2}$/.test(block.end),
      );
    });
  });
}

function isValidState(value: unknown) {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  if (!Array.isArray(value.candidates) || !Array.isArray(value.schedule)) return false;
  if (!Array.isArray(value.interviewers) || !isRecord(value.availabilityByDate)) return false;
  if (value.candidates.length > 20_000 || value.schedule.length > 20_000) return false;
  if (value.interviewers.length < 1 || value.interviewers.length > 200) return false;
  if (!value.candidates.every(isValidCandidate) || !value.schedule.every(isValidScheduleRow)) {
    return false;
  }
  if (!value.interviewers.every(isValidInterviewer)) return false;
  const interviewerIds = new Set(
    value.interviewers.map((interviewer) => (interviewer as Record<string, unknown>).id as string),
  );
  if (interviewerIds.size !== value.interviewers.length) return false;
  if (!isValidAvailability(value.availabilityByDate, interviewerIds)) return false;
  if (typeof value.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) return false;
  if (
    typeof value.duration !== "number" ||
    !Number.isInteger(value.duration) ||
    value.duration < 1 ||
    value.duration > 120
  ) {
    return false;
  }
  if (
    typeof value.gap !== "number" ||
    !Number.isInteger(value.gap) ||
    value.gap < 0 ||
    value.gap > 120
  ) {
    return false;
  }
  if (!isLimitedString(value.companyName, 500)) return false;
  if (value.onboarding !== undefined) {
    if (!isRecord(value.onboarding)) return false;
    for (const key of ["trainingStartDate", "employmentStartDate", "payrollDate", "salary", "workingHours", "platformUrl", "tutorialUrl"]) {
      if (!isLimitedString(value.onboarding[key], 2000)) return false;
    }
  }
  if (value.messageTemplates !== undefined) {
    if (!isRecord(value.messageTemplates)) return false;
    if (!["invitation", "meeting", "training"].every((key) => isLimitedString(value.messageTemplates && (value.messageTemplates as Record<string, unknown>)[key], 12000))) return false;
  }
  if (value.candidateOnboarding !== undefined) {
    if (!isRecord(value.candidateOnboarding) || Object.keys(value.candidateOnboarding).length > 20000) return false;
    if (!Object.values(value.candidateOnboarding).every((entry) => isRecord(entry) &&
      Object.keys(entry).every((key) => key === "countries" || key === "loginId") &&
      isLimitedString(entry.countries, 1000) && isLimitedString(entry.loginId, 500))) return false;
  }
  if (value.trainingStartByDate !== undefined) {
    if (!isRecord(value.trainingStartByDate)) return false;
    if (Object.keys(value.trainingStartByDate).length > 3660) return false;
    if (!Object.entries(value.trainingStartByDate).every(([date, start]) =>
      /^\d{4}-\d{2}-\d{2}$/.test(date) && typeof start === "string" &&
      (start === "" || /^\d{4}-\d{2}-\d{2}$/.test(start)))) return false;
  }
  if (!isLimitedString(value.defaultMeetingLink, 2_000)) return false;
  if (!isLimitedString(value.defaultCountryCode, 30)) return false;
  if (
    value.messageLanguage !== "auto" &&
    value.messageLanguage !== "ar" &&
    value.messageLanguage !== "en" &&
    value.messageLanguage !== "fr"
  ) {
    return false;
  }
  if (!isLimitedString(value.fileName, 500)) return false;
  if (!isRecord(value.importNotes)) return false;
  for (const key of ["duplicates", "invalid", "missingPhones"]) {
    const count = value.importNotes[key];
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > 1_000_000) {
      return false;
    }
  }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_REQUEST_BYTES) return false;
  return true;
}

function parseStoredState(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

async function workspaceForSession(request: Request) {
  const token = getCookie(request, COOKIE_NAME);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = await sha256(`interview-session:v1:${token}`);
  const row = await getRawDb()
    .prepare(
      `SELECT w.id, w.state_json, w.revision, w.updated_at
       FROM scheduler_sessions AS s
       INNER JOIN scheduler_workspaces AS w ON w.id = s.workspace_id
       WHERE s.token_hash = ? AND s.expires_at > ?
       LIMIT 1`,
    )
    .bind(tokenHash, Math.floor(Date.now() / 1000))
    .first<WorkspaceRow>();
  return row ? { row, tokenHash } : null;
}

async function canCreateWorkspace(request: Request, now: number) {
  const clientAddress = request.headers.get("cf-connecting-ip") || "missing-edge-address";
  const bucketHash = await sha256(`interview-create-limit:v1:${clientAddress}`);
  const windowStart = Math.floor(now / CREATE_LIMIT_WINDOW_SECONDS) * CREATE_LIMIT_WINDOW_SECONDS;
  const result = await getRawDb()
    .prepare(
      `INSERT INTO scheduler_workspace_creation_limits
       (bucket_hash, window_start, attempts)
       VALUES (?, ?, 1)
       ON CONFLICT(bucket_hash, window_start)
       DO UPDATE SET attempts = attempts + 1
       RETURNING attempts`,
    )
    .bind(bucketHash, windowStart)
    .first<{ attempts: number }>();
  return {
    allowed: Boolean(result && result.attempts <= CREATE_LIMIT_PER_WINDOW),
    retryAfter: windowStart + CREATE_LIMIT_WINDOW_SECONDS - now,
    windowStart,
  };
}

function workspacePayload(row: WorkspaceRow) {
  return {
    state: parseStoredState(row.state_json),
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: Request) {
  try {
    const session = await workspaceForSession(request);
    if (!session) return json({ error: "locked" }, 401);
    return json(workspacePayload(session.row));
  } catch (error) {
    console.error("Workspace read failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "تعذر تحميل بيانات مساحة الفريق." }, 500);
  }
}

export async function POST(request: Request) {
  try {
    if (!isSameOriginMutation(request, true)) {
      return json({ error: "الطلب غير مسموح من هذا المصدر." }, 403);
    }
    const body = await readJson(request);
    const action = body.action;
    const db = getRawDb();
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + SESSION_SECONDS;
    const token = randomToken();
    const tokenHash = await sha256(`interview-session:v1:${token}`);

    if (action === "create") {
      if (!isValidState(body.state)) {
        return json({ error: "بيانات البداية غير صالحة." }, 400);
      }
      const createLimit = await canCreateWorkspace(request, now);
      if (!createLimit.allowed) {
        return json(
          { error: "تم إنشاء عدة مساحات مؤخرًا. حاول مرة أخرى بعد قليل." },
          429,
          { "Retry-After": String(Math.max(1, createLimit.retryAfter)) },
        );
      }
      const code = generateCode();
      const normalizedCode = normalizeCode(code);
      const codeHash = await sha256(`interview-team:v1:${normalizedCode}`);
      const workspaceId = crypto.randomUUID();
      const stateJson = JSON.stringify(body.state);

      try {
        await db.prepare("DELETE FROM scheduler_sessions WHERE expires_at <= ?").bind(now).run();
        await db
          .prepare("DELETE FROM scheduler_workspace_creation_limits WHERE window_start < ?")
          .bind(createLimit.windowStart - 24 * 60 * 60)
          .run();
        await db.batch([
          db
            .prepare(
              `INSERT INTO scheduler_workspaces
               (id, code_hash, state_json, revision, created_at, updated_at)
               VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            )
            .bind(workspaceId, codeHash, stateJson),
          db
            .prepare(
              `INSERT INTO scheduler_sessions
               (token_hash, workspace_id, created_at, expires_at)
               VALUES (?, ?, CURRENT_TIMESTAMP, ?)`,
            )
            .bind(tokenHash, workspaceId, expiresAt),
        ]);
      } catch (error) {
        console.error(
          "Workspace creation failed",
          error instanceof Error ? error.message : "unknown",
        );
        return json({ error: "تعذر إنشاء مساحة الفريق. حاول مرة أخرى." }, 500);
      }

      return json(
        {
          code,
          state: body.state,
          revision: 1,
          updatedAt: new Date().toISOString(),
        },
        201,
        { "Set-Cookie": sessionCookie(request, token) },
      );
    }

    if (action === "join") {
      const normalizedCode = normalizeCode(body.code);
      if (!isValidCode(normalizedCode)) {
        return json({ error: "رمز الفريق غير صحيح." }, 401);
      }
      const codeHash = await sha256(`interview-team:v1:${normalizedCode}`);
      const workspace = await db
        .prepare(
          `SELECT id, state_json, revision, updated_at
           FROM scheduler_workspaces
           WHERE code_hash = ?
           LIMIT 1`,
        )
        .bind(codeHash)
        .first<WorkspaceRow>();

      if (!workspace) return json({ error: "رمز الفريق غير صحيح." }, 401);

      await db.prepare("DELETE FROM scheduler_sessions WHERE expires_at <= ?").bind(now).run();
      await db
        .prepare(
          `INSERT INTO scheduler_sessions
           (token_hash, workspace_id, created_at, expires_at)
           VALUES (?, ?, CURRENT_TIMESTAMP, ?)`,
        )
        .bind(tokenHash, workspace.id, expiresAt)
        .run();

      return json(workspacePayload(workspace), 200, {
        "Set-Cookie": sessionCookie(request, token),
      });
    }

    return json({ error: "طلب غير صالح." }, 400);
  } catch (error) {
    if (error instanceof Error && error.message === "REQUEST_TOO_LARGE") {
      return json({ error: "حجم البيانات أكبر من الحد المتاح للمزامنة." }, 413);
    }
    if (error instanceof Error && error.message === "INVALID_JSON") {
      return json({ error: "الطلب غير صالح." }, 400);
    }
    console.error("Workspace access failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "تعذر فتح مساحة الفريق." }, 500);
  }
}

export async function PUT(request: Request) {
  try {
    if (!isSameOriginMutation(request, true)) {
      return json({ error: "الطلب غير مسموح من هذا المصدر." }, 403);
    }
    const session = await workspaceForSession(request);
    if (!session) return json({ error: "locked" }, 401);
    const body = await readJson(request);
    if (!isValidState(body.state)) return json({ error: "بيانات المزامنة غير صالحة." }, 400);
    const baseRevision = Number(body.baseRevision);
    if (!Number.isInteger(baseRevision) || baseRevision < 1) {
      return json({ error: "رقم المزامنة غير صالح." }, 400);
    }

    const stateJson = JSON.stringify(body.state);
    const force = body.force === true;
    const statement = force
      ? getRawDb()
          .prepare(
            `UPDATE scheduler_workspaces
             SET state_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?
             RETURNING id, state_json, revision, updated_at`,
          )
          .bind(stateJson, session.row.id)
      : getRawDb()
          .prepare(
            `UPDATE scheduler_workspaces
             SET state_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND revision = ?
             RETURNING id, state_json, revision, updated_at`,
          )
          .bind(stateJson, session.row.id, baseRevision);
    const updated = await statement.first<WorkspaceRow>();

    if (!updated) {
      const latest = await getRawDb()
        .prepare(
          `SELECT id, state_json, revision, updated_at
           FROM scheduler_workspaces
           WHERE id = ?
           LIMIT 1`,
        )
        .bind(session.row.id)
        .first<WorkspaceRow>();
      return latest
        ? json({ error: "conflict", ...workspacePayload(latest) }, 409)
        : json({ error: "مساحة الفريق غير موجودة." }, 404);
    }

    return json({ revision: updated.revision, updatedAt: updated.updated_at });
  } catch (error) {
    if (error instanceof Error && error.message === "REQUEST_TOO_LARGE") {
      return json({ error: "حجم البيانات أكبر من الحد المتاح للمزامنة." }, 413);
    }
    if (error instanceof Error && error.message === "INVALID_JSON") {
      return json({ error: "الطلب غير صالح." }, 400);
    }
    console.error("Workspace save failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "تعذر حفظ بيانات الفريق." }, 500);
  }
}

export async function DELETE(request: Request) {
  try {
    if (!isSameOriginMutation(request)) {
      return json({ error: "الطلب غير مسموح من هذا المصدر." }, 403);
    }
    const token = getCookie(request, COOKIE_NAME);
    if (/^[a-f0-9]{64}$/.test(token)) {
      const tokenHash = await sha256(`interview-session:v1:${token}`);
      await getRawDb()
        .prepare("DELETE FROM scheduler_sessions WHERE token_hash = ?")
        .bind(tokenHash)
        .run();
    }
  } catch (error) {
    console.error("Workspace sign out failed", error instanceof Error ? error.message : "unknown");
  }
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(request, "", 0) });
}
