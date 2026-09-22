"use client";

import {
  ChangeEvent,
  DragEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as XLSX from "xlsx";
import {
  CalendarDays,
  CalendarCheck2,
  Cloud,
  CloudCheck,
  Copy,
  Download,
  FileSpreadsheet,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Toaster } from "@/components/ui/sonner";
import { InterviewDesk, type MessageKind } from "@/components/interview-desk";
import { MeetLinkField } from "@/components/meet-link-field";
import { MessageSettings } from "@/components/message-settings";
import { DEFAULT_ONBOARDING, DEFAULT_TEMPLATES, normalizeOnboarding, normalizeTemplates, normalizeCandidateOnboarding, normalizeMeetLink, renderTemplate, templateIssue, validHttpsUrl, validDate, type OnboardingSettings, type MessageTemplates, type CandidateOnboarding } from "@/lib/interview-messages";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

type Candidate = {
  id: string;
  name: string;
  phone: string;
  email: string;
  role: string;
  language: string;
};

type TimeBlock = {
  id: string;
  label: string;
  start: string;
  end: string;
};

type InterviewerConfig = {
  id: string;
  name: string;
  meetingLink: string;
  googleEmail?: string;
};

type InterviewerAvailability = {
  enabled: boolean;
  blocks: TimeBlock[];
};

type AvailabilityByDate = Record<string, Record<string, InterviewerAvailability>>;

type BlockStat = TimeBlock & {
  minutes: number;
  perInterviewer: number;
  capacity: number;
};

type InterviewSlot = {
  start: string;
  end: string;
  blockId: string;
  blockLabel: string;
  interviewerId: string;
  interviewer: string;
};

type InterviewerStat = InterviewerConfig & {
  enabled: boolean;
  blocks: BlockStat[];
  minutes: number;
  capacity: number;
  valid: boolean;
};

type CandidateStatus =
  | "بانتظار الإرسال"
  | "بانتظار التأكيد"
  | "مؤكد"
  | "طلب تغيير"
  | "اعتذر"
  | "لم يرد"
  | "حضر"
  | "لم يحضر"
  | "مكتمل";

type InterviewStatus = "لم تُجرَ بعد" | "تمت المقابلة" | "لم يحضر";
type WorkPreference = "لم تُحدّد بعد" | "يرغب بالعمل" | "لا يرغب بالعمل";

type ScheduleRow = Candidate & {
  scheduleId: string;
  meetingId: string;
  date: string;
  start: string;
  end: string;
  blockId: string;
  blockLabel: string;
  interviewerId: string;
  interviewer: string;
  status: CandidateStatus;
  interviewStatus: InterviewStatus;
  workPreference: WorkPreference;
  googleEventId?: string;
  meetLink?: string;
  calendarLink?: string;
  meetingSyncStatus?: "not_created" | "needs_update" | "pending" | "ready" | "error";
  meetingSyncError?: string;
};

type ImportNotes = {
  duplicates: number;
  invalid: number;
  missingPhones: number;
};

type SharedSchedulerStateV1 = {
  schemaVersion: 1;
  candidates: Candidate[];
  schedule: ScheduleRow[];
  interviewers: InterviewerConfig[];
  availabilityByDate: AvailabilityByDate;
  date: string;
  duration: number;
  gap: number;
  companyName: string;
  positionByDate: Record<string, string>;
  trainingStartByDate: Record<string, string>;
  onboarding: OnboardingSettings;
  messageTemplates: MessageTemplates;
  candidateOnboarding: Record<string, CandidateOnboarding>;
  defaultMeetingLink: string;
  defaultCountryCode: string;
  messageLanguage: string;
  fileName: string;
  importNotes: ImportNotes;
};

type WorkspacePhase =
  | "checking"
  | "locked"
  | "joining"
  | "creating"
  | "created"
  | "ready";

type SyncStatus = "loading" | "saved" | "saving" | "conflict" | "error";

type WorkspaceResponse = {
  state?: unknown;
  revision?: number;
  updatedAt?: string;
  code?: string;
  error?: string;
};

type WorkspaceConflict = {
  state: SharedSchedulerStateV1;
  revision: number;
  updatedAt: string;
};

type ModelContextLike = {
  registerTool: (
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: Record<string, unknown>;
      annotations: {
        readOnlyHint: boolean;
        untrustedContentHint: boolean;
      };
      execute: (input: unknown) => Promise<Record<string, unknown>>;
    },
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};

const STATUS_OPTIONS: CandidateStatus[] = [
  "بانتظار الإرسال",
  "بانتظار التأكيد",
  "مؤكد",
  "طلب تغيير",
  "اعتذر",
  "لم يرد",
  "حضر",
  "لم يحضر",
  "مكتمل",
];

const INTERVIEW_STATUS_OPTIONS: InterviewStatus[] = [
  "لم تُجرَ بعد",
  "تمت المقابلة",
  "لم يحضر",
];

const WORK_PREFERENCE_OPTIONS: WorkPreference[] = [
  "لم تُحدّد بعد",
  "يرغب بالعمل",
  "لا يرغب بالعمل",
];

const MEETING_ID_START = 300;
const CONFIRMATION_WHATSAPP_NUMBER = "17095063202";

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeWorkspaceState(value: unknown): SharedSchedulerStateV1 | null {
  if (!isRecordValue(value) || value.schemaVersion !== 1) return null;
  if (
    !Array.isArray(value.candidates) ||
    !Array.isArray(value.schedule) ||
    !Array.isArray(value.interviewers) ||
    !isRecordValue(value.availabilityByDate)
  ) {
    return null;
  }

  const candidates = value.candidates.filter((candidate): candidate is Candidate => {
    if (!isRecordValue(candidate)) return false;
    return ["id", "name", "phone", "email", "role", "language"].every(
      (key) => typeof candidate[key] === "string",
    );
  });
  const interviewers = value.interviewers.filter(
    (interviewer): interviewer is InterviewerConfig =>
      isRecordValue(interviewer) &&
      typeof interviewer.id === "string" &&
      typeof interviewer.name === "string" &&
      typeof interviewer.meetingLink === "string" &&
      (interviewer.googleEmail === undefined || typeof interviewer.googleEmail === "string"),
  );
  const schedule = value.schedule.filter((row): row is ScheduleRow => {
    if (!isRecordValue(row)) return false;
    return (
      [
        "id",
        "name",
        "phone",
        "email",
        "role",
        "language",
        "scheduleId",
        "date",
        "start",
        "end",
        "blockId",
        "blockLabel",
        "interviewerId",
        "interviewer",
      ].every((key) => typeof row[key] === "string") &&
      STATUS_OPTIONS.includes(row.status as CandidateStatus) &&
      (row.interviewStatus === undefined ||
        INTERVIEW_STATUS_OPTIONS.includes(row.interviewStatus as InterviewStatus)) &&
      (row.workPreference === undefined ||
        WORK_PREFERENCE_OPTIONS.includes(row.workPreference as WorkPreference))
    );
  });
  const date = typeof value.date === "string" ? value.date : "";
  const duration = Number(value.duration);
  const gap = Number(value.gap);
  if (
    candidates.length !== value.candidates.length ||
    schedule.length !== value.schedule.length ||
    interviewers.length !== value.interviewers.length ||
    !interviewers.length ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isInteger(duration) ||
    duration < 1 ||
    duration > 120 ||
    !Number.isInteger(gap) ||
    gap < 0 ||
    gap > 120
  ) {
    return null;
  }
  const rawImportNotes = isRecordValue(value.importNotes) ? value.importNotes : {};
  const positionByDate: Record<string, string> = {};
  if (isRecordValue(value.positionByDate)) {
    Object.entries(value.positionByDate).forEach(([key, position]) => {
      if (typeof position === "string") positionByDate[key] = position;
    });
  }
  const trainingStartByDate: Record<string, string> = {};
  if (isRecordValue(value.trainingStartByDate)) {
    Object.entries(value.trainingStartByDate).forEach(([key, start]) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(key) && typeof start === "string" &&
          (!start || /^\d{4}-\d{2}-\d{2}$/.test(start))) trainingStartByDate[key] = start;
    });
  }
  const language = "en";
  const normalizedSchedule = schedule.map((row, index) => ({
    ...row,
    meetingId: String(MEETING_ID_START + index),
    interviewStatus: (INTERVIEW_STATUS_OPTIONS.includes(row.interviewStatus)
      ? row.interviewStatus
      : row.status === "حضر"
        ? "تمت المقابلة"
        : row.status === "لم يحضر"
          ? "لم يحضر"
          : "لم تُجرَ بعد"
    ) as InterviewStatus,
    workPreference: WORK_PREFERENCE_OPTIONS.includes(row.workPreference as WorkPreference)
      ? (row.workPreference as WorkPreference)
      : "لم تُحدّد بعد",
    googleEventId: typeof row.googleEventId === "string" ? row.googleEventId : "",
    meetLink: typeof row.meetLink === "string" ? row.meetLink : "",
    calendarLink: typeof row.calendarLink === "string" ? row.calendarLink : "",
    meetingSyncStatus:
      row.meetingSyncStatus === "needs_update" ||
      row.meetingSyncStatus === "pending" ||
      row.meetingSyncStatus === "ready" ||
      row.meetingSyncStatus === "error"
        ? row.meetingSyncStatus
        : ("not_created" as ScheduleRow["meetingSyncStatus"]),
    meetingSyncError:
      typeof row.meetingSyncError === "string" ? row.meetingSyncError : "",
  }));

  return {
    schemaVersion: 1,
    candidates,
    schedule: normalizedSchedule,
    interviewers: interviewers.map((interviewer) => ({
      ...interviewer,
      meetingLink: normalizeMeetLink(interviewer.meetingLink).url || interviewer.meetingLink,
      googleEmail: interviewer.googleEmail || "",
    })),
    availabilityByDate: value.availabilityByDate as AvailabilityByDate,
    date,
    duration,
    gap,
    companyName:
      typeof value.companyName === "string" && value.companyName !== "فريق التوظيف"
        ? value.companyName
        : DEFAULT_COMPANY_NAME,
    positionByDate,
    trainingStartByDate,
    onboarding: normalizeOnboarding(value.onboarding),
    messageTemplates: normalizeTemplates(value.messageTemplates),
    candidateOnboarding: normalizeCandidateOnboarding(value.candidateOnboarding),
    defaultMeetingLink:
      typeof value.defaultMeetingLink === "string" ? normalizeMeetLink(value.defaultMeetingLink).url || value.defaultMeetingLink : "",
    defaultCountryCode:
      "",
    messageLanguage: language,
    fileName: typeof value.fileName === "string" ? value.fileName : "",
    importNotes: {
      duplicates: Number(rawImportNotes.duplicates) || 0,
      invalid: Number(rawImportNotes.invalid) || 0,
      missingPhones: Number(rawImportNotes.missingPhones) || 0,
    },
  };
}

const HEADER_ALIASES = {
  name: [
    "name",
    "full name",
    "candidate name",
    "candidate",
    "الاسم",
    "اسم المرشح",
    "الاسم الكامل",
    "nom",
    "nom complet",
  ],
  phone: [
    "phone",
    "phone number",
    "mobile",
    "whatsapp",
    "رقم الهاتف",
    "الهاتف",
    "رقم الواتساب",
    "telephone",
    "téléphone",
  ],
  email: ["email", "e-mail", "البريد", "البريد الالكتروني", "البريد الإلكتروني"],
  role: ["role", "job", "position", "job title", "الوظيفة", "المسمى الوظيفي", "poste"],
  language: ["language", "lang", "اللغة", "langue"],
  id: ["id", "candidate id", "رقم المرشح", "رقم"],
};

function defaultBlocks(ownerId: string): TimeBlock[] {
  return [
    { id: ownerId + "-period-1", label: "الفترة 1", start: "09:00", end: "12:00" },
    { id: ownerId + "-period-2", label: "الفترة 2", start: "16:00", end: "19:00" },
    { id: ownerId + "-period-3", label: "الفترة 3", start: "20:00", end: "23:00" },
  ];
}

function defaultAvailability(ownerId: string): InterviewerAvailability {
  return {
    enabled: true,
    blocks: defaultBlocks(ownerId),
  };
}

function safeAvailability(ownerId: string, value: unknown): InterviewerAvailability {
  if (!value || typeof value !== "object") return defaultAvailability(ownerId);
  const candidate = value as Partial<InterviewerAvailability>;
  const blocks = Array.isArray(candidate.blocks)
    ? candidate.blocks.filter(
        (block): block is TimeBlock =>
          Boolean(
            block &&
              typeof block.id === "string" &&
              typeof block.label === "string" &&
              typeof block.start === "string" &&
              typeof block.end === "string",
          ),
      )
    : [];
  return {
    enabled: candidate.enabled !== false,
    blocks: blocks.length ? blocks : defaultBlocks(ownerId),
  };
}

const DEFAULT_INTERVIEWERS: InterviewerConfig[] = [
  {
    id: "interviewer-mahmoud",
    name: "محمود",
    meetingLink: "",
    googleEmail: "",
  },
  {
    id: "interviewer-yazid",
    name: "يزيد",
    meetingLink: "",
    googleEmail: "",
  },
];

const PAGE_SIZE = 25;
const DAILY_AVAILABILITY_STORAGE_KEY = "interview-scheduler-daily-availability-v3";
const MESSAGE_SETTINGS_STORAGE_KEY = "interview-scheduler-message-settings-v1";
const INTERVIEW_TIMEZONE = "Asia/Riyadh";
const DEFAULT_COMPANY_NAME = "HRadeeco";

