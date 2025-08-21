
import React, { useEffect, useMemo, useState, useRef } from "react";
import { DateTime, Duration, Settings } from "luxon";
import { motion, AnimatePresence } from "framer-motion";

type Theme = "system" | "light" | "dark";
type HourFormat = "12h" | "24h";
type ReminderKeys = "halfway" | "threeDays" | "lastDay" | "renewal";

export type SubscriptionCycle = {
  plan: "ChatGPT Plus";
  timezone: "Asia/Kathmandu";
  startISO: string;
  endISO: string;
  reminders: { halfway: boolean; threeDays: boolean; lastDay: boolean; renewal: boolean; };
  theme: Theme;
  hourFormat: HourFormat;
};

const DEFAULT_ZONE = "Asia/Kathmandu" as const;
const DEFAULT_CYCLE: SubscriptionCycle = {
  plan: "ChatGPT Plus",
  timezone: DEFAULT_ZONE,
  startISO: "2025-08-20T07:18:00+05:45",
  endISO: "2025-09-20T07:18:00+05:45",
  reminders: { halfway: true, threeDays: true, lastDay: true, renewal: true },
  theme: "system",
  hourFormat: "12h",
};

const MS_PER_MIN = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MIN;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const inZone = (iso: string, zone = DEFAULT_ZONE) => DateTime.fromISO(iso, { zone });
const fmtDate = (dt: DateTime, hourFormat: HourFormat) => dt.setLocale("en").toLocaleString({
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: hourFormat === "12h",
});
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const asLocalInputValue = (dt: DateTime) => dt.toFormat("yyyy-LL-dd'T'HH:mm");
const fromLocalInputValue = (v: string, zone = DEFAULT_ZONE) => DateTime.fromFormat(v, "yyyy-LL-dd'T'HH:mm", { zone });
const monthAddCalendar = (dt: DateTime, months = 1) => dt.plus({ months });

function durationBreakdown(ms: number) {
  const days = Math.floor(ms / MS_PER_DAY);
  const rem1 = ms - days * MS_PER_DAY;
  const hours = Math.floor(rem1 / MS_PER_HOUR);
  const rem2 = rem1 - hours * MS_PER_HOUR;
  const minutes = Math.floor(rem2 / MS_PER_MIN);
  const seconds = Math.floor((rem2 - minutes * MS_PER_MIN) / 1000);
  return { days, hours, minutes, seconds };
}
function humanRel(dt: DateTime, base: DateTime) {
  const diff = dt.diff(base, ["days", "hours", "minutes"]).toObject();
  const parts: string[] = [];
  if ((diff.days ?? 0) !== 0) parts.push(`${Math.trunc(Math.abs(diff.days ?? 0))}d`);
  if ((diff.hours ?? 0) !== 0) parts.push(`${Math.trunc(Math.abs(diff.hours ?? 0))}h`);
  if (parts.length < 2) parts.push(`${Math.trunc(Math.abs(diff.minutes ?? 0))}m`);
  const tense = dt >= base ? "from now" : "ago";
  return `${parts.join(" ")} ${tense}`;
}
const uid = () => Math.random().toString(36).slice(2);
function loadState<T>(key: string, fallback: T): T { try { const raw = localStorage.getItem(key); return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback; } catch { return fallback; } }
function saveState<T>(key: string, val: T) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

