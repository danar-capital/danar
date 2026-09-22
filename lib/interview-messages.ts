export type MessageKind = "invitation" | "meeting" | "training";
export type OnboardingSettings = {
  trainingStartDate: string; employmentStartDate: string; payrollDate: string;
  salary: string; workingHours: string; platformUrl: string; tutorialUrl: string;
};
export type CandidateOnboarding = { countries: string; loginId: string };
export type MessageTemplates = Record<MessageKind, string>;

export const DEFAULT_ONBOARDING: OnboardingSettings = {
  trainingStartDate: "2026-09-23", employmentStartDate: "2026-10-08", payrollDate: "2026-11-08",
  salary: "500", workingHours: "Flexible working hours; achievement of assigned daily targets is required.",
  platformUrl: "", tutorialUrl: "",
};

export const DEFAULT_TEMPLATES: MessageTemplates = {
  invitation: `Hello [Candidate Name],

Thank you for applying for the [Position] position at [Company].

Your online interview is scheduled as follows:

Date: [Date]
Time: [Time]
Time Zone: [Time Zone]
Duration: 4–6 minutes
Language: English

The Google Meet link will be sent to you at the scheduled interview time.

Please reply CONFIRMED to confirm your attendance.

HRadeeco Recruitment Team`,
  meeting: `Hello [Candidate Name],

Your scheduled Talureva interview is ready to begin.

Google Meet:
[Meeting Link]

Please join now. The interview will be conducted in English and will take approximately 4–6 minutes.

HRadeeco Recruitment Team`,
  training: `Hello [Candidate Name],

Congratulations. Following your interview, we are pleased to confirm that you have been selected to join HRadeeco as a [Position], beginning with a paid two-week training period.

Position: Full-time Remote
Monthly Salary after Training: USD [Monthly Salary]
Training Period: Two Weeks — Paid
Training Start Date: [Training Start Date]
First Month of Employment Starts: [Employment Start Date], subject to successful completion of training.
Working Hours: [Working Hours]
Assigned Countries: [Countries]
Training Compensation Payment: First Payroll Cycle — [Payroll Date]

Your Talureva employee account is ready. Your employee profile, Employee ID, and assigned workspace have already been set up. Talureva is your employee platform for viewing your role, submitting candidate data, and tracking your work.

Talureva Platform:
[Talureva Login Link]

Login ID: [Login ID]
Password: [Password]

5-Minute Platform Tutorial:
[Video Link]

Please watch the tutorial, sign in to your account, and confirm that you can access the platform by replying:

ACCEPTED — ACCESS CONFIRMED

Please keep your login details private and do not share them with anyone.

Welcome to HRadeeco. We are pleased to have you joining our team.

HRadeeco Recruitment Team`,
};

export const TEMPLATE_TOKENS = ["Candidate Name", "Position", "Company", "Date", "Time", "Time Zone", "Time Remaining", "Meeting Link", "Training Start Date", "Employment Start Date", "Payroll Date", "Monthly Salary", "Working Hours", "Countries", "Talureva Login Link", "Login ID", "Password", "Video Link"] as const;
const tokenPattern = /\[([^\[\]\n]+)\]/g;
export function templateIssue(template: string, kind: MessageKind) {
  if (!template.trim()) return "النموذج فارغ. اكتب نص الرسالة أولًا.";
  if (template.length > 12000) return "النموذج طويل جدًا؛ الحد 12000 حرف.";
  if (/[\u0600-\u06ff]/.test(template)) return "نصوص النماذج بالإنجليزية فقط.";
  const tokens = [...template.matchAll(tokenPattern)].map((m) => m[1]);
  const unknown = tokens.find((t) => !TEMPLATE_TOKENS.includes(t as typeof TEMPLATE_TOKENS[number]));
  if (unknown) return "حقل غير معروف في النموذج: [" + unknown + "]";
  const required = kind === "invitation" ? ["Candidate Name", "Date", "Time", "Time Zone"] : kind === "meeting" ? ["Candidate Name", "Meeting Link"] : ["Candidate Name", "Training Start Date", "Employment Start Date", "Payroll Date", "Countries", "Talureva Login Link", "Login ID", "Password", "Video Link"];
  const missing = required.find((t) => !tokens.includes(t));
  if (missing) return "أبقِ الحقل [" + missing + "] في النموذج لتعبئته تلقائيًا.";
  if (kind !== "training" && tokens.some((t) => ["Password", "Login ID", "Talureva Login Link", "Video Link"].includes(t))) return "بيانات الدخول مخصصة لرسالة ما بعد المقابلة فقط.";
  if (kind === "invitation" && (tokens.includes("Meeting Link") || /meet\.google\.com/i.test(template))) return "رابط Meet يُرسل في رسالة الرابط المستقلة فقط.";
  return "";
}
export function renderTemplate(template: string, values: Record<string, string>) {
  return template.replace(tokenPattern, (match, token: string) => values[token] ?? match);
}
export function normalizeOnboarding(value: unknown): OnboardingSettings {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(DEFAULT_ONBOARDING).map(([key, fallback]) => [key, typeof raw[key] === "string" ? raw[key] : fallback])) as OnboardingSettings;
}
export function normalizeTemplates(value: unknown): MessageTemplates {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(DEFAULT_TEMPLATES).map(([key, fallback]) => [key, typeof raw[key] === "string" ? raw[key] : fallback])) as MessageTemplates;
}
export function normalizeCandidateOnboarding(value: unknown): Record<string, CandidateOnboarding> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item && typeof item === "object").map(([id, item]) => [id, {
    countries: typeof item.countries === "string" ? item.countries : "",
    loginId: typeof item.loginId === "string" ? item.loginId : "",
  }]));
}
export function validHttpsUrl(value: string) {
  try { const url = new URL(value); return url.protocol === "https:" && !!url.hostname && !url.username && !url.password; } catch { return false; }
}
export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T12:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value;
}
export function normalizeMeetLink(input: string): { url: string; error: string } {
  const raw = input.trim().replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
  if (!raw) return {url: "", error: ""};
  if (/^(?:javascript|data|file):/i.test(raw)) return {url: "", error: "استخدم رابط Google Meet فقط."};
  if (/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(raw)) return {url: "https://meet.google.com/" + raw.toLowerCase(), error: ""};
  const pieces = raw.replace(/(?=https?:\/\/)/gi, " ").split(/\s+/).map((s) => s.replace(/^[<("']+|[>),.،;"']+$/g, "")).filter(Boolean);
  const urls: string[] = [];
  for (const piece of pieces) {
    if (!/^(?:https?:\/\/)?meet\.google\.com\//i.test(piece)) continue;
    try {
      const url = new URL(/^https?:\/\//i.test(piece) ? piece : "https://" + piece);
      if (url.hostname !== "meet.google.com" || url.username || url.password || url.port) continue;
      if (!/^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/i.test(url.pathname)) continue;
      urls.push("https://meet.google.com" + url.pathname.replace(/\/$/, "").toLowerCase());
    } catch { /* Invalid input stays visible for correction. */ }
  }
  const unique = [...new Set(urls)];
  if (unique.length > 1) return {url: "", error: "يوجد رابطا اجتماع مختلفان. ضع رابط اجتماع واحدًا فقط."};
  if (unique.length === 1) return {url: unique[0], error: ""};
  return {url: "", error: "رابط Meet غير صالح. الصق رابطًا مثل https://meet.google.com/abc-defg-hij"};
}
