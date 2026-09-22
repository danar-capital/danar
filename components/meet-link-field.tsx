"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeMeetLink } from "@/lib/interview-messages";

export function MeetLinkField({id, label, value, fallback = "", onSave, onOpen}: {
  id: string; label: string; value: string; fallback?: string;
  onSave: (value: string) => void; onOpen?: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { const frame = requestAnimationFrame(() => {setDraft(value); setError("");}); return () => cancelAnimationFrame(frame); }, [value]);
  const save = () => {
    const result = normalizeMeetLink(draft);
    if (result.error) {setError(result.error); return null;}
    setError(""); setDraft(result.url); onSave(result.url);
    setNotice(result.url !== draft.trim() ? "تم تنظيف الرابط وحفظ نسخة واحدة منه." : "تم حفظ الرابط.");
    return result.url || normalizeMeetLink(fallback).url;
  };
  return <div className="min-w-0 flex-1 space-y-2">
    <Label htmlFor={id}>{label}</Label>
    <div className="flex flex-wrap gap-2">
      <Input id={id} dir="ltr" type="text" value={draft} placeholder="https://meet.google.com/abc-defg-hij" className="h-11 min-w-0 basis-full sm:flex-1 sm:basis-auto" aria-invalid={!!error} aria-describedby={id + "-help"}
        onChange={(e) => {setDraft(e.target.value); setError(""); setNotice("");}}
        onPaste={(e) => {e.preventDefault(); setDraft(e.clipboardData.getData("text")); setError(""); setNotice("");}}
        onBlur={() => {if (draft !== value) save();}} onKeyDown={(e) => {if(e.key === "Enter") {e.preventDefault();save();}}} />
      <Button className="h-11" variant="outline" onClick={save}>حفظ الرابط</Button>
      {onOpen && <Button className="h-11" variant="outline" disabled={!draft.trim() && !fallback.trim()} onClick={() => {const url = save(); if(url) onOpen(url);}}>دخول الاجتماع</Button>}
    </div>
    <p id={id + "-help"} className={"text-sm " + (error ? "text-rose-700" : "text-slate-500")} role={error ? "alert" : undefined}>{error || notice || (!value && fallback ? "يُستخدم الرابط العام حتى تحفظ رابطًا خاصًا لهذا الموظف." : "الصق الرابط مرة واحدة؛ يُحفظ حتى تغيّره ويُرسل في رسالة الاجتماع فقط.")}</p>
  </div>;
}
