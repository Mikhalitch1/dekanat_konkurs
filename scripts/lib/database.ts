import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DEMO_STUDENTS } from '../../config/schedule.js';
import type { ImportResult } from '../import-schedule/index.js';

export function studentId(login: string): string {
  const hex = createHash('sha256').update(`demo-student:${login}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function migrate(db: PGlite): Promise<void> {
  await db.exec(await readFile('db/migrations/000_schedule.sql', 'utf8'));
}

export async function seedDatabase(db: PGlite, data: ImportResult): Promise<void> {
  await migrate(db);
  await db.transaction(async (tx) => {
    for (const g of data.groups) {
      await tx.query('INSERT INTO groups (id,name,course,program,faculty) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,course=EXCLUDED.course,program=EXCLUDED.program,faculty=EXCLUDED.faculty', [g.id, g.name, g.course, g.program, g.faculty]);
    }
    for (const t of data.teachers) {
      await tx.query('INSERT INTO teachers (id,full_name) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET full_name=EXCLUDED.full_name', [t.id, t.full_name]);
    }
    for (const d of data.disciplines) {
      await tx.query('INSERT INTO disciplines (id,name,teacher_id,kind) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,teacher_id=EXCLUDED.teacher_id,kind=EXCLUDED.kind', [d.id, d.name, d.teacher_id, d.kind]);
    }
    // Перезапуск заменяет только импортированные расписания, а не накапливает недели.
    for (const g of data.groups) await tx.query('DELETE FROM schedule_entries WHERE group_id=$1', [g.id]);
    for (const e of data.entries) {
      await tx.query('INSERT INTO schedule_entries (id,group_id,discipline_id,room,starts_at,ends_at,type,subgroup,language,language_group,elective_option,parity,source_sheet,source_cell,source_merge,source_text) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)', [e.id,e.group_id,e.discipline_id,e.room,e.starts_at,e.ends_at,e.type,e.subgroup,e.language,e.language_group,e.elective_option,e.parity,e.source_sheet,e.source_cell,e.source_merge,e.source_text]);
    }
    for (const student of DEMO_STUDENTS) {
      const g = data.groups.find((g) => g.name === student.group);
      if (!g) throw new Error('В сиде отсутствует обязательная демонстрационная группа');
      await tx.query('INSERT INTO students (user_id,login,full_name,faculty,program,course,group_id,subgroup,language_groups,elective_option) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (user_id) DO UPDATE SET full_name=EXCLUDED.full_name,faculty=EXCLUDED.faculty,program=EXCLUDED.program,course=EXCLUDED.course,group_id=EXCLUDED.group_id,subgroup=EXCLUDED.subgroup,language_groups=EXCLUDED.language_groups,elective_option=EXCLUDED.elective_option', [studentId(student.login),student.login,student.full_name,g.faculty,g.program,g.course,g.id,student.subgroup,[...student.language_groups],student.elective_option]);
    }
  });
}

/** Внутренняя выборка: этап 1 будет передавать userId только из сессии. */
export async function studentSchedule(db: PGlite, userId: string) {
  type StudentEntry = Omit<ImportResult['entries'][number], 'source_text'|'source_sheet'|'source_cell'|'source_merge'>;
  return (await db.query<StudentEntry>(`
    SELECT e.id,e.group_id,e.discipline_id,e.room,e.starts_at,e.ends_at,e.type,
      e.subgroup,e.language,e.language_group,e.elective_option,e.parity
    FROM students s JOIN schedule_entries e ON e.group_id=s.group_id
    WHERE s.user_id=$1 AND (e.subgroup IS NULL OR e.subgroup=s.subgroup)
      AND (e.language_group IS NULL OR (e.language || ':' || e.language_group)=ANY(s.language_groups))
      AND (e.elective_option IS NULL OR e.elective_option=s.elective_option)
    ORDER BY e.starts_at,e.id`, [userId])).rows;
}

export async function databaseSnapshot(db: PGlite): Promise<string> {
  const rows = await Promise.all(['groups','students','teachers','disciplines','schedule_entries'].map(async (table) => {
    // table is a hard-coded allowlist, never user input.
    return (await db.query(`SELECT * FROM ${table} ORDER BY 1`)).rows;
  }));
  return JSON.stringify(rows);
}
