const TZ = 'Europe/Moscow';
const time = new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const dateTime = new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const dayLong = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
const dayShort = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'short' });
const dayNum = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric' });
const dateOnly = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'long' });
const iso = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

const at = (day: string) => new Date(`${day}T12:00:00Z`);
export const mskToday = (now = new Date()) => iso.format(now);
export const addDays = (day: string, n: number) => { const d = at(day); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const fmtTime = (value: string) => time.format(new Date(value));
export const fmtDateTime = (value: string) => dateTime.format(new Date(value));
export const fmtDayLong = (day: string) => dayLong.format(at(day));
export const fmtDayShort = (day: string) => dayShort.format(at(day));
export const fmtDayNum = (day: string) => dayNum.format(at(day));
export const fmtDate = (day: string) => dateOnly.format(at(day));
export const fmtStamp = (value: string) => dateOnly.format(new Date(value)) + ', ' + time.format(new Date(value));
export const dayOf = (value: string) => iso.format(new Date(value));
export const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function untilText(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} мин`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

export function plural(n: number, one: string, few: string, many: string) {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? few : many;
}

export function greeting(now = new Date()) {
  const h = Number(new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, hour: '2-digit', hour12: false }).format(now));
  return h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
}
