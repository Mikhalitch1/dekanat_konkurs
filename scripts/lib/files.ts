import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { FIRST_WEEK_PARITY } from '../../config/schedule.js';
import { extractSourceSurnames, importWorkbook, loadSourceWorkbook, type ImportResult } from '../import-schedule/index.js';

export function loadEnvironment(): void {
  if (existsSync('.env')) process.loadEnvFile('.env');
}

export async function findScheduleFile(): Promise<string | undefined> {
  if (process.env.SCHEDULE_FILE) return resolve(process.env.SCHEDULE_FILE);
  const files: string[] = [];
  for (const dir of ['data/schedule', '.']) {
    if (existsSync(dir)) for (const name of await readdir(dir)) {
      if (name.endsWith('.xlsx') && !name.startsWith('~$')) files.push(resolve(join(dir, name)));
    }
  }
  if (files.length > 1) throw new Error('Найдено несколько XLSX; укажите SCHEDULE_FILE в .env');
  return files[0];
}

export function assertNoOriginalSurnames(value: unknown, surnames: string[]): void {
  const text = JSON.stringify(value).normalize('NFKC');
  for (const name of surnames) {
    const escaped = name.normalize('NFKC').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?<![\\p{L}])${escaped}(?![\\p{L}])`, 'iu').test(text)) {
      // Do not disclose the matching name or source text, even on failure.
      throw new Error('Проверка приватности: обнаружена исходная фамилия');
    }
  }
}

const uuid = z.string().uuid();
const groupSchema = z.object({ id:uuid,name:z.string(),course:z.number().int().min(1).max(6),program:z.string(),faculty:z.string() });
const seedSchema = z.object({
  groups:z.array(groupSchema),
  teachers:z.array(z.object({id:uuid,full_name:z.string()})),
  disciplines:z.array(z.object({id:uuid,name:z.string(),teacher_id:uuid.nullable(),kind:z.string()})),
  entries:z.array(z.object({id:uuid,group_id:uuid,discipline_id:uuid,room:z.string().nullable(),starts_at:z.string().datetime({offset:true}),ends_at:z.string().datetime({offset:true}),type:z.string(),subgroup:z.enum(['I','II']).nullable(),language:z.string().nullable(),language_group:z.string().nullable(),elective_option:z.string().nullable(),parity:z.enum(['odd','even']),source_sheet:z.string(),source_cell:z.string(),source_merge:z.string().nullable(),source_text:z.string()})),
  report:z.object({}).passthrough(),
});

/** Переносим обезличенный двухнедельный сид на неделю запуска без исходной книги. */
export function rebaseSeed(data: ImportResult, now = new Date()): ImportResult {
  if (!data.entries.length) return data;
  function monday(date: Date): number {
    const [year,month,day] = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(date).split('-').map(Number);
    const local = new Date(Date.UTC(year,month-1,day));
    return local.getTime()-((local.getUTCDay()+6)%7)*86400000;
  }
  const origin = monday(new Date(data.entries.reduce((a,e) => e.starts_at<a?e.starts_at:a,data.entries[0].starts_at)));
  const shift = monday(now)-origin;
  const firstParity = data.entries.filter((e) => monday(new Date(e.starts_at)) === origin)[0]?.parity;
  const flip = firstParity !== FIRST_WEEK_PARITY;
  return {...data,report:{...data.report,week_start:new Date(monday(now)).toISOString().slice(0,10),first_week_parity:FIRST_WEEK_PARITY},entries:data.entries.map((e) => {
    const weekSwap = flip ? (monday(new Date(e.starts_at)) === origin ? 7 : -7)*86400000 : 0;
    return {...e,starts_at:new Date(Date.parse(e.starts_at)+shift+weekSwap).toISOString(),ends_at:new Date(Date.parse(e.ends_at)+shift+weekSwap).toISOString()};
  })};
}

export async function prepareSeed(now = new Date()): Promise<{data:ImportResult;surnames:string[];fromSource:boolean}> {
  const source = await findScheduleFile();
  if (!source) {
    const parsed = seedSchema.parse(JSON.parse(await readFile('data/seed/schedule.json','utf8')));
    return {data:rebaseSeed(parsed as unknown as ImportResult,now),surnames:[],fromSource:false};
  }
  const workbook = await loadSourceWorkbook(source);
  const surnames = extractSourceSurnames(workbook);
  const data = importWorkbook(workbook,{now});
  assertNoOriginalSurnames(data,surnames);
  assertNoOriginalSurnames(await readFile('docs/SCHEDULE_FORMAT.md','utf8'),surnames);
  // No artifact is written until privacy and quality checks have passed.
  await saveJson('docs/reports/schedule-import.json',data.report);
  if (data.report.recognition_rate < 0.95) throw new Error('Распознавание ниже 95%; проверьте отчёт импорта');
  await saveJson('data/seed/schedule.json',data);
  return {data,surnames,fromSource:true};
}

async function saveJson(path: string,value:unknown): Promise<void> {
  await mkdir(dirname(path),{recursive:true});
  await writeFile(path,JSON.stringify(value,null,2)+'\n','utf8');
}
