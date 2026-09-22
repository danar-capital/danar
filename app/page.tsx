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
