import { PGlite } from '@electric-sql/pglite';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verify } from 'argon2';
import { createApp, type AppOptions } from '../apps/api/src/app.js';
import { seedDatabase, studentId, type Database } from '../scripts/lib/database.js';
import { connectPostgres } from '../scripts/lib/postgres.js';
import { rebaseSeed } from '../scripts/lib/files.js';
import { readDemoPasswords, seedCore, STAFF_LOGIN, type DemoPasswords } from '../scripts/lib/seed-core.js';
import type { ImportResult } from '../scripts/import-schedule/index.js';

const ORIGIN = 'https://localhost:8443';
const instant = new Date('2026-11-15T12:00:00+03:00');
type App = Awaited<ReturnType<typeof createApp>>;
const secret = () => randomBytes(24).toString('base64url');

function cookiePair(value: string | string[] | undefined): string {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) throw new Error('Expected session cookie');
  return first.split(';')[0];
}

async function csrf(app: App, remoteAddress?: string) {
  const response = await app.inject({ method: 'GET', url: '/api/csrf', remoteAddress });
  expect(response.statusCode).toBe(200);
  return { cookie: cookiePair(response.headers['set-cookie']), token: response.json<{ csrfToken: string }>().csrfToken, response };
}

async function login(app: App, loginName: string, password: string) {
  const anonymous = await csrf(app);
  const response = await app.inject({ method: 'POST', url: '/api/login', headers: { cookie: anonymous.cookie, origin: ORIGIN, 'x-csrf-token': anonymous.token }, payload: { login: loginName, password } });
  expect(response.statusCode).toBe(200);
  const result = response.json<{ user: { id: string; login: string; role: string }; csrfToken: string }>();
  return { cookie: cookiePair(response.headers['set-cookie']), token: result.csrfToken, user: result.user, response, anonymous };
}

