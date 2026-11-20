import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { z } from 'zod';
import { studentSchedule, type Database, type Queryable } from '../../../scripts/lib/database.js';
import { certificateCode } from '../../../scripts/lib/seed-core.js';
import { moscowDate, moscowMonday, occurrences } from '../../../scripts/lib/timeline.js';
import { askModel, localAnswer, withinQuota, type AssistantContext } from './assistant.js';
import { NEWS_IMAGES, extraPoints, registerExtras } from './extras.js';

interface Session { user_id: string | null; role: 'student' | 'staff' | null }
export interface Helpers {
  sessionFor(request: FastifyRequest): Promise<Session | null>;
  student(request: FastifyRequest): Promise<Session>;
  staff(request: FastifyRequest): Promise<Session>;
  clock(): Date;
}

const DAY = 86_400_000;
const uuid = z.string().uuid();
const idParams = z.object({ id: uuid }).strict();
const STATUS = ['submitted', 'accepted', 'in_progress', 'ready', 'issued', 'rejected'] as const;
export const STATUS_LABEL: Record<string, string> = { submitted: 'подана', accepted: 'принята', in_progress: 'в работе', ready: 'готова', issued: 'выдана', rejected: 'отклонена' };
const KIND_LABEL: Record<string, string> = { lecture: 'Лекция', practice: 'Семинар', lecture_practice: 'Лекция и семинар', class: 'Занятие' };
const FORM_LABEL: Record<string, string> = { exam: 'Экзамен', credit: 'Зачёт', diff_credit: 'Зачёт с оценкой' };

const timeFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', weekday: 'long', day: 'numeric', month: 'long' });

interface Lesson {
  id: string; date: string; starts_at: string; ends_at: string; discipline: string; kind: string; room: string | null; teacher: string | null;
  change: { kind: string; note: string; new_room: string | null; new_teacher: string | null } | null;
}

async function lessonsFor(db: Queryable, userId: string, from: Date, to: Date): Promise<Lesson[]> {
  const base = await studentSchedule(db, userId);
  const list = occurrences(base, from, to);
  if (!list.length) return [];
  const disciplines = (await db.query<{ id: string; name: string; teacher: string | null }>('SELECT d.id,d.name,t.full_name AS teacher FROM disciplines d LEFT JOIN teachers t ON t.id=d.teacher_id WHERE d.id=ANY($1::uuid[])', [[...new Set(base.map((e) => e.discipline_id))]])).rows;
  const changes = (await db.query<{ schedule_entry_id: string; on_date: string; kind: string; note: string; new_room: string | null; new_teacher: string | null }>("SELECT schedule_entry_id,to_char(on_date,'YYYY-MM-DD') AS on_date,kind,note,new_room,new_teacher FROM lesson_changes WHERE schedule_entry_id=ANY($1::uuid[]) AND on_date BETWEEN $2::date AND $3::date", [base.map((e) => e.id), moscowDate(from), moscowDate(to)])).rows;
  const byId = new Map(disciplines.map((d) => [d.id, d]));
  return list.map((o) => {
    const d = byId.get(o.entry.discipline_id);
    const change = changes.find((c) => c.schedule_entry_id === o.entry.id && c.on_date === o.date);
    return {
      id: `${o.entry.id}:${o.date}`, date: o.date, starts_at: o.starts_at, ends_at: o.ends_at, discipline: d?.name ?? 'Занятие', kind: KIND_LABEL[o.entry.type] ?? 'Занятие',
      room: o.entry.room, teacher: d?.teacher ?? null,
      change: change ? { kind: change.kind, note: change.note, new_room: change.new_room, new_teacher: change.new_teacher } : null,
    };
  });
}

interface ProgressRow { id: string; discipline: string; form: string; points: string | number; attended: number; total_classes: number }
function prognosis(row: ProgressRow) {
  const points = Number(row.points);
  const attendance = Math.round((row.attended / Math.max(1, row.total_classes)) * 100);
  const semesterClasses = row.total_classes + 6;
  const canMiss = Math.max(0, Math.floor(semesterClasses * 0.3) - (row.total_classes - row.attended));
  const projected = Math.round(points + 40 * (points / 60));
  const grade = projected >= 85 ? 'отлично' : projected >= 70 ? 'хорошо' : projected >= 50 ? 'удовлетворительно' : 'неудовлетворительно';
  let status: 'ok' | 'attention' | 'risk' = 'ok';
  const steps: string[] = [];
  if (points < 30 || attendance < 70) status = 'risk';
  else if (points < 40 || attendance < 80) status = 'attention';
  if (points < 30) steps.push(`до допуска не хватает ${30 - points} ${plural(30 - points, 'балла', 'баллов', 'баллов')} — перепиши контрольную по заявлению на пересдачу или приходи на консультацию`);
  if (attendance < 70) steps.push(`посещаемость ${attendance}% — нужно не меньше 70%, пропуски по болезни закрой справкой`);
  if (status === 'attention' && points >= 30) steps.push(`допуск есть, но до оценки «хорошо» нужно ещё около ${Math.max(1, Math.ceil(70 * 0.6) - points)} баллов за семестр`);
  if (status === 'ok') steps.push(`допуск есть, можно пропустить ещё ${canMiss} ${plural(canMiss, 'занятие', 'занятия', 'занятий')}`);
  return { id: row.id, discipline: row.discipline, form: FORM_LABEL[row.form] ?? row.form, points, max: 60, attendance, attended: row.attended, total: row.total_classes, can_miss: canMiss, projected, projected_grade: grade, status, advice: steps.join('; ') };
}
function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
}