function rollCycleToNow(cycle: SubscriptionCycle, now: DateTime) {
  let start = inZone(cycle.startISO, cycle.timezone);
  let end = inZone(cycle.endISO, cycle.timezone);
  let rolled = false;
  if (now < start) return { start, end, rolled };
  while (now >= end) { start = end; end = monthAddCalendar(end, 1); rolled = true; }
  return { start, end, rolled };
}
function milestoneTimes(start: DateTime, end: DateTime) {
  const totalMs = end.toMillis() - start.toMillis();
  const halfway = start.plus({ milliseconds: totalMs / 2 });
  const threeDays = end.minus({ days: 3 });
  const lastDay = end.minus({ hours: 24 });
  const renewal = end;
  return { halfway, threeDays, lastDay, renewal };
}
function generateICS(start: DateTime, end: DateTime, zone: string) {
  const { halfway, threeDays, lastDay, renewal } = milestoneTimes(start, end);
  const nowUTC = DateTime.now().toUTC();
  const dtstamp = nowUTC.toFormat("yyyyLLdd'T'HHmmss'Z'");
  const wrap = (dt: DateTime) => `DTSTART;TZID=${zone}:${dt.toFormat("yyyyLLdd'T'HHmm")}`;
  const events = [
    { sum: "ChatGPT Plus: Halfway point", dt: halfway },
    { sum: "ChatGPT Plus: 3 days left", dt: threeDays },
    { sum: "ChatGPT Plus: 24 hours left", dt: lastDay },
    { sum: "ChatGPT Plus: Renewal", dt: renewal.minus({ minutes: 5 }) },
  ];
  const vevents = events.map((e) => ["BEGIN:VEVENT", `UID:${uid()}@gptdeadline`, `DTSTAMP:${dtstamp}`, wrap(e.dt), `SUMMARY:${e.sum}`, "END:VEVENT"].join("\\n")).join("\\n");
  return ["BEGIN:VCALENDAR","VERSION:2.0","CALSCALE:GREGORIAN","PRODID:-//GPTDeadline//EN",vevents,"END:VCALENDAR"].join("\\n");
}

const TIPS = [
  "Try Deep Research for a complex topic you’ve been postponing.",
  "Audit your best prompts; turn them into reusable templates.",
  "Use voice + screen share to troubleshoot a workflow quickly.",
  "Batch tasks: draft 5 emails, then refine in one go.",
  "Set up automations for weekly summaries and reminders.",
  "Keep a ‘Wins’ doc—log outputs you shipped thanks to Plus.",
];
function useRotatingTip(intervalMs = 8000) {
  const [i, setI] = useState(0);
  useEffect(() => { const id = setInterval(() => setI((p) => (p + 1) % TIPS.length), intervalMs); return () => clearInterval(id); }, [intervalMs]);
  return TIPS[i];
}
function useNowTick(qaMode: boolean, qaNowISO?: string) {
  const [now, setNow] = useState(() => qaMode && qaNowISO ? inZone(qaNowISO) : DateTime.now().setZone(DEFAULT_ZONE));
  useEffect(() => { const id = setInterval(() => setNow((prev) => qaMode ? prev.plus({ seconds: 1 }) : DateTime.now().setZone(DEFAULT_ZONE)), 1000); return () => clearInterval(id); }, [qaMode]);
  useEffect(() => { if (qaMode && qaNowISO) setNow(inZone(qaNowISO)); }, [qaMode, qaNowISO]);
  return now;
}

// Fixed reminder hook
function useReminders(enabled: SubscriptionCycle["reminders"], start: DateTime, end: DateTime) {
  const timers = useRef<{ [K in ReminderKeys]?: number }>({});
  const [toasts, setToasts] = useState<{ id: string; title: string; body: string }[]>([]);
  useEffect(() => {
    Object.values(timers.current).forEach((id) => id && clearTimeout(id as number));
    timers.current = {};
    const schedule = async (key: ReminderKeys, at: DateTime, title: string, body: string) => {
      const nowRef = DateTime.now().setZone(DEFAULT_ZONE);
      const delay = at.toMillis() - nowRef.toMillis();
      if (delay <= 0 || !enabled[key]) return;
      const pushToast = () => {
        if ("Notification" in window) { if (Notification.permission === "granted") new Notification(title, { body }); }
        const tid = uid(); setToasts((list) => [{ id: tid, title, body }, ...list].slice(0, 4));
        window.setTimeout(() => { setToasts((list) => list.filter((t) => t.id !== tid)); }, 7000);
      };
      if ("Notification" in window && Notification.permission === "default") { try { await Notification.requestPermission(); } catch {} }
      timers.current[key] = window.setTimeout(pushToast, delay) as unknown as number;
    };
    const { halfway, threeDays, lastDay, renewal } = milestoneTimes(start, end);
    schedule("halfway", halfway, "Halfway point", "You’re halfway through this cycle. Plan a high-value session.");
    schedule("threeDays", threeDays, "3 days left", "Three days left—queue the tasks you want done.");
    schedule("lastDay", lastDay, "24 hours left", "Last day of this cycle. Ship something today.");
    schedule("renewal", renewal.minus({ minutes: 5 }), "Renewal soon", "Your plan renews in 5 minutes.");
    return () => { Object.values(timers.current).forEach((id) => id && clearTimeout(id as number)); timers.current = {}; };
  }, [enabled, start.toMillis(), end.toMillis()]);
  const snooze = (minutes = 60) => {
    const title = "Snoozed reminder"; const body = `I'll remind you again in ${minutes} minutes.`;
    const tid = uid();
    const tidTO = window.setTimeout(() => {
      if ("Notification" in window && Notification.permission === "granted") new Notification("Reminder", { body: "This is your snoozed reminder." });
      setToasts((list) => [{ id: uid(), title: "Reminder", body: "Snooze time is up." }, ...list].slice(0, 4));
    }, minutes * MS_PER_MIN);
    setToasts((list) => [{ id: tid, title, body }, ...list].slice(0, 4));
    window.setTimeout(() => { setToasts((list) => list.filter((t) => t.id !== tid)); }, 3000);
    return tidTO;
  };
  const dismissToast = (id: string) => setToasts((list) => list.filter((t) => t.id !== id));
  return { toasts, snooze, dismissToast };
}

