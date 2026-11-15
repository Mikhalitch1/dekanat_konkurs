import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { DEMO_STUDENTS } from '../config/schedule.js';
import { databaseSnapshot, migrate, seedDatabase, studentId, studentSchedule } from '../scripts/lib/database.js';
import { assertNoOriginalSurnames, findScheduleFile, prepareSeed, rebaseSeed } from '../scripts/lib/files.js';
import type { ImportResult } from '../scripts/import-schedule/index.js';

const hasSourceWorkbook=Boolean(await findScheduleFile());

describe('Расписание в PostgreSQL', () => {
  let db:PGlite;
  let data:ImportResult;
  let surnames:string[];
  beforeAll(async () => {
    db = new PGlite();
    ({data,surnames} = await prepareSeed(new Date('2026-11-12T12:00:00+03:00')));
    await seedDatabase(db,data);
  });
  afterAll(async () => { if (db) await db.close(); });

  it('сохраняет курс и направление двух студентов из шапок и фильтрует свои группы', async () => {
    for (const expected of DEMO_STUDENTS) {
      const group = data.groups.find((g) => g.name===expected.group)!;
      const profile = (await db.query<{course:number;program:string;subgroup:string}>('SELECT course,program,subgroup FROM students WHERE user_id=$1',[studentId(expected.login)])).rows[0];
      expect(profile).toEqual({course:2,program:group.program,subgroup:'I'});
      const lessons = await studentSchedule(db,studentId(expected.login));
      expect(lessons.length).toBeGreaterThan(0);
      expect(lessons.every((e) => e.group_id===group.id)).toBe(true);
      expect(lessons.every((e) => e.subgroup===null || e.subgroup==='I')).toBe(true);
      expect(lessons.every((e) => e.language_group===null || (expected.language_groups as readonly string[]).includes(`${e.language}:${e.language_group}`))).toBe(true);
      expect(lessons.every((e) => e.elective_option===null || e.elective_option==='1')).toBe(true);
      for (const lesson of lessons) {
        expect(lesson).not.toHaveProperty('source_text');
        expect(lesson).not.toHaveProperty('source_sheet');
        expect(lesson).not.toHaveProperty('source_cell');
        expect(lesson).not.toHaveProperty('source_merge');
      }
    }
    expect(await studentSchedule(db,'00000000-0000-4000-a000-000000000000')).toEqual([]);
  });

  it('смена подгруппы в БД меняет только предназначенные ей занятия', async () => {
    const id = studentId('student-lina');
    const originalGroup=data.groups.find((g) => g.name===DEMO_STUDENTS[1].group)!;
    const subgroupGroup=data.groups.find((g) => g.name==='ИТБ(б)-О-23/1')!;
    try {
      // У ФЭТ нет явно размеченных I/II; для проверки используем реальную сетку ИТБ.
      await db.query('UPDATE students SET group_id=$2 WHERE user_id=$1',[id,subgroupGroup.id]);
      const before = await studentSchedule(db,id);
      await db.query("UPDATE students SET subgroup='II' WHERE user_id=$1",[id]);
      const after = await studentSchedule(db,id);
      expect(after.every((e) => e.subgroup===null || e.subgroup==='II')).toBe(true);
      expect(after.some((e) => e.subgroup==='II')).toBe(true);
      expect(before.some((e) => e.subgroup==='I')).toBe(true);
      expect(after.map((e) => e.id)).not.toEqual(before.map((e) => e.id));
    } finally { await db.query("UPDATE students SET subgroup='I',group_id=$2 WHERE user_id=$1",[id,originalGroup.id]); }
  });

  it('повтор миграции и сида не создаёт дубликатов', async () => {
    const before = await databaseSnapshot(db);
    await migrate(db);
    await seedDatabase(db,data);
    expect(await databaseSnapshot(db)).toBe(before);
  });

  it('одинаковый номер языковой группы не открывает занятия другого языка', async () => {
    const id=studentId('student-lina');
    try {
      await db.query('UPDATE students SET language_groups=$2 WHERE user_id=$1',[id,['арабский:2-2(2)']]);
      const lessons=await studentSchedule(db,id);
      expect(lessons.some((e) => e.language==='арабский' && e.language_group==='2-2(2)')).toBe(true);
      expect(lessons.some((e) => e.language==='немецкий' && e.language_group==='2-2(2)')).toBe(false);
    } finally {
      await db.query('UPDATE students SET language_groups=$2 WHERE user_id=$1',[id,[...DEMO_STUDENTS[1].language_groups]]);
    }
  });

  it('БД отклоняет неизвестную подгруппу', async () => {
    await expect(db.query("UPDATE students SET subgroup='III' WHERE user_id=$1",[studentId('student-artem')])).rejects.toThrow();
  });

  it.skipIf(!hasSourceWorkbook)('ни одна исходная фамилия не остаётся в БД, сидах и документах (требуется исходный XLSX)', async () => {
    expect(surnames.length).toBeGreaterThan(10);
    const outputs = [await databaseSnapshot(db), await readFile('data/seed/schedule.json','utf8'),await readFile('docs/SCHEDULE_FORMAT.md','utf8'),await readFile('docs/reports/schedule-import.json','utf8')];
    for (const output of outputs) expect(() => assertNoOriginalSurnames(output,surnames)).not.toThrow();
  });

  it('защита артефактов отклоняет фамилию и не путает её с частью другого слова', () => {
    expect(() => assertNoOriginalSurnames({text:'Контрольная Фамилиятестова'},['Фамилиятестова'])).toThrow(/приватности/);
    expect(() => assertNoOriginalSurnames({text:'Фамилиятестова'},['Фамилия'])).not.toThrow();
  });

  it('доля распознанных непустых ячеек не ниже 95%, исключения перечислены', () => {
    expect(data.report.nonempty_cells).toBeGreaterThan(100);
    expect(data.report.recognition_rate).toBeGreaterThanOrEqual(0.95);
    expect(data.report.recognized_cells+data.report.unrecognized.length).toBe(data.report.nonempty_cells);
    expect(data.report.ignored_dates.length).toBeGreaterThan(0);
  });

  it('переносит готовый обезличенный сид на новую неделю без исходного XLSX', () => {
    const shifted = rebaseSeed(data,new Date('2027-02-10T12:00:00+03:00'));
    const dates = shifted.entries.map((e) => Date.parse(e.starts_at));
    expect(Math.min(...dates)).toBeGreaterThanOrEqual(Date.parse('2027-02-08T00:00:00+03:00'));
    expect(Math.max(...dates)).toBeLessThan(Date.parse('2027-02-22T00:00:00+03:00'));
    expect(shifted.groups).toEqual(data.groups);
    expect(shifted.entries[0].id).toBe(data.entries[0].id);
    expect(shifted.report.week_start).toBe('2027-02-08');
    // Сид мог быть создан с другой первой чётностью: переносим содержимое недель, а не меняем метки.
    const reversed={...data,entries:data.entries.map((e) => {
      const delta=(e.parity==='odd'?7:-7)*86400000;
      return {...e,starts_at:new Date(Date.parse(e.starts_at)+delta).toISOString(),ends_at:new Date(Date.parse(e.ends_at)+delta).toISOString()};
    })};
    const restored=rebaseSeed(reversed,new Date('2026-11-12T12:00:00+03:00'));
    expect(restored.entries).toEqual(data.entries);
    expect(rebaseSeed({...data,entries:[]})).toEqual({...data,entries:[]});
  });
});