function dateISO(offsetDays = 1) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: INTERVIEW_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value || 0);
  const month = Number(parts.find((part) => part.type === "month")?.value || 1);
  const day = Number(parts.find((part) => part.type === "day")?.value || 1);
  return new Date(Date.UTC(year, month - 1, day + offsetDays, 12)).toISOString().slice(0, 10);
}

function shiftDateISO(value: string, offsetDays: number) {
  const date = new Date(value + "T12:00:00Z");
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[ـًٌٍَُِّْ]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function findColumn(headers: unknown[], aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeHeader);
  const exactMatch = headers.findIndex((header) => {
    const normalized = normalizeHeader(header);
    return normalizedAliases.some((alias) => normalized === alias);
  });
  if (exactMatch >= 0) return exactMatch;
  return headers.findIndex((header) => {
    const normalized = normalizeHeader(header);
    return normalizedAliases.some((alias) => normalized.includes(alias));
  });
}

function cellText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function arabicDigitsToLatin(value: string) {
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const eastern = "۰۱۲۳۴۵۶۷۸۹";
  return value
    .replace(/[٠-٩]/g, (digit) => String(arabic.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(eastern.indexOf(digit)));
}

function normalizePhone(value: string, defaultCountryCode = "") {
  const normalizedValue = arabicDigitsToLatin(value).trim();
  const explicitlyInternational = normalizedValue.startsWith("+") || normalizedValue.startsWith("00");
  let digits = normalizedValue.replace(/\D/g, "");
  if (normalizedValue.startsWith("00")) digits = digits.slice(2);
  const country = defaultCountryCode.replace(/\D/g, "");
  if (!explicitlyInternational && country) {
    const localDigits = digits.replace(/^0+/, "");
    const looksLocal = digits.startsWith("0") || localDigits.length <= 10;
    digits =
      localDigits.startsWith(country) || !looksLocal
        ? localDigits
        : country + localDigits;
  }
  return digits;
}

function isValidInternationalPhone(value: string, defaultCountryCode = "") {
  const readableValue = arabicDigitsToLatin(value).trim();
  if (!readableValue || !/^[+\d\s().-]+$/.test(readableValue)) return false;
  if (
    (readableValue.startsWith("+") || readableValue.startsWith("00")) &&
    /\(\s*0\s*\)/.test(readableValue)
  ) {
    return false;
  }
  const normalized = normalizePhone(value, defaultCountryCode);
  return /^[1-9]\d{7,14}$/.test(normalized);
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isValidTimeValue(value: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const parts = value.split(":").map(Number);
  return parts[0] >= 0 && parts[0] <= 23 && parts[1] >= 0 && parts[1] <= 59;
}

function timeToMinutes(value: string) {
  if (!isValidTimeValue(value)) return Number.NaN;
  const parts = value.split(":").map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

function minutesToTime(value: number) {
  const hours = Math.floor(value / 60) % 24;
  const minutes = value % 60;
  return String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0");
}

function isValidBlockLayout(blocks: Array<Pick<TimeBlock, "start" | "end">>) {
  if (!blocks.length) return false;
  if (blocks.some((block) => !isValidTimeValue(block.start) || !isValidTimeValue(block.end))) {
    return false;
  }
  const ordered = [...blocks].sort(
    (left, right) => timeToMinutes(left.start) - timeToMinutes(right.start),
  );
  for (let index = 0; index < ordered.length; index += 1) {
    if (timeToMinutes(ordered[index].end) <= timeToMinutes(ordered[index].start)) {
      return false;
    }
    if (
      index > 0 &&
      timeToMinutes(ordered[index].start) < timeToMinutes(ordered[index - 1].end)
    ) {
      return false;
    }
  }
  return true;
}

function formatTime(value: string, locale: string) {
  if (!isValidTimeValue(value)) return value || "—";
  const date = new Date("2026-01-01T" + value + ":00+03:00");
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: INTERVIEW_TIMEZONE,
  }).format(date);
}

function formatDate(value: string, locale: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || "—";
  const date = new Date(value + "T12:00:00+03:00");
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: INTERVIEW_TIMEZONE,
  }).format(date);
}

function formatRemainingTime(row: Pick<ScheduleRow, "date" | "start">, language: "ar" | "en") {
  const target = new Date(row.date + "T" + row.start + ":00+03:00");
  if (Number.isNaN(target.getTime())) return "";
  const remainingMilliseconds = target.getTime() - Date.now();
  if (remainingMilliseconds <= 0) {
    return language === "en" ? "The scheduled time has started or passed." : "بدأ الموعد أو انتهى.";
  }
  if (remainingMilliseconds < 60_000) {
    return language === "en" ? "Less than 1 minute remaining" : "متبقي أقل من دقيقة";
  }
  const remainingMinutes = Math.ceil(remainingMilliseconds / 60000);
  const days = Math.floor(remainingMinutes / 1440);
  const hours = Math.floor((remainingMinutes % 1440) / 60);
  const minutes = remainingMinutes % 60;
  if (language === "en") {
    const parts = [];
    if (days) parts.push(days + (days === 1 ? " day" : " days"));
    if (hours) parts.push(hours + (hours === 1 ? " hour" : " hours"));
    if (minutes) parts.push(minutes + (minutes === 1 ? " minute" : " minutes"));
    const readable =
      parts.length > 1
        ? parts.slice(0, -1).join(", ") + " and " + parts.at(-1)
        : parts[0] || "less than 1 minute";
    return "Approximately " + readable + " remaining";
  }
  const parts = [];
  if (days) parts.push(days + " يوم");
  if (hours) parts.push(hours + " ساعة");
  if (minutes) parts.push(minutes + " دقيقة");
  return "متبقي تقريبًا " + (parts.join(" و") || "أقل من دقيقة");
}

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || value;
}

function blockSlotsForInterviewer(
  interviewer: InterviewerStat,
  duration: number,
  slotLength: number,
) {
  return interviewer.blocks.map((block) => {
    const startMinutes = timeToMinutes(block.start);
    const slots: InterviewSlot[] = Array.from(
      { length: block.perInterviewer },
      (_, slotIndex) => {
        const slotStart = startMinutes + slotIndex * slotLength;
        return {
          start: minutesToTime(slotStart),
          end: minutesToTime(slotStart + duration),
          blockId: block.id,
          blockLabel: block.label,
          interviewerId: interviewer.id,
          interviewer: interviewer.name,
        };
      },
    );
    return { blockId: block.id, slots };
  });
}

function selectBalancedSlots(
  blockSlots: Array<{ blockId: string; slots: InterviewSlot[] }>,
  count: number,
) {
  const quotas = blockSlots.map(() => 0);
  for (let assigned = 0; assigned < count; ) {
    let madeProgress = false;
    for (let index = 0; index < blockSlots.length && assigned < count; index += 1) {
      if (quotas[index] < blockSlots[index].slots.length) {
        quotas[index] += 1;
        assigned += 1;
        madeProgress = true;
      }
    }
    if (!madeProgress) break;
  }
  return blockSlots.flatMap((block, index) => block.slots.slice(0, quotas[index]));
}