describe('API authentication and ownership', () => {
  let db: Database & { close(): Promise<void> };
  let app: App;
  const passwords: DemoPasswords = { studentArtem: secret(), studentLina: secret(), staff: secret() };
  let studentA: Awaited<ReturnType<typeof login>>;
  let studentB: Awaited<ReturnType<typeof login>>;
  beforeAll(async () => {
    db = process.env.TEST_DATABASE_URL ? await connectPostgres(process.env.TEST_DATABASE_URL) : new PGlite();
    const data = rebaseSeed(JSON.parse(await readFile('data/seed/schedule.json', 'utf8')) as ImportResult, instant);
    await seedDatabase(db, data);
    await seedCore(db, passwords, instant);
    app = await createApp(db, { origin: ORIGIN, now: () => instant, loginIpMax: 100, loginAccountMax: 100 });
    studentA = await login(app, 'student-artem', passwords.studentArtem);
    studentB = await login(app, 'student-lina', passwords.studentLina);
  });
  afterAll(async () => { if (app) await app.close(); if (db) await db.close(); });

  it('requires configured passwords and stores only argon2id for active accounts', async () => {
    expect(() => readDemoPasswords({})).toThrow('DEMO_PASSWORD');
    const rows = (await db.query<{ login: string; password_hash: string; role: string; active: boolean }>('SELECT login,password_hash,role,active FROM users ORDER BY login')).rows;
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.active && row.password_hash.startsWith('$argon2id$'))).toBe(true);
    expect(rows.filter((row) => row.role === 'student')).toHaveLength(2);
    expect(rows.filter((row) => row.role === 'staff')).toHaveLength(1);
    const actual = rows.find((row) => row.login === 'student-artem')!;
    expect(await verify(actual.password_hash, passwords.studentArtem)).toBe(true);
    expect(actual.password_hash).not.toBe(passwords.studentArtem);
  });

  it('rotates the session on login, stores a token hash, and uses secure cookie flags', async () => {
    expect(studentA.cookie).not.toBe(studentA.anonymous.cookie);
    const flags = String(studentA.response.headers['set-cookie']);
    expect(flags).toContain('HttpOnly');
    expect(flags).toContain('Secure');
    expect(flags).toContain('SameSite=Lax');
    expect(flags).toContain('Path=/');
    expect(flags).toContain('Max-Age=');
    const stored = (await db.query<{ token_hash: string }>('SELECT token_hash FROM sessions WHERE user_id=$1', [studentA.user.id])).rows;
    expect(stored).toHaveLength(1);
    expect(stored[0].token_hash).toHaveLength(64);
    expect(stored[0].token_hash).not.toBe(studentA.cookie.split('=')[1]);
    expect((await app.inject({ url: '/api/me', headers: { cookie: studentA.anonymous.cookie } })).statusCode).toBe(401);
  });

  it('returns 401 without a session for profile, schedule, grades, requests and staff routes', async () => {
    for (const url of ['/api/me', '/api/schedule', '/api/grades', '/api/requests', '/api/staff/requests']) {
      expect((await app.inject({ url })).statusCode).toBe(401);
    }
  });

  it('returns the two different student profiles from sessions only', async () => {
    const a = await app.inject({ url: '/api/me', headers: { cookie: studentA.cookie } });
    const b = await app.inject({ url: '/api/me', headers: { cookie: studentB.cookie } });
    expect(a.json().profile.full_name).toBe('Артём Тестов');
    expect(b.json().profile.full_name).toBe('Лина Образцова');
    expect(a.json().profile.group_name).toBe('ТИГ(б)-О-23/1');
    expect(b.json().profile.group_name).toBe('ФЭТ(б)-О-23/1');
    expect(a.json().profile.course).toBe(2);
    expect((await app.inject({ url: `/api/me?user_id=${studentB.user.id}`, headers: { cookie: studentA.cookie } })).statusCode).toBe(400);
    const spoofed = await app.inject({ url: '/api/me', headers: { cookie: studentA.cookie, 'x-user-id': studentB.user.id } });
    expect(spoofed.json().profile.full_name).toBe('Артём Тестов');
    expect((await app.inject({ url: `/api/students/${studentB.user.id}`, headers: { cookie: studentA.cookie } })).statusCode).toBe(404);
  });

  it('returns 404 for a foreign request by direct UUID and returns the owned one', async () => {
    const own = (await db.query<{ id: string }>('SELECT id FROM requests WHERE student_id=$1 ORDER BY id LIMIT 1', [studentA.user.id])).rows[0].id;
    const foreign = (await db.query<{ id: string }>('SELECT id FROM requests WHERE student_id=$1 ORDER BY id LIMIT 1', [studentB.user.id])).rows[0].id;
    expect((await app.inject({ url: `/api/requests/${own}`, headers: { cookie: studentA.cookie } })).statusCode).toBe(200);
    const denied = await app.inject({ url: `/api/requests/${foreign}`, headers: { cookie: studentA.cookie } });
    expect(denied.statusCode).toBe(404);
    const unknown = await app.inject({ url: '/api/requests/00000000-0000-4000-a000-000000000000', headers: { cookie: studentA.cookie } });
    expect(denied.body).toBe(unknown.body);
  });

  it('filters grades by the owner for lists and direct UUIDs', async () => {
    const foreign = (await db.query<{ id: string }>('SELECT id FROM grades WHERE student_id=$1 ORDER BY id LIMIT 1', [studentB.user.id])).rows[0].id;
    expect((await app.inject({ url: `/api/grades/${foreign}`, headers: { cookie: studentA.cookie } })).statusCode).toBe(404);
    const response = await app.inject({ url: '/api/grades', headers: { cookie: studentA.cookie } });
    expect(response.statusCode).toBe(200);
    const own = (await db.query<{ n: string }>('SELECT count(*) AS n FROM grades WHERE student_id=$1', [studentA.user.id])).rows[0].n;
    const works = response.json<{ progress: { works: unknown[] }[] }>().progress.flatMap((p) => p.works);
    expect(works).toHaveLength(Number(own));
    expect(response.body).not.toContain(foreign);
  });

  it('enforces student group in schedule without source fields', async () => {
    const seen: Set<string>[] = [];
    for (const session of [studentA, studentB]) {
      const response = await app.inject({ url: '/api/schedule', headers: { cookie: session.cookie } });
      expect(response.statusCode).toBe(200);
      const lessons = response.json<{ lessons: { id: string }[] }>().lessons;
      expect(lessons.length).toBeGreaterThan(0);
      const ids = [...new Set(lessons.map((l) => l.id.split(':')[0]))];
      const profile = (await db.query<{ group_id: string }>('SELECT group_id FROM students WHERE user_id=$1', [session.user.id])).rows[0];
      const foreign = (await db.query<{ n: string }>('SELECT count(*) AS n FROM schedule_entries WHERE id=ANY($1::uuid[]) AND group_id<>$2', [ids, profile.group_id])).rows[0].n;
      expect(Number(foreign)).toBe(0);
      expect(response.body).not.toContain('source_');
      expect(response.body).not.toContain('password_hash');
      seen.push(new Set(ids));
    }
    expect([...seen[0]].some((id) => seen[1].has(id))).toBe(false);
  });

  it('checks the staff role server-side and gives staff only request processing data', async () => {
    const denied = await app.inject({ url: '/api/staff/requests', headers: { cookie: studentA.cookie, 'x-role': 'staff' } });
    expect(denied.statusCode).toBe(403);
    const staff = await login(app, STAFF_LOGIN, passwords.staff);
    const response = await app.inject({ url: '/api/staff/requests', headers: { cookie: staff.cookie } });
    expect(response.statusCode).toBe(200);
    const total = (await db.query<{ n: string }>('SELECT count(*) AS n FROM requests')).rows[0].n;
    expect(response.json().requests).toHaveLength(Number(total));
    expect(response.body).not.toContain('password_hash');
    expect(response.body).not.toContain('grades');
    expect(response.body).not.toContain('language_groups');
    expect((await app.inject({ url: '/api/schedule', headers: { cookie: staff.cookie } })).statusCode).toBe(403);
  });

  it('requires CSRF for login and logout and rejects a foreign Origin', async () => {
    const anonymous = await csrf(app);
    const missing = await app.inject({ method: 'POST', url: '/api/login', headers: { cookie: anonymous.cookie, origin: ORIGIN }, payload: { login: 'student-artem', password: passwords.studentArtem } });
    expect(missing.statusCode).toBe(403);
    const foreign = await app.inject({ method: 'POST', url: '/api/login', headers: { cookie: anonymous.cookie, origin: 'https://example.invalid', 'x-csrf-token': anonymous.token }, payload: { login: 'student-artem', password: passwords.studentArtem } });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
    const logout = await app.inject({ method: 'POST', url: '/api/logout', headers: { cookie: studentA.cookie, origin: ORIGIN }, payload: {} });
    expect(logout.statusCode).toBe(403);
    expect((await app.inject({ url: '/api/me', headers: { cookie: studentA.cookie } })).statusCode).toBe(200);
  });

  it('returns the same error for unknown login and wrong password without leaking credentials', async () => {
    const wrong = secret();
    const attempt = async (name: string) => {
      const session = await csrf(app);
      return app.inject({ method: 'POST', url: '/api/login', headers: { cookie: session.cookie, origin: ORIGIN, 'x-csrf-token': session.token }, payload: { login: name, password: wrong } });
    };
    const unknown = await attempt(`unknown-${randomBytes(4).toString('hex')}`);
    const invalid = await attempt('student-artem');
    expect(unknown.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(401);
    expect(unknown.body).toBe(invalid.body);
    expect(unknown.body).not.toContain(wrong);
    expect(invalid.body).not.toContain('password_hash');
  });

  it('revokes the server session on logout, so the old cookie cannot be replayed', async () => {
    const session = await login(app, 'student-artem', passwords.studentArtem);
    const logout = await app.inject({ method: 'POST', url: '/api/logout', headers: { cookie: session.cookie, origin: ORIGIN, 'x-csrf-token': session.token }, payload: {} });
    expect(logout.statusCode).toBe(204);
    expect(String(logout.headers['set-cookie'])).toContain('__Host-dekanat=;');
    expect((await app.inject({ url: '/api/me', headers: { cookie: session.cookie } })).statusCode).toBe(401);
  });

  it('expires authenticated sessions server-side', async () => {
    let current = instant;
    const isolated = await createApp(db, { origin: ORIGIN, sessionTtlSeconds: 1, now: () => current });
    try {
      const session = await login(isolated, 'student-lina', passwords.studentLina);
      current = new Date(instant.getTime() + 2000);
      expect((await isolated.inject({ url: '/api/me', headers: { cookie: session.cookie } })).statusCode).toBe(401);
    } finally { await isolated.close(); }
  });

  it('limits login attempts independently by IP and account', async () => {
    async function run(options: AppOptions, varyIp: boolean) {
      const isolated = await createApp(db, { origin: ORIGIN, now: () => instant, ...options });
      const statuses: number[] = [];
      try {
        for (let i = 0; i < 3; i++) {
          const remoteAddress = varyIp ? `127.0.0.${i + 2}` : '127.0.0.10';
          const anonymous = await csrf(isolated, remoteAddress);
          statuses.push((await isolated.inject({ method: 'POST', url: '/api/login', remoteAddress, headers: { cookie: anonymous.cookie, origin: ORIGIN, 'x-csrf-token': anonymous.token }, payload: { login: 'student-artem', password: secret() } })).statusCode);
        }
        expect(statuses).toEqual([401, 401, 429]);
      } finally { await isolated.close(); }
    }
    await run({ loginIpMax: 2, loginAccountMax: 20 }, false);
    await run({ loginIpMax: 20, loginAccountMax: 2 }, true);
  });

  it('sends security headers, does not cache personal responses, and validates UUIDs and body fields', async () => {
    const response = await app.inject({ url: '/api/me', headers: { cookie: studentA.cookie } });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.body).not.toContain('password_hash');
    expect(response.body).not.toContain('$argon2id$');
    expect((await app.inject({ url: '/api/requests/not-a-uuid', headers: { cookie: studentA.cookie } })).statusCode).toBe(400);
    const anonymous = await csrf(app);
    expect((await app.inject({ method: 'POST', url: '/api/login', headers: { cookie: anonymous.cookie, origin: ORIGIN, 'x-csrf-token': anonymous.token }, payload: { login: 'student-artem', password: passwords.studentArtem, role: 'staff' } })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/health' })).json()).toEqual({ status: 'ok' });
    expect((await db.query('SELECT user_id FROM students WHERE user_id=$1', [studentId('student-artem')])).rows).toHaveLength(1);
  });
});
