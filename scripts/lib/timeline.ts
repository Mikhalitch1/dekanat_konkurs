/**
 * Расписание импортировано как две недели (нечётная и чётная). Чтобы кабинет
 * работал в любую дату, базовые две недели повторяются циклом по 14 дней.
 */
const DAY = 86_400_000;
const WEEK = 7 * DAY;

export function moscowDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Понедельник недели (00:00 по Москве) в мс UTC. */
export function moscowMonday(date: Date): number {
  const [y, m, d] = moscowDate(date).split('-').map(Number);
  const local = Date.UTC(y, m - 1, d) - 3 * 3_600_000;
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return local - weekday * DAY;
}

export interface BaseEntry { id: string; starts_at: string | Date; ends_at: string | Date }
export interface Occurrence<T> { entry: T; starts_at: string; ends_at: string; date: string }

export function occurrences<T extends BaseEntry>(entries: T[], from: Date, to: Date): Occurrence<T>[] {
  if (!entries.length) return [];
  const iso = (v: string | Date) => (typeof v === 'string' ? Date.parse(v) : v.getTime());
  const origin = moscowMonday(new Date(Math.min(...entries.map((e) => iso(e.starts_at)))));
  const result: Occurrence<T>[] = [];
  for (let week = moscowMonday(from); week <= to.getTime(); week += WEEK) {
    const index = Math.round((week - origin) / WEEK);
    const base = ((index % 2) + 2) % 2;
    const shift = week - (origin + base * WEEK);
    for (const entry of entries) {
      const start = iso(entry.starts_at);
      if (start < origin + base * WEEK || start >= origin + (base + 1) * WEEK) continue;
      const s = start + shift, e = iso(entry.ends_at) + shift;
      if (e < from.getTime() || s > to.getTime()) continue;
      result.push({ entry, starts_at: new Date(s).toISOString(), ends_at: new Date(e).toISOString(), date: moscowDate(new Date(s)) });
    }
  }
  return result.sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.entry.id.localeCompare(b.entry.id));
}
