import { PGlite } from '@electric-sql/pglite';
import { assertNoOriginalSurnames, loadEnvironment, prepareSeed } from './lib/files.js';
import { databaseSnapshot, seedDatabase, studentId, studentSchedule } from './lib/database.js';
import { DEMO_STUDENTS } from '../config/schedule.js';

loadEnvironment();
const db = new PGlite(process.env.PGLITE_DATA_DIR || './data/local-db');
try {
  const {data,surnames} = await prepareSeed();
  await seedDatabase(db,data);
  assertNoOriginalSurnames(await databaseSnapshot(db),surnames);
  const students = await Promise.all(DEMO_STUDENTS.map(async (s) => ({login:s.login,group:s.group,lessons:(await studentSchedule(db,studentId(s.login))).length})));
  console.log(JSON.stringify({seeded:true,students}));
} catch {
  console.error('Сид не выполнен. Проверьте импорт, миграцию и обезличивание; исходные данные в лог не выводятся.');
  process.exitCode=1;
} finally { await db.close(); }
