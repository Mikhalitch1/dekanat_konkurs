import ExcelJS from 'exceljs';
import { z } from 'zod';
import { FIRST_WEEK_PARITY } from '../../config/schedule.js';
import { cellText, createAnonymizer, datesIn, normalizeText, stableId, withoutDates } from './privacy.js';
import type { CellAudit, Discipline, Entry, Group, ImportOptions, ImportResult, Issue, Teacher, WeekParity } from './types.js';

export { extractSourceSurnames, createAnonymizer, stableId } from './privacy.js';
export type { CellAudit, Discipline, Entry, Group, ImportOptions, ImportReport, ImportResult, Issue, Teacher, WeekParity } from './types.js';

interface Bounds { top: number; bottom: number; left: number; right: number; address: string }
interface Variant { language: string | null; language_group: string | null; subgroup: string | null; room: string | null }
const weekdays = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const optionsSchema = z.object({
  now: z.date().optional(),
  firstWeekParity: z.enum(['odd', 'even']).optional(),
  weeks: z.number().int().min(1).max(52).optional(),
});
const groupSchema = z.object({
  id: z.string().uuid(), name: z.string().min(1), course: z.number().int().min(1).max(6),
  program: z.string().min(1), faculty: z.string().min(1),
});

function columnNumber(value: string): number {
  return [...value].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
}

function bounds(address: string): Bounds {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/u.exec(address);
  if (!m) throw new Error('Invalid merged range');
  return { top: Number(m[2]), bottom: Number(m[4]), left: columnNumber(m[1]!), right: columnNumber(m[3]!), address };
}

function mergeAt(merges: Bounds[], row: number, col: number): Bounds | undefined {
  return merges.find((m) => m.top <= row && m.bottom >= row && m.left <= col && m.right >= col);
}

function parseTime(value: string): { start: string; end: string } | null {
  const m = /^(\d{1,2})[.:](\d{2})\s*[-–—]\s*(\d{1,2})[.:](\d{2})$/u.exec(normalizeText(value));
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (parts[0]! > 23 || parts[2]! > 23 || parts[1]! > 59 || parts[3]! > 59 || parts[0]! * 60 + parts[1]! >= parts[2]! * 60 + parts[3]!) return null;
  return { start: `${m[1]!.padStart(2, '0')}:${m[2]}`, end: `${m[3]!.padStart(2, '0')}:${m[4]}` };
}

function mondayInMoscow(now: Date): string {
  if (Number.isNaN(now.getTime())) throw new Error('Invalid import date');
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}