async function progressFor(db: Queryable, userId: string) {
  const rows = (await db.query<ProgressRow>('SELECT p.id,d.name AS discipline,p.form,p.points,p.attended,p.total_classes FROM discipline_progress p JOIN disciplines d ON d.id=p.discipline_id WHERE p.student_id=$1 ORDER BY d.name', [userId])).rows;
  return rows.map(prognosis);
}

async function keyDatesFor(db: Queryable, userId: string, today: string) {
  return (await db.query<{ id: string; title: string; kind: string; starts_on: string; ends_on: string | null }>("SELECT k.id,k.title,k.kind,to_char(k.starts_on,'YYYY-MM-DD') AS starts_on,to_char(k.ends_on,'YYYY-MM-DD') AS ends_on FROM key_dates k JOIN students s ON (k.group_id=s.group_id OR k.group_id IS NULL) WHERE s.user_id=$1 AND COALESCE(k.ends_on,k.starts_on)>=$2::date ORDER BY k.starts_on", [userId, today])).rows;
}

async function requestsFor(db: Queryable, userId: string) {
  return (await db.query<{ id: string; number: number | null; title: string; code: string | null; status: string; purpose: string; comment: string; staff_comment: string; created_at: string; updated_at: string; sla_days: number; certificate: string | null }>(
    'SELECT r.id,r.number,t.title,t.code,r.status,r.purpose,r.comment,r.staff_comment,r.created_at,r.updated_at,t.sla_days,c.code AS certificate FROM requests r JOIN request_types t ON t.id=r.type_id LEFT JOIN certificates c ON c.request_id=r.id WHERE r.student_id=$1 ORDER BY r.created_at DESC,r.id', [userId])).rows;
}

async function notify(db: Queryable, userId: string, kind: string, title: string, body: string, link: string, now: Date) {
  await db.query('INSERT INTO notifications(id,user_id,kind,title,body,link,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), userId, kind, title, body, link, now.toISOString()]);
}

function icsEscape(value: string) { return value.replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, '\\n'); }
function icsDate(iso: string) { return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }

