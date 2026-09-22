import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const schedulerWorkspaces = sqliteTable(
  "scheduler_workspaces",
  {
    id: text("id").primaryKey(),
    codeHash: text("code_hash").notNull(),
    stateJson: text("state_json").notNull(),
    revision: integer("revision").notNull().default(1),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_scheduler_workspaces_code_hash").on(table.codeHash),
  ],
);

export const schedulerSessions = sqliteTable(
  "scheduler_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => schedulerWorkspaces.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    index("idx_scheduler_sessions_workspace_id").on(table.workspaceId),
    index("idx_scheduler_sessions_expires_at").on(table.expiresAt),
  ],
);

export const schedulerWorkspaceCreationLimits = sqliteTable(
  "scheduler_workspace_creation_limits",
  {
    bucketHash: text("bucket_hash").notNull(),
    windowStart: integer("window_start").notNull(),
    attempts: integer("attempts").notNull().default(1),
  },
  (table) => [
    uniqueIndex("idx_scheduler_workspace_creation_limits_bucket_window").on(
      table.bucketHash,
      table.windowStart,
    ),
    index("idx_scheduler_workspace_creation_limits_window_start").on(table.windowStart),
  ],
);

export const schedulerGoogleConnections = sqliteTable(
  "scheduler_google_connections",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => schedulerWorkspaces.id, { onDelete: "cascade" }),
    interviewerId: text("interviewer_id").notNull(),
    googleEmail: text("google_email").notNull(),
    accessTokenCipher: text("access_token_cipher").notNull(),
    accessTokenIv: text("access_token_iv").notNull(),
    refreshTokenCipher: text("refresh_token_cipher"),
    refreshTokenIv: text("refresh_token_iv"),
    expiresAt: integer("expires_at").notNull(),
    scope: text("scope").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.interviewerId] }),
    index("idx_scheduler_google_connections_workspace").on(table.workspaceId),
  ],
);

export const schedulerGoogleOauthStates = sqliteTable(
  "scheduler_google_oauth_states",
  {
    stateHash: text("state_hash").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => schedulerWorkspaces.id, { onDelete: "cascade" }),
    interviewerId: text("interviewer_id").notNull(),
    loginHint: text("login_hint").notNull().default(""),
    codeVerifier: text("code_verifier").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_scheduler_google_oauth_states_workspace").on(table.workspaceId),
    index("idx_scheduler_google_oauth_states_expires").on(table.expiresAt),
  ],
);

export const schedulerGoogleMeetings = sqliteTable(
  "scheduler_google_meetings",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => schedulerWorkspaces.id, { onDelete: "cascade" }),
    scheduleId: text("schedule_id").notNull(),
    interviewerId: text("interviewer_id").notNull(),
    googleEventId: text("google_event_id").notNull(),
    meetLink: text("meet_link").notNull().default(""),
    calendarLink: text("calendar_link").notNull().default(""),
    syncStatus: text("sync_status").notNull().default("pending"),
    lastError: text("last_error").notNull().default(""),
    scheduledStart: text("scheduled_start").notNull(),
    scheduledEnd: text("scheduled_end").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.scheduleId] }),
    index("idx_scheduler_google_meetings_interviewer").on(
      table.workspaceId,
      table.interviewerId,
    ),
    index("idx_scheduler_google_meetings_status").on(table.workspaceId, table.syncStatus),
  ],
);
