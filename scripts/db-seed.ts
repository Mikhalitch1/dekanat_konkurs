import { assertNoOriginalSurnames, loadEnvironment, prepareSeed } from './lib/files.js';
import { databaseSnapshot, seedDatabase, studentId, studentSchedule } from './lib/database.js';
import { DEMO_STUDENTS } from '../config/schedule.js';
import { connectPostgres } from './lib/postgres.js';
import { readDemoPasswords, seedCore } from './lib/seed-core.js';

loadEnvironment();
let db: Awaited<ReturnType<typeof connectPostgres>> | undefined;
try {
  const passwords = readDemoPasswords();
  db = await connectPostgres();
  const database = db;
  // Повторный старт контейнера не должен стирать заявки и баллы, которые жюри уже внесло: сид идёт только в пустую базу.
  // Принудительный сброс демо-данных: FORCE_SEED=1 npm run db:seed.
  const existing = Number((await db.query<{ n: string }>('SELECT count(*) AS n FROM users')).rows[0]?.n ?? 0);
  if (existing > 0 && process.env.FORCE_SEED !== '1') {
    console.log(JSON.stringify({seeded:false,reason:'база уже заполнена; FORCE_SEED=1 сбрасывает демо-данные'}));
    await db.close();
    process.exit(0);
  }
  const {data,surnames} = await prepareSeed();
  await seedDatabase(db,data);
  await seedCore(db,passwords);
  assertNoOriginalSurnames(await databaseSnapshot(db),surnames);
  const students = await Promise.all(DEMO_STUDENTS.map(async (s) => ({login:s.login,group:s.group,lessons:(await studentSchedule(database,studentId(s.login))).length})));
  console.log(JSON.stringify({seeded:true,students}));
} catch {
  console.error('Сид не выполнен. Проверьте импорт, миграцию и обезличивание; исходные данные в лог не выводятся.');
  process.exitCode=1;
} finally { if (db) await db.close(); }
