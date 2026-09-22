"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_TEMPLATES, TEMPLATE_TOKENS, templateIssue, type MessageKind, type MessageTemplates, type OnboardingSettings } from "@/lib/interview-messages";

export function MessageSettings({settings, templates, onSettings, onTemplates}: {
  settings: OnboardingSettings; templates: MessageTemplates;
  onSettings: (value: OnboardingSettings) => void; onTemplates: (value: MessageTemplates) => void;
}) {
  const [kind, setKind] = useState<MessageKind>("invitation");
  const fields: {key: keyof OnboardingSettings; label: string; type?: string}[] = [
    {key:"trainingStartDate",label:"بداية التدريب المدفوع",type:"date"},
    {key:"employmentStartDate",label:"بداية أول شهر عمل",type:"date"},
    {key:"payrollDate",label:"أول صرف، ويشمل مقابل التدريب",type:"date"},
    {key:"salary",label:"الراتب الشهري بعد التدريب — USD",type:"number"},
    {key:"workingHours",label:"نظام العمل — بالإنجليزية"},
    {key:"platformUrl",label:"رابط دخول منصة Talureva",type:"url"},
    {key:"tutorialUrl",label:"رابط فيديو الشرح — 5 دقائق",type:"url"},
  ];
  const issue = templateIssue(templates[kind],kind);
  return <div className="space-y-5">
    <p className="rounded-xl bg-blue-50 p-3 text-sm">الرسائل والمقابلات بالإنجليزية دائمًا · Makkah time (UTC+3)</p>
    <div className="space-y-3"><h3 className="font-bold">مواعيد وشروط الانضمام الثابتة</h3><p className="text-sm text-slate-500">تخص جميع المرشحين، ولا تتغير عند اختيار يوم مقابلات آخر.</p>
      {fields.map(({key,label,type}) => <div key={key} className="space-y-1.5"><Label htmlFor={"onboarding-" + key}>{label}</Label><Input id={"onboarding-" + key} type={type || "text"} dir="ltr" value={settings[key]} min={type === "number" ? "0" : undefined} onInput={(e) => onSettings({...settings,[key]:e.currentTarget.value})} onChange={(e) => onSettings({...settings,[key]:e.target.value})}/></div>)}
    </div>
    <div className="space-y-3 border-t pt-4"><h3 className="font-bold">تعديل نماذج الرسائل</h3>
      <div className="flex flex-wrap gap-2">{([['invitation','قبل المقابلة'],['meeting','رابط الاجتماع'],['training','بعد المقابلة']] as const).map(([key,label]) => <Button key={key} size="sm" variant={kind === key ? "default" : "outline"} onClick={() => setKind(key)}>{label}</Button>)}</div>
      <Textarea aria-label="نص نموذج الرسالة" dir="ltr" className="min-h-80 text-sm leading-6" maxLength={12000} value={templates[kind]} onChange={(e) => onTemplates({...templates,[kind]:e.target.value})}/>
      {issue && <p role="alert" className="text-sm text-amber-800">{issue}</p>}
      <details className="text-sm"><summary className="cursor-pointer font-medium">الحقول التي تُعبّأ تلقائيًا</summary><p dir="ltr" className="mt-2 break-words leading-7 text-slate-500">{TEMPLATE_TOKENS.map((t) => "["+t+"]").join(" · ")}</p></details>
      <Button variant="outline" size="sm" onClick={() => onTemplates({...templates,[kind]:DEFAULT_TEMPLATES[kind]})}>استعادة النص الأصلي لهذا النموذج</Button>
    </div>
  </div>;
}
