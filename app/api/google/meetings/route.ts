import { getRawDb } from "../../../../db";
import {
  createCalendarInterview,
  deleteCalendarInterview,
  googleConfigured,
  updateCalendarInterview,
  type CalendarInterview,
  type GoogleConnectionRow,
} from "../../../../lib/google-calendar";
import {
  readSmallJson,
  sameOriginJsonMutation,
  secureJson,
  workspaceForRequest,
} from "../../../../lib/workspace-server";

export const dynamic = "force-dynamic";

type ScheduleRow = {
  scheduleId: string;
  name: string;
  phone?: string;
  email?: string;
  role?: string;
  interviewerId: string;
  interviewer: string;
  date: string;
  start: string;
  end: string;
};

type StoredMeeting = {
  interviewer_id: string;
  google_event_id: string;
  meet_link: string;
  calendar_link: string;
};

async function connectionFor(workspaceId: string, interviewerId: string) {
  return getRawDb()
    .prepare(
      `SELECT workspace_id, interviewer_id, google_email, access_token_cipher,
              access_token_iv, refresh_token_cipher, refresh_token_iv, expires_at, scope
       FROM scheduler_google_connections
       WHERE workspace_id = ? AND interviewer_id = ?
       LIMIT 1`,
    )
    .bind(workspaceId, interviewerId)
    .first<GoogleConnectionRow>();
}

function safeError(error: unknown) {
  if (!(error instanceof Error)) return "تعذر إنشاء الاجتماع.";
  if (error.message === "GOOGLE_RECONNECT_REQUIRED") return "أعد ربط حساب Google.";
  if (error.message === "GOOGLE_CALENDAR_FAILED") return "رفض Google إنشاء الموعد مؤقتًا.";
  return "تعذر إنشاء الاجتماع.";
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
    const rawScheduleIds = Array.isArray(body.scheduleIds) ? body.scheduleIds : [];
    const scheduleIds = rawScheduleIds.filter(
      (value): value is string => typeof value === "string" && value.length > 0 && value.length <= 300,
    );
    if (!scheduleIds.length || scheduleIds.length > 10 || scheduleIds.length !== rawScheduleIds.length) {
      return secureJson({ error: "اختر من 1 إلى 10 مقابلات في كل دفعة." }, 400);
    }

    const state = JSON.parse(workspace.stateJson) as {
      companyName?: string;
      schedule?: ScheduleRow[];
    };
    const scheduleById = new Map((state.schedule || []).map((row) => [row.scheduleId, row]));
    const results = [];

    for (const scheduleId of scheduleIds) {
      const row = scheduleById.get(scheduleId);
      if (!row) {
        results.push({ scheduleId, ok: false, error: "المقابلة غير موجودة." });
        continue;
      }
      const connection = await connectionFor(workspace.id, row.interviewerId);
      if (!connection) {
        results.push({ scheduleId, ok: false, error: "حساب المقابل غير مربوط." });
        continue;
      }
      const existing = await getRawDb()
        .prepare(
          `SELECT interviewer_id, google_event_id, meet_link, calendar_link
           FROM scheduler_google_meetings
           WHERE workspace_id = ? AND schedule_id = ?
           LIMIT 1`,
        )
        .bind(workspace.id, scheduleId)
        .first<StoredMeeting>();
      const interview: CalendarInterview = {
        workspaceId: workspace.id,
        scheduleId,
        candidateName: row.name,
        candidateEmail: row.email || "",
        candidatePhone: row.phone || "",
        role: row.role || "",
        interviewerName: row.interviewer,
        interviewerId: row.interviewerId,
        date: row.date,
        start: row.start,
        end: row.end,
        companyName: state.companyName || "TALUREVA",
      };

      try {
        if (existing && existing.interviewer_id !== row.interviewerId) {
          const oldConnection = await connectionFor(workspace.id, existing.interviewer_id);
          if (oldConnection) {
            try {
              await deleteCalendarInterview(oldConnection, existing.google_event_id);
            } catch (error) {
              console.warn("Old Google event cleanup failed", error instanceof Error ? error.message : "unknown");
            }
          }
        }
        const synced =
          existing && existing.interviewer_id === row.interviewerId
            ? await updateCalendarInterview(connection, existing.google_event_id, interview)
            : await createCalendarInterview(connection, interview);
        const syncStatus = synced.meetLink ? "ready" : "pending";
        await getRawDb()
          .prepare(
            `INSERT INTO scheduler_google_meetings
             (workspace_id, schedule_id, interviewer_id, google_event_id, meet_link,
              calendar_link, sync_status, last_error, scheduled_start, scheduled_end,
              created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT(workspace_id, schedule_id) DO UPDATE SET
               interviewer_id = excluded.interviewer_id,
               google_event_id = excluded.google_event_id,
               meet_link = excluded.meet_link,
               calendar_link = excluded.calendar_link,
               sync_status = excluded.sync_status,
               last_error = '',
               scheduled_start = excluded.scheduled_start,
               scheduled_end = excluded.scheduled_end,
               updated_at = CURRENT_TIMESTAMP`,
          )
          .bind(
            workspace.id,
            scheduleId,
            row.interviewerId,
            synced.googleEventId,
            synced.meetLink,
            synced.calendarLink,
            syncStatus,
            `${row.date}T${row.start}:00+03:00`,
            `${row.date}T${row.end}:00+03:00`,
          )
          .run();
        results.push({
          scheduleId,
          ok: true,
          googleEventId: synced.googleEventId,
          meetLink: synced.meetLink,
          calendarLink: synced.calendarLink,
          syncStatus,
        });
      } catch (error) {
        const message = safeError(error);
        console.error("Google interview sync failed", scheduleId, error instanceof Error ? error.message : "unknown");
        results.push({ scheduleId, ok: false, error: message });
      }
    }

    return secureJson({ results });
  } catch (error) {
    console.error("Google meeting batch failed", error instanceof Error ? error.message : "unknown");
    return secureJson({ error: "تعذر مزامنة اجتماعات Google." }, 500);
  }
}
