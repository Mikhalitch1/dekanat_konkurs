import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database, Queryable } from '../../../scripts/lib/database.js';
import { decryptPii, maskPassport, maskSnils, type PassportData } from '../../../scripts/lib/pii.js';
import { EXTRA_CAP, LEVEL_POINTS, award } from '../../../scripts/lib/seed-extra.js';
import { moscowDate } from '../../../scripts/lib/timeline.js';
import type { Helpers } from './cabinet.js';

const uuid = z.string().uuid();
const idParams = z.object({ id: uuid }).strict();
const ROLE_LABEL: Record<string, string> = { participant: 'Участник', organizer: 'Организатор', prize1: '1 место', prize2: '2 место', prize3: '3 место' };
export const NEWS_IMAGES = ['/img/news/n0.svg', '/img/news/n1.svg', '/img/news/n2.svg', '/img/news/n3.svg', '/img/news/n4.svg'] as const;
const EVENT_POSTERS = Array.from({ length: 6 }, (_, i) => `/img/events/e${i}.svg`);

async function notify(db: Queryable, userId: string, kind: string, title: string, body: string, link: string, now: Date) {
  await db.query('INSERT INTO notifications(id,user_id,kind,title,body,link,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), userId, kind, title, body, link, now.toISOString()]);
}

const EVENT_SQL = `SELECT e.id,e.title,e.organizer,e.place,e.starts_at,e.category,e.description,e.program,e.capacity,e.poster,e.level,e.points::float AS points,e.completed_at,
  (SELECT count(*)::integer FROM event_registrations x WHERE x.event_id=e.id AND x.role IS DISTINCT FROM 'absent') AS registered,
  r.student_id IS NOT NULL AS joined,r.role AS my_role,r.awarded::float AS my_awarded
  FROM events e LEFT JOIN event_registrations r ON r.event_id=e.id AND r.student_id=$1`;

export async function extraPoints(db: Queryable, userId: string): Promise<number> {
  const row = (await db.query<{ total: number }>('SELECT COALESCE(sum(points),0)::float AS total FROM portfolio_items WHERE student_id=$1', [userId])).rows[0];
  return Math.min(EXTRA_CAP, row?.total ?? 0);
}

export async function registerExtras(app: FastifyInstance, db: Database, h: Helpers) {
  const today = () => moscowDate(h.clock());

  // ——— Мероприятия ———
  app.get('/api/events', async (request) => {
    const session = await h.student(request);
    const rows = (await db.query(`${EVENT_SQL} ORDER BY (e.completed_at IS NOT NULL), CASE WHEN e.completed_at IS NULL THEN e.starts_at END ASC, e.starts_at DESC`, [session.user_id])).rows;
    return { events: rows, now: h.clock().toISOString(), cap: EXTRA_CAP };
  });
  app.get('/api/events/:id', async (request, reply) => {
    const session = await h.student(request), { id } = idParams.parse(request.params);
    const row = (await db.query(`${EVENT_SQL} WHERE e.id=$2`, [session.user_id, id])).rows[0];
    return row ? { event: row, now: h.clock().toISOString() } : reply.code(404).send({ error: 'Ресурс не найден' });
  });
  app.post('/api/events/:id/join', async (request, reply) => {
    const session = await h.student(request), { id } = idParams.parse(request.params);
    z.object({}).strict().parse(request.body ?? {});
    const event = (await db.query<{ capacity: number; registered: number }>('SELECT capacity,(SELECT count(*)::integer FROM event_registrations x WHERE x.event_id=e.id) AS registered FROM events e WHERE id=$1 AND starts_at>$2 AND completed_at IS NULL', [id, h.clock().toISOString()])).rows[0];
    if (!event) return reply.code(404).send({ error: 'Ресурс не найден' });
    const already = (await db.query('SELECT 1 FROM event_registrations WHERE event_id=$1 AND student_id=$2', [id, session.user_id])).rows.length;
    if (!already && event.registered >= event.capacity) return reply.code(409).send({ error: 'Мест больше нет' });
    await db.query('INSERT INTO event_registrations(event_id,student_id,created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [id, session.user_id, h.clock().toISOString()]);
    return { joined: true };
  });
  app.post('/api/events/:id/leave', async (request, reply) => {
    const session = await h.student(request), { id } = idParams.parse(request.params);
    z.object({}).strict().parse(request.body ?? {});
    const done = await db.query('DELETE FROM event_registrations WHERE event_id=$1 AND student_id=$2 AND role IS NULL AND EXISTS (SELECT 1 FROM events e WHERE e.id=$1 AND e.completed_at IS NULL) RETURNING 1', [id, session.user_id]);
    if (!done.rows.length) return reply.code(409).send({ error: 'Мероприятие уже завершено — запись отменить нельзя' });
    return { joined: false };
  });

  // ——— Портфолио ———
  app.get('/api/portfolio', async (request) => {
    const session = await h.student(request);
    const items = (await db.query("SELECT p.id,p.event_id,p.kind,p.place,p.title,p.description,p.points::float AS points,to_char(p.earned_on,'YYYY-MM-DD') AS earned_on,e.poster FROM portfolio_items p LEFT JOIN events e ON e.id=p.event_id WHERE p.student_id=$1 ORDER BY p.earned_on DESC,p.id", [session.user_id])).rows as { kind: string; points: number }[];
    const count = (kind: string) => items.filter((i) => i.kind === kind).length;
    const raw = items.reduce((a, i) => a + i.points, 0);
    return { items, summary: { participation: count('participation'), organization: count('organization'), prizes: count('prize'), raw_points: raw, points: Math.min(EXTRA_CAP, raw), cap: EXTRA_CAP } };
  });

  // ——— Библиотека ———
  app.get('/api/library', async (request) => {
    const session = await h.student(request);
    const { q, category } = z.object({ q: z.string().trim().max(80).default(''), category: z.string().trim().max(40).default('') }).strict().parse(request.query);
    const pattern = `%${q.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const books = (await db.query(`SELECT b.id,b.title,b.authors,b.year,b.category,b.kind,b.description,b.pages,b.shelf,b.cover,b.copies,
      b.copies-(SELECT count(*)::integer FROM book_reservations r WHERE r.book_id=b.id) AS available,
      EXISTS(SELECT 1 FROM book_reservations r WHERE r.book_id=b.id AND r.student_id=$1) AS reserved
      FROM books b WHERE ($2='' OR lower(b.title) LIKE $3 OR lower(b.authors) LIKE $3) AND ($4='' OR b.category=$4) ORDER BY b.title`, [session.user_id, q, pattern, category])).rows;
    const categories = (await db.query<{ category: string }>('SELECT DISTINCT category FROM books ORDER BY category')).rows.map((r) => r.category);
    return { books, categories };
  });
  app.post('/api/library/:id/reserve', async (request, reply) => {
    const session = await h.student(request), { id } = idParams.parse(request.params);
    z.object({}).strict().parse(request.body ?? {});
    const book = (await db.query<{ copies: number; taken: number; mine: number; total: number }>('SELECT b.copies,(SELECT count(*)::integer FROM book_reservations r WHERE r.book_id=b.id) AS taken,(SELECT count(*)::integer FROM book_reservations r WHERE r.book_id=b.id AND r.student_id=$2) AS mine,(SELECT count(*)::integer FROM book_reservations r WHERE r.student_id=$2) AS total FROM books b WHERE b.id=$1', [id, session.user_id])).rows[0];
    if (!book) return reply.code(404).send({ error: 'Ресурс не найден' });
    if (book.mine) return { reserved: true };
    if (book.taken >= book.copies) return reply.code(409).send({ error: 'Все экземпляры сейчас забронированы' });
    if (book.total >= 3) return reply.code(409).send({ error: 'Можно забронировать не больше трёх книг одновременно' });
    await db.query('INSERT INTO book_reservations(book_id,student_id,created_at) VALUES ($1,$2,$3)', [id, session.user_id, h.clock().toISOString()]);
    return reply.code(201).send({ reserved: true });
  });
  app.post('/api/library/:id/cancel', async (request) => {
    const session = await h.student(request), { id } = idParams.parse(request.params);
    z.object({}).strict().parse(request.body ?? {});
    await db.query('DELETE FROM book_reservations WHERE book_id=$1 AND student_id=$2', [id, session.user_id]);
    return { reserved: false };
  });

  // ——— Документы (шифруются в БД, по умолчанию скрыты) ———
  async function documentsFor(studentId: string, actorId: string, reveal: boolean) {
    const row = (await db.query<{ snils_enc: string; passport_enc: string }>('SELECT snils_enc,passport_enc FROM student_documents WHERE student_id=$1', [studentId])).rows[0];
    if (!row) return null;
    const snils = decryptPii<string>(row.snils_enc), passport = decryptPii<PassportData>(row.passport_enc);
    if (reveal) await db.query('INSERT INTO access_log(id,actor_id,student_id,action,at) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), actorId, studentId, 'documents:reveal', h.clock().toISOString()]);
    return reveal
      ? { revealed: true, snils, passport: { ...passport, display: `${passport.series} ${passport.number}` } }
      : { revealed: false, snils: maskSnils(snils), passport: { display: maskPassport(passport) } };
  }
  const revealQuery = z.object({ reveal: z.enum(['1']).optional() }).strict();
  app.get('/api/me/documents', async (request, reply) => {
    const session = await h.student(request);
    const { reveal } = revealQuery.parse(request.query);
    return (await documentsFor(session.user_id!, session.user_id!, reveal === '1')) ?? reply.code(404).send({ error: 'Ресурс не найден' });
  });
  app.get('/api/me/contacts', async (request) => {
    const session = await h.student(request);
    return (await db.query("SELECT personal_email,phone,to_char(birth_date,'YYYY-MM-DD') AS birth_date,reg_address,live_address FROM students WHERE user_id=$1", [session.user_id])).rows[0] ?? {};
  });
  app.get('/api/staff/students/:id/documents', async (request, reply) => {
    const session = await h.staff(request), { id } = idParams.parse(request.params);
    const { reveal } = revealQuery.parse(request.query);
    return (await documentsFor(id, session.user_id!, reveal === '1')) ?? reply.code(404).send({ error: 'Ресурс не найден' });
  });

  // ——— Мероприятия: кабинет сотрудника ———
  app.get('/api/staff/events', async (request) => {
    await h.staff(request);
    return { events: (await db.query('SELECT e.id,e.title,e.starts_at,e.place,e.category,e.level,e.points::float AS points,e.poster,e.completed_at,e.capacity,(SELECT count(*)::integer FROM event_registrations x WHERE x.event_id=e.id) AS registered FROM events e ORDER BY (e.completed_at IS NOT NULL), e.starts_at DESC')).rows, levels: LEVEL_POINTS, posters: EVENT_POSTERS };
  });
  app.get('/api/staff/announcements', async (request) => {
    await h.staff(request);
    return { announcements: (await db.query('SELECT a.id,a.title,a.body,a.image,a.created_at,u.display_name AS author FROM announcements a JOIN users u ON u.id=a.created_by ORDER BY a.created_at DESC LIMIT 100')).rows };
  });
  const eventBody = z.object({
    title: z.string().trim().min(3).max(120), organizer: z.string().trim().min(2).max(120), place: z.string().trim().min(2).max(120),
    starts_at: z.string().datetime({ offset: true }), category: z.string().trim().min(2).max(30), description: z.string().trim().min(3).max(1000), program: z.string().trim().max(1000).default(''),
    capacity: z.number().int().min(1).max(1000), level: z.enum(['club', 'faculty', 'university', 'interuniversity']), poster: z.enum(EVENT_POSTERS as [string, ...string[]]).optional(),
  }).strict();
  app.post('/api/staff/events', async (request, reply) => {
    await h.staff(request);
    const b = eventBody.parse(request.body);
    const id = randomUUID();
    await db.query('INSERT INTO events(id,title,organizer,place,starts_at,category,description,capacity,poster,level,points,program) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [id, b.title, b.organizer, b.place, b.starts_at, b.category, b.description, b.capacity, b.poster ?? EVENT_POSTERS[b.title.length % EVENT_POSTERS.length], b.level, LEVEL_POINTS[b.level], b.program]);
    return reply.code(201).send({ id });
  });
  app.get('/api/staff/events/:id', async (request, reply) => {
    await h.staff(request);
    const { id } = idParams.parse(request.params);
    const event = (await db.query('SELECT id,title,organizer,category,description,program,poster,capacity,starts_at,place,level,points::float AS points,completed_at FROM events WHERE id=$1', [id])).rows[0];
    if (!event) return reply.code(404).send({ error: 'Ресурс не найден' });
    const people = (await db.query('SELECT r.student_id,s.full_name,g.name AS group_name,r.role,r.awarded::float AS awarded FROM event_registrations r JOIN students s ON s.user_id=r.student_id JOIN groups g ON g.id=s.group_id WHERE r.event_id=$1 ORDER BY s.full_name', [id])).rows;
    return { event, people };
  });
  const completeBody = z.object({ results: z.array(z.object({ student_id: uuid, role: z.enum(['absent', 'participant', 'organizer', 'prize1', 'prize2', 'prize3']) }).strict()).max(500) }).strict();
  app.post('/api/staff/events/:id/complete', async (request, reply) => {
    await h.staff(request);
    const { id } = idParams.parse(request.params);
    const { results } = completeBody.parse(request.body);
    const event = (await db.query<{ title: string; organizer: string; place: string; level: string; points: number; completed_at: string | null; starts_at: string }>('SELECT title,organizer,place,level,points::float AS points,completed_at,starts_at FROM events WHERE id=$1', [id])).rows[0];
    if (!event) return reply.code(404).send({ error: 'Ресурс не найден' });
    if (event.completed_at) return reply.code(409).send({ error: 'Мероприятие уже завершено, баллы начислены' });
    const known = new Set((await db.query<{ user_id: string }>('SELECT user_id FROM students')).rows.map((r) => r.user_id));
    if (results.some((r) => !known.has(r.student_id))) return reply.code(404).send({ error: 'Ресурс не найден' });
    const now = h.clock();
    let awarded = 0;
    await db.transaction(async (tx) => {
      const chosen = new Map(results.map((r) => [r.student_id, r.role]));
      const registered = (await tx.query<{ student_id: string }>('SELECT student_id FROM event_registrations WHERE event_id=$1', [id])).rows;
      for (const r of registered) if (!chosen.has(r.student_id)) chosen.set(r.student_id, 'absent');
      for (const [student, role] of chosen) {
        const pts = role === 'absent' ? 0 : award(event.points, role);
        await tx.query('INSERT INTO event_registrations(event_id,student_id,created_at,role,awarded) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(event_id,student_id) DO UPDATE SET role=EXCLUDED.role,awarded=EXCLUDED.awarded', [id, student, now.toISOString(), role, pts]);
        if (role === 'absent') continue;
        const place = role.startsWith('prize') ? Number(role.slice(5)) : null;
        const kind = role === 'organizer' ? 'organization' : place ? 'prize' : 'participation';
        await tx.query('INSERT INTO portfolio_items(id,student_id,event_id,kind,place,title,description,points,earned_on,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(student_id,event_id) DO UPDATE SET kind=EXCLUDED.kind,place=EXCLUDED.place,points=EXCLUDED.points,description=EXCLUDED.description', [randomUUID(), student, id, kind, place, event.title, `${ROLE_LABEL[role]}. ${event.organizer}, ${event.place}.`, pts, today(), now.toISOString()]);
        await notify(tx, student, 'portfolio', `Достижение в портфолио: ${event.title}`, `${ROLE_LABEL[role]}. Начислено баллов за внеучебную деятельность: ${pts}.`, 'portfolio', now);
        awarded += 1;
      }
      await tx.query('UPDATE events SET completed_at=$2 WHERE id=$1', [id, now.toISOString()]);
    });
    return { ok: true, awarded };
  });
}