function interviewerAllocations(interviewerStats: InterviewerStat[], count: number) {
  const totalCapacity = interviewerStats.reduce(
    (sum, interviewer) => sum + interviewer.capacity,
    0,
  );
  if (!totalCapacity || !count) return interviewerStats.map(() => 0);
  const target = Math.min(count, totalCapacity);
  const shares = interviewerStats.map((interviewer, index) => {
    const exact = (target * interviewer.capacity) / totalCapacity;
    return {
      index,
      assigned: Math.min(interviewer.capacity, Math.floor(exact)),
      remainder: exact - Math.floor(exact),
    };
  });
  let remaining = target - shares.reduce((sum, share) => sum + share.assigned, 0);
  const byRemainder = [...shares].sort(
    (left, right) => right.remainder - left.remainder || left.index - right.index,
  );
  while (remaining > 0) {
    let progressed = false;
    for (const share of byRemainder) {
      if (remaining === 0) break;
      if (share.assigned < interviewerStats[share.index].capacity) {
        share.assigned += 1;
        remaining -= 1;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return shares.sort((left, right) => left.index - right.index).map((share) => share.assigned);
}

function buildInterviewSlots(
  interviewerStats: InterviewerStat[],
  duration: number,
  slotLength: number,
) {
  const order = new Map(interviewerStats.map((interviewer, index) => [interviewer.id, index]));
  return interviewerStats
    .flatMap((interviewer) =>
      blockSlotsForInterviewer(interviewer, duration, slotLength).flatMap(
        (block) => block.slots,
      ),
    )
    .sort(
      (left, right) =>
        timeToMinutes(left.start) - timeToMinutes(right.start) ||
        (order.get(left.interviewerId) || 0) - (order.get(right.interviewerId) || 0),
    );
}

function createScheduleRows({
  candidates,
  interviewDate,
  interviewerStats,
  duration,
  slotLength,
}: {
  candidates: Candidate[];
  interviewDate: string;
  interviewerStats: InterviewerStat[];
  duration: number;
  slotLength: number;
}) {
  if (
    !candidates.length ||
    !interviewDate ||
    !interviewerStats.length ||
    interviewerStats.some((interviewer) => !interviewer.valid)
  ) {
    return [];
  }
  const allocations = interviewerAllocations(interviewerStats, candidates.length);
  const order = new Map(interviewerStats.map((interviewer, index) => [interviewer.id, index]));
  const slots = interviewerStats
    .flatMap((interviewer, index) =>
      selectBalancedSlots(
        blockSlotsForInterviewer(interviewer, duration, slotLength),
        allocations[index],
      ),
    )
    .sort(
      (left, right) =>
        timeToMinutes(left.start) - timeToMinutes(right.start) ||
        (order.get(left.interviewerId) || 0) - (order.get(right.interviewerId) || 0),
    );
  return candidates.slice(0, slots.length).map((candidate, index) => {
    const slot = slots[index];
    return {
      ...candidate,
      scheduleId: candidate.id + "-" + index,
      meetingId: String(MEETING_ID_START + index),
      date: interviewDate,
      start: slot.start,
      end: slot.end,
      blockId: slot.blockId,
      blockLabel: slot.blockLabel,
      interviewerId: slot.interviewerId,
      interviewer: slot.interviewer,
      status: "بانتظار الإرسال" as CandidateStatus,
      interviewStatus: "لم تُجرَ بعد" as InterviewStatus,
      workPreference: "لم تُحدّد بعد" as WorkPreference,
      googleEventId: "",
      meetLink: "",
      calendarLink: "",
      meetingSyncStatus: "not_created" as const,
      meetingSyncError: "",
    };
  });
}

function downloadWorkbook(workbook: XLSX.WorkBook, fileName: string) {
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}

export default function InterviewScheduler() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);
  const [interviewers, setInterviewers] =
    useState<InterviewerConfig[]>(DEFAULT_INTERVIEWERS);
  const [availabilityByDate, setAvailabilityByDate] = useState<AvailabilityByDate>({});
  const [availabilityStorageReady, setAvailabilityStorageReady] = useState(false);
  const [date, setDate] = useState(() => dateISO(0));
  const [duration, setDuration] = useState(5);
  const [gap, setGap] = useState(0);
  const [companyName, setCompanyName] = useState(DEFAULT_COMPANY_NAME);
  const [positionByDate, setPositionByDate] = useState<Record<string, string>>({});
  const [trainingStartByDate, setTrainingStartByDate] = useState<Record<string, string>>({});
  const [onboarding, setOnboarding] = useState<OnboardingSettings>(DEFAULT_ONBOARDING);
  const [messageTemplates, setMessageTemplates] = useState<MessageTemplates>(DEFAULT_TEMPLATES);
  const [candidateOnboarding, setCandidateOnboarding] = useState<Record<string, CandidateOnboarding>>({});
  const [sessionPasswords, setSessionPasswords] = useState<Record<string, string>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [defaultMeetingLink, setDefaultMeetingLink] = useState("");
  const defaultCountryCode = "";
  const messageLanguage = "en";
  const [messageSettingsReady, setMessageSettingsReady] = useState(false);
  const [search, setSearch] = useState("");
  const [interviewerFilter, setInterviewerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [interviewStatusFilter, setInterviewStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [fileName, setFileName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [importNotes, setImportNotes] = useState<ImportNotes>({
    duplicates: 0,
    invalid: 0,
    missingPhones: 0,
  });
  const [workspacePhase, setWorkspacePhase] = useState<WorkspacePhase>("checking");
  const [workspaceCode, setWorkspaceCode] = useState("");
  const [createdWorkspaceCode, setCreatedWorkspaceCode] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const [workspaceUpdatedAt, setWorkspaceUpdatedAt] = useState("");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("loading");
  const [lastSyncedJson, setLastSyncedJson] = useState("");
  const [isLocking, setIsLocking] = useState(false);
  const [workspaceConflict, setWorkspaceConflict] =
    useState<WorkspaceConflict | null>(null);
  const [workspaceHydrationVersion, setWorkspaceHydrationVersion] = useState(0);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const importRequestId = useRef(0);
  const handledHydrationVersion = useRef(0);
  const workspaceRevisionRef = useRef(0);
  const lastSyncedJsonRef = useRef("");
  const currentSnapshotRef = useRef<SharedSchedulerStateV1 | null>(null);
  const currentSnapshotJsonRef = useRef("");
  const workspacePhaseRef = useRef<WorkspacePhase>("checking");
  const syncStatusRef = useRef<SyncStatus>("loading");
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveGenerationRef = useRef(0);
  const refreshInFlightRef = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let restoredInterviewers: InterviewerConfig[] | null = null;
    let restoredAvailability: AvailabilityByDate | null = null;
    try {
      const saved = window.localStorage.getItem(DAILY_AVAILABILITY_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          interviewers?: InterviewerConfig[];
          availabilityByDate?: AvailabilityByDate;
        };
        if (Array.isArray(parsed.interviewers) && parsed.interviewers.length) {
          const validInterviewers = parsed.interviewers.filter(
            (interviewer) =>
              interviewer &&
              typeof interviewer.id === "string" &&
              typeof interviewer.name === "string" &&
              typeof interviewer.meetingLink === "string" &&
              (interviewer.googleEmail === undefined ||
                typeof interviewer.googleEmail === "string"),
          );
          if (validInterviewers.length) restoredInterviewers = validInterviewers;
        }
        if (
          parsed.availabilityByDate &&
          typeof parsed.availabilityByDate === "object" &&
          !Array.isArray(parsed.availabilityByDate)
        ) {
          restoredAvailability = parsed.availabilityByDate;
        }
      }
    } catch {
      window.localStorage.removeItem(DAILY_AVAILABILITY_STORAGE_KEY);
    }
    const frame = window.requestAnimationFrame(() => {
      if (restoredInterviewers) setInterviewers(restoredInterviewers);
      if (restoredAvailability) setAvailabilityByDate(restoredAvailability);
      setAvailabilityStorageReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!availabilityStorageReady) return;
    try {
      window.localStorage.setItem(
        DAILY_AVAILABILITY_STORAGE_KEY,
        JSON.stringify({ interviewers, availabilityByDate }),
      );
    } catch {
      // Daily availability remains usable for this session if browser storage is unavailable.
    }
  }, [availabilityByDate, availabilityStorageReady, interviewers]);

  useEffect(() => {
    let savedSettings:
      | {
          companyName?: string;
          positionByDate?: Record<string, string>;
          trainingStartByDate?: Record<string, string>;
          onboarding?: OnboardingSettings;
          messageTemplates?: MessageTemplates;
          candidateOnboarding?: Record<string, CandidateOnboarding>;
          defaultMeetingLink?: string;
          defaultCountryCode?: string;
          messageLanguage?: string;
        }
      | undefined;
    try {
      const saved = window.localStorage.getItem(MESSAGE_SETTINGS_STORAGE_KEY);
      if (saved) savedSettings = JSON.parse(saved);
    } catch {
      window.localStorage.removeItem(MESSAGE_SETTINGS_STORAGE_KEY);
    }

    const frame = window.requestAnimationFrame(() => {
      if (typeof savedSettings?.companyName === "string") {
        setCompanyName(
          savedSettings.companyName === "فريق التوظيف"
            ? DEFAULT_COMPANY_NAME
            : savedSettings.companyName,
        );
      }
      if (typeof savedSettings?.defaultMeetingLink === "string") {
        setDefaultMeetingLink(savedSettings.defaultMeetingLink);
      }
      if (savedSettings?.positionByDate && typeof savedSettings.positionByDate === "object") {
        const normalizedPositions: Record<string, string> = {};
        Object.entries(savedSettings.positionByDate).forEach(([key, position]) => {
          if (typeof position === "string") normalizedPositions[key] = position;
        });
        setPositionByDate(normalizedPositions);
      }
      setOnboarding(normalizeOnboarding(savedSettings?.onboarding));
      setMessageTemplates(normalizeTemplates(savedSettings?.messageTemplates));
      setCandidateOnboarding(normalizeCandidateOnboarding(savedSettings?.candidateOnboarding));
      if (isRecordValue(savedSettings?.trainingStartByDate)) {
        setTrainingStartByDate(Object.fromEntries(Object.entries(savedSettings.trainingStartByDate)
          .filter(([key, start]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && typeof start === "string")));
      }
      setMessageSettingsReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!messageSettingsReady) return;
    try {
      window.localStorage.setItem(
        MESSAGE_SETTINGS_STORAGE_KEY,
        JSON.stringify({
          companyName,
          positionByDate,
          trainingStartByDate,
          onboarding, messageTemplates, candidateOnboarding,
          defaultMeetingLink,
          defaultCountryCode,
          messageLanguage,
        }),
      );
    } catch {
      // Message settings remain usable for this session if browser storage is unavailable.
    }
  }, [
    companyName,
    defaultCountryCode,
    defaultMeetingLink,
    messageLanguage,
    messageSettingsReady,
    positionByDate,
    trainingStartByDate,
    onboarding, messageTemplates, candidateOnboarding,
  ]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const saved = window.localStorage.getItem("interview-desk-selected-person");
        if (saved) setInterviewerFilter(saved);
      } catch { /* Device preference is optional. */ }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (workspacePhase === "ready" && interviewerFilter !== "all" &&
        !interviewers.some((person) => person.id === interviewerFilter)) {
      const frame = window.requestAnimationFrame(() => setInterviewerFilter("all"));
      return () => window.cancelAnimationFrame(frame);
    }
  }, [workspacePhase, interviewerFilter, interviewers]);
  const selectInterviewerView = (id: string) => {
    setInterviewerFilter(id);
    setCurrentPage(1);
    setSearch("");
    setInterviewStatusFilter("all");
    try { window.localStorage.setItem("interview-desk-selected-person", id); } catch { /* Optional. */ }
  };

  const slotLength = Math.max(1, duration + gap);
  const interviewerStats = useMemo<InterviewerStat[]>(() => {
    return interviewers.map((interviewer) => {
      const availability = safeAvailability(
        interviewer.id,
        availabilityByDate[date]?.[interviewer.id],
      );
      const blocks = availability.blocks.map((block) => {
        const startMinutes = timeToMinutes(block.start);
        const endMinutes = timeToMinutes(block.end);
        const minutes =
          Number.isFinite(startMinutes) && Number.isFinite(endMinutes)
            ? Math.max(0, endMinutes - startMinutes)
            : 0;
        const perInterviewer =
          !availability.enabled || minutes < duration
            ? 0
            : 1 + Math.floor((minutes - duration) / slotLength);
        return {
          ...block,
          minutes,
          perInterviewer,
          capacity: perInterviewer,
        };
      });
      return {
        ...interviewer,
        enabled: availability.enabled,
        blocks,
        minutes: availability.enabled
          ? blocks.reduce((sum, block) => sum + block.minutes, 0)
          : 0,
        capacity: blocks.reduce((sum, block) => sum + block.capacity, 0),
        valid:
          Boolean(interviewer.name.trim()) &&
          (!availability.enabled || isValidBlockLayout(availability.blocks)),
      };
    });
  }, [availabilityByDate, date, duration, interviewers, slotLength]);

  const hasSavedAvailabilityForDate = Boolean(availabilityByDate[date]);
  const previousDate = shiftDateISO(date, -1);
  const hasPreviousDayAvailability = Boolean(
    previousDate && availabilityByDate[previousDate],
  );

  const configurationValid =
    interviewerStats.length > 0 && interviewerStats.every((interviewer) => interviewer.valid);
  const totalCapacity = configurationValid
    ? interviewerStats.reduce((sum, interviewer) => sum + interviewer.capacity, 0)
    : 0;

  const selectedInterviewer = interviewers.find((person) => person.id === interviewerFilter);
  const scopedSchedule = useMemo(() => schedule.filter((row) =>
    row.date === date && (interviewerFilter === "all" || row.interviewerId === interviewerFilter)
  ), [schedule, date, interviewerFilter]);

  const filteredSchedule = useMemo(() => {
    const query = normalizeHeader(search);
    return scopedSchedule.filter((row) => {
      const matchesSearch =
        !query ||
        normalizeHeader(row.name).includes(query) ||
        normalizeHeader(row.phone).includes(query) ||
        normalizeHeader(positionByDate[row.date] || row.role).includes(query);
      const matchesInterviewer =
        interviewerFilter === "all" || row.interviewerId === interviewerFilter;
      const matchesStatus = statusFilter === "all" || row.status === statusFilter;
      const matchesInterviewStatus =
        interviewStatusFilter === "all" || row.interviewStatus === interviewStatusFilter;
      return matchesSearch && matchesInterviewer && matchesStatus && matchesInterviewStatus;
    });
  }, [interviewStatusFilter, interviewerFilter, scopedSchedule, search, statusFilter, positionByDate]);

  const interviewedCount = useMemo(
    () => scopedSchedule.filter((row) => row.interviewStatus === "تمت المقابلة").length,
    [scopedSchedule],
  );

  const pageCount = Math.max(1, Math.ceil(filteredSchedule.length / PAGE_SIZE));
  const resolvedPage = Math.min(currentPage, pageCount);
  const visibleSchedule = useMemo(() => {
    const start = (resolvedPage - 1) * PAGE_SIZE;
    return filteredSchedule.slice(start, start + PAGE_SIZE);
  }, [filteredSchedule, resolvedPage]);

  const interviewerScheduleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    schedule.forEach((row) => {
      counts.set(row.interviewerId, (counts.get(row.interviewerId) || 0) + 1);
    });
    return interviewerStats.map((interviewer) => ({
      id: interviewer.id,
      name: interviewer.name,
      count: counts.get(interviewer.id) || 0,
    }));
  }, [interviewerStats, schedule]);

  const nextInterview = useMemo(() => {
    return [...scopedSchedule]
      .filter((row) => {
        if (row.interviewStatus !== "لم تُجرَ بعد") return false;
        const end = new Date(`${row.date}T${row.end}:00+03:00`).getTime();
        return Number.isFinite(end) && end >= nowTick;
      })
      .sort(
        (left, right) =>
          new Date(`${left.date}T${left.start}:00+03:00`).getTime() -
          new Date(`${right.date}T${right.start}:00+03:00`).getTime(),
      )[0];
  }, [nowTick, scopedSchedule]);

  const parseWorkbook = async (file: File) => {
    const requestId = ++importRequestId.current;
    const countryCodeAtStart = defaultCountryCode;
    const capacityAtStart = totalCapacity;
    try {
      const buffer = await file.arrayBuffer();
      if (requestId !== importRequestId.current) return;
      const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
        header: 1,
        defval: "",
        raw: false,
      });
      if (rows.length < 2) {
        toast.error("الملف لا يحتوي على صفوف مرشحين.");
        return;
      }
      const headers = rows[0];
      const indexes = {
        name: findColumn(headers, HEADER_ALIASES.name),
        phone: findColumn(headers, HEADER_ALIASES.phone),
        email: findColumn(headers, HEADER_ALIASES.email),
        role: findColumn(headers, HEADER_ALIASES.role),
        language: findColumn(headers, HEADER_ALIASES.language),
        id: findColumn(headers, HEADER_ALIASES.id),
      };
      if (indexes.name < 0 || (indexes.phone < 0 && indexes.email < 0)) {
        toast.error("نحتاج عمود الاسم، ومعه رقم الهاتف أو البريد الإلكتروني.");
        return;
      }

      const imported: Candidate[] = [];
      const seenPhones = new Set<string>();
      const seenEmails = new Set<string>();
      let duplicates = 0;
      let invalid = 0;
      let missingPhones = 0;

      rows.slice(1).forEach((row, rowIndex) => {
        const values = Array.isArray(row) ? row : [];
        const name = cellText(values[indexes.name]);
        const phone = indexes.phone >= 0 ? cellText(values[indexes.phone]) : "";
        const email = indexes.email >= 0 ? cellText(values[indexes.email]) : "";
        const validPhone = isValidInternationalPhone(phone, countryCodeAtStart);
        const validEmail = isValidEmail(email);
        if (!name || (!validPhone && !validEmail)) {
          invalid += 1;
          return;
        }
        if (!validPhone) missingPhones += 1;
        const normalizedPhone = validPhone
          ? normalizePhone(phone, countryCodeAtStart)
          : "";
        const normalizedEmail = validEmail ? email.toLowerCase() : "";
        const isDuplicate =
          (normalizedPhone && seenPhones.has(normalizedPhone)) ||
          (normalizedEmail && seenEmails.has(normalizedEmail));
        if (isDuplicate) {
          duplicates += 1;
          return;
        }
        if (normalizedPhone) seenPhones.add(normalizedPhone);
        if (normalizedEmail) seenEmails.add(normalizedEmail);
        imported.push({
          id:
            indexes.id >= 0
              ? cellText(values[indexes.id]) || "C-" + (rowIndex + 1)
              : "C-" + (rowIndex + 1),
          name,
          phone,
          email,
          role: indexes.role >= 0 ? cellText(values[indexes.role]) : "",
          language: indexes.language >= 0 ? cellText(values[indexes.language]) : "",
        });
      });

      if (requestId !== importRequestId.current) return;

      if (!imported.length) {
        setCandidates([]);
        setSchedule([]);
        setFileName(file.name);
        setImportNotes({ duplicates, invalid, missingPhones });
        toast.error("لم نجد مرشحين صالحين. تأكد من الاسم ورقم الهاتف أو البريد.");
        return;
      }

      setSchedule([]);
      setCandidates(imported);
      setFileName(file.name);
      setImportNotes({ duplicates, invalid, missingPhones });
      if (!capacityAtStart) {
        toast.warning("تم استيراد " + imported.length + " مرشحًا. عدّل أوقات الموظفين.");
      } else if (imported.length > capacityAtStart) {
        toast.warning(
          "تم استيراد " +
            imported.length +
            " مرشحًا، والسعة الحالية " +
            capacityAtStart +
            " فقط.",
        );
      } else {
        toast.success("تم استيراد " + imported.length + " مرشحًا وجدولتهم تلقائيًا.");
      }
    } catch (error) {
      if (requestId !== importRequestId.current) return;
      console.error("Workbook import failed", error);
      toast.error("تعذر قراءة الملف. تأكد أنه Excel أو CSV صالح.");
    }
  };

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) await parseWorkbook(file);
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void parseWorkbook(file);
  };

  const loadDemo = () => {
    importRequestId.current += 1;
    const names = [
      "ليان أحمد",
      "محمد خالد",
      "سارة مصطفى",
      "يوسف علي",
      "ريم محمود",
      "أحمد سمير",
      "نور الهدى",
      "عمر حسن",
      "مريم ياسر",
      "كريم وائل",
      "هبة عادل",
      "أنس طارق",
    ];
    const demo = names.map((name, index) => ({
      id: "DEMO-" + String(index + 1).padStart(2, "0"),
      name,
      phone: "+962790000" + String(index + 1).padStart(2, "0"),
      email: "",
      role: index % 2 ? "Sales Representative" : "Customer Support",
      language: index % 4 === 0 ? "English" : "العربية",
    }));
    setSchedule([]);
    setCandidates(demo);
    setFileName("بيانات تجريبية");
    setImportNotes({ duplicates: 0, invalid: 0, missingPhones: 0 });
    toast.success("تم تحميل البيانات وجدولتها تلقائيًا.");
  };

  const buildAllSlots = () => {
    return buildInterviewSlots(interviewerStats, duration, slotLength);
  };

  const plannedSchedule = useMemo(
    () => {
      if (!configurationValid || !date) return [];
      return createScheduleRows({
        candidates,
        interviewDate: date,
        interviewerStats,
        duration,
        slotLength,
      });
    },
    [
      candidates,
      configurationValid,
      date,
      duration,
      interviewerStats,
      slotLength,
    ],
  );
  const unscheduledCandidates = useMemo(
    () => candidates.slice(plannedSchedule.length),
    [candidates, plannedSchedule.length],
  );

  useEffect(() => {
    if (workspaceHydrationVersion !== handledHydrationVersion.current) {
      handledHydrationVersion.current = workspaceHydrationVersion;
      setCurrentPage(1);
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      setSchedule((current) => {
        const previous = new Map(current.map((row) => [row.scheduleId, row]));
        return plannedSchedule.map((row) => {
          const old = previous.get(row.scheduleId);
          const sameAppointment =
            old &&
            old.date === row.date &&
            old.start === row.start &&
            old.end === row.end &&
            old.interviewerId === row.interviewerId;
          return sameAppointment
            ? {
                ...row,
                status: old.status,
                meetingId: old.meetingId || row.meetingId,
                interviewStatus: old.interviewStatus,
                workPreference: old.workPreference,
                googleEventId: old.googleEventId || "",
                meetLink: old.meetLink || "",
                calendarLink: old.calendarLink || "",
                meetingSyncStatus: old.meetingSyncStatus || "not_created",
                meetingSyncError: old.meetingSyncError || "",
              }
            : old?.googleEventId
              ? {
                  ...row,
                  status: old.status,
                  meetingId: old.meetingId || row.meetingId,
                  interviewStatus: old.interviewStatus,
                  workPreference: old.workPreference,
                  googleEventId: old.googleEventId,
                  meetLink: old.meetLink || "",
                  calendarLink: old.calendarLink || "",
                  meetingSyncStatus: "needs_update" as const,
                  meetingSyncError: "",
                }
              : row;
        });
      });
      setCurrentPage(1);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [plannedSchedule, workspaceHydrationVersion]);

  const workspaceSnapshot = useMemo<SharedSchedulerStateV1>(
    () => ({
      schemaVersion: 1,
      candidates,
      schedule,
      interviewers,
      availabilityByDate,
      date,
      duration,
      gap,
      companyName,
      positionByDate,
      trainingStartByDate,
      onboarding, messageTemplates, candidateOnboarding,
      defaultMeetingLink,
      defaultCountryCode,
      messageLanguage,
      fileName,
      importNotes,
    }),
    [
      availabilityByDate,
      candidates,
      companyName,
      date,
      defaultCountryCode,
      defaultMeetingLink,
      duration,
      fileName,
      gap,
      importNotes,
      interviewers,
      positionByDate,
      trainingStartByDate,
      onboarding, messageTemplates, candidateOnboarding,
      messageLanguage,
      schedule,
    ],
  );
  const workspaceSnapshotJson = useMemo(
    () => JSON.stringify(workspaceSnapshot),
    [workspaceSnapshot],
  );

  useLayoutEffect(() => {
    currentSnapshotRef.current = workspaceSnapshot;
    currentSnapshotJsonRef.current = workspaceSnapshotJson;
    workspacePhaseRef.current = workspacePhase;
    syncStatusRef.current = syncStatus;
  }, [syncStatus, workspacePhase, workspaceSnapshot, workspaceSnapshotJson]);
  const isWorkspaceDirty =
    workspacePhase === "ready" && workspaceSnapshotJson !== lastSyncedJson;

  const applyWorkspaceState = useCallback(
    (rawState: unknown, revision: number, updatedAt: string) => {
      const state = normalizeWorkspaceState(rawState);
      if (!state || !Number.isInteger(revision) || revision < 1) return false;

      saveGenerationRef.current += 1;
      importRequestId.current += 1;
      setCandidates(state.candidates);
      setSchedule(state.schedule);
      setInterviewers(state.interviewers);
      setAvailabilityByDate(state.availabilityByDate);
      setDate(state.date);
      setDuration(state.duration);
      setGap(state.gap);
      setCompanyName(state.companyName);
      setPositionByDate(state.positionByDate);
      setTrainingStartByDate(state.trainingStartByDate);
      setDefaultMeetingLink(state.defaultMeetingLink);
      setOnboarding(state.onboarding);
      setMessageTemplates(state.messageTemplates);
      setCandidateOnboarding(state.candidateOnboarding);
      setFileName(state.fileName);
      setImportNotes(state.importNotes);
      setWorkspaceHydrationVersion((current) => current + 1);
      setWorkspaceRevision(revision);
      workspaceRevisionRef.current = revision;
      setWorkspaceUpdatedAt(updatedAt);
      const serializedState = JSON.stringify(state);
      lastSyncedJsonRef.current = serializedState;
      setLastSyncedJson(serializedState);
      setWorkspaceConflict(null);
      setWorkspaceError("");
      setSyncStatus("saved");
      syncStatusRef.current = "saved";
      setWorkspacePhase("ready");
      workspacePhaseRef.current = "ready";
      setCurrentPage(1);
      return true;
    },
    [],
  );

  useEffect(() => {
    if (!availabilityStorageReady || !messageSettingsReady) return;
    const controller = new AbortController();

    const openSavedWorkspace = async () => {
      setWorkspacePhase("checking");
      workspacePhaseRef.current = "checking";
      setSyncStatus("loading");
      syncStatusRef.current = "loading";
      try {
        const response = await fetch("/api/workspace", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await response.json()) as WorkspaceResponse;
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          setWorkspacePhase("locked");
          workspacePhaseRef.current = "locked";
          setSyncStatus("loading");
          return;
        }
        if (!response.ok) throw new Error(data.error || "تعذر فتح مساحة الفريق.");
        const applied = applyWorkspaceState(
          data.state,
          Number(data.revision),
          typeof data.updatedAt === "string" ? data.updatedAt : "",
        );
        if (!applied) throw new Error("بيانات مساحة الفريق غير صالحة.");
      } catch (error) {
        if (controller.signal.aborted) return;
        setWorkspaceError(error instanceof Error ? error.message : "تعذر فتح مساحة الفريق.");
        setWorkspacePhase("locked");
        workspacePhaseRef.current = "locked";
        setSyncStatus("error");
        syncStatusRef.current = "error";
      }
    };

    void openSavedWorkspace();
    return () => controller.abort();
  }, [applyWorkspaceState, availabilityStorageReady, messageSettingsReady]);

  const persistWorkspaceState = useCallback(
    async (state: SharedSchedulerStateV1, force = false) => {
      if (workspacePhaseRef.current !== "ready" || (!force && syncStatusRef.current === "conflict")) {
        return;
      }
      setSyncStatus("saving");
      syncStatusRef.current = "saving";
      setWorkspaceError("");
      try {
        const response = await fetch("/api/workspace", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            state,
            baseRevision: workspaceRevisionRef.current,
            force,
          }),
        });
        const data = (await response.json()) as WorkspaceResponse;
        if (response.status === 401) {
          setWorkspacePhase("locked");
          workspacePhaseRef.current = "locked";
          setWorkspaceError("انتهت جلسة هذا الجهاز. أدخل رمز الفريق من جديد.");
          setSyncStatus("error");
          syncStatusRef.current = "error";
          return;
        }
        if (response.status === 409) {
          const latest = normalizeWorkspaceState(data.state);
          const revision = Number(data.revision);
          if (latest && Number.isInteger(revision) && revision > 0) {
            saveGenerationRef.current += 1;
            setWorkspaceConflict({
              state: latest,
              revision,
              updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "",
            });
            setSyncStatus("conflict");
            syncStatusRef.current = "conflict";
            return;
          }
        }
        if (!response.ok) throw new Error(data.error || "تعذر حفظ بيانات الفريق.");
        const revision = Number(data.revision);
        if (!Number.isInteger(revision) || revision < 1) {
          throw new Error("لم يصل تأكيد صحيح من الخادم.");
        }
        workspaceRevisionRef.current = revision;
        setWorkspaceRevision(revision);
        setWorkspaceUpdatedAt(typeof data.updatedAt === "string" ? data.updatedAt : "");
        const serializedState = JSON.stringify(state);
        lastSyncedJsonRef.current = serializedState;
        setLastSyncedJson(serializedState);
        setWorkspaceConflict(null);
        setSyncStatus("saved");
        syncStatusRef.current = "saved";
      } catch (error) {
        setWorkspaceError(error instanceof Error ? error.message : "تعذر حفظ بيانات الفريق.");
        setSyncStatus("error");
        syncStatusRef.current = "error";
      }
    },
    [],
  );

  const enqueueWorkspaceSave = useCallback(
    (state: SharedSchedulerStateV1, force = false) => {
      const generation = saveGenerationRef.current;
      const serializedState = JSON.stringify(state);
      saveQueueRef.current = saveQueueRef.current
        .then(async () => {
          if (!force && generation !== saveGenerationRef.current) return;
          if (!force && serializedState === lastSyncedJsonRef.current) return;
          await persistWorkspaceState(state, force);
        })
        .catch(() => undefined);
      return saveQueueRef.current;
    },
    [persistWorkspaceState],
  );

  useEffect(() => {
    if (
      workspacePhase !== "ready" ||
      workspaceConflict ||
      workspaceSnapshotJson === lastSyncedJson
    ) {
      return;
    }
    const snapshot = workspaceSnapshot;
    const timer = window.setTimeout(() => {
      void enqueueWorkspaceSave(snapshot);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [
    enqueueWorkspaceSave,
    lastSyncedJson,
    workspaceConflict,
    workspacePhase,
    workspaceSnapshot,
    workspaceSnapshotJson,
  ]);

  useEffect(() => {
    if (workspacePhase !== "ready") return;

    const saveBeforeBackgrounding = () => {
      if (
        document.visibilityState === "hidden" &&
        currentSnapshotRef.current &&
        currentSnapshotJsonRef.current !== lastSyncedJsonRef.current &&
        syncStatusRef.current !== "conflict"
      ) {
        void enqueueWorkspaceSave(currentSnapshotRef.current);
      }
    };
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (!isWorkspaceDirty && syncStatusRef.current !== "saving") return;
      event.preventDefault();
      event.returnValue = "";
    };

    document.addEventListener("visibilitychange", saveBeforeBackgrounding);
    window.addEventListener("pagehide", saveBeforeBackgrounding);
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => {
      document.removeEventListener("visibilitychange", saveBeforeBackgrounding);
      window.removeEventListener("pagehide", saveBeforeBackgrounding);
      window.removeEventListener("beforeunload", warnBeforeLeaving);
    };
  }, [enqueueWorkspaceSave, isWorkspaceDirty, workspacePhase]);

  const refreshWorkspace = useCallback(
    async (showResult = false) => {
      if (workspacePhaseRef.current !== "ready" || refreshInFlightRef.current) return;
      refreshInFlightRef.current = true;
      try {
        const response = await fetch("/api/workspace", { cache: "no-store" });
        const data = (await response.json()) as WorkspaceResponse;
        if (response.status === 401) {
          setWorkspacePhase("locked");
          workspacePhaseRef.current = "locked";
          setWorkspaceError("انتهت جلسة هذا الجهاز. أدخل رمز الفريق من جديد.");
          return;
        }
        if (!response.ok) throw new Error(data.error || "تعذر تحديث بيانات الفريق.");
        const remoteState = normalizeWorkspaceState(data.state);
        const remoteRevision = Number(data.revision);
        if (!remoteState || !Number.isInteger(remoteRevision) || remoteRevision < 1) {
          throw new Error("بيانات مساحة الفريق غير صالحة.");
        }
        if (remoteRevision > workspaceRevisionRef.current) {
          const hasLocalChanges = currentSnapshotJsonRef.current !== lastSyncedJsonRef.current;
          if (hasLocalChanges) {
            saveGenerationRef.current += 1;
            setWorkspaceConflict({
              state: remoteState,
              revision: remoteRevision,
              updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "",
            });
            setSyncStatus("conflict");
            syncStatusRef.current = "conflict";
          } else {
            applyWorkspaceState(
              remoteState,
              remoteRevision,
              typeof data.updatedAt === "string" ? data.updatedAt : "",
            );
            if (showResult) toast.success("تم تحميل أحدث نسخة من مساحة الفريق.");
          }
        } else if (showResult) {
          toast.success("هذه أحدث نسخة بالفعل.");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "تعذر تحديث بيانات الفريق.";
        setWorkspaceError(message);
        if (showResult) toast.error(message);
      } finally {
        refreshInFlightRef.current = false;
      }
    },
    [applyWorkspaceState],
  );

  useEffect(() => {
    if (workspacePhase !== "ready") return;
    const interval = window.setInterval(() => void refreshWorkspace(false), 15_000);
    const onFocus = () => void refreshWorkspace(false);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshWorkspace, workspacePhase]);

  const createWorkspace = async () => {
    const state = currentSnapshotRef.current;
    if (!state) return;
    setWorkspacePhase("creating");
    workspacePhaseRef.current = "creating";
    setWorkspaceError("");
    try {
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", state }),
      });
      const data = (await response.json()) as WorkspaceResponse;
      if (!response.ok) throw new Error(data.error || "تعذر إنشاء مساحة الفريق.");
      if (
        typeof data.code !== "string" ||
        !Number.isInteger(Number(data.revision)) ||
        Number(data.revision) < 1
      ) {
        throw new Error("لم يصل رمز فريق صالح من الخادم.");
      }
      const revision = Number(data.revision);
      setCreatedWorkspaceCode(data.code);
      setWorkspaceRevision(revision);
      workspaceRevisionRef.current = revision;
      setWorkspaceUpdatedAt(typeof data.updatedAt === "string" ? data.updatedAt : "");
      const serializedState = JSON.stringify(state);
      lastSyncedJsonRef.current = serializedState;
      setLastSyncedJson(serializedState);
      setSyncStatus("saved");
      syncStatusRef.current = "saved";
      setWorkspacePhase("created");
      workspacePhaseRef.current = "created";
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "تعذر إنشاء مساحة الفريق.");
      setWorkspacePhase("locked");
      workspacePhaseRef.current = "locked";
    }
  };

  const joinWorkspace = async () => {
    if (!workspaceCode.trim()) {
      setWorkspaceError("أدخل رمز الفريق أولًا.");
      return;
    }
    setWorkspacePhase("joining");
    workspacePhaseRef.current = "joining";
    setWorkspaceError("");
    try {
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "join", code: workspaceCode }),
      });
      const data = (await response.json()) as WorkspaceResponse;
      if (!response.ok) throw new Error(data.error || "تعذر فتح مساحة الفريق.");
      const applied = applyWorkspaceState(
        data.state,
        Number(data.revision),
        typeof data.updatedAt === "string" ? data.updatedAt : "",
      );
      if (!applied) throw new Error("بيانات مساحة الفريق غير صالحة.");
      setWorkspaceCode("");
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "تعذر فتح مساحة الفريق.");
      setWorkspacePhase("locked");
      workspacePhaseRef.current = "locked";
    }
  };

  const acknowledgeCreatedWorkspace = () => {
    setCreatedWorkspaceCode("");
    setWorkspacePhase("ready");
    workspacePhaseRef.current = "ready";
  };

  const copyWorkspaceCode = async () => {
    if (!createdWorkspaceCode) return;
    try {
      await navigator.clipboard.writeText(createdWorkspaceCode);
      toast.success("تم نسخ رمز الفريق.");
    } catch {
      setWorkspaceError("تعذر النسخ التلقائي. حدّد الرمز وانسخه يدويًا.");
    }
  };

  const lockThisDevice = async () => {
    if (isLocking) return;
    setIsLocking(true);
    setWorkspaceError("");
    try {
      if (
        currentSnapshotRef.current &&
        currentSnapshotJsonRef.current !== lastSyncedJsonRef.current &&
        syncStatusRef.current !== "conflict"
      ) {
        await enqueueWorkspaceSave(currentSnapshotRef.current);
      }
      await saveQueueRef.current;
      if (syncStatusRef.current === "conflict") {
        throw new Error("حل تعارض النسختين قبل قفل هذا الجهاز.");
      }
      if (syncStatusRef.current === "error") {
        throw new Error("احفظ التعديلات بنجاح قبل قفل هذا الجهاز.");
      }
      const response = await fetch("/api/workspace", { method: "DELETE" });
      if (!response.ok) throw new Error("تعذر قفل هذا الجهاز. تحقق من الاتصال وحاول مجددًا.");

      setWorkspacePhase("locked");
      workspacePhaseRef.current = "locked";
      saveGenerationRef.current += 1;
      setWorkspaceConflict(null);
      setWorkspaceCode("");
      setCreatedWorkspaceCode("");
      setWorkspaceRevision(0);
      workspaceRevisionRef.current = 0;
      setWorkspaceUpdatedAt("");
      lastSyncedJsonRef.current = "";
      setLastSyncedJson("");
      setCandidates([]);
      setSchedule([]);
      setInterviewers(DEFAULT_INTERVIEWERS.map((interviewer) => ({ ...interviewer })));
      setAvailabilityByDate({});
      setDate(dateISO(0));
      setDuration(5);
      setGap(0);
      setCompanyName(DEFAULT_COMPANY_NAME);
      setPositionByDate({});
      setTrainingStartByDate({});
      setDefaultMeetingLink("");
      setOnboarding(DEFAULT_ONBOARDING);
      setMessageTemplates(DEFAULT_TEMPLATES);
      setCandidateOnboarding({});
      setSessionPasswords({});
      setFileName("");
      setImportNotes({ duplicates: 0, invalid: 0, missingPhones: 0 });
      setSearch("");
      setInterviewerFilter("all");
      setStatusFilter("all");
      setInterviewStatusFilter("all");
      window.localStorage.removeItem(DAILY_AVAILABILITY_STORAGE_KEY);
      window.localStorage.removeItem(MESSAGE_SETTINGS_STORAGE_KEY);
    } catch (error) {
      const message = error instanceof Error ? error.message : "تعذر قفل هذا الجهاز.";
      setWorkspaceError(message);
      toast.error(message);
    } finally {
      setIsLocking(false);
    }
  };

  const acceptRemoteConflict = () => {
    if (!workspaceConflict) return;
    applyWorkspaceState(
      workspaceConflict.state,
      workspaceConflict.revision,
      workspaceConflict.updatedAt,
    );
    toast.success("تم تحميل نسخة الفريق الأحدث.");
  };

  const keepLocalConflict = () => {
    const state = currentSnapshotRef.current;
    if (!state) return;
    saveGenerationRef.current += 1;
    setWorkspaceConflict(null);
    setSyncStatus("saving");
    syncStatusRef.current = "saving";
    void enqueueWorkspaceSave(state, true);
  };

  const generateSchedule = useCallback(() => {
    if (!candidates.length) {
      toast.error("ارفع ملف المرشحين أولًا.");
      return;
    }
    if (!configurationValid) {
      toast.error("أدخل اسم كل موظف وتأكد أن فتراته صحيحة ولا تتداخل.");
      return;
    }
    if (!date) {
      toast.error("اختر تاريخ المقابلات.");
      return;
    }
    if (!totalCapacity) {
      toast.error("الأوقات الحالية لا تتسع لأي مقابلة بهذه المدة.");
      return;
    }
    setSchedule((current) => {
      const previous = new Map(current.map((row) => [row.id, row]));
      return plannedSchedule.map((row) => {
        const old = previous.get(row.id);
        return old
          ? {
              ...row,
              status: old.status,
              interviewStatus: old.interviewStatus,
              workPreference: old.workPreference,
            }
          : row;
      });
    });
    setCurrentPage(1);
    if (unscheduledCandidates.length) {
      toast.warning(
        "تمت جدولة " +
          plannedSchedule.length +
          " وبقي " +
          unscheduledCandidates.length +
          " دون موعد.",
      );
    } else {
      toast.success("تم ترتيب " + plannedSchedule.length + " مقابلة لهذا اليوم.");
    }
  }, [
    candidates.length,
    configurationValid,
    date,
    plannedSchedule,
    totalCapacity,
    unscheduledCandidates.length,
  ]);

  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: ModelContextLike;
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();

    void Promise.resolve(
      context.registerTool(
        {
          name: "generate_interview_schedule",
          title: "إنشاء جدول المقابلات",
          description:
            "يوزع مقابلات يوم واحد تلقائيًا حسب فترات توفر كل موظف، دون تداخل.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: false,
            untrustedContentHint: false,
          },
          async execute() {
            if (!candidates.length) {
              throw new Error("يجب استيراد ملف المرشحين أولًا.");
            }
            if (!configurationValid || !date || !totalCapacity) {
              throw new Error("إعدادات الجدولة غير مكتملة.");
            }
            generateSchedule();
            await new Promise<void>((resolve) => {
              window.requestAnimationFrame(() => resolve());
            });
            return {
              imported_candidates: candidates.length,
              scheduled_candidates: plannedSchedule.length,
              daily_capacity: totalCapacity,
              interviewers: interviewerScheduleCounts,
              unscheduled_candidates: unscheduledCandidates.length,
              interview_date: date,
            };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => undefined);

    return () => lifecycle.abort();
  }, [
    candidates,
    configurationValid,
    date,
    duration,
    gap,
    generateSchedule,
    interviewerScheduleCounts,
    interviewers,
    plannedSchedule,
    totalCapacity,
    unscheduledCandidates.length,
  ]);

  const manualMeetingLinkForRow = (row: ScheduleRow) => {
    const raw = interviewers.find((interviewer) => interviewer.id === row.interviewerId)?.meetingLink?.trim() || defaultMeetingLink.trim();
    return normalizeMeetLink(raw).url;
  };

  const positionForRow = (row: ScheduleRow) =>
    positionByDate[row.date]?.trim() || row.role?.trim() || "Recruitment Sourcing Associate";

  const messageValues = (row: ScheduleRow, includePassword = false) => ({
    "Candidate Name": row.name,
    "Position": positionForRow(row),
    "Company": companyName.trim() || DEFAULT_COMPANY_NAME,
    "Date": formatDate(row.date, "en-GB"),
    "Time": formatTime(row.start, "en-GB"),
    "Time Zone": "Makkah time (UTC+3)",
    "Time Remaining": formatRemainingTime(row, "en"),
    "Meeting Link": manualMeetingLinkForRow(row),
    "Training Start Date": validDate(onboarding.trainingStartDate) ? formatDate(onboarding.trainingStartDate, "en-GB") : "",
    "Employment Start Date": validDate(onboarding.employmentStartDate) ? formatDate(onboarding.employmentStartDate, "en-GB") : "",
    "Payroll Date": validDate(onboarding.payrollDate) ? formatDate(onboarding.payrollDate, "en-GB") : "",
    "Monthly Salary": onboarding.salary,
    "Working Hours": onboarding.workingHours,
    "Countries": candidateOnboarding[row.id]?.countries || "",
    "Talureva Login Link": onboarding.platformUrl.trim(),
    "Login ID": candidateOnboarding[row.id]?.loginId || "",
    "Password": includePassword ? sessionPasswords[row.id] || "" : "[Provided separately]",
    "Video Link": onboarding.tutorialUrl.trim(),
  });
  const messageFor = (row: ScheduleRow, kind: MessageKind) => renderTemplate(messageTemplates[kind], messageValues(row, kind === "training"));
  const attendanceConfirmationUrl = (row: ScheduleRow) =>
    "https://wa.me/" + CONFIRMATION_WHATSAPP_NUMBER +
    "?text=" + encodeURIComponent(
      "CONFIRMED — Meeting ID: " + row.meetingId + " — Candidate: " + row.name,
    );
  const RECRUITMENT_SIGNATURE = "HRadeeco Recruitment Team";
  const emailMessageFor = (row: ScheduleRow, kind: MessageKind) => {
    // Keep the company signature below every generated detail, including the
    // Meeting ID and WhatsApp confirmation link in the invitation email.
    const message = messageFor(row, kind)
      .replace(/\s*HRadeeco Recruitment Team\s*$/, "")
      .trimEnd();
    if (kind !== "invitation") return message + "\n\n" + RECRUITMENT_SIGNATURE;
    return message +
      "\n\nMeeting ID: " + row.meetingId +
      "\n\nConfirm your attendance on WhatsApp:\n" + attendanceConfirmationUrl(row) +
      "\n\n" + RECRUITMENT_SIGNATURE;
  };
  const emailSubjectFor = (row: ScheduleRow, kind: MessageKind) => {
    const label = kind === "invitation"
      ? "Interview Invitation"
      : kind === "meeting"
        ? "Your Interview Is Ready"
        : "Interview Outcome";
    return label + " — Meeting ID " + row.meetingId;
  };
  const preparedEmailUrl = (row: ScheduleRow, kind: MessageKind) =>
    "mailto:" + encodeURIComponent(row.email.trim()) +
    "?subject=" + encodeURIComponent(emailSubjectFor(row, kind)) +
    "&body=" + encodeURIComponent(emailMessageFor(row, kind));
  const buildMessage = (row: ScheduleRow) => emailMessageFor(row, "invitation");
  const buildMeetingMessage = (row: ScheduleRow) => emailMessageFor(row, "meeting");
  const messageIssue = (row: ScheduleRow, kind: MessageKind) => {
    const issue = templateIssue(messageTemplates[kind], kind);
    if (issue) return issue;
    if (kind !== "meeting" && /[\u0600-\u06ff]/.test(positionForRow(row) + companyName)) return "اكتب المسمى الوظيفي واسم الجهة بالإنجليزية في الإعدادات.";
    if (kind === "meeting" && !manualMeetingLinkForRow(row)) return "أضف رابط Google Meet صالحًا تحت اسم الموظف أولًا.";
    if (kind === "training") {
      if (row.interviewStatus !== "تمت المقابلة") return "سجّل «تمت المقابلة» قبل تجهيز رسالة القبول لهذا المرشح.";
      if (row.workPreference === "لا يرغب بالعمل") return "هذا المرشح مسجل بأنه لا يرغب بالعمل. راجع النتيجة قبل إرسال القبول.";
      if (![onboarding.trainingStartDate, onboarding.employmentStartDate, onboarding.payrollDate].every(validDate)) return "راجع مواعيد التدريب والعمل وأول صرف في الإعدادات.";
      if (onboarding.trainingStartDate < row.date) return "بداية التدريب المثبتة تسبق هذه المقابلة. حدّث مواعيد الدفعة في الإعدادات.";
      if (onboarding.employmentStartDate <= onboarding.trainingStartDate || onboarding.payrollDate < onboarding.employmentStartDate) return "بداية العمل يجب أن تلي التدريب، وأول صرف يجب ألا يسبق بداية العمل.";
      if (!validHttpsUrl(onboarding.platformUrl) || !validHttpsUrl(onboarding.tutorialUrl)) return "أضف رابط Talureva ورابط الفيديو بصيغة HTTPS في الإعدادات أولًا.";
      if (!candidateOnboarding[row.id]?.countries.trim()) return "حدّد الدول المخصصة لهذا الشخص بالإنجليزية.";
      if (!candidateOnboarding[row.id]?.loginId.trim() || !sessionPasswords[row.id]) return "أدخل Login ID وكلمة المرور المؤقتة للحساب الذي جهزته لهذا الشخص.";
      if (!onboarding.workingHours.trim() || !(Number(onboarding.salary) > 0)) return "أكمل الراتب ونظام العمل في الإعدادات.";
      if (/[\u0600-\u06ff]/.test(onboarding.workingHours + (candidateOnboarding[row.id]?.countries || ""))) return "اكتب نظام العمل والدول بالإنجليزية حتى تبقى الرسالة إنجليزية بالكامل.";
    }
    return "";
  };

  const copyPreparedMessage = async (row: ScheduleRow, kind: MessageKind) => {
    const issue = messageIssue(row, kind);
    if (issue) { toast.error(issue); return; }
    try {
      await navigator.clipboard.writeText(emailMessageFor(row, kind));
      toast.success("تم نسخ رسالة " + firstName(row.name) + ".");
    } catch { toast.error("تعذر النسخ. جرّب فتح الإيميل مباشرة."); }
  };

  const openPreparedEmail = (row: ScheduleRow, kind: MessageKind) => {
    const issue = messageIssue(row, kind);
    if (issue) { toast.error(issue); return; }
    if (!isValidEmail(row.email)) {
      toast.error("لا يوجد بريد إلكتروني صالح لهذا المرشح."); return;
    }
    window.location.href = preparedEmailUrl(row, kind);
  };

  const openSecureLink = (value: string, label: string) => {
    const result = normalizeMeetLink(value);
    if (!result.url || result.error) { toast.error(result.error || "رابط " + label + " غير صالح."); return; }
    window.open(result.url, "_blank", "noopener,noreferrer");
  };

  const updateStatus = (scheduleId: string, status: CandidateStatus) => {
    setSchedule((current) =>
      current.map((row) => (row.scheduleId === scheduleId ? { ...row, status } : row)),
    );
  };

  const updateInterviewStatus = (scheduleId: string, interviewStatus: InterviewStatus) => {
    setSchedule((current) =>
      current.map((row) =>
        row.scheduleId === scheduleId ? { ...row, interviewStatus } : row,
      ),
    );
  };

  const updateWorkPreference = (scheduleId: string, workPreference: WorkPreference) => {
    setSchedule((current) =>
      current.map((row) =>
        row.scheduleId === scheduleId ? { ...row, workPreference } : row,
      ),
    );
  };

  const markSent = (scheduleId: string) => {
    updateStatus(scheduleId, "بانتظار التأكيد");
    toast.success("تم تعليم الرسالة كمرسلة.");
  };

  const moveToNextAvailable = (scheduleId: string) => {
    const currentRow = schedule.find((row) => row.scheduleId === scheduleId);
    if (!currentRow) return;
    const used = new Set(
      schedule
        .filter((row) => row.scheduleId !== scheduleId)
        .map((row) => row.date + "|" + row.start + "|" + row.interviewerId),
    );
    const laterSlots = buildAllSlots().filter(
      (slot) => timeToMinutes(slot.start) > timeToMinutes(currentRow.start),
    );
    const ordered = [
      ...laterSlots.filter((slot) => slot.interviewerId === currentRow.interviewerId),
      ...laterSlots.filter((slot) => slot.interviewerId !== currentRow.interviewerId),
    ];
    const free = ordered.find(
      (slot) => !used.has(date + "|" + slot.start + "|" + slot.interviewerId),
    );
    if (!free) {
      toast.error("لا يوجد موعد شاغر تالٍ ضمن أوقات هذا اليوم.");
      return;
    }
    setSchedule((current) =>
      current.map((row) =>
        row.scheduleId === scheduleId
          ? {
              ...row,
              date,
              start: free.start,
              end: free.end,
              blockId: free.blockId,
              blockLabel: free.blockLabel,
              interviewerId: free.interviewerId,
              interviewer: free.interviewer,
              status: "طلب تغيير",
              meetingSyncStatus: row.googleEventId ? "needs_update" : "not_created",
              meetingSyncError: "",
            }
          : row,
      ),
    );
    toast.success("تم نقل " + firstName(currentRow.name) + " إلى أقرب موعد شاغر.");
  };

  const exportSchedule = () => {
    if (!schedule.length) {
      toast.error("أنشئ الجدول قبل التصدير.");
      return;
    }
    const rows = scopedSchedule.map((row) => ({
      "رقم المرشح": row.id,
      "Meeting ID": row.meetingId,
      الاسم: row.name,
      الهاتف: row.phone,
      البريد: row.email,
      الوظيفة: row.role,
      اللغة: row.language,
      التاريخ: row.date,
      "وقت البداية": row.start,
      "وقت النهاية": row.end,
      الفترة: row.blockLabel,
      المقابل: row.interviewer,
      الحالة: row.status,
      "حالة المقابلة": row.interviewStatus,
      "الرغبة بالعمل": row.workPreference,
      "البوزيشن في الرسالة": positionForRow(row),
      "رابط الاجتماع اليدوي": manualMeetingLinkForRow(row),
      "رسالة الموعد": buildMessage(row),
      "رسالة إرسال الرابط": buildMeetingMessage(row),
      "الدول المخصصة": candidateOnboarding[row.id]?.countries || "",
      "رابط الإيميل - دعوة المقابلة": isValidEmail(row.email)
        ? preparedEmailUrl(row, "invitation")
        : "",
      "رابط الإيميل - إرسال الاجتماع": isValidEmail(row.email) && manualMeetingLinkForRow(row)
        ? preparedEmailUrl(row, "meeting")
        : "",
      "رابط تأكيد الحضور عبر واتساب": attendanceConfirmationUrl(row),
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet["!cols"] = [
      { wch: 15 },
      { wch: 24 },
      { wch: 18 },
      { wch: 28 },
      { wch: 24 },
      { wch: 12 },
      { wch: 14 },
      { wch: 13 },
      { wch: 13 },
      { wch: 16 },
      { wch: 18 },
      { wch: 18 },
      { wch: 20 },
      { wch: 42 },
      { wch: 42 },
      { wch: 70 },
      { wch: 40 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "جدول المقابلات");
    const interviewedWorksheet = XLSX.utils.json_to_sheet(
      rows.filter((row) => row["حالة المقابلة"] === "تمت المقابلة"),
    );
    interviewedWorksheet["!cols"] = [
      { wch: 15 },
      { wch: 24 },
      { wch: 18 },
      { wch: 28 },
      { wch: 24 },
      { wch: 12 },
      { wch: 14 },
      { wch: 13 },
      { wch: 13 },
      { wch: 16 },
      { wch: 18 },
      { wch: 18 },
      { wch: 20 },
      { wch: 42 },
      { wch: 42 },
      { wch: 70 },
      { wch: 40 },
    ];
    XLSX.utils.book_append_sheet(workbook, interviewedWorksheet, "تمت مقابلتهم");
    if (interviewerFilter === "all" && unscheduledCandidates.length) {
      const unscheduledWorksheet = XLSX.utils.json_to_sheet(
        unscheduledCandidates.map((candidate) => ({
          "رقم المرشح": candidate.id,
          الاسم: candidate.name,
          الهاتف: candidate.phone,
          البريد: candidate.email,
          الوظيفة: candidate.role,
          اللغة: candidate.language,
          السبب: "السعة اليومية غير كافية",
        })),
      );
      XLSX.utils.book_append_sheet(workbook, unscheduledWorksheet, "غير مجدولين");
    }
    downloadWorkbook(workbook, "Interview_Schedule_" + date + ".xlsx");
    toast.success(
      "تم تنزيل الجدول، وتبويب تمت مقابلتهم يحتوي على " + interviewedCount + " شخصًا.",
    );
  };

  const downloadTemplate = () => {
    const worksheet = XLSX.utils.json_to_sheet([
      {
        "Candidate ID": "C-001",
        "Full Name": "اسم المرشح",
        "Phone Number": "+962790000000",
        Email: "candidate@example.com",
        "Job Title": "Sales Representative",
        Language: "Arabic",
      },
    ]);
    worksheet["!cols"] = [
      { wch: 16 },
      { wch: 24 },
      { wch: 20 },
      { wch: 30 },
      { wch: 28 },
      { wch: 14 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Candidates");
    downloadWorkbook(workbook, "Interview_Candidates_Template.xlsx");
  };

  const updateInterviewer = (
    interviewerId: string,
    field: "name" | "meetingLink" | "googleEmail",
    value: string,
  ) => {
    setInterviewers((current) =>
      current.map((interviewer) =>
        interviewer.id === interviewerId ? { ...interviewer, [field]: value } : interviewer,
      ),
    );
  };

  const updateDailyAvailability = (
    interviewerId: string,
    updater: (availability: InterviewerAvailability) => InterviewerAvailability,
  ) => {
    if (!date) {
      toast.error("اختر يوم المقابلات أولًا.");
      return;
    }
    setAvailabilityByDate((current) => {
      const dayAvailability = current[date] || {};
      const existing = safeAvailability(interviewerId, dayAvailability[interviewerId]);
      const next = updater({
        enabled: existing.enabled,
        blocks: existing.blocks.map((block) => ({ ...block })),
      });
      return {
        ...current,
        [date]: {
          ...dayAvailability,
          [interviewerId]: next,
        },
      };
    });
  };

  const updateBlock = (
    interviewerId: string,
    blockId: string,
    field: "start" | "end",
    value: string,
  ) => {
    updateDailyAvailability(interviewerId, (availability) => ({
      ...availability,
      blocks: availability.blocks.map((block) =>
        block.id === blockId ? { ...block, [field]: value } : block,
      ),
    }));
  };

  const addBlock = (interviewerId: string) => {
    updateDailyAvailability(interviewerId, (availability) => {
        const lastEnd = availability.blocks.at(-1)?.end || "09:00";
        const lastEndMinutes = timeToMinutes(lastEnd);
        const startMinutes = Math.min(
          (Number.isFinite(lastEndMinutes) ? lastEndMinutes : 8 * 60) + 60,
          23 * 60,
        );
        const endMinutes = Math.min(startMinutes + 180, 23 * 60 + 59);
        return {
          ...availability,
          blocks: [
            ...availability.blocks,
            {
              id: interviewerId + "-period-" + crypto.randomUUID(),
              label: "الفترة " + (availability.blocks.length + 1),
              start: minutesToTime(startMinutes),
              end: minutesToTime(endMinutes),
            },
          ],
        };
      });
  };

  const removeBlock = (interviewerId: string, blockId: string) => {
    const interviewer = interviewerStats.find((item) => item.id === interviewerId);
    if (!interviewer || interviewer.blocks.length === 1) {
      toast.error("يجب إبقاء فترة واحدة على الأقل لكل موظف.");
      return;
    }
    updateDailyAvailability(interviewerId, (availability) => ({
      ...availability,
      blocks: availability.blocks
        .filter((block) => block.id !== blockId)
        .map((block, index) => ({ ...block, label: "الفترة " + (index + 1) })),
    }));
  };

  const setInterviewerAvailable = (interviewerId: string, enabled: boolean) => {
    updateDailyAvailability(interviewerId, (availability) => ({
      ...availability,
      enabled,
    }));
  };

  const copyPreviousDayAvailability = () => {
    if (!previousDate || !availabilityByDate[previousDate]) {
      toast.error("لا توجد أوقات محفوظة لليوم السابق.");
      return;
    }
    const previous = availabilityByDate[previousDate];
    const copied = Object.fromEntries(
      interviewers.map((interviewer) => {
        const availability = safeAvailability(interviewer.id, previous[interviewer.id]);
        return [
          interviewer.id,
          {
            enabled: availability.enabled,
            blocks: availability.blocks.map((block) => ({
              ...block,
              id: interviewer.id + "-period-" + crypto.randomUUID(),
            })),
          },
        ];
      }),
    );
    setAvailabilityByDate((current) => ({ ...current, [date]: copied }));
    toast.success("تم نسخ أوقات اليوم السابق.");
  };

  const resetCurrentDayAvailability = () => {
    if (!date) {
      toast.error("اختر يوم المقابلات أولًا.");
      return;
    }
    setAvailabilityByDate((current) => ({
      ...current,
      [date]: Object.fromEntries(
        interviewers.map((interviewer) => [
          interviewer.id,
          defaultAvailability(interviewer.id),
        ]),
      ),
    }));
    toast.success("تمت إعادة أوقات هذا اليوم إلى الفترات الافتراضية.");
  };

  const addInterviewer = () => {
    const id = "interviewer-" + crypto.randomUUID();
    setInterviewers((current) => [
      ...current,
      {
        id,
        name: "الموظف " + (current.length + 1),
        meetingLink: "",
        googleEmail: "",
      },
    ]);
    if (date) {
      setAvailabilityByDate((current) => ({
        ...current,
        [date]: {
          ...(current[date] || {}),
          [id]: defaultAvailability(id),
        },
      }));
    }
  };

  const removeInterviewer = (interviewerId: string) => {
    if (interviewers.length === 1) {
      toast.error("يجب إبقاء موظف واحد على الأقل.");
      return;
    }
    setInterviewers((current) => current.filter((item) => item.id !== interviewerId));
    setAvailabilityByDate((current) =>
      Object.fromEntries(
        Object.entries(current).map(([day, availability]) => {
          const next = { ...availability };
          delete next[interviewerId];
          return [day, next];
        }),
      ),
    );
  };

  const displayedSyncStatus: SyncStatus =
    syncStatus === "saved" && isWorkspaceDirty ? "saving" : syncStatus;
  const syncLabel =
    displayedSyncStatus === "saving"
      ? "جارٍ الحفظ…"
      : displayedSyncStatus === "conflict"
        ? "يوجد تعارض يحتاج اختيارك"
        : displayedSyncStatus === "error"
          ? "تعذر الحفظ"
          : "محفوظ ومتزامن";
  const lastSyncLabel = workspaceUpdatedAt
    ? new Intl.DateTimeFormat("ar-SA", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        timeZone: INTERVIEW_TIMEZONE,
      }).format(new Date(workspaceUpdatedAt))
    : "";

  if (workspacePhase !== "ready") {
    const isBusy =
      workspacePhase === "checking" ||
      workspacePhase === "joining" ||
      workspacePhase === "creating";

    return (
      <main
        dir="rtl"
        className="grid min-h-screen place-items-center bg-[#f3f6fb] px-4 py-10 text-[#10213f]"
      >
        <Toaster position="top-center" richColors />
        <Card className="w-full max-w-lg overflow-hidden border-0 shadow-xl shadow-slate-300/50">
          <div className="h-2 bg-gradient-to-l from-[#5377ff] to-[#25c99a]" />
          <CardHeader className="pb-3 text-center">
            <div className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-[#edf1ff] text-[#4668e8]">
              {isBusy ? (
                <LoaderCircle className="size-7 animate-spin" />
              ) : workspacePhase === "created" ? (
                <KeyRound className="size-7" />
              ) : (
                <LockKeyhole className="size-7" />
              )}
            </div>
            <CardTitle className="text-2xl font-black">
              {workspacePhase === "checking"
                ? "جارٍ فتح مساحة الفريق"
                : workspacePhase === "creating"
                  ? "جارٍ إنشاء مساحة الفريق"
                  : workspacePhase === "joining"
                    ? "جارٍ التحقق من الرمز"
                    : workspacePhase === "created"
                      ? "احفظ رمز الفريق الآن"
                      : "افتح مساحة الفريق"}
            </CardTitle>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
              {workspacePhase === "created"
                ? "هذا الرمز هو مفتاح بيانات المقابلات. ستستخدمه على اللابتوب الثاني لعرض نفس الجدول والتعديلات."
                : "استخدم نفس الرابط ونفس رمز الفريق على الجهازين، وستظهر الأسماء والمواعيد والحالات تلقائيًا."}
            </p>
          </CardHeader>
          <CardContent className="space-y-4 p-6 pt-2">
            {workspacePhase === "created" ? (
              <>
                <div className="rounded-2xl border border-[#cdd8ff] bg-[#f3f6ff] p-4 text-center">
                  <p className="mb-2 text-xs font-bold text-slate-500">رمز الفريق</p>
                  <p
                    dir="ltr"
                    className="select-all break-all font-mono text-xl font-black tracking-[0.12em] text-[#244bc0] sm:text-2xl"
                  >
                    {createdWorkspaceCode}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full gap-2"
                  onClick={() => void copyWorkspaceCode()}
                >
                  <Copy className="size-4" />
                  نسخ الرمز
                </Button>
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
                  احفظ الرمز في مكان آمن قبل المتابعة. لا نحتفظ بنسخة يمكن عرضها لك لاحقًا،
                  وأي شخص يملك الرمز يستطيع فتح بيانات الفريق.
                </div>
                {workspaceError && (
                  <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
                    {workspaceError}
                  </p>
                )}
                <Button
                  type="button"
                  className="h-12 w-full bg-[#4668e8] font-bold hover:bg-[#3857c9]"
                  onClick={acknowledgeCreatedWorkspace}
                >
                  حفظت الرمز — دخول للمنصة
                </Button>
              </>
            ) : isBusy ? (
              <div className="py-6 text-center text-sm text-slate-500">
                لحظات قليلة…
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="team-code">رمز الفريق</Label>
                  <Input
                    id="team-code"
                    dir="ltr"
                    autoComplete="off"
                    spellCheck={false}
                    value={workspaceCode}
                    onChange={(event) => setWorkspaceCode(event.target.value.toUpperCase())}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void joinWorkspace();
                    }}
                    placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
                    className="h-12 text-center font-mono text-base font-bold tracking-wider"
                  />
                </div>
                {workspaceError && (
                  <p className="rounded-xl bg-rose-50 p-3 text-sm leading-6 text-rose-700">
                    {workspaceError}
                  </p>
                )}
                <Button
                  type="button"
                  className="h-12 w-full bg-[#4668e8] font-bold hover:bg-[#3857c9]"
                  onClick={() => void joinWorkspace()}
                >
                  دخول بنفس بيانات الفريق
                </Button>
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <span className="h-px flex-1 bg-slate-200" />
                  أول جهاز؟
                  <span className="h-px flex-1 bg-slate-200" />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full font-bold"
                  onClick={() => void createWorkspace()}
                >
                  إنشاء مساحة فريق جديدة
                </Button>
                <p className="text-center text-xs leading-5 text-slate-500">
                  لا تحتاج حساب ChatGPT. الرمز يفتح مساحة واحدة مشتركة ومحميّة للأجهزة التي
                  تختارها.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main dir="rtl" className="min-h-screen bg-[#f3f6fb] text-[#10213f]">
      <Toaster position="top-center" richColors />
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0b1730]/95 text-white shadow-[0_10px_30px_rgba(11,23,48,0.18)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1560px] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-[#5377ff] to-[#25c99a] shadow-lg shadow-blue-950/30">
              <CalendarDays className="size-5" />
            </div>
            <div>
              <p className="text-[0.7rem] font-semibold tracking-[0.14em] text-[#8fa8da]">
                INTERVIEW OPERATIONS
              </p>
              <h1 className="text-base font-bold sm:text-lg">جدولة المقابلات اليومية</h1>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div
              className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-[#c9d5ee]"
              title={
                "نسخة الفريق " +
                workspaceRevision +
                (lastSyncLabel ? " · آخر مزامنة " + lastSyncLabel : "")
              }
            >
              {displayedSyncStatus === "saving" ? (
                <LoaderCircle className="size-4 animate-spin text-[#8fa8da]" />
              ) : displayedSyncStatus === "saved" ? (
                <CloudCheck className="size-4 text-[#55ddb4]" />
              ) : (
                <Cloud className="size-4 text-amber-300" />
              )}
              <span className="hidden sm:inline">{syncLabel}</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 rounded-full text-[#dce6fb] hover:bg-white/10 hover:text-white"
              title="تحديث بيانات الفريق الآن"
              onClick={() => void refreshWorkspace(true)}
            >
              <RefreshCw className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 rounded-full text-[#dce6fb] hover:bg-white/10 hover:text-white"
              title="قفل مساحة الفريق على هذا الجهاز"
              disabled={isLocking}
              onClick={() => void lockThisDevice()}
            >
              {isLocking ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <LogOut className="size-4" />
              )}
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1560px] px-4 py-6 sm:px-6 lg:px-8">
        {workspaceConflict && (
          <section className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-black text-amber-950">تم تعديل البيانات على جهاز آخر</p>
                <p className="mt-1 text-sm leading-6 text-amber-800">
                  اختر نسخة الفريق الأحدث، أو احفظ التعديلات الموجودة على هذا الجهاز بدلًا
                  منها. لن نستبدل أي نسخة دون اختيارك.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="border-amber-300 bg-white"
                  onClick={acceptRemoteConflict}
                >
                  تحميل نسخة الفريق
                </Button>
                <Button
                  type="button"
                  className="bg-amber-700 hover:bg-amber-800"
                  onClick={keepLocalConflict}
                >
                  حفظ نسخة هذا الجهاز
                </Button>
              </div>
            </div>
          </section>
        )}
        {workspaceError && !workspaceConflict && (
          <section className="mb-5 flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 sm:flex-row sm:items-center sm:justify-between">
            <span>{workspaceError}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-rose-200 bg-white"
              onClick={() => {
                setWorkspaceError("");
                const state = currentSnapshotRef.current;
                if (state) void enqueueWorkspaceSave(state);
              }}
            >
              إعادة محاولة الحفظ
            </Button>
          </section>
        )}
        <InterviewDesk
          interviewers={interviewers} selected={interviewerFilter} onSelect={selectInterviewerView}
          date={date} onDate={(value) => { setDate(value); setCurrentPage(1); }}
          today={dateISO(0)} tomorrow={dateISO(1)} dateLabel={formatDate(date, "ar-SA")}
          rows={scopedSchedule} visible={visibleSchedule} resultCount={filteredSchedule.length}
          totalImported={candidates.length} unassigned={unscheduledCandidates.length}
          search={search} onSearch={(value) => { setSearch(value); setCurrentPage(1); }}
          outcome={interviewStatusFilter} onOutcomeFilter={(value) => { setInterviewStatusFilter(value); setCurrentPage(1); }}
          page={resolvedPage} pageCount={pageCount} pageSize={PAGE_SIZE} onPage={setCurrentPage}
          onSettings={() => setSettingsOpen(true)} onExport={exportSchedule}
          meetingLink={selectedInterviewer ? selectedInterviewer.meetingLink : defaultMeetingLink}
          meetingFallback={selectedInterviewer ? defaultMeetingLink : ""}
          onMeetingLink={(value) => selectedInterviewer
            ? updateInterviewer(selectedInterviewer.id, "meetingLink", value) : setDefaultMeetingLink(value)}
          onOpenMeeting={(value) => openSecureLink(value, "الاجتماع")}
          onOutcome={updateInterviewStatus} onInterest={updateWorkPreference}
          onMarkSent={markSent} onReschedule={moveToNextAvailable}
          statusOptions={STATUS_OPTIONS} onStatus={(id, value) => updateStatus(id, value as CandidateStatus)}
          position={positionForRow} time={(value) => formatTime(value, "ar-SA")}
          next={nextInterview} remaining={(row) => formatRemainingTime(row, "ar")}
          buildMessage={emailMessageFor} messageIssue={messageIssue}
          onCopy={(row, kind) => void copyPreparedMessage(row, kind)} onEmail={openPreparedEmail}
          emailValid={(row) => isValidEmail(row.email)}
          onboarding={onboarding}
          candidateDetails={(row) => ({countries: candidateOnboarding[row.id]?.countries || "", loginId: candidateOnboarding[row.id]?.loginId || "", password: sessionPasswords[row.id] || ""})}
          onCandidateDetails={(row, field, value) => {
            if (field === "password") setSessionPasswords((current) => ({...current, [row.id]: value}));
            else setCandidateOnboarding((current) => ({...current, [row.id]: {...(current[row.id] || {countries:"",loginId:""}), [field]:value}}));
          }}
        />
        <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
          <SheetContent dir="rtl" side="left" className="w-full overflow-y-auto sm:max-w-xl">
            <SheetHeader className="border-b border-slate-200 px-6 pt-10 pb-5">
              <SheetTitle>البيانات وإعدادات المقابلات</SheetTitle>
              <SheetDescription>إعدادات الفريق ليوم {formatDate(date, "ar-SA")}. تُحفظ تغييراتك تلقائيًا.</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 pb-6">
              <Button className="w-full" onClick={() => { generateSchedule(); }} disabled={!candidates.length}>
                <RefreshCw className="size-4" /> إعادة ترتيب جدول الفريق
              </Button>

            <Card className="overflow-hidden border-0 bg-white shadow-sm shadow-slate-200/80">
              <CardHeader className="border-b border-slate-100 px-5 py-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span className="grid size-7 place-items-center rounded-lg bg-[#edf1ff] text-xs font-black text-[#4668e8]">
                      1
                    </span>
                    ملف المرشحين
                  </CardTitle>
                  <Button variant="ghost" size="sm" onClick={downloadTemplate} className="h-8 text-xs">
                    <Download className="size-3.5" />
                    نموذج
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-5">
                <div
                  onDragOver={(event) => {
                    event.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={onDrop}
                  className={
                    "relative rounded-2xl border-2 border-dashed p-5 text-center transition " +
                    (isDragging
                      ? "border-[#4668e8] bg-[#edf1ff]"
                      : "border-slate-200 bg-slate-50/70 hover:border-[#9bb0ff]")
                  }
                >
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={onFileChange}
                    className="absolute inset-0 cursor-pointer opacity-0"
                    aria-label="رفع ملف المرشحين"
                  />
                  <div className="mx-auto grid size-11 place-items-center rounded-2xl bg-white text-[#4668e8] shadow-sm">
                    <UploadCloud className="size-5" />
                  </div>
                  <p className="mt-3 text-sm font-bold">ارفع ملف Excel لبدء الجدولة</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    XLSX أو XLS أو CSV · الاسم ورقم الهاتف يكفيان
                  </p>
                </div>

                {fileName ? (
                  <div className="mt-3 flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
                    <FileSpreadsheet className="size-5 shrink-0 text-emerald-600" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-emerald-900">{fileName}</p>
                      <p className="text-xs text-emerald-700">
                        {configurationValid ? (
                          <>
                            {candidates.length} مرشحًا · {plannedSchedule.length} موعدًا في{" "}
                            {date || "اليوم المختار"}
                            {unscheduledCandidates.length
                              ? " · بقي " + unscheduledCandidates.length
                              : " · اكتمل التوزيع"}
                          </>
                        ) : (
                          candidates.length + " مرشحًا · عدّل بيانات الموظفين وأوقاتهم"
                        )}
                      </p>
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" onClick={loadDemo} className="mt-3 w-full">
                    <Sparkles className="size-4 text-[#4668e8]" />
                    جرّب ببيانات تجريبية
                  </Button>
                )}

                {(importNotes.duplicates > 0 ||
                  importNotes.invalid > 0 ||
                  importNotes.missingPhones > 0) && (
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-xl bg-slate-50 p-2">
                      <b className="block text-base text-[#10213f]">{importNotes.duplicates}</b>
                      مكرر
                    </div>
                    <div className="rounded-xl bg-slate-50 p-2">
                      <b className="block text-base text-[#10213f]">{importNotes.invalid}</b>
                      ناقص
                    </div>
                    <div className="rounded-xl bg-slate-50 p-2">
                      <b className="block text-base text-[#10213f]">
                        {importNotes.missingPhones}
                      </b>
                      بلا هاتف
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card
              id="daily-availability"
              className="scroll-mt-24 border-0 bg-white shadow-sm shadow-slate-200/80"
            >
              <CardHeader className="border-b border-slate-100 px-5 py-4">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className="grid size-7 place-items-center rounded-lg bg-[#edf1ff] text-xs font-black text-[#4668e8]">
                    2
                  </span>
                  توفر الموظفين اليومي
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 p-5">
                <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold leading-5 text-emerald-800">
                  الأوقات أدناه تخص {date ? formatDate(date, "ar-SA") : "اليوم المختار"} فقط.
                  يمكنك تغييرها يوميًا، والتداخل بين موظفين مختلفين مسموح.
                </p>

                <div className="rounded-2xl border border-[#d9e2ff] bg-[#f8faff] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-bold text-slate-500">إعدادات هذا التاريخ</p>
                      <p className="mt-1 text-sm font-black text-[#10213f]">
                        {date ? formatDate(date, "ar-SA") : "اختر يوم المقابلات"}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        hasSavedAvailabilityForDate
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-amber-200 bg-amber-50 text-amber-700"
                      }
                    >
                      {hasSavedAvailabilityForDate ? "محفوظ لهذا اليوم" : "أوقات افتراضية"}
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#d9e2ff] pt-3">
                    <span className="text-xs font-semibold text-[#4668e8]">
                      توقيت السعودية ثابت في الجدول والرسائل — UTC+3
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={resetCurrentDayAvailability}
                        className="h-8 text-xs"
                      >
                        إعادة ضبط اليوم
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!hasPreviousDayAvailability}
                        onClick={copyPreviousDayAvailability}
                        title={
                          hasPreviousDayAvailability
                            ? "نسخ توفر الموظفين من " + previousDate
                            : "لا توجد أوقات محفوظة لليوم السابق"
                        }
                        className="h-8 text-xs"
                      >
                        <Copy className="size-3.5" />
                        نسخ أوقات اليوم السابق
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="duration">مدة كل مقابلة</Label>
                  <div className="grid grid-cols-4 gap-2">
                    {[5, 6, 10].map((minutes) => (
                      <Button
                        key={minutes}
                        type="button"
                        variant={duration === minutes ? "default" : "outline"}
                        onClick={() => setDuration(minutes)}
                        className={
                          duration === minutes
                            ? "bg-[#4668e8] px-2 hover:bg-[#3859cf]"
                            : "px-2"
                        }
                      >
                        {minutes} د
                      </Button>
                    ))}
                    <div className="relative">
                      <Input
                        id="duration"
                        aria-label="مدة أخرى بالدقائق"
                        type="number"
                        min={1}
                        max={120}
                        value={duration}
                        onChange={(event) =>
                          setDuration(Math.max(1, Number(event.target.value) || 1))
                        }
                        className="h-10 pl-6 pr-2 text-center"
                      />
                      <span className="pointer-events-none absolute left-1.5 top-3 text-[0.65rem] text-slate-400">
                        د
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500">
                    {duration === 5
                      ? "5 دقائق = 12 مقابلة بالساعة لكل موظف."
                      : "السعة الحالية للفريق: " + totalCapacity + " مقابلة."}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="gap">فاصل بين المقابلات — اختياري</Label>
                  <div className="relative">
                    <Input
                      id="gap"
                      type="number"
                      min={0}
                      max={60}
                      value={gap}
                      onChange={(event) =>
                        setGap(Math.max(0, Number(event.target.value) || 0))
                      }
                      className="pl-12"
                    />
                    <span className="absolute left-3 top-2.5 text-xs text-slate-400">دقيقة</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <Label>من سيُجري مقابلات هذا اليوم؟</Label>
                      <p className="mt-1 text-xs text-slate-500">فعّل الموظف وحدّد فتراته لهذا التاريخ</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addInterviewer}
                      className="h-9 text-xs text-[#4668e8]"
                    >
                      <Plus className="size-3.5" />
                      إضافة موظف
                    </Button>
                  </div>

                  {interviewerStats.map((interviewer) => (
                    <div
                      key={interviewer.id}
                      className={
                        "space-y-3 rounded-2xl border p-3 " +
                        (interviewer.valid
                          ? "border-slate-200 bg-slate-50/70"
                          : "border-rose-200 bg-rose-50/60")
                      }
                    >
                      <div className="flex items-center gap-2">
                        <Input
                          value={interviewer.name}
                          onChange={(event) =>
                            updateInterviewer(interviewer.id, "name", event.target.value)
                          }
                          aria-label="اسم الموظف"
                          className="h-9 bg-white font-bold"
                        />
                        <Badge
                          variant="outline"
                          className="shrink-0 border-[#bdcaff] bg-white text-[#4668e8]"
                        >
                          {interviewer.enabled ? interviewer.capacity + " موعد" : "غير متاح"}
                        </Badge>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeInterviewer(interviewer.id)}
                          className="size-9 shrink-0 text-slate-400 hover:text-rose-600"
                          aria-label={"حذف الموظف " + interviewer.name}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>

                      <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                        <div>
                          <p className="text-sm font-bold text-[#10213f]">متاح بهذا اليوم</p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {interviewer.enabled
                              ? interviewer.blocks
                                  .map(
                                    (block) =>
                                      formatTime(block.start, "ar-SA") +
                                      "–" +
                                      formatTime(block.end, "ar-SA"),
                                  )
                                  .join(" · ")
                              : "لن تُسند إليه مقابلات في هذا التاريخ"}
                          </p>
                        </div>
                        <Switch
                          checked={interviewer.enabled}
                          onCheckedChange={(checked) =>
                            setInterviewerAvailable(interviewer.id, checked)
                          }
                          aria-label={
                            (interviewer.enabled ? "إيقاف " : "تفعيل ") +
                            interviewer.name +
                            " لهذا اليوم"
                          }
                        />
                      </div>

                      {interviewer.enabled ? (
                        <>
                          <div className="space-y-2">
                            {interviewer.blocks.map((block) => (
                              <div
                                key={block.id}
                                className="grid grid-cols-[1fr_1fr_36px] items-end gap-2"
                              >
                                <div>
                                  <span className="mb-1 block text-xs text-slate-500">من</span>
                                  <Input
                                    type="time"
                                    value={block.start}
                                    onChange={(event) =>
                                      updateBlock(
                                        interviewer.id,
                                        block.id,
                                        "start",
                                        event.target.value,
                                      )
                                    }
                                    className="h-9 bg-white px-2 text-xs"
                                    aria-label={
                                      "بداية " + block.label + " للموظف " + interviewer.name
                                    }
                                  />
                                </div>
                                <div>
                                  <span className="mb-1 block text-xs text-slate-500">إلى</span>
                                  <Input
                                    type="time"
                                    value={block.end}
                                    onChange={(event) =>
                                      updateBlock(
                                        interviewer.id,
                                        block.id,
                                        "end",
                                        event.target.value,
                                      )
                                    }
                                    className="h-9 bg-white px-2 text-xs"
                                    aria-label={
                                      "نهاية " + block.label + " للموظف " + interviewer.name
                                    }
                                  />
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => removeBlock(interviewer.id, block.id)}
                                  className="size-9 text-slate-400 hover:text-rose-600"
                                  aria-label={"حذف " + block.label + " للموظف " + interviewer.name}
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </div>
                            ))}
                          </div>

                          {!interviewer.valid && (
                            <p className="text-xs font-semibold text-rose-700">
                              تأكد أن نهاية كل فترة بعد بدايتها، وألا تتداخل فترات هذا الموظف.
                            </p>
                          )}

                          <div className="flex items-center justify-between gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => addBlock(interviewer.id)}
                              className="h-8 px-2 text-xs text-[#4668e8]"
                            >
                              <Plus className="size-3.5" />
                              إضافة فترة لهذا اليوم
                            </Button>
                            <span className="text-xs text-slate-500">
                              {(interviewer.minutes / 60).toLocaleString("ar-JO", {
                                maximumFractionDigits: 1,
                              })} ساعة
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-500">
                          هذا الموظف غير متاح في اليوم المختار. فعّله لإضافة ساعات عمله.
                        </div>
                      )}

                      <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <CalendarCheck2 className="size-4 text-emerald-700" />
                            <p className="text-xs font-bold text-[#10213f]">رابط الاجتماع اليدوي</p>
                          </div>
                          <Badge className="border-emerald-200 bg-white text-emerald-700 hover:bg-white">
                            اختياري
                          </Badge>
                        </div>
                        <MeetLinkField id={"settings-meet-" + interviewer.id} label={"رابط الاجتماع للموظف " + interviewer.name}
                          value={interviewer.meetingLink} onSave={(value) => updateInterviewer(interviewer.id, "meetingLink", value)} />
                        <p className="text-xs leading-5 text-emerald-800">
                          إذا وضعت رابطًا خاصًا لهذا الموظف سيُستخدم في رسائله بدل الرابط العام.
                          يمكنك تغييره يوميًا بدون أي ربط تلقائي مع Google.
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <details
                  open
                  className="rounded-2xl border border-[#cbd8ff] bg-[#f8faff]"
                >
                  <summary className="cursor-pointer list-none px-4 py-3 text-sm font-bold text-slate-600">
                    إعدادات الرسائل الجاهزة
                  </summary>
                  <div className="space-y-4 border-t border-slate-200 p-4">
                    <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold leading-5 text-emerald-800">
                      ثلاثة نماذج مستقلة: دعوة المقابلة، رابط الاجتماع، والقبول بعد المقابلة.
                      عدّل النصوص هنا، ثم راجع رسالة كل شخص قبل إرسالها.
                    </p>

                    <div className="space-y-1.5">
                      <MeetLinkField id="defaultMeetingLink" label="رابط الاجتماع العام" value={defaultMeetingLink} onSave={setDefaultMeetingLink} />
                      <p className="text-xs leading-5 text-slate-500">
                        يُستخدم هذا الرابط في رسالة الرابط الثانية فقط. الرسالة الأولى ترسل الموعد
                        بدون رابط، ويمكنك تغيير الرابط متى شئت لتستخدمه الرسائل التالية.
                      </p>
                      {!defaultMeetingLink.trim() &&
                        interviewers.every((interviewer) => !interviewer.meetingLink.trim()) && (
                          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800">
                            أضف رابط المنصة أو مكان المقابلة قبل إرسال الرسائل حتى تصل التفاصيل
                            كاملة للمرشحين.
                          </p>
                        )}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="company">اسم الجهة في الرسالة</Label>
                      <Input
                        id="company"
                        value={companyName}
                        onChange={(event) => setCompanyName(event.target.value)}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="interviewPosition">البوزيشن / المسمى الوظيفي لهذا اليوم</Label>
                      <Input
                        id="interviewPosition"
                        value={positionByDate[date] || ""}
                        onChange={(event) =>
                          setPositionByDate((current) => ({
                            ...current,
                            [date]: event.target.value,
                          }))
                        }
                        placeholder="مثال: Sales Representative"
                      />
                      <p className="text-xs leading-5 text-slate-500">
                        يُضاف هذا البوزيشن إلى رسائل مقابلات تاريخ اليوم المحدد. إذا تركته فارغًا،
                        سيستخدم النظام البوزيشن الموجود لكل شخص في ملف Excel.
                      </p>
                    </div>

                    <MessageSettings settings={onboarding} templates={messageTemplates} onSettings={setOnboarding} onTemplates={setMessageTemplates} />
                    <p className="text-sm text-slate-500">أدخل أرقام المرشحين مع مفتاح الدولة، مثل +966. لا يُضاف كود افتراضي إلى الأرقام.</p>

                  </div>
                </details>
              </CardContent>
            </Card>

            </div>
          </SheetContent>
        </Sheet>
      </div>
    </main>
  );
}
