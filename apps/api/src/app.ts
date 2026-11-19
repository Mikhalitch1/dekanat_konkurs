import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { verify, hash, argon2id } from 'argon2';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { type Database } from '../../../scripts/lib/database.js';
import { registerCabinet } from './cabinet.js';

const COOKIE = '__Host-dekanat';
const publicUserFields = 'id,login,role';
const loginBody = z.object({ login: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,64}$/u), password: z.string().min(1).max(128) }).strict();
const empty = z.object({}).strict();
interface Session {
  token_hash: string;
  csrf_token: string;
  user_id: string | null;
  login: string | null;
  role: 'student' | 'staff' | null;
}
export interface AppOptions {
  origin?: string;
  sessionTtlSeconds?: number;
  loginIpMax?: number;
  loginAccountMax?: number;
  loginWindowMs?: number;
  now?: () => Date;
}

function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function randomToken(): string { return randomBytes(32).toString('base64url'); }
function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function userDto(session: Session) { return { id: session.user_id!, login: session.login!, role: session.role! }; }

/** All user IDs below originate from a server-side session, never from URL/body. */
export async function createApp(db: Database, options: AppOptions = {}) {
  const origin = z.string().url().refine((value) => value.startsWith('https://') || /^http:\/\/localhost:\d+$/u.test(value)).parse(options.origin ?? 'https://localhost:8443');
  const ttl = z.number().int().min(1).max(86_400).parse(options.sessionTtlSeconds ?? 8 * 60 * 60);
  const clock = options.now ?? (() => new Date());
  const loginWindowMs = options.loginWindowMs ?? 15 * 60 * 1000;
  const accountMax = options.loginAccountMax ?? 5;
  const app = Fastify({ logger: false, bodyLimit: 16384, trustProxy: false, requestTimeout: 10_000 });
  await app.register(cookie);
  await app.register(helmet, { global: true, contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } });
  await app.register(rateLimit, { global: false, cache: 10_000, timeWindow: loginWindowMs, errorResponseBuilder: () => ({ statusCode: 429, error: 'Слишком много попыток. Попробуйте позже.' }) });
  const dummyHash = await hash(randomToken(), { type: argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
  const sessions = new WeakMap<FastifyRequest, Session | null>();
  const accountAttempts = new Map<string, { count: number; until: number }>();

  async function sessionFor(request: FastifyRequest): Promise<Session | null> {
    if (sessions.has(request)) return sessions.get(request) ?? null;
    const token = request.cookies[COOKIE];
    if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) { sessions.set(request, null); return null; }
    const session = (await db.query<Session>(`
      SELECT s.token_hash,s.csrf_token,u.id AS user_id,u.login,u.role
      FROM sessions s LEFT JOIN users u ON u.id=s.user_id AND u.active=true
      WHERE s.token_hash=$1 AND s.expires_at>$2`, [digest(token), clock().toISOString()])).rows[0] ?? null;
    sessions.set(request, session);
    return session;
  }

  async function makeSession(userId: string | null) {
    const token = randomToken(), csrfToken = randomToken();
    const lifetime = userId ? ttl : 10 * 60;
    await db.query('INSERT INTO sessions(token_hash,user_id,csrf_token,created_at,expires_at) VALUES ($1,$2,$3,$4,$5)', [digest(token), userId, csrfToken, clock().toISOString(), new Date(clock().getTime() + lifetime * 1000).toISOString()]);
    return { token, csrfToken, lifetime };
  }

  function accountLimited(login: string): boolean {
    const now = clock().getTime();
    for (const [key, item] of accountAttempts) if (item.until <= now) accountAttempts.delete(key);
    const key = digest(login);
    let item = accountAttempts.get(key);
    if (!item) {
      if (accountAttempts.size >= 10_000) accountAttempts.delete(accountAttempts.keys().next().value!);
      item = { count: 0, until: now + loginWindowMs };
      accountAttempts.set(key, item);
    }
    item.count++;
    return item.count > accountMax;
  }

  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');
    if (request.headers.origin && request.headers.origin !== origin) return reply.code(403).send({ error: 'Источник запроса не разрешён' });
    if (request.headers['sec-fetch-site'] === 'cross-site') return reply.code(403).send({ error: 'Источник запроса не разрешён' });
  });

  app.addHook('preHandler', async (request, reply) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
    const session = await sessionFor(request);
    if (request.headers.origin !== origin) return reply.code(403).send({ error: 'Источник запроса не разрешён' });
    if (!session) return reply.code(401).send({ error: 'Сессия отсутствует или истекла' });
    const token = request.headers['x-csrf-token'];
    if (typeof token !== 'string' || !sameToken(token, session.csrf_token)) return reply.code(403).send({ error: 'Обновите страницу и повторите действие' });
  });

  async function student(request: FastifyRequest) {
    const session = await sessionFor(request);
    if (!session?.user_id) throw Object.assign(new Error(), { statusCode: 401 });
    if (session.role !== 'student') throw Object.assign(new Error(), { statusCode: 403 });
    return session;
  }

  async function staff(request: FastifyRequest) {
    const session = await sessionFor(request);
    if (!session?.user_id) throw Object.assign(new Error(), { statusCode: 401 });
    if (session.role !== 'staff') throw Object.assign(new Error(), { statusCode: 403 });
    return session;
  }

  app.get('/api/health', async (_request, reply) => {
    try { await db.query('SELECT 1'); return { status: 'ok' }; }
    catch { return reply.code(503).send({ status: 'unavailable' }); }
  });

  app.get('/api/csrf', { config: { rateLimit: { max: 30, timeWindow: 60_000 } } }, async (request, reply) => {
    empty.parse(request.query);
    const existing = await sessionFor(request);
    if (existing) return { csrfToken: existing.csrf_token };
    await db.query('DELETE FROM sessions WHERE expires_at<=$1', [clock().toISOString()]);
    const count = (await db.query<{ count: number }>('SELECT count(*)::integer AS count FROM sessions WHERE user_id IS NULL')).rows[0]?.count ?? 0;
    if (count >= 10_000) return reply.code(503).send({ error: 'Попробуйте позже' });
    const session = await makeSession(null);
    reply.setCookie(COOKIE, session.token, { path: '/', secure: true, httpOnly: true, sameSite: 'lax', maxAge: session.lifetime });
    return { csrfToken: session.csrfToken };
  });

  app.post('/api/login', { config: { rateLimit: { max: options.loginIpMax ?? 10 } } }, async (request, reply) => {
    const { login, password } = loginBody.parse(request.body);
    if (accountLimited(login)) return reply.code(429).send({ error: 'Слишком много попыток. Попробуйте позже.' });
    const account = (await db.query<{ id: string; login: string; role: 'student' | 'staff'; password_hash: string | null; active: boolean }>(`SELECT ${publicUserFields},password_hash,active FROM users WHERE login=$1`, [login])).rows[0];
    const valid = await verify(account?.active && account.password_hash ? account.password_hash : dummyHash, password);
    if (!valid || !account?.active) return reply.code(401).send({ error: 'Неверный логин или пароль' });
    const old = await sessionFor(request);
    const next = await makeSession(account.id);
    if (old) await db.query('DELETE FROM sessions WHERE token_hash=$1', [old.token_hash]);
    reply.setCookie(COOKIE, next.token, { path: '/', secure: true, httpOnly: true, sameSite: 'lax', maxAge: next.lifetime });
    return { user: { id: account.id, login: account.login, role: account.role }, csrfToken: next.csrfToken };
  });

  app.post('/api/logout', async (request, reply) => {
    empty.parse(request.body ?? {});
    const session = await sessionFor(request);
    if (!session?.user_id) return reply.code(401).send({ error: 'Сессия отсутствует или истекла' });
    await db.query('DELETE FROM sessions WHERE token_hash=$1', [session.token_hash]);
    reply.clearCookie(COOKIE, { path: '/', secure: true, httpOnly: true, sameSite: 'lax' });
    return reply.code(204).send();
  });

  async function profileFor(userId: string) {
    return (await db.query('SELECT s.full_name,s.faculty,s.program,s.course,g.name AS group_name,s.subgroup,s.record_book,s.student_card,s.enrolled_year,s.email FROM students s JOIN groups g ON g.id=s.group_id WHERE s.user_id=$1', [userId])).rows[0] ?? null;
  }

  app.get('/api/me', async (request, reply) => {
    empty.parse(request.query);
    const session = await sessionFor(request);
    if (!session?.user_id) return reply.code(401).send({ error: 'Сессия отсутствует или истекла' });
    const display = (await db.query<{ display_name: string }>('SELECT display_name FROM users WHERE id=$1', [session.user_id])).rows[0]?.display_name ?? '';
    return { user: { ...userDto(session), name: display }, profile: session.role === 'student' ? await profileFor(session.user_id) : null };
  });
  await registerCabinet(app, db, { sessionFor, student, staff, clock });

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'Ресурс не найден' }));
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Некорректный запрос' });
    const status = typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    const messages: Record<number, string> = { 400: 'Некорректный запрос', 401: 'Сессия отсутствует или истекла', 403: 'Доступ запрещён', 404: 'Ресурс не найден', 413: 'Запрос слишком большой', 429: 'Слишком много попыток. Попробуйте позже.' };
    return reply.code(status >= 400 && status < 600 ? status : 500).send({ error: messages[status] ?? 'Сервис временно недоступен' });
  });
  return app;
}
