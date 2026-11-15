import { PGlite } from '@electric-sql/pglite';
import { loadEnvironment } from './lib/files.js';
import { migrate } from './lib/database.js';

loadEnvironment();
const db = new PGlite(process.env.PGLITE_DATA_DIR || './data/local-db');
try {
  await migrate(db);
  console.log('Миграция расписания применена.');
} catch {
  console.error('Миграция не выполнена; проверьте локальное хранилище.');
  process.exitCode=1;
} finally { await db.close(); }
