"use client";

import { useState } from "react";
import { CalendarDays, Check, Clock3, Copy, Download, Mail, MoreHorizontal, Search, Settings2, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from "@/components/ui/dropdown-menu";
import { MeetLinkField } from "@/components/meet-link-field";
import { type MessageKind, type OnboardingSettings } from "@/lib/interview-messages";
export type { MessageKind } from "@/lib/interview-messages";

type Outcome = "لم تُجرَ بعد" | "تمت المقابلة" | "لم يحضر";
type Interest = "لم تُحدّد بعد" | "يرغب بالعمل" | "لا يرغب بالعمل";
type Row = {
  scheduleId: string; meetingId: string; name: string; phone: string; email: string; date: string;
  start: string; end: string; interviewer: string; interviewerId: string;
  role: string; status: string; interviewStatus: Outcome; workPreference: Interest;
};
type Props<T extends Row> = {
  interviewers: {id: string; name: string; meetingLink: string}[];
  selected: string; onSelect: (id: string) => void;
  date: string; onDate: (date: string) => void; today: string; tomorrow: string;
  rows: T[]; visible: T[]; resultCount: number; totalImported: number; unassigned: number;
  search: string; onSearch: (s: string) => void;
  outcome: string; onOutcomeFilter: (s: string) => void;
  page: number; pageCount: number; pageSize: number; onPage: (p: number) => void;
  onSettings: () => void; onExport: () => void;
  meetingLink: string; meetingFallback: string; onMeetingLink: (s: string) => void; onOpenMeeting: (s: string) => void;
  onOutcome: (id: string, s: Outcome) => void; onInterest: (id: string, s: Interest) => void;
  onMarkSent: (id: string) => void; onReschedule: (id: string) => void;
  statusOptions: string[]; onStatus: (id: string, value: string) => void;
  position: (r: T) => string; time: (s: string) => string; dateLabel: string;
  next?: T; remaining: (r: T) => string;
  buildMessage: (r: T, kind: MessageKind) => string;
  messageIssue: (r: T, kind: MessageKind) => string;
  onCopy: (r: T, kind: MessageKind) => void;
  onEmail: (r: T, kind: MessageKind) => void;
  emailValid: (r: T) => boolean;
  onboarding: OnboardingSettings;
  candidateDetails: (r: T) => {countries: string; loginId: string; password: string};
  onCandidateDetails: (r: T, field: "countries" | "loginId" | "password", value: string) => void;
};

const messageLabels: Record<MessageKind, string> = {
  invitation: "قبل المقابلة", meeting: "رابط الاجتماع", training: "بعد المقابلة",
};

export function InterviewDesk<T extends Row>(p: Props<T>) {
  const [messageId, setMessageId] = useState<string | null>(null);
  const [kind, setKind] = useState<MessageKind>("invitation");
  const selectedEmployee = p.interviewers.find((i) => i.id === p.selected);
  const messageRow = p.rows.find((r) => r.scheduleId === messageId);
  const completed = p.rows.filter((r) => r.interviewStatus === "تمت المقابلة").length;
  const absent = p.rows.filter((r) => r.interviewStatus === "لم يحضر").length;
  const pending = p.rows.length - completed - absent;
  const openMessage = (row: T, type: MessageKind) => { setMessageId(row.scheduleId); setKind(type); };
  const issue = messageRow ? p.messageIssue(messageRow, kind) : "";

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" aria-label="اختيار الموظف واليوم">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold">اختر الموظف لعرض مقابلاته</h2>
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="عرض الموظف">
              {p.interviewers.map((i) => (
                <Button key={i.id} variant={p.selected === i.id ? "default" : "outline"} aria-pressed={p.selected === i.id}
                  onClick={() => p.onSelect(i.id)} className="h-11 min-w-28 gap-2 rounded-xl px-4">
                  <span className="grid size-6 place-items-center rounded-full bg-current/10"><Users className="size-4" /></span>
                  {i.name || "موظف بدون اسم"}
                </Button>
              ))}
              <Button variant={p.selected === "all" ? "default" : "ghost"} aria-pressed={p.selected === "all"} onClick={() => p.onSelect("all")} className="h-11">عرض الفريق</Button>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
            <div className="min-w-40 flex-1 space-y-1 sm:flex-none">
              <Label htmlFor="desk-date">يوم المقابلات</Label>
              <Input id="desk-date" type="date" className="h-11" value={p.date} onChange={(e) => e.target.value && p.onDate(e.target.value)} />
            </div>
            <Button variant="outline" className="h-11" onClick={() => p.onDate(p.today)}>اليوم</Button>
            <Button variant="outline" className="h-11" onClick={() => p.onDate(p.tomorrow)}>غدًا</Button>
            <Button variant="outline" className="h-11" onClick={p.onSettings}><Settings2 className="size-4" /> البيانات والإعدادات</Button>
          </div>
        </div>
        <p className="mt-3 text-sm text-slate-500">{p.dateLabel} · توقيت السعودية UTC+3 · الاختيار للعرض فقط ولا يغيّر توزيع المرشحين.</p>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="أعداد مقابلات الموظف">
        {[
          {label: "كل المواعيد", value: p.rows.length, icon: CalendarDays, style: "text-blue-700 bg-blue-50"},
          {label: "لم تُجرَ بعد", value: pending, icon: Clock3, style: "text-amber-700 bg-amber-50"},
          {label: "تمت المقابلة", value: completed, icon: Check, style: "text-emerald-700 bg-emerald-50"},
          {label: "لم يحضر", value: absent, icon: X, style: "text-rose-700 bg-rose-50"},
        ].map((m) => (
          <div key={m.label} className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <div><p className="text-sm text-slate-500">{m.label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{m.value}</p></div>
            <m.icon className={"size-10 rounded-xl p-2.5 " + m.style} />
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-emerald-200 bg-white p-4" aria-label="رابط الاجتماع المثبت">
        <MeetLinkField key={p.selected} id="desk-meeting" label={selectedEmployee ? "رابط اجتماع " + selectedEmployee.name : "رابط الاجتماع العام"} value={p.meetingLink} fallback={p.meetingFallback} onSave={p.onMeetingLink} onOpen={p.onOpenMeeting}/>
      </section>

      {p.next && <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#142747] px-5 py-4 text-white">
        <div><p className="text-sm text-blue-200">المقابلة القادمة · {p.remaining(p.next)}</p><p className="mt-1 text-lg font-bold" dir="auto">{p.next.name}</p></div>
        <p className="text-lg font-semibold">{p.time(p.next.start)} <span className="text-sm font-normal text-blue-200">· {p.next.interviewer}</span></p>
        <Button variant="secondary" onClick={() => openMessage(p.next!, "meeting")}><Mail className="size-4" /> تجهيز إيميل الرابط</Button>
      </section>}

      {p.selected === "all" && <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-sm text-slate-600"><span>ملف الفريق: {p.totalImported} مرشحًا · {p.unassigned} دون موعد</span>{p.unassigned > 0 && <Button variant="ghost" size="sm" onClick={p.onSettings}>تعديل ساعات الموظفين</Button>}</div>}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-label="قائمة المقابلات">
        <div className="space-y-4 border-b border-slate-200 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-bold">{selectedEmployee ? "مقابلات " + selectedEmployee.name : "مقابلات الفريق"}<span className="mr-2 rounded-lg bg-slate-100 px-2.5 py-1 text-base tabular-nums">{p.rows.length}</span></h2><Button variant="outline" onClick={p.onExport} disabled={!p.rows.length}><Download className="size-4" />تصدير الجدول</Button></div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-0 basis-full sm:max-w-sm sm:flex-1 sm:basis-auto"><Search className="absolute right-3 top-3 size-4 text-slate-400" /><Input aria-label="بحث عن مرشح" className="h-10 pr-9" placeholder="اسم المرشح أو رقم الهاتف" value={p.search} onChange={(e) => p.onSearch(e.target.value)} /></div>
            <Select value={p.outcome} onValueChange={p.onOutcomeFilter}><SelectTrigger className="w-44" aria-label="تصفية نتيجة المقابلة"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">كل النتائج</SelectItem>{["لم تُجرَ بعد", "تمت المقابلة", "لم يحضر"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
            <span className="text-sm text-slate-500">{p.resultCount} نتيجة</span>
          </div>
        </div>
        <div role="table" aria-label="جدول أسماء ومواعيد المرشحين">
          <div role="row" className="hidden grid-cols-[40px_minmax(180px,1fr)_130px_270px_110px] items-center gap-3 bg-slate-50 px-5 py-3 text-sm font-semibold text-slate-500 lg:grid">
            <span role="columnheader">#</span><span role="columnheader">المرشح</span><span role="columnheader">الموعد</span><span role="columnheader">نتيجة المقابلة</span><span role="columnheader">التواصل</span>
          </div>
          {p.visible.map((row, index) => <div role="row" key={row.scheduleId} className="grid min-w-0 gap-3 border-t border-slate-100 p-4 first:border-t-0 sm:p-5 lg:grid-cols-[40px_minmax(180px,1fr)_130px_270px_110px] lg:items-center">
            <div role="cell" className="text-sm tabular-nums text-slate-400"><span className="lg:hidden">المرشح </span>{(p.page - 1) * p.pageSize + index + 1}</div>
            <div role="cell" className="min-w-0"><p dir="auto" className="break-words text-right text-base font-bold text-[#10213f]">{row.name}</p><p className="mt-1 break-all text-right text-sm text-slate-500" dir="ltr">{row.email || "بدون بريد إلكتروني"}</p><p className="mt-1 text-xs font-semibold text-blue-700" dir="ltr">Meeting ID: {row.meetingId}</p>{p.position(row) && <p className="mt-1 break-words text-right text-sm text-slate-500" dir="auto">{p.position(row)}</p>}{p.candidateDetails(row).countries && <p className="mt-1 break-words text-right text-sm text-blue-700" dir="auto">{p.candidateDetails(row).countries}</p>}<p className="mt-1 text-xs text-slate-500">{row.status}</p></div>
            <div role="cell"><p className="text-lg font-bold tabular-nums">{p.time(row.start)}</p>{p.selected === "all" && <p className="mt-1 text-sm text-slate-500">{row.interviewer}</p>}</div>
            <div role="cell" className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" aria-pressed={row.interviewStatus === "تمت المقابلة"} variant="outline" className={row.interviewStatus === "تمت المقابلة" ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 hover:text-white" : "text-emerald-700"} onClick={() => p.onOutcome(row.scheduleId, "تمت المقابلة")}><Check className="size-4" />تمت المقابلة</Button>
                <Button size="sm" aria-pressed={row.interviewStatus === "لم يحضر"} variant="outline" className={row.interviewStatus === "لم يحضر" ? "border-rose-600 bg-rose-600 text-white hover:bg-rose-700 hover:text-white" : "text-slate-600"} onClick={() => p.onOutcome(row.scheduleId, "لم يحضر")}><X className="size-4" />لم يحضر</Button>
              </div>
              {row.interviewStatus === "تمت المقابلة" ? <Select value={row.workPreference} onValueChange={(s) => p.onInterest(row.scheduleId, s as Interest)}><SelectTrigger aria-label={"الرغبة بالعمل — " + row.name} className="h-9 w-full max-w-60 text-sm"><SelectValue /></SelectTrigger><SelectContent>{["لم تُحدّد بعد", "يرغب بالعمل", "لا يرغب بالعمل"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select> : <p className="text-xs text-slate-500">{row.interviewStatus}</p>}
            </div>
            <div role="cell" className="flex items-center gap-1 lg:flex-wrap">
              <Button variant="outline" size="sm" onClick={() => openMessage(row, "invitation")}><Mail className="size-4" />الإيميل</Button>
              <DropdownMenu dir="rtl"><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={"خيارات " + row.name} className="size-8"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => p.onMarkSent(row.scheduleId)}>تعليم دعوة الموعد كمرسلة</DropdownMenuItem><DropdownMenuSub><DropdownMenuSubTrigger>حالة الدعوة</DropdownMenuSubTrigger><DropdownMenuSubContent>{p.statusOptions.map((status) => <DropdownMenuItem key={status} onSelect={() => p.onStatus(row.scheduleId, status)}>{row.status === status && <Check className="size-3" />}{status}</DropdownMenuItem>)}</DropdownMenuSubContent></DropdownMenuSub><DropdownMenuItem onSelect={() => p.onReschedule(row.scheduleId)}>نقل لأقرب موعد شاغر</DropdownMenuItem><DropdownMenuItem onSelect={() => p.onOutcome(row.scheduleId, "لم تُجرَ بعد")}>إعادة النتيجة إلى «لم تُجرَ بعد»</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
            </div>
          </div>)}
        </div>
        {!p.visible.length && <div className="p-10 text-center text-slate-500"><CalendarDays className="mx-auto mb-3 size-8 text-slate-300" /><p>{p.rows.length ? "لا توجد أسماء مطابقة للبحث أو الفلتر." : "لا توجد مقابلات لهذا الموظف في اليوم المحدد."}</p><Button className="mt-4" variant="outline" onClick={p.onSettings}>رفع ملف أو تعديل الأوقات</Button></div>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 text-sm text-slate-500"><p>عرض {p.resultCount ? (p.page - 1) * p.pageSize + 1 : 0}–{Math.min(p.page * p.pageSize, p.resultCount)} من {p.resultCount}</p><div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={p.page <= 1} onClick={() => p.onPage(p.page - 1)}>السابق</Button><span>{p.page} / {p.pageCount}</span><Button size="sm" variant="outline" disabled={p.page >= p.pageCount} onClick={() => p.onPage(p.page + 1)}>التالي</Button></div></div>
      </section>
      <p className="text-sm text-slate-500">تُحفظ النتائج وروابط الاجتماعات في مساحة الفريق. افتح الإيميل الجاهز، راجعه ثم اضغط إرسال. رابط تأكيد الحضور عبر واتساب موجود داخل الدعوة.</p>

      <Dialog open={Boolean(messageRow)} onOpenChange={(open) => { if (!open) setMessageId(null); }}>
        <DialogContent dir="rtl" className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader className="text-right sm:text-right"><DialogTitle>إيميل {messageRow?.name}</DialogTitle><DialogDescription>اختر الرسالة وراجع التفاصيل قبل نسخها أو فتح برنامج البريد.</DialogDescription></DialogHeader>
          {messageRow && <p className="rounded-xl bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800" dir="ltr">Meeting ID: {messageRow.meetingId}</p>}
          <div className="flex flex-wrap gap-2" role="group" aria-label="نوع الرسالة">{(Object.keys(messageLabels) as MessageKind[]).map((type) => <Button key={type} size="sm" variant={kind === type ? "default" : "outline"} aria-pressed={kind === type} onClick={() => setKind(type)}>{messageLabels[type]}</Button>)}</div>
          {kind === "training" && messageRow && <div className="space-y-3 rounded-xl bg-blue-50 p-4">
            <p className="text-sm">التدريب: <bdi>{p.onboarding.trainingStartDate}</bdi> · العمل: <bdi>{p.onboarding.employmentStartDate}</bdi> · أول صرف: <bdi>{p.onboarding.payrollDate}</bdi></p>
            <p className="text-sm text-slate-600">أدخل بيانات حساب Talureva الذي جهزته لهذا الشخص. هذه الأداة تجهّز الرسالة ولا تنشئ حساب Talureva.</p>
            {([['countries','الدول المخصصة — بالإنجليزية'],['loginId','Login ID'],['password','كلمة المرور المؤقتة — لهذه الجلسة فقط']] as const).map(([field,label]) => <div key={field} className="space-y-1.5"><Label htmlFor={"candidate-"+field}>{label}</Label><Input id={"candidate-"+field} dir="ltr" type={field === "password" ? "password" : "text"} autoComplete={field === "password" ? "new-password" : "off"} maxLength={field === "countries" ? 1000 : 500} value={p.candidateDetails(messageRow)[field]} onChange={(e) => p.onCandidateDetails(messageRow,field,e.target.value)} /></div>)}
            <p className="text-xs text-slate-500">كلمة المرور لا تُحفظ بعد تحديث الصفحة ولا تُضاف إلى ملف Excel.</p>
          </div>}
          {issue ? <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900" role="status">{issue}</p> : messageRow && <div dir="ltr" className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-4 text-left text-sm leading-7" aria-label="معاينة الرسالة">{p.buildMessage(messageRow, kind)}</div>}
          <div className="flex flex-wrap gap-2"><Button disabled={Boolean(issue) || !messageRow || !p.emailValid(messageRow)} onClick={() => messageRow && p.onEmail(messageRow, kind)}><Mail className="size-4" />فتح الإيميل الجاهز</Button><Button variant="outline" disabled={Boolean(issue) || !messageRow} onClick={() => messageRow && p.onCopy(messageRow, kind)}><Copy className="size-4" />نسخ نص الإيميل</Button></div>
          <p className="rounded-xl bg-emerald-50 p-3 text-sm leading-6 text-emerald-900">دعوة المقابلة تتضمن رابط تأكيد حضور مباشر عبر واتساب إلى الرقم +1 709 506 3202 مع Meeting ID الخاص بالمرشح.</p>
          {messageRow && !p.emailValid(messageRow) && <p className="text-sm text-amber-800">لا يوجد بريد إلكتروني صالح لهذا المرشح. يمكنك نسخ النص فقط.</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