function ProgressRing({ progress, label, size = 220 }: { progress: number; label: string; size?: number }) {
  const stroke = 14; const r = (size - stroke) / 2; const c = 2 * Math.PI * r;
  const clamped = clamp(progress, 0, 1); const dash = c * clamped; const offset = c - dash;
  return (
    <div className="relative inline-block" aria-label="Subscription progress" role="img" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped * 100)}>
      <svg width={size} height={size} className="block">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="text-gray-200 dark:text-gray-800" stroke="currentColor" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} strokeLinecap="round" className="text-blue-500" strokeDasharray={`${dash} ${c}`} strokeDashoffset={offset} stroke="currentColor" fill="none" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-4xl font-semibold" aria-live="polite">{label}</div>
        <div className="text-sm text-gray-500">{`${(100 - Math.round(clamped * 100))}% left`}</div>
      </div>
    </div>
  );
}
function Timeline({ start, now, end }: { start: DateTime; now: DateTime; end: DateTime }) {
  const total = end.toMillis() - start.toMillis();
  const elapsed = clamp(now.toMillis() - start.toMillis(), 0, total);
  const pctNow = (elapsed / total) * 100;
  return (
    <div className="w-full">
      <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-800 relative overflow-hidden">
        <div className="absolute inset-y-0 left-0 bg-blue-500" style={{ width: `${pctNow}%` }} />
        <div className="absolute -top-1 left-0 h-4 w-0.5 bg-gray-400" aria-label="start marker" />
        <div className="absolute -top-1 right-0 h-4 w-0.5 bg-gray-400" aria-label="end marker" />
        <div className="absolute -top-1" style={{ left: `calc(${pctNow}% - 1px)` }}><div className="h-4 w-0.5 bg-blue-600" aria-label="now marker" /></div>
      </div>
      <div className="mt-2 flex justify-between text-xs text-gray-600 dark:text-gray-300"><span>Start</span><span>Today</span><span>End</span></div>
    </div>
  );
}
function CalendarStrip({ start, now, end }: { start: DateTime; now: DateTime; end: DateTime }) {
  const days: { date: DateTime; fill: number }[] = []; let cursor = start.startOf("day"); const endDay = end.startOf("day");
  while (cursor <= endDay) {
    const dayStart = DateTime.max(cursor, start); const dayEnd = DateTime.min(cursor.plus({ days: 1 }), end);
    const denom = Math.max(1, dayEnd.toMillis() - dayStart.toMillis()); const upto = DateTime.min(dayEnd, now);
    const fill = clamp((upto.toMillis() - dayStart.toMillis()) / denom, 0, 1);
    days.push({ date: cursor, fill }); cursor = cursor.plus({ days: 1 });
  }
  return (<div className="flex gap-1 flex-wrap" aria-label="Calendar progress strip">
    {days.map((d) => (<div key={d.date.toISODate()} className="w-6 h-8 rounded bg-gray-200 dark:bg-gray-800 overflow-hidden" title={`${d.date.toFormat("LLL d")}: ${(d.fill*100).toFixed(0)}%`}>
      <div className="h-full bg-blue-500" style={{ height: `${d.fill * 100}%` }} /></div>))}
  </div>);
}

