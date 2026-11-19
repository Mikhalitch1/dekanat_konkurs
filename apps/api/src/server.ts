import { z } from 'zod';
import { loadEnvironment } from '../../../scripts/lib/files.js';
import { connectPostgres } from '../../../scripts/lib/postgres.js';
import { migrate, type Database } from '../../../scripts/lib/database.js';
import { refreshDemoChanges } from '../../../scripts/lib/seed-core.js';
import { createApp } from './app.js';

loadEnvironment();
let db: (Database & { close(): Promise<void> }) | undefined;
try {
  const port = z.coerce.number().int().min(1).max(65535).parse(process.env.PORT ?? 3000);
  const url = process.env.DATABASE_URL ?? '';
  if (url.startsWith('pglite:')) {
    if (process.env.NODE_ENV === 'production') throw new Error('PGlite только для локальной разработки');
    const { PGlite } = await import('@electric-sql/pglite');
    db = new PGlite(url.slice(7)) as unknown as Database & { close(): Promise<void> };
  } else db = await connectPostgres();
  await migrate(db);
  const app = await createApp(db, { origin: process.env.APP_ORIGIN ?? 'https://localhost:8443' });
  // Демонстрационные изменения расписания всегда остаются на ближайших днях.
  const refresh = setInterval(() => { void refreshDemoChanges(db!).catch(() => undefined); }, 6 * 3_600_000);
  const close = async () => { clearInterval(refresh); await app.close(); await db!.close(); };
  process.once('SIGTERM', () => { void close(); });
  process.once('SIGINT', () => { void close(); });
  await app.listen({ host: '0.0.0.0', port });
  console.log('API конкурсного концепта запущен.');
} catch (error) {
  if (process.env.NODE_ENV !== 'production') console.error(error);
  if (db) await db.close();
  console.error('API не запущен. Проверьте окружение и PostgreSQL.');
  process.exitCode = 1;
}
