import { env } from "cloudflare:workers";

import { getRawDb } from "../db";
import { bytesToBase64Url, sha256Hex } from "./workspace-server";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USER_INFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

type GoogleEvent = {
  id?: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
    createRequest?: { status?: { statusCode?: string } };
  };
};

export type GoogleConnectionRow = {
  workspace_id: string;
  interviewer_id: string;
  google_email: string;
  access_token_cipher: string;
  access_token_iv: string;
  refresh_token_cipher: string | null;
  refresh_token_iv: string | null;
  expires_at: number;
  scope: string;
};

export function googleConfigured() {
  return Boolean(
    env.GOOGLE_OAUTH_CLIENT_ID &&
      env.GOOGLE_OAUTH_CLIENT_SECRET &&
      env.GOOGLE_TOKEN_ENCRYPTION_KEY,
  );
}

export function googleRedirectUri(request: Request) {
  return (
    env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ||
    new URL("/api/google/callback", request.url).toString()
  );
}

function requireGoogleConfig() {
  if (!googleConfigured()) throw new Error("GOOGLE_NOT_CONFIGURED");
  return {
    clientId: env.GOOGLE_OAUTH_CLIENT_ID as string,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET as string,
    encryptionSecret: env.GOOGLE_TOKEN_ENCRYPTION_KEY as string,
  };
}

function base64Encode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Decode(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey() {
  const { encryptionSecret } = requireGoogleConfig();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(encryptionSecret),
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptSecret(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    new TextEncoder().encode(value),
  );
  return { cipher: base64Encode(new Uint8Array(ciphertext)), iv: base64Encode(iv) };
}

async function decryptSecret(cipher: string, iv: string) {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64Decode(iv) },
    await encryptionKey(),
    base64Decode(cipher),
  );
  return new TextDecoder().decode(plaintext);
}

export async function pkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return bytesToBase64Url(new Uint8Array(digest));
}

export function authorizationUrl({
  request,
  state,
  codeChallenge,
  loginHint,
}: {
  request: Request;
  state: string;
  codeChallenge: string;
  loginHint: string;
}) {
  const { clientId } = requireGoogleConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRedirectUri(request),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/calendar.events",
    ].join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  if (loginHint) params.set("login_hint", loginHint);
  return "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();
}

export async function exchangeAuthorizationCode({
  request,
  code,
  codeVerifier,
}: {
  request: Request;
  code: string;
  codeVerifier: string;
}) {
  const { clientId, clientSecret } = requireGoogleConfig();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: googleRedirectUri(request),
    }),
  });
  const payload = (await response.json()) as TokenResponse;
  if (!response.ok || !payload.access_token) {
    console.error("Google OAuth exchange failed", response.status, payload.error || "unknown");
    throw new Error("GOOGLE_TOKEN_EXCHANGE_FAILED");
  }
  return payload as TokenResponse & { access_token: string };
}

export async function googleAccountEmail(accessToken: string) {
  const response = await fetch(USER_INFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error("GOOGLE_USERINFO_FAILED");
  const payload = (await response.json()) as { email?: string; email_verified?: boolean };
  if (!payload.email || payload.email_verified === false) throw new Error("GOOGLE_EMAIL_MISSING");
  return payload.email.toLowerCase();
}

export async function accessTokenForConnection(connection: GoogleConnectionRow) {
  const now = Math.floor(Date.now() / 1000);
  if (connection.expires_at > now + 90) {
    return decryptSecret(connection.access_token_cipher, connection.access_token_iv);
  }
  if (!connection.refresh_token_cipher || !connection.refresh_token_iv) {
    throw new Error("GOOGLE_RECONNECT_REQUIRED");
  }
  const { clientId, clientSecret } = requireGoogleConfig();
  const refreshToken = await decryptSecret(
    connection.refresh_token_cipher,
    connection.refresh_token_iv,
  );
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload = (await response.json()) as TokenResponse;
  if (!response.ok || !payload.access_token) {
    console.error("Google token refresh failed", response.status, payload.error || "unknown");
    throw new Error("GOOGLE_RECONNECT_REQUIRED");
  }
  const encryptedAccess = await encryptSecret(payload.access_token);
  const expiresAt = now + Math.max(60, Number(payload.expires_in) || 3600);
  await getRawDb()
    .prepare(
      `UPDATE scheduler_google_connections
       SET access_token_cipher = ?, access_token_iv = ?, expires_at = ?,
           scope = ?, updated_at = CURRENT_TIMESTAMP
       WHERE workspace_id = ? AND interviewer_id = ?`,
    )
    .bind(
      encryptedAccess.cipher,
      encryptedAccess.iv,
      expiresAt,
      payload.scope || connection.scope,
      connection.workspace_id,
      connection.interviewer_id,
    )
    .run();
  return payload.access_token;
}

function meetLinkFromEvent(event: GoogleEvent) {
  if (event.hangoutLink) return event.hangoutLink;
  return (
    event.conferenceData?.entryPoints?.find(
      (entryPoint) => entryPoint.entryPointType === "video",
    )?.uri || ""
  );
}

async function calendarRequest(
  accessToken: string,
  url: string,
  init?: RequestInit,
  acceptedStatuses: number[] = [],
) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!response.ok && !acceptedStatuses.includes(response.status)) {
    const detail = await response.text();
    console.error("Google Calendar request failed", response.status, detail.slice(0, 500));
    if (response.status === 401 || response.status === 403) {
      throw new Error("GOOGLE_RECONNECT_REQUIRED");
    }
    throw new Error("GOOGLE_CALENDAR_FAILED");
  }
  return response;
}