function dateTime(monday: string, offset: number, time: string): string {
  const day = new Date(`${monday}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + offset);
  return new Date(`${day.toISOString().slice(0, 10)}T${time}:00+03:00`).toISOString();
}

function roomFrom(text: string): string | null {
  const room = /ауд\.?\s*([\d]+[а-яa-z]?)/iu.exec(text);
  if (room) return room[1]!;
  if (/СОК/u.test(text)) return 'СОК';
  return null;
}

function languageFrom(text: string): string | null {
  const languages = [...text.matchAll(/англ(?:ийск)?[а-яё.]*|француз[а-яё.]*|испан[а-яё.]*|немец[а-яё.]*|араб[а-яё.]*|китай[а-яё.]*/giu)];
  const match = languages.at(-1)?.[0]?.toLowerCase();
  if (!match) return null;
  return match.startsWith('англ') ? 'английский' : match.startsWith('француз') ? 'французский' : match.startsWith('испан') ? 'испанский' : match.startsWith('немец') ? 'немецкий' : match.startsWith('араб') ? 'арабский' : 'китайский';
}

function variantsFrom(text: string): Variant[] {
  const group = /\((I{1,3}|[123])\s*гр\.?\)/iu.exec(text)?.[1] ?? null;
  const subgroup = group === '1' ? 'I' : group === '2' ? 'II' : group === '3' ? 'III' : group?.toUpperCase() ?? null;
  const languageGroups = [...text.matchAll(/гр\.?\s*(\d+(?:-\d+)?(?:\(\d+\))?)/giu)];
  if (!languageGroups.length) return [{ language: languageFrom(text), language_group: null, subgroup, room: roomFrom(text) }];
  return languageGroups.map((m, i) => ({
    language: languageFrom(text.slice(0, m.index)),
    language_group: m[1]!,
    subgroup,
    room: roomFrom(text.slice(m.index!, languageGroups[i + 1]?.index ?? text.length)),
  }));
}

function kindFrom(text: string): string {
  const lecture = /(?:^|[\s(/])ЛК(?:[\s)/]|$)/u.test(text);
  const practice = /(?:^|[\s(/])ПЗ(?:[\s)/]|$)/u.test(text);
  return lecture && practice ? 'lecture_practice' : lecture ? 'lecture' : practice ? 'practice' : 'class';
}

function disciplineName(text: string): string {
  const marker = text.search(/\((?:ЛК|ПЗ)|(?:д-р|канд\.|ст\.?преп|проф\.|доцент|Преподаватель [a-f0-9]{10}|ауд\.)/iu);
  return normalizeText(marker >= 0 ? text.slice(0, marker) : text).replace(/[\s,;]+$/u, '');
}

function knownNote(text: string): boolean {
  return /военн(?:ая|ой|ую) подготов|по расписанию|спортивн[а-яё]* секц|университет|учебн[а-яё]* практик|производственн[а-яё]* практик|самостоятельн[а-яё]* работ|декан факультета|защит[а-яё]* выпуск|каникул|экзаменационн[а-яё]* сесси/iu.test(text);
}

function groupFrom(sheet: ExcelJS.Worksheet, anonymize: (text: string) => string): Group | null {
  const name = normalizeText(cellText(sheet.getCell('C13')));
  const course = Number(/(\d)\s*курс/iu.exec(cellText(sheet.getCell('A9')))?.[1]);
  const program = normalizeText(anonymize(cellText(sheet.getCell('A10')))).replace(/^НАПРАВЛЕНИЕ\s+ПОДГОТОВКИ\s*[-–—:]\s*/iu, '');
  const faculty = normalizeText(anonymize(cellText(sheet.getCell('A2'))));
  const parsed = groupSchema.safeParse({ id: stableId(`group:${name}`), name, course, program, faculty });
  return parsed.success ? parsed.data : null;
}

function rowTime(sheet: ExcelJS.Worksheet, row: number): { start: string; end: string } | null {
  return parseTime(cellText(sheet.getCell(row, 2)));
}

function timing(sheet: ExcelJS.Worksheet, row: number, merge: Bounds | undefined): { start: string; end: string } | null {
  const endRow = merge?.bottom ?? row;
  const times = Array.from({ length: endRow - row + 1 }, (_, i) => rowTime(sheet, row + i)).filter((t) => t !== null);
  if (!times.length) return null;
  return { start: times[0]!.start, end: times.at(-1)!.end };
}

function weekdayAt(sheet: ExcelJS.Worksheet, row: number): number | null {
  const day = normalizeText(cellText(sheet.getCell(row, 1))).toLowerCase();
  const idx = weekdays.findIndex((d) => day === d);
  return idx < 0 ? null : idx;
}

function electiveOption(sheet: ExcelJS.Worksheet, row: number, col: number, merges: Bounds[], text: string): string | null {
  const block = mergeAt(merges, row, 2);
  if (!block || block.top === block.bottom || /\((?:I{1,3}|[123])\s*гр\.?\)/iu.test(text) || languageFrom(text)) return null;
  const candidates: number[] = [];
  for (let r = block.top; r <= block.bottom; r++) {
    const cell = sheet.getCell(r, col);
    if (cell.isMerged && cell.master.address !== cell.address) continue;
    const value = normalizeText(cellText(cell));
    if (value && !/^обед$/iu.test(value) && !languageFrom(value) && !/\((?:I{1,3}|[123])\s*гр\.?\)/iu.test(value)) candidates.push(r);
  }
  return candidates.length > 1 ? String(candidates.indexOf(row) + 1) : null;
}

export function importWorkbook(workbook: ExcelJS.Workbook, options: ImportOptions = {}): ImportResult {
  options = optionsSchema.parse(options);
  const firstParity: WeekParity = options.firstWeekParity ?? FIRST_WEEK_PARITY;
  const weeks = options.weeks ?? 2;
  if (weeks < 1 || weeks > 52 || !Number.isInteger(weeks)) throw new Error('weeks must be an integer from 1 to 52');
  const monday = mondayInMoscow(options.now ?? new Date());
  const anonymize = createAnonymizer(workbook);
  const groups: Group[] = [];
  const teachers = new Map<string, Teacher>();
  const disciplines = new Map<string, Discipline>();
  const entries: Entry[] = [];
  const cells: CellAudit[] = [];
  const unrecognized: Issue[] = [];
  const ignoredDates: Issue[] = [];
  const warnings: Issue[] = [];
  const skippedSheets: string[] = [];

  for (const sheet of workbook.worksheets) {
    const sheetName = normalizeText(sheet.name);
    if (sheet.state !== 'visible') { skippedSheets.push(sheetName); continue; }
    const group = groupFrom(sheet, anonymize);
    if (group) groups.push(group);
    const merges = (sheet.model.merges ?? []).map(bounds);
    for (let row = 14; row <= sheet.rowCount; row++) {
      for (let col = 2; col <= 4; col++) {
        const cell = sheet.getCell(row, col);
        if (cell.isMerged && cell.master.address !== cell.address) continue;
        const raw = normalizeText(cellText(cell));
        if (!raw) continue;
        const text = withoutDates(anonymize(raw));
        const dates = datesIn(raw);
        if (dates.length) ignoredDates.push({ sheet: sheetName, cell: cell.address, reason: 'text_dates_ignored', text, dates });
        if (col === 2) continue;
        const merge = mergeAt(merges, row, col);
        const parities: WeekParity[] = merge && merge.left <= 3 && merge.right >= 4 ? ['odd', 'even'] : col === 3 ? ['odd'] : ['even'];
        const time = timing(sheet, row, merge);
        const weekday = weekdayAt(sheet, row);
        const audit: CellAudit = { sheet: sheetName, cell: cell.address, merge: merge?.address ?? null, classification: 'unrecognized', text, weekday, start: time?.start ?? null, end: time?.end ?? null, parities, entry_ids: [] };
        cells.push(audit);
        if (/^обед$/iu.test(text)) { audit.classification = 'break'; continue; }
        if (knownNote(text)) { audit.classification = 'note'; continue; }
        if (!group || !time || weekday === null || !text) {
          const reason = !group ? 'missing_group_header' : weekday === null ? 'missing_weekday' : !time ? 'missing_time' : 'empty_after_removing_dates';
          unrecognized.push({ sheet: sheetName, cell: cell.address, reason, text });
          continue;
        }
        const name = disciplineName(text);
        if (!name) { unrecognized.push({ sheet: sheetName, cell: cell.address, reason: 'missing_discipline', text }); continue; }
        audit.classification = 'lesson';
        const teacherNames = [...new Set(text.match(/Преподаватель [a-f0-9]{10}/gu) ?? [])];
        for (const teacherName of teacherNames) {
          const id = stableId(`teacher:${teacherName}`);
          teachers.set(id, { id, full_name: teacherName });
        }
        const teacherId = teacherNames[0] ? stableId(`teacher:${teacherNames[0]}`) : null;
        const kind = kindFrom(text);
        const disciplineId = stableId(`discipline:${group.id}:${name}:${teacherId ?? 'unassigned'}:${kind}`);
        disciplines.set(disciplineId, { id: disciplineId, name, teacher_id: teacherId, kind });
        const variants = [...new Map(variantsFrom(text).map((variant) => [
          JSON.stringify([variant.subgroup, variant.language, variant.language_group, variant.room]), variant,
        ])).values()];
        const elective = electiveOption(sheet, row, col, merges, text);
        if (elective) warnings.push({ sheet: sheetName, cell: cell.address, reason: `parallel_elective_option_${elective}`, text });
        if (!variants.some((v) => v.room)) warnings.push({ sheet: sheetName, cell: cell.address, reason: 'room_unspecified', text });
        for (let week = 0; week < weeks; week++) {
          const parity: WeekParity = week % 2 === 0 ? firstParity : firstParity === 'odd' ? 'even' : 'odd';
          if (!parities.includes(parity)) continue;
          for (const variant of variants) {
            const startsAt = dateTime(monday, week * 7 + weekday, time.start);
            const endsAt = dateTime(monday, week * 7 + weekday, time.end);
            const id = stableId(`entry:${group.id}:${sheetName}:${cell.address}:${startsAt}:${endsAt}:${variant.subgroup}:${variant.language}:${variant.language_group}:${variant.room}:${elective}`);
            entries.push({ id, group_id: group.id, discipline_id: disciplineId, room: variant.room, starts_at: startsAt, ends_at: endsAt, type: kind, subgroup: variant.subgroup, language: variant.language, language_group: variant.language_group, elective_option: elective, source_sheet: sheetName, source_cell: cell.address, source_merge: merge?.address ?? null, source_text: text, parity });
            audit.entry_ids.push(id);
          }
        }
      }
    }
  }
  const recognized = cells.filter((c) => c.classification !== 'unrecognized').length;
  const lessonCells = cells.filter((c) => c.classification === 'lesson').length;
  const lessonCandidates = cells.filter((c) => c.classification !== 'break' && c.classification !== 'note').length;
  return { groups, teachers: [...teachers.values()], disciplines: [...disciplines.values()], entries, report: {
    nonempty_cells: cells.length, recognized_cells: recognized, recognition_rate: cells.length ? recognized / cells.length : 1,
    lesson_cells: lessonCells, lesson_candidates: lessonCandidates, lesson_coverage: lessonCandidates ? lessonCells / lessonCandidates : 1,
    unrecognized, ignored_dates: ignoredDates, warnings, cells, skipped_sheets: skippedSheets, first_week_parity: firstParity, week_start: monday,
  } };
}

export async function loadSourceWorkbook(path: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  return workbook;
}

export async function importScheduleFile(path: string, options: ImportOptions = {}): Promise<ImportResult> {
  return importWorkbook(await loadSourceWorkbook(path), options);
}
