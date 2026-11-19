import { loadEnvironment } from './lib/files.js';
import { migrate } from './lib/database.js';
import { connectPostgres } from './lib/postgres.js';

loadEnvironment();
let db: Awaited<ReturnType<typeof connectPostgres>> | undefined;
try {
  db = await connectPostgres();
  await migrate(db);
  console.log('Миграции PostgreSQL применены.');
} catch {
  console.error('Миграция не выполнена; проверьте DATABASE_URL и доступность PostgreSQL.');
  process.exitCode=1;
} finally { if (db) await db.close(); }