export type CalendarInterview = {
  workspaceId: string;
  scheduleId: string;
  candidateName: string;
  candidateEmail: string;
  candidatePhone: string;
  role: string;
  interviewerName: string;
  interviewerId: string;
  date: string;
  start: string;
  end: string;
  companyName: string;
};

function googleEventBody(interview: CalendarInterview, includeConference: boolean) {
  return {
    summary: `${interview.companyName || "TALUREVA"} Interview — ${interview.candidateName}`,
    description: [
      `Candidate: ${interview.candidateName}`,
      interview.role ? `Role: ${interview.role}` : "",
      interview.candidateEmail ? `Email: ${interview.candidateEmail}` : "",
      interview.candidatePhone ? `Phone: ${interview.candidatePhone}` : "",
      `Interviewer: ${interview.interviewerName}`,
      "Time zone: Saudi Arabia (UTC+3)",
    ]
      .filter(Boolean)
      .join("\n"),
    start: {
      dateTime: `${interview.date}T${interview.start}:00+03:00`,
      timeZone: "Asia/Riyadh",
    },
    end: {
      dateTime: `${interview.date}T${interview.end}:00+03:00`,
      timeZone: "Asia/Riyadh",
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: "popup", minutes: 10 },
        { method: "popup", minutes: 2 },
      ],
    },
    ...(includeConference
      ? { conferenceData: { createRequest: { requestId: crypto.randomUUID() } } }
      : {}),
  };
}

export async function deterministicEventId(workspaceId: string, scheduleId: string) {
  return (await sha256Hex(`talureva-event:v1:${workspaceId}:${scheduleId}`)).slice(0, 40);
}

export async function createCalendarInterview(
  connection: GoogleConnectionRow,
  interview: CalendarInterview,
  preferredEventId?: string,
) {
  const accessToken = await accessTokenForConnection(connection);
  const eventId = preferredEventId || (await deterministicEventId(interview.workspaceId, interview.scheduleId));
  const insertUrl =
    `${CALENDAR_API}/calendars/primary/events?conferenceDataVersion=1&sendUpdates=none`;
  const response = await calendarRequest(
    accessToken,
    insertUrl,
    {
      method: "POST",
      body: JSON.stringify({
        ...googleEventBody(interview, true),
        id: eventId,
      }),
    },
    [409],
  );
  let event: GoogleEvent;
  if (response.status === 409) {
    event = await getCalendarInterview(accessToken, eventId);
  } else {
    event = (await response.json()) as GoogleEvent;
  }
  if (!meetLinkFromEvent(event)) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    event = await getCalendarInterview(accessToken, event.id || eventId);
  }
  return {
    googleEventId: event.id || eventId,
    meetLink: meetLinkFromEvent(event),
    calendarLink: event.htmlLink || "",
  };
}

async function getCalendarInterview(accessToken: string, eventId: string) {
  const response = await calendarRequest(
    accessToken,
    `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}`,
  );
  return (await response.json()) as GoogleEvent;
}

export async function updateCalendarInterview(
  connection: GoogleConnectionRow,
  eventId: string,
  interview: CalendarInterview,
) {
  const accessToken = await accessTokenForConnection(connection);
  const response = await calendarRequest(
    accessToken,
    `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}?conferenceDataVersion=1&sendUpdates=none`,
    {
      method: "PATCH",
      body: JSON.stringify(googleEventBody(interview, false)),
    },
    [404, 410],
  );
  if (response.status === 404 || response.status === 410) {
    return createCalendarInterview(connection, interview, eventId);
  }
  let event = (await response.json()) as GoogleEvent;
  if (!meetLinkFromEvent(event)) {
    const conferenceResponse = await calendarRequest(
      accessToken,
      `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}?conferenceDataVersion=1&sendUpdates=none`,
      {
        method: "PATCH",
        body: JSON.stringify({
          conferenceData: { createRequest: { requestId: crypto.randomUUID() } },
        }),
      },
    );
    event = (await conferenceResponse.json()) as GoogleEvent;
  }
  return {
    googleEventId: event.id || eventId,
    meetLink: meetLinkFromEvent(event),
    calendarLink: event.htmlLink || "",
  };
}

export async function deleteCalendarInterview(
  connection: GoogleConnectionRow,
  eventId: string,
) {
  const accessToken = await accessTokenForConnection(connection);
  await calendarRequest(
    accessToken,
    `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
    { method: "DELETE" },
    [404, 410],
  );
}