export async function registerCabinet(app: FastifyInstance, db: Database, h: Helpers) {
  const today = () => moscowDate(h.clock());

  app.get('/api/schedule', async (request) => {
    const session = await h.student(request);
    const { week } = z.object({ week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional() }).strict().parse(request.query);
    const anchor = week ? new Date(`${week}T12:00:00+03:00`) : h.clock();
    if (Number.isNaN(anchor.getTime())) throw Object.assign(new Error(), { statusCode: 400 });
    const start = moscowMonday(anchor);
    const lessons = await lessonsFor(db, session.user_id!, new Date(start), new Date(start + 7 * DAY - 1));
    const index = Math.round((start - moscowMonday(new Date('2026-09-01T12:00:00+03:00'))) / (7 * DAY));
    return { week_start: moscowDate(new Date(start + 3 * 3_600_000)), parity: index % 2 === 0 ? 'нечётная' : 'чётная', lessons };
  });

  app.get('/api/schedule.ics', async (request, reply) => {
    const session = await h.student(request);
    const now = h.clock();
    const lessons = await lessonsFor(db, session.user_id!, new Date(moscowMonday(now)), new Date(now.getTime() + 8 * 7 * DAY));
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Digital dean office concept//RU', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Расписание', 'X-WR-TIMEZONE:Europe/Moscow'];
    for (const l of lessons) {
      if (l.change?.kind === 'cancelled') continue;
      const room = l.change?.new_room ?? l.room;
      lines.push('BEGIN:VEVENT', `UID:${l.id}@dekanat-concept`, `DTSTAMP:${icsDate(now.toISOString())}`, `DTSTART:${icsDate(l.starts_at)}`, `DTEND:${icsDate(l.ends_at)}`, `SUMMARY:${icsEscape(l.discipline)}`, `LOCATION:${icsEscape(room ? `Ауд. ${room}` : '')}`, `DESCRIPTION:${icsEscape(`${l.kind}${l.change?.new_teacher ?? l.teacher ? ` · ${l.change?.new_teacher ?? l.teacher}` : ''}`)}`, 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return reply.header('Content-Type', 'text/calendar; charset=utf-8').header('Content-Disposition', 'attachment; filename="schedule.ics"').send(lines.join('\r\n'));
  });

  app.get('/api/today', async (request) => {
    const session = await h.student(request);
    const now = h.clock();
    const from = new Date(now.getTime());
    from.setUTCHours(-3, 0, 0, 0);
    if (moscowDate(from) !== today()) from.setTime(from.getTime() + DAY);
    const lessons = await lessonsFor(db, session.user_id!, from, new Date(from.getTime() + 7 * DAY));
    const todays = lessons.filter((l) => l.date === today());
    const upcoming = lessons.filter((l) => l.ends_at > now.toISOString());
    const nextDay = upcoming.find((l) => l.date !== today())?.date ?? null;
    const progress = await progressFor(db, session.user_id!);
    const requests = (await requestsFor(db, session.user_id!)).filter((r) => !['issued', 'rejected'].includes(r.status)).slice(0, 3);
    const unread = (await db.query<{ count: number }>('SELECT count(*)::integer AS count FROM notifications WHERE user_id=$1 AND read_at IS NULL', [session.user_id])).rows[0].count;
    const changes = lessons.filter((l) => l.change && l.ends_at > now.toISOString()).slice(0, 3);
    return {
      now: now.toISOString(), today: today(), lessons: todays,
      next_day: nextDay ? { date: nextDay, lessons: lessons.filter((l) => l.date === nextDay) } : null,
      changes, attention: progress.filter((p) => p.status !== 'ok'), requests,
      key_dates: (await keyDatesFor(db, session.user_id!, today())).slice(0, 3), unread,
    };
  });

  app.get('/api/grades', async (request) => {
    const session = await h.student(request);
    const progress = await progressFor(db, session.user_id!);
    const works = (await db.query<{ id: string; discipline_id: string; discipline: string; kind: string; points: string; max_points: string; date: string; comment: string }>("SELECT g.id,p.id AS discipline_id,d.name AS discipline,g.kind,g.points,g.max_points,to_char(g.date,'YYYY-MM-DD') AS date,g.comment FROM grades g JOIN disciplines d ON d.id=g.discipline_id JOIN discipline_progress p ON p.discipline_id=g.discipline_id AND p.student_id=g.student_id WHERE g.student_id=$1 ORDER BY g.date DESC,g.id", [session.user_id])).rows.map((w) => ({ ...w, points: Number(w.points), max_points: Number(w.max_points) }));
    const past = (await db.query<{ id: string; discipline: string; form: string; result: string; term: string }>('SELECT r.id,d.name AS discipline,r.form,r.result,r.term FROM session_results r JOIN disciplines d ON d.id=r.discipline_id WHERE r.student_id=$1 ORDER BY d.name', [session.user_id])).rows;
    const numeric = past.map((r) => Number(r.result)).filter((n) => !Number.isNaN(n));
    const student = (await db.query<{ rating_place: number | null; rating_total: number | null }>('SELECT rating_place,rating_total FROM students WHERE user_id=$1', [session.user_id])).rows[0];
    const attended = progress.reduce((a, p) => a + p.attended, 0), total = progress.reduce((a, p) => a + p.total, 0);
    const extra = await extraPoints(db, session.user_id!);
    return {
      summary: { extra_points: extra, gpa: numeric.length ? Math.round((numeric.reduce((a, b) => a + b, 0) / numeric.length) * 100) / 100 : null, rating_place: student?.rating_place ?? null, rating_total: student?.rating_total ?? null, attendance: total ? Math.round(attended / total * 100) : null, missed: total - attended, risk: progress.filter((p) => p.status === 'risk').length, attention: progress.filter((p) => p.status === 'attention').length },
      progress: progress.map((p) => ({ ...p, works: works.filter((w) => w.discipline_id === p.id).map(({ discipline_id: _d, discipline: _n, ...w }) => w) })),
      past,
    };
  });

  app.get('/api/request-types', async (request) => {
    await h.student(request);
    return { types: (await db.query('SELECT id,code,title,description,sla_days,instant,needs_purpose FROM request_types WHERE code IS NOT NULL ORDER BY position')).rows };
  });

  app.get('/api/requests', async (request) => {
    const session = await h.student(request);
    return { requests: await requestsFor(db, session.user_id!) };
  });

  app.get('/api/requests/:id', async (request, reply) => {
    const session = await h.student(request), { id } = idParams.parse(request.params);
    const item = (await requestsFor(db, session.user_id!)).find((r) => r.id === id);
    if (!item) return reply.code(404).send({ error: 'Ресурс не найден' });
    const events = (await db.query('SELECT id,status,comment,created_at FROM request_events WHERE request_id=$1 ORDER BY created_at,id', [id])).rows;
    let certificate = null;
    if (item.certificate) {
      const cert = (await db.query<{ code: string; issued_at: string; valid_until: string }>('SELECT code,issued_at,valid_until FROM certificates WHERE request_id=$1', [id])).rows[0];
      const profile = (await db.query('SELECT s.full_name,s.faculty,s.program,s.course,g.name AS group_name,s.record_book,s.enrolled_year FROM students s JOIN groups g ON g.id=s.group_id WHERE s.user_id=$1', [session.user_id])).rows[0];
      const origin = process.env.APP_ORIGIN ?? 'https://localhost:8443';
      const qr = await QRCode.toString(`${origin}/verify/${cert.code}`, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#0000' } });
      certificate = { ...cert, profile, qr, url: `${origin}/verify/${cert.code}` };
    }
    return { request: item, events, certificate };
  });

  const createBody = z.object({ type_id: uuid, purpose: z.string().trim().max(200).default(''), comment: z.string().trim().max(1000).default(''), copies: z.number().int().min(1).max(5).default(1) }).strict();
  app.post('/api/requests', { config: { rateLimit: { max: 20, timeWindow: 60_000 } } }, async (request, reply) => {
    const session = await h.student(request);
    const body = createBody.parse(request.body);
    const type = (await db.query<{ id: string; title: string; instant: boolean; needs_purpose: boolean }>('SELECT id,title,instant,needs_purpose FROM request_types WHERE id=$1 AND code IS NOT NULL', [body.type_id])).rows[0];
    if (!type) return reply.code(404).send({ error: 'Ресурс не найден' });
    if (type.needs_purpose && !body.purpose) return reply.code(400).send({ error: 'Укажите, куда нужна справка' });
    const now = h.clock(), id = randomUUID();
    const status = type.instant ? 'ready' : 'submitted';
    await db.transaction(async (tx) => {
      await tx.query("INSERT INTO requests(id,student_id,type_id,comment,purpose,copies,status,staff_comment,created_at,updated_at,number) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,nextval('request_number_seq'))", [id, session.user_id, type.id, body.comment, body.purpose, body.copies, status, type.instant ? 'Справка сформирована автоматически' : '', now.toISOString()]);
      await tx.query('INSERT INTO request_events(id,request_id,status,comment,actor_id,created_at) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), id, 'submitted', 'Заявка подана', session.user_id, now.toISOString()]);
      if (type.instant) {
        await tx.query('INSERT INTO request_events(id,request_id,status,comment,actor_id,created_at) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), id, 'ready', 'Справка сформирована автоматически', session.user_id, new Date(now.getTime() + 1000).toISOString()]);
        await tx.query('INSERT INTO certificates(code,request_id,issued_at,valid_until) VALUES ($1,$2,$3,$4)', [certificateCode(), id, now.toISOString(), new Date(now.getTime() + 90 * DAY).toISOString()]);
        await notify(tx, session.user_id!, 'request', `${type.title} готова`, 'Откройте её в разделе «Заявки» или покажите QR-код.', 'requests', now);
      }
    });
    return reply.code(201).send({ id, status });
  });

  app.get('/api/verify/:code', { config: { rateLimit: { max: 30, timeWindow: 60_000 } } }, async (request, reply) => {
    const { code } = z.object({ code: z.string().regex(/^[A-Z0-9]{10}$/u) }).strict().parse(request.params);
    const row = (await db.query<{ title: string; full_name: string; issued_at: string; valid_until: string; group_name: string }>('SELECT t.title,s.full_name,c.issued_at,c.valid_until,g.name AS group_name FROM certificates c JOIN requests r ON r.id=c.request_id JOIN request_types t ON t.id=r.type_id JOIN students s ON s.user_id=r.student_id JOIN groups g ON g.id=s.group_id WHERE c.code=$1', [code])).rows[0];
    if (!row) return reply.code(404).send({ error: 'Справка с таким кодом не найдена' });
    // Публично раскрываем минимум: имя и первую букву фамилии.
    const [first, last] = row.full_name.split(' ');
    return { title: row.title, holder: `${first} ${last ? `${last[0]}.` : ''}`.trim(), group: row.group_name, issued_at: row.issued_at, valid_until: row.valid_until, valid: new Date(row.valid_until) > h.clock() };
  });

  app.get('/api/notifications', async (request) => {
    const session = await h.student(request);
    const items = (await db.query('SELECT id,kind,title,body,link,read_at,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [session.user_id])).rows;
    const announcements = (await db.query('SELECT a.id,a.title,a.body,a.image,a.created_at,u.display_name AS author FROM announcements a JOIN users u ON u.id=a.created_by ORDER BY a.created_at DESC LIMIT 20')).rows;
    return { notifications: items, announcements };
  });
  app.post('/api/notifications/read', async (request) => {
    const session = await h.student(request);
    z.object({}).strict().parse(request.body ?? {});
    await db.query('UPDATE notifications SET read_at=$2 WHERE user_id=$1 AND read_at IS NULL', [session.user_id, h.clock().toISOString()]);
    return { ok: true };
  });

  const askBody = z.object({ message: z.string().trim().min(1).max(500), history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(2000) }).strict()).max(10).default([]) }).strict();
  app.post('/api/assistant', { config: { rateLimit: { max: 20, timeWindow: 60_000 } } }, async (request) => {
    const session = await h.student(request);
    const { message, history } = askBody.parse(request.body);
    const ctx = await assistantContext(db, session.user_id!, h.clock());
    return (withinQuota(session.user_id!, ctx.today) ? await askModel(ctx, message, history) : null) ?? localAnswer(ctx, message);
  });

  // ——— Кабинет сотрудника ———
  app.get('/api/staff/requests', async (request) => {
    await h.staff(request);
    return { requests: (await db.query('SELECT r.id,r.number,r.status,r.purpose,r.comment,r.staff_comment,r.created_at,r.updated_at,t.title,t.sla_days,s.full_name,g.name AS group_name FROM requests r JOIN students s ON s.user_id=r.student_id JOIN groups g ON g.id=s.group_id JOIN request_types t ON t.id=r.type_id ORDER BY CASE WHEN r.status IN (\'submitted\',\'accepted\',\'in_progress\') THEN 0 ELSE 1 END, r.created_at DESC')).rows };
  });

  const statusBody = z.object({ status: z.enum(STATUS), comment: z.string().trim().max(500).default('') }).strict();
  app.post('/api/staff/requests/:id/status', async (request, reply) => {
    const session = await h.staff(request), { id } = idParams.parse(request.params);
    const body = statusBody.parse(request.body);
    const item = (await db.query<{ student_id: string; title: string; status: string }>('SELECT r.student_id,t.title,r.status FROM requests r JOIN request_types t ON t.id=r.type_id WHERE r.id=$1', [id])).rows[0];
    if (!item) return reply.code(404).send({ error: 'Ресурс не найден' });
    const now = h.clock();
    await db.transaction(async (tx) => {
      await tx.query('UPDATE requests SET status=$2,staff_comment=$3,updated_at=$4 WHERE id=$1', [id, body.status, body.comment, now.toISOString()]);
      await tx.query('INSERT INTO request_events(id,request_id,status,comment,actor_id,created_at) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), id, body.status, body.comment || `Статус: ${STATUS_LABEL[body.status]}`, session.user_id, now.toISOString()]);
      if (body.status === 'ready') {
        const exists = (await tx.query('SELECT 1 FROM certificates WHERE request_id=$1', [id])).rows.length;
        if (!exists) await tx.query('INSERT INTO certificates(code,request_id,issued_at,valid_until) VALUES ($1,$2,$3,$4)', [certificateCode(), id, now.toISOString(), new Date(now.getTime() + 90 * DAY).toISOString()]);
      }
      await notify(tx, item.student_id, 'request', `«${item.title}»: ${STATUS_LABEL[body.status]}`, body.comment || 'Статус заявки обновлён.', 'requests', now);
    });
    return { ok: true };
  });

  app.get('/api/staff/lessons', async (request) => {
    await h.staff(request);
    const students = (await db.query<{ user_id: string; group_name: string }>('SELECT s.user_id,g.name AS group_name FROM students s JOIN groups g ON g.id=s.group_id JOIN users u ON u.id=s.user_id WHERE u.active ORDER BY g.name')).rows;
    const from = new Date(h.clock().getTime()); from.setUTCHours(-3, 0, 0, 0);
    const result = [];
    for (const s of students) result.push({ group: s.group_name, lessons: await lessonsFor(db, s.user_id, from, new Date(from.getTime() + 3 * DAY)) });
    return { groups: result };
  });

  const changeBody = z.object({ lesson_id: z.string().regex(/^[0-9a-f-]{36}:\d{4}-\d{2}-\d{2}$/u), kind: z.enum(['cancelled', 'room', 'substitute']), new_room: z.string().trim().max(20).optional(), new_teacher: z.string().trim().max(80).optional(), note: z.string().trim().max(300).default('') }).strict();
  app.post('/api/staff/lesson-changes', async (request, reply) => {
    const session = await h.staff(request);
    const body = changeBody.parse(request.body);
    const [entryId, date] = [body.lesson_id.slice(0, 36), body.lesson_id.slice(37)];
    const entry = (await db.query<{ group_id: string; discipline: string }>('SELECT e.group_id,d.name AS discipline FROM schedule_entries e JOIN disciplines d ON d.id=e.discipline_id WHERE e.id=$1', [entryId])).rows[0];
    if (!entry) return reply.code(404).send({ error: 'Ресурс не найден' });
    if (body.kind === 'room' && !body.new_room) return reply.code(400).send({ error: 'Укажите новую аудиторию' });
    if (body.kind === 'substitute' && !body.new_teacher) return reply.code(400).send({ error: 'Укажите преподавателя' });
    const now = h.clock();
    await db.transaction(async (tx) => {
      await tx.query('DELETE FROM lesson_changes WHERE schedule_entry_id=$1 AND on_date=$2', [entryId, date]);
      await tx.query('INSERT INTO lesson_changes(id,schedule_entry_id,on_date,kind,new_room,new_teacher,note,created_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [randomUUID(), entryId, date, body.kind, body.new_room ?? null, body.new_teacher ?? null, body.note, session.user_id, now.toISOString()]);
      const title = body.kind === 'cancelled' ? 'Занятие отменено' : body.kind === 'room' ? 'Аудитория изменилась' : 'Замена преподавателя';
      const day = dayFmt.format(new Date(`${date}T12:00:00+03:00`));
      const students = (await tx.query<{ user_id: string }>('SELECT user_id FROM students WHERE group_id=$1', [entry.group_id])).rows;
      for (const s of students) await notify(tx, s.user_id, 'schedule', title, `${entry.discipline}, ${day}.${body.note ? ` ${body.note}` : ''}`, 'schedule', now);
    });
    return reply.code(201).send({ ok: true });
  });

  // ——— Студенты: поиск, профиль, успеваемость ———
  const likeEscape = (v: string) => v.replace(/[\\%_]/g, (m) => `\\${m}`);
  app.get('/api/staff/students', async (request) => {
    await h.staff(request);
    const { q } = z.object({ q: z.string().trim().max(80).default('') }).strict().parse(request.query);
    const pattern = `%${likeEscape(q.toLowerCase())}%`;
    const rows = (await db.query(`SELECT s.user_id AS id,s.full_name,s.course,s.record_book,g.name AS group_name FROM students s JOIN groups g ON g.id=s.group_id JOIN users u ON u.id=s.user_id WHERE u.active AND ($1='' OR lower(s.full_name) LIKE $2 OR lower(s.login) LIKE $2 OR lower(COALESCE(s.record_book,'')) LIKE $2 OR lower(g.name) LIKE $2) ORDER BY s.full_name LIMIT 30`, [q, pattern])).rows;
    return { students: rows };
  });

  async function studentCard(userId: string) {
    const student = (await db.query('SELECT s.user_id AS id,s.login,s.full_name,s.faculty,s.program,s.course,s.group_id,g.name AS group_name,s.subgroup,s.record_book,s.student_card,s.email,s.personal_email,s.phone,s.reg_address,s.live_address FROM students s JOIN groups g ON g.id=s.group_id WHERE s.user_id=$1', [userId])).rows[0];
    if (!student) return null;
    return {
      student,
      groups: (await db.query("SELECT id,name FROM groups ORDER BY name")).rows,
      progress: (await db.query('SELECT p.id,p.discipline_id,d.name AS discipline,p.form,p.points::float AS points,p.attended,p.total_classes FROM discipline_progress p JOIN disciplines d ON d.id=p.discipline_id WHERE p.student_id=$1 ORDER BY d.name', [userId])).rows,
      works: (await db.query("SELECT g.id,g.discipline_id,d.name AS discipline,g.kind,g.points::float AS points,g.max_points::float AS max_points,to_char(g.date,'YYYY-MM-DD') AS date,g.comment FROM grades g JOIN disciplines d ON d.id=g.discipline_id WHERE g.student_id=$1 ORDER BY g.date DESC,g.id", [userId])).rows,
      past: (await db.query('SELECT r.id,r.discipline_id,d.name AS discipline,r.form,r.result,r.term FROM session_results r JOIN disciplines d ON d.id=r.discipline_id WHERE r.student_id=$1 ORDER BY d.name', [userId])).rows,
    };
  }

  app.get('/api/staff/students/:id', async (request, reply) => {
    await h.staff(request);
    const { id } = idParams.parse(request.params);
    const card = await studentCard(id);
    return card ?? reply.code(404).send({ error: 'Ресурс не найден' });
  });

  const profileBody = z.object({
    full_name: z.string().trim().min(3).max(120), faculty: z.string().trim().min(2).max(200), program: z.string().trim().min(2).max(300),
    course: z.number().int().min(1).max(6), group_id: uuid, subgroup: z.enum(['I', 'II']), email: z.string().trim().email().max(120),
    personal_email: z.string().trim().email().max(120).or(z.literal('')).default(''), phone: z.string().trim().max(30).default(''), reg_address: z.string().trim().max(300).default(''), live_address: z.string().trim().max(300).default(''),
  }).strict();
  app.post('/api/staff/students/:id/profile', async (request, reply) => {
    const session = await h.staff(request), { id } = idParams.parse(request.params);
    const body = profileBody.parse(request.body);
    if (!(await db.query('SELECT 1 FROM students WHERE user_id=$1', [id])).rows.length) return reply.code(404).send({ error: 'Ресурс не найден' });
    if (!(await db.query('SELECT 1 FROM groups WHERE id=$1', [body.group_id])).rows.length) return reply.code(400).send({ error: 'Группа не найдена' });
    await db.transaction(async (tx) => {
      await tx.query('UPDATE students SET full_name=$2,faculty=$3,program=$4,course=$5,group_id=$6,subgroup=$7,email=$8,personal_email=$9,phone=$10,reg_address=$11,live_address=$12 WHERE user_id=$1', [id, body.full_name, body.faculty, body.program, body.course, body.group_id, body.subgroup, body.email, body.personal_email, body.phone, body.reg_address, body.live_address]);
      await tx.query('UPDATE users SET display_name=$2 WHERE id=$1', [id, body.full_name]);
      await notify(tx, id, 'profile', 'Деканат обновил ваш профиль', 'Проверьте данные в разделе «Профиль».', 'profile', h.clock());
    });
    app.log.info({ staff: session.user_id, student: id }, 'staff updated profile');
    return { ok: true };
  });

  const progressBody = z.object({ discipline_id: uuid, points: z.number().min(0).max(60), attended: z.number().int().min(0).max(500), total_classes: z.number().int().min(0).max(500) }).strict();
  app.post('/api/staff/students/:id/progress', async (request, reply) => {
    await h.staff(request);
    const { id } = idParams.parse(request.params);
    const b = progressBody.parse(request.body);
    if (b.attended > b.total_classes) return reply.code(400).send({ error: 'Посещено не может быть больше, чем проведено занятий' });
    const row = (await db.query<{ name: string }>('SELECT d.name FROM discipline_progress p JOIN disciplines d ON d.id=p.discipline_id WHERE p.student_id=$1 AND p.discipline_id=$2', [id, b.discipline_id])).rows[0];
    if (!row) return reply.code(404).send({ error: 'Ресурс не найден' });
    await db.transaction(async (tx) => {
      await tx.query('UPDATE discipline_progress SET points=$3,attended=$4,total_classes=$5 WHERE student_id=$1 AND discipline_id=$2', [id, b.discipline_id, b.points, b.attended, b.total_classes]);
      await notify(tx, id, 'grades', `Баллы обновлены: ${row.name}`, `Сейчас ${b.points} из 60, посещено ${b.attended} из ${b.total_classes}.`, 'grades', h.clock());
    });
    return { ok: true };
  });

  const workBody = z.object({ discipline_id: uuid, kind: z.string().trim().min(2).max(60), points: z.number().min(0).max(60), max_points: z.number().min(1).max(60), comment: z.string().trim().max(200).default(''), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional() }).strict();
  app.post('/api/staff/students/:id/works', async (request, reply) => {
    await h.staff(request);
    const { id } = idParams.parse(request.params);
    const b = workBody.parse(request.body);
    if (b.points > b.max_points) return reply.code(400).send({ error: 'Баллов не может быть больше максимума за работу' });
    const row = (await db.query<{ name: string; points: number }>('SELECT d.name,p.points::float AS points FROM discipline_progress p JOIN disciplines d ON d.id=p.discipline_id WHERE p.student_id=$1 AND p.discipline_id=$2', [id, b.discipline_id])).rows[0];
    if (!row) return reply.code(404).send({ error: 'Ресурс не найден' });
    const total = Math.min(60, row.points + b.points);
    await db.transaction(async (tx) => {
      await tx.query('INSERT INTO grades(id,student_id,discipline_id,kind,points,max_points,date,comment) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), id, b.discipline_id, b.kind, b.points, b.max_points, b.date ?? today(), b.comment]);
      await tx.query('UPDATE discipline_progress SET points=$3 WHERE student_id=$1 AND discipline_id=$2', [id, b.discipline_id, total]);
      await notify(tx, id, 'grades', `Новая оценка: ${row.name}`, `${b.kind}: ${b.points} из ${b.max_points}. Всего ${total} из 60.`, 'grades', h.clock());
    });
    return reply.code(201).send({ ok: true, total });
  });

  const resultBody = z.object({ discipline_id: uuid, form: z.enum(['exam', 'credit']), result: z.string().trim().min(1).max(30), term: z.string().trim().min(3).max(60) }).strict();
  app.post('/api/staff/students/:id/session-results', async (request, reply) => {
    await h.staff(request);
    const { id } = idParams.parse(request.params);
    const b = resultBody.parse(request.body);
    const row = (await db.query<{ name: string }>('SELECT d.name FROM discipline_progress p JOIN disciplines d ON d.id=p.discipline_id WHERE p.student_id=$1 AND p.discipline_id=$2', [id, b.discipline_id])).rows[0];
    if (!row) return reply.code(404).send({ error: 'Ресурс не найден' });
    await db.transaction(async (tx) => {
      await tx.query('DELETE FROM session_results WHERE student_id=$1 AND discipline_id=$2 AND term=$3', [id, b.discipline_id, b.term]);
      await tx.query('INSERT INTO session_results(id,student_id,discipline_id,form,result,term) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), id, b.discipline_id, b.form, b.result, b.term]);
      await notify(tx, id, 'grades', `Результат сессии: ${row.name}`, `${b.form === 'exam' ? 'Экзамен' : 'Зачёт'}: ${b.result}.`, 'grades', h.clock());
    });
    return reply.code(201).send({ ok: true });
  });

  await registerExtras(app, db, h);

  const announceBody = z.object({ title: z.string().trim().min(3).max(120), body: z.string().trim().min(3).max(1000), image: z.enum(NEWS_IMAGES).optional() }).strict();
  app.post('/api/staff/announcements', async (request, reply) => {
    const session = await h.staff(request);
    const body = announceBody.parse(request.body);
    await db.query('INSERT INTO announcements(id,title,body,audience,created_by,created_at,image) VALUES ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), body.title, body.body, 'all', session.user_id, h.clock().toISOString(), body.image ?? '']);
    return reply.code(201).send({ ok: true });
  });
}

export async function assistantContext(db: Queryable, userId: string, now: Date): Promise<AssistantContext> {
  const profile = (await db.query<{ full_name: string; course: number; group_name: string; program: string; rating_place: number | null; rating_total: number | null }>('SELECT s.full_name,s.course,g.name AS group_name,s.program,s.rating_place,s.rating_total FROM students s JOIN groups g ON g.id=s.group_id WHERE s.user_id=$1', [userId])).rows[0];
  const lessons = await lessonsFor(db, userId, now, new Date(now.getTime() + 7 * DAY));
  const today = moscowDate(now);
  return {
    firstName: profile.full_name.split(' ')[0], course: profile.course, group: profile.group_name, program: profile.program, today,
    lessons: lessons.slice(0, 20).map((l) => ({
      day: l.date === today ? today : dayFmt.format(new Date(l.starts_at)), time: timeFmt.format(new Date(l.starts_at)), title: l.discipline, room: l.change?.new_room ?? l.room, teacher: l.change?.new_teacher ?? l.teacher,
      change: l.change ? (l.change.kind === 'cancelled' ? 'отменено' : l.change.kind === 'room' ? `перенос в ауд. ${l.change.new_room}` : `замена: ${l.change.new_teacher}`) : null,
    })),
    progress: (await progressFor(db, userId)).map((p) => ({ discipline: p.discipline, form: p.form, points: p.points, attendance: p.attendance, status: p.status, advice: p.advice })),
    requests: (await requestsFor(db, userId)).map((r) => ({ title: r.title, status: STATUS_LABEL[r.status] ?? r.status, number: r.number })),
    keyDates: (await keyDatesFor(db, userId, today)).map((d) => ({ title: d.title, from: d.starts_on, to: d.ends_on })),
    requestTypes: (await db.query<{ code: string; title: string }>('SELECT code,title FROM request_types WHERE code IS NOT NULL ORDER BY position')).rows,
    rating: { place: profile.rating_place, total: profile.rating_total },
  };
}