export default function GPTDeadlineApp() {
  const [cycle, setCycle] = useState<SubscriptionCycle>(() => loadState("gpt-deadline:cycle", DEFAULT_CYCLE));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [qaMode, setQaMode] = useState(false);
  const [qaNowISO, setQaNowISO] = useState<string | undefined>(undefined);
  const theme = cycle.theme;

  useEffect(() => { Settings.defaultZone = cycle.timezone; }, [cycle.timezone]);
  useEffect(() => {
    const root = document.documentElement;
    const sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = theme === 'dark' || (theme === 'system' && sysDark);
    root.classList.toggle('dark', isDark);
  }, [theme]);

  const now = useNowTick(qaMode, qaNowISO);
  const { start, end, rolled } = useMemo(() => rollCycleToNow(cycle, now), [cycle, now.toMillis()]);

  const totalMs = end.toMillis() - start.toMillis();
  const elapsedMs = clamp(now.toMillis() - start.toMillis(), 0, totalMs);
  const remainingMs = clamp(end.toMillis() - now.toMillis(), 0, totalMs);
  const progress = elapsedMs / totalMs;
  const { days, hours, minutes, seconds } = durationBreakdown(remainingMs);

  const tip = useRotatingTip();
  const { toasts, snooze, dismissToast } = useReminders(cycle.reminders, start, end);

  useEffect(() => { saveState("gpt-deadline:cycle", cycle); }, [cycle]);

  const startLabel = fmtDate(start, cycle.hourFormat);
  const endLabel = fmtDate(end, cycle.hourFormat);
  const milestones = useMemo(() => {
    const m = milestoneTimes(start, end);
    return [
      { key: "halfway" as const, label: "Halfway point", at: m.halfway },
      { key: "threeDays" as const, label: "3 days left", at: m.threeDays },
      { key: "lastDay" as const, label: "24 hours left", at: m.lastDay },
      { key: "renewal" as const, label: "Renewal", at: m.renewal },
    ];
  }, [start.toMillis(), end.toMillis()]);

  const updateReminder = (k: ReminderKeys, v: boolean) => setCycle((c) => ({ ...c, reminders: { ...c.reminders, [k]: v } }));
  const toggleTheme = (t: Theme) => setCycle((c) => ({ ...c, theme: t }));
  const toggleHourFmt = (f: HourFormat) => setCycle((c) => ({ ...c, hourFormat: f }));

  const onEditDates = (newStartLocal: string, newEndLocal: string) => {
    const s = fromLocalInputValue(newStartLocal, cycle.timezone);
    const e = fromLocalInputValue(newEndLocal, cycle.timezone);
    if (!s.isValid || !e.isValid || e <= s) return alert("Please provide valid start/end with end after start.");
    setCycle((c) => ({ ...c, startISO: s.toISO()!, endISO: e.toISO()! }));
  };
  const onExportICS = () => {
    const ics = generateICS(start, end, cycle.timezone);
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `gpt-deadline-${start.toFormat('yyyyLLdd')}-${end.toFormat('yyyyLLdd')}.ics`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };
  const onResetDefaults = () => setCycle(DEFAULT_CYCLE);
  const renewedState = now >= end;

  return (
    <div className="min-h-screen bg-white text-gray-900 dark:bg-neutral-950 dark:text-neutral-100 transition-colors duration-200">
      <header className="px-4 py-3 flex items-center justify-between border-b border-black/5 dark:border-white/10 sticky top-0 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-neutral-950/60">
        <div className="flex items-center gap-2">
          <span className="text-xl font-semibold">GPT deadline</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{cycle.plan}</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-sm" onClick={() => setSettingsOpen(true)} aria-label="Open settings">Settings</button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl p-4 grid gap-4 md:grid-cols-[1.2fr_1fr]">
        <section className="rounded-2xl p-4 md:p-6 bg-white/70 dark:bg-white/5 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
          <div className="flex flex-col items-center gap-4">
            <ProgressRing progress={progress} label={`${days}d`} />
            <div className="flex items-center gap-2 text-lg" aria-live="polite" aria-label="Countdown timer">
              <span className="tabular-nums">{days}d</span><span>•</span><span className="tabular-nums">{hours}h</span><span>•</span><span className="tabular-nums">{minutes}m</span><span>•</span><span className="tabular-nums">{seconds}s</span>
            </div>
            <Timeline start={start} now={now} end={end} />
            <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-gray-600 dark:text-gray-300">
              <span>Started <strong>{startLabel}</strong></span><span>•</span><span>Renews <strong>{endLabel}</strong></span>
              {rolled && <span className="ml-2 text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">Rolled to current cycle</span>}
            </div>
            <div className="w-full mt-2 rounded-xl p-3 md:p-4 bg-blue-50 text-blue-900 dark:bg-blue-900/20 dark:text-blue-100">
              <div className="text-sm font-medium">Usage tip</div>
              <div className="text-sm opacity-90 mt-1">{useRotatingTip()}</div>
            </div>
            <div className="mt-2 flex gap-2">
              <button className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-sm" onClick={() => setDetailsOpen((v) => !v)} aria-expanded={detailsOpen} aria-controls="details">{detailsOpen ? "Hide details" : "Details"}</button>
              <button className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-sm" onClick={() => setTipsOpen((v) => !v)} aria-expanded={tipsOpen} aria-controls="tips">{tipsOpen ? "Hide plan optimization" : "Plan optimization"}</button>
            </div>
          </div>

          <AnimatePresence initial={false}>
            {detailsOpen && (
              <motion.div id="details" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mt-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="rounded-xl p-4 bg-gray-50 dark:bg-white/5">
                    <div className="text-sm font-semibold mb-2">Cycle breakdown</div>
                    <ul className="space-y-1 text-sm">
                      <li><strong>Total length:</strong> {Duration.fromMillis(totalMs).shiftTo("days", "hours").toHuman({ listStyle: "narrow", unitDisplay: "short" })}</li>
                      <li><strong>Elapsed:</strong> {pct(progress)} used</li>
                      <li><strong>Remaining:</strong> {pct(1 - progress)} left</li>
                      <li><strong>Start (local):</strong> {startLabel} ({cycle.timezone})</li>
                      <li><strong>End (local):</strong> {endLabel} ({cycle.timezone})</li>
                    </ul>
                  </div>
                  <div className="rounded-xl p-4 bg-gray-50 dark:bg-white/5">
                    <div className="text-sm font-semibold mb-2">Milestones</div>
                    <ul className="space-y-2 text-sm">
                      {milestones.map((m) => (
                        <li key={m.key} className="flex items-center justify-between">
                          <span>{m.label}</span>
                          <span className="text-gray-600 dark:text-gray-300">{fmtDate(m.at, cycle.hourFormat)} • <em className="not-italic">{humanRel(m.at, now)}</em></span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="text-sm font-semibold mb-2">Calendar strip</div>
                  <CalendarStrip start={start} now={now} end={end} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence initial={false}>
            {tipsOpen && (
              <motion.div id="tips" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mt-4">
                <div className="rounded-xl p-4 bg-gray-50 dark:bg-white/5 grid md:grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm font-semibold mb-2">Quick actions</div>
                    <div className="flex flex-wrap gap-2 text-sm">
                      <button className="px-3 py-1.5 rounded-lg bg-white dark:bg-white/10 hover:bg-gray-100 dark:hover:bg-white/20 ring-1 ring-black/5">Review Plus benefits</button>
                      <button className="px-3 py-1.5 rounded-lg bg-white dark:bg-white/10 hover:bg-gray-100 dark:hover:bg-white/20 ring-1 ring-black/5">Deep Research best practices</button>
                      <button className="px-3 py-1.5 rounded-lg bg-white dark:bg-white/10 hover:bg-gray-100 dark:hover:bg-white/20 ring-1 ring-black/5">Prompt library</button>
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-semibold mb-2">Tips (short, curated)</div>
                    <ul className="list-disc list-inside text-sm space-y-1 text-gray-700 dark:text-gray-300">
                      <li>Block 25–45 minutes for a focused session twice a week.</li>
                      <li>Save proven prompts with examples; reuse & iterate.</li>
                      <li>Use images + screen share for faster troubleshooting.</li>
                      <li>Set calendar nudges for high-impact tasks tied to renewal.</li>
                    </ul>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <section className="flex flex-col gap-4">
          <div className="rounded-2xl p-4 bg-white/70 dark:bg-white/5 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">Reminders & nudges</div>
                <div className="text-sm text-gray-600 dark:text-gray-300">Local notifications; toggles persist. Snooze inside app.</div>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {milestones.map((m) => {
                const key = m.key as ReminderKeys;
                const on = cycle.reminders[key];
                return (
                  <label key={m.key} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 bg-gray-50 dark:bg_WHITE/5">
                    <div className="text-sm">
                      <div className="font-medium">{m.label}</div>
                      <div className="text-gray-600 dark:text-gray-300">{fmtDate(m.at, cycle.hourFormat)} • {humanRel(m.at, now)}</div>
                    </div>
                    <input type="checkbox" checked={on} onChange={(e) => updateReminder(key, e.target.checked)} aria-label={`Toggle ${m.label} reminder`} />
                  </label>
                );
              })}
            </div>
            <div className="mt-3 flex gap-2">
              <button className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-sm" onClick={() => snooze(60)}>Snooze 1h</button>
              <button className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-sm" onClick={() => snooze(10)}>Snooze 10m</button>
              <button className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-sm" onClick={onExportICS}>Export .ics</button>
            </div>
            <div className="mt-3 text-xs text-gray-500">Email push requires integration; by default everything stays local.</div>
          </div>

          <div className="rounded-2xl p-4 bg-white/70 dark:bg-white/5 shadow-sm ring-1 ring-black/5 dark:ring_WHITE/10">
            <div className="font-semibold">Quick settings</div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div className="col-span-2">
                <div className="text-xs text-gray-500 mb-1">Timezone</div>
                <div className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-white/5">{cycle.timezone}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">Theme</div>
                <select className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-white/5" value={cycle.theme} onChange={(e) => toggleTheme(e.target.value as Theme)}>
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">Time format</div>
                <select className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-white/5" value={cycle.hourFormat} onChange={(e) => toggleHourFmt(e.target.value as HourFormat)}>
                  <option value="12h">12-hour</option>
                  <option value="24h">24-hour</option>
                </select>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-sm" onClick={() => setSettingsOpen(true)}>Open full settings</button>
              <button className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg_WHITE/10 hover:bg-gray-200 dark:hover:bg_WHITE/20 text-sm" onClick={onResetDefaults}>Reset to defaults</button>
            </div>
          </div>

          <div className="rounded-2xl p-4 bg-white/70 dark:bg-white/5 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
            <div className="font-semibold">QA Mode</div>
            <div className="mt-2 text-sm">Override "Now" for testing (ticks forward every second).</div>
            <div className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={qaMode} onChange={(e) => setQaMode(e.target.checked)} id="qa-mode" />
              <label htmlFor="qa-mode">Enable QA time override</label>
            </div>
            {qaMode and (
              <div className="mt-2 grid gap-2">
                <label className="text-sm">
                  <span className="text-xs text-gray-500 block mb-1">Now (local)</span>
                  <input className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-white/5 w-full" type="datetime-local" value={qaNowISO ? inZone(qaNowISO).toFormat("yyyy-LL-dd'T'HH:mm") : now.toFormat("yyyy-LL-dd'T'HH:mm")} onChange={(e) => setQaNowISO(DateTime.fromFormat(e.target.value, "yyyy-LL-dd'T'HH:mm", { zone: cycle.timezone }).toISO()!)} />
                </label>
                <div className="text-xs text-gray-500">Sample: set 2025-08-21 10:00 → elapsed ≈ ~3.7% (1 day in ~31).</div>
              </div>
            )}
          </div>
        </section>
      </main>

      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[92vw] max-w-sm space-y-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div key={t.id} initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }} className="pointer-events-auto rounded-xl bg-neutral-900 text-white shadow-lg p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-sm">{t.title}</div>
                  <div className="text-xs opacity-90">{t.body}</div>
                </div>
                <button className="text-xs underline" onClick={() => dismissToast(t.id)}>Dismiss</button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {settingsOpen && (
          <motion.div className="fixed inset-0 z-50 grid place-items-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-black/50" onClick={() => setSettingsOpen(false)} />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative z-10 w-full max-w-2xl rounded-2xl p-4 md:p-6 bg-white text-gray-900 dark:bg-neutral-900 dark:text-neutral-100 shadow-xl ring-1 ring-black/10 dark:ring-white/10">
              <div className="flex items-center justify-between">
                <div className="text-lg font-semibold">Settings</div>
                <button className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-sm" onClick={() => setSettingsOpen(false)}>Close</button>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="rounded-xl p-4 bg-gray-50 dark:bg-white/5">
                  <div className="text-sm font-semibold mb-2">Cycle dates</div>
                  <label className="block text-sm mb-2">
                    <span className="text-xs text-gray-500">Start</span>
                    <input className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/10 ring-1 ring-black/5 dark:ring-white/10" type="datetime-local" defaultValue={start.toFormat("yyyy-LL-dd'T'HH:mm")} id="start-input" />
                  </label>
                  <label className="block text-sm mb-2">
                    <span className="text-xs text-gray-500">End</span>
                    <input className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/10 ring-1 ring-black/5 dark:ring-white/10" type="datetime-local" defaultValue={end.toFormat("yyyy-LL-dd'T'HH:mm")} id="end-input" />
                  </label>
                  <button className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg_WHITE/10 hover:bg-gray-200 dark:hover:bg_WHITE/20 text-sm" onClick={() => {
                    const s = (document.getElementById("start-input") as HTMLInputElement).value;
                    const e = (document.getElementById("end-input") as HTMLInputElement).value;
                    onEditDates(s, e);
                  }}>Save dates</button>
                  <div className="text-xs text-gray-500 mt-2">Treat month add as calendar add (e.g., Aug 20 → Sep 20 at same local time).</div>
                </div>
                <div className="rounded-xl p-4 bg-gray-50 dark:bg-white/5">
                  <div className="text-sm font-semibold mb-2">Preferences</div>
                  <label className="block text-sm mb-2">
                    <span className="text-xs text-gray-500">Theme</span>
                    <select className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/10 ring-1 ring-black/5 dark:ring-white/10" value={cycle.theme} onChange={(e) => toggleTheme(e.target.value as Theme)}>
                      <option value="system">System</option>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </select>
                  </label>
                  <label className="block text-sm mb-2">
                    <span className="text-xs text-gray-500">Time format</span>
                    <select className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/10 ring-1 ring-black/5 dark:ring-white/10" value={cycle.hourFormat} onChange={(e) => toggleHourFmt(e.target.value as HourFormat)}>
                      <option value="12h">12-hour</option>
                      <option value="24h">24-hour</option>
                    </select>
                  </label>
                  <div className="text-xs text-gray-500">Privacy: stored locally; no external calls by default.</div>
                </div>
                <div className="rounded-xl p-4 bg-gray-50 dark:bg-white/5 md:col-span-2">
                  <div className="text-sm font-semibold mb-2">Utilities</div>
                  <div className="flex flex-wrap gap-2">
                    <button className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-sm" onClick={() => {
                      const s = DateTime.fromISO(cycle.startISO, { zone: cycle.timezone });
                      const e = s.plus({ months: 1 });
                      setCycle((c) => ({ ...c, endISO: e.toISO()! }));
                    }}>Recompute 1-month end</button>
                    <button className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-sm" onClick={onExportICS}>Export reminders (.ics)</button>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {renewedState && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-emerald-600 text-white text-sm shadow-lg">
          Cycle renewed. Showing current window.
        </div>
      )}
    </div>
  );
}
