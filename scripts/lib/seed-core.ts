import { hash, argon2id } from 'argon2';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { DEMO_STUDENTS } from '../../config/schedule.js';
import { stableId } from '../import-schedule/index.js';
import { studentId, studentSchedule, type Database, type Queryable } from './database.js';
import { occurrences } from './timeline.js';
import { seedExtra } from './seed-extra.js';

export interface DemoPasswords { studentArtem: string; studentLina: string; staff: string }
const passwordSchema = z.string().min(12).max(128);
const passwordsSchema = z.object({ studentArtem: passwordSchema, studentLina: passwordSchema, staff: passwordSchema });
export const STAFF_LOGIN = 'staff-maria';
export const STAFF_ID = stableId(`staff:${STAFF_LOGIN}`);

export function readDemoPasswords(env: NodeJS.ProcessEnv = process.env): DemoPasswords {
  const parsed = passwordsSchema.safeParse({ studentArtem: env.DEMO_PASSWORD_STUDENT_ARTEM, studentLina: env.DEMO_PASSWORD_STUDENT_LINA, staff: env.DEMO_PASSWORD_STAFF });
  if (!parsed.success) throw new Error('Задайте все три DEMO_PASSWORD_* в окружении: от 12 до 128 символов');
  return parsed.data;
}

export function certificateCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...randomBytes(10)].map((b) => alphabet[b % alphabet.length]).join('');
}

/** Вымышленные псевдонимы преподавателей вместо технических кодов импорта. */
const SURNAMES = ['Соколова', 'Ветров', 'Лебедева', 'Орлов', 'Миронова', 'Климов', 'Зайцева', 'Белов', 'Громова', 'Тихонов', 'Полякова', 'Ершов', 'Савина', 'Комаров', 'Назарова', 'Голубев', 'Фролова', 'Ширяев', 'Абрамова', 'Медведев', 'Калинина', 'Яковлев', 'Ефимова', 'Дорофеев', 'Серова', 'Гончаров', 'Рябова', 'Ладыгин', 'Устинова', 'Вершинин'];
const INITIALS = ['А. В.', 'Е. С.', 'И. Н.', 'О. П.', 'М. Д.', 'Н. Г.', 'Т. А.', 'С. Л.', 'Д. К.', 'В. Р.'];
export function teacherAlias(index: number): string {
  return `${SURNAMES[index % SURNAMES.length]} ${INITIALS[Math.floor(index / SURNAMES.length + index) % INITIALS.length]}`;
}

export const REQUEST_TYPES = [
  { code: 'study', title: 'Справка об обучении', description: 'С QR-кодом для проверки. Готова сразу после подачи.', sla: 1, instant: true, purpose: true },
  { code: 'call', title: 'Справка-вызов на сессию', description: 'Для работодателя, чтобы получить учебный отпуск.', sla: 3, instant: false, purpose: true },
  { code: 'transcript', title: 'Выписка оценок', description: 'Все оценки за пройденные семестры.', sla: 5, instant: false, purpose: false },
  { code: 'retake', title: 'Заявление на пересдачу', description: 'Укажите дисциплину в комментарии.', sla: 3, instant: false, purpose: false },
  { code: 'stipend', title: 'Справка о стипендии', description: 'Размер выплат за последние 6 месяцев.', sla: 2, instant: false, purpose: true },
  { code: 'leave', title: 'Заявление на академический отпуск', description: 'Деканат свяжется для уточнения документов.', sla: 10, instant: false, purpose: false },
] as const;
export const requestTypeId = (code: string) => stableId(`request-type:${code}`);

interface Profile { points: number[]; attendance: number[]; place: number; total: number; book: string; card: string; email: string; past: string[] }
const PROFILES: Profile[] = [
  { points: [56, 53, 58, 51, 55, 49, 54, 57], attendance: [96, 100, 92, 94, 100, 90, 95, 98], place: 4, total: 58, book: '23-0417', card: 'ФФЭ 230417', email: 'a.testov@student.example', past: ['5', '5', 'зачтено', '5', '4', 'зачтено'] },
  { points: [41, 24, 33, 45, 38, 29, 47, 36], attendance: [88, 61, 74, 90, 82, 68, 93, 80], place: 41, total: 52, book: '23-0562', card: 'ФФЭ 230562', email: 'l.obraztsova@student.example', past: ['4', '3', 'зачтено', '4', '4', 'зачтено'] },
];

async function upsert(tx: Queryable, sql: string, values: unknown[]) { await tx.query(sql, values); }

export async function seedCore(db: Database, passwords: DemoPasswords, now = new Date()): Promise<void> {
  passwords = passwordsSchema.parse(passwords);
  const accounts = [
    { id: studentId(DEMO_STUDENTS[0].login), login: DEMO_STUDENTS[0].login, name: DEMO_STUDENTS[0].full_name, role: 'student', password: passwords.studentArtem },
    { id: studentId(DEMO_STUDENTS[1].login), login: DEMO_STUDENTS[1].login, name: DEMO_STUDENTS[1].full_name, role: 'student', password: passwords.studentLina },
    { id: STAFF_ID, login: STAFF_LOGIN, name: 'Мария Ковалёва', role: 'staff', password: passwords.staff },
  ];
  const hashes: string[] = [];
  for (const account of accounts) hashes.push(await hash(account.password, { type: argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 }));
  const at = (days: number, hours = 0) => new Date(now.getTime() + days * 86_400_000 + hours * 3_600_000).toISOString();
  await db.transaction(async (tx) => {
    for (const [index, account] of accounts.entries()) {
      await upsert(tx, 'INSERT INTO users(id,login,password_hash,role,display_name,active) VALUES ($1,$2,$3,$4,$5,true) ON CONFLICT(id) DO UPDATE SET login=EXCLUDED.login,password_hash=EXCLUDED.password_hash,role=EXCLUDED.role,display_name=EXCLUDED.display_name,active=true', [account.id, account.login, hashes[index], account.role, account.name]);
    }
    await tx.query('DELETE FROM sessions WHERE user_id=ANY($1::uuid[])', [accounts.map((account) => account.id)]);

    const teachers = (await tx.query<{ id: string }>('SELECT id FROM teachers ORDER BY id')).rows;
    for (const [index, teacher] of teachers.entries()) await tx.query('UPDATE teachers SET full_name=$2 WHERE id=$1', [teacher.id, teacherAlias(index)]);

    for (const [position, type] of REQUEST_TYPES.entries()) {
      await upsert(tx, 'INSERT INTO request_types(id,title,description,sla_days,code,instant,needs_purpose,position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,sla_days=EXCLUDED.sla_days,code=EXCLUDED.code,instant=EXCLUDED.instant,needs_purpose=EXCLUDED.needs_purpose,position=EXCLUDED.position', [requestTypeId(type.code), type.title, type.description, type.sla, type.code, type.instant, type.purpose, position]);
    }
    // Старый тип из черновика этапа 1 больше не показывается.
    await tx.query("UPDATE request_types SET position=99 WHERE code IS NULL");

    for (const [index, student] of DEMO_STUDENTS.entries()) {
      const owner = studentId(student.login);
      const p = PROFILES[index];
      await tx.query('UPDATE students SET record_book=$2,student_card=$3,enrolled_year=2023,rating_place=$4,rating_total=$5,email=$6 WHERE user_id=$1', [owner, p.book, p.card, p.place, p.total, p.email]);
      const schedule = await studentSchedule(tx, owner);
      const seen = new Set<string>();
      const disciplineIds = schedule.map((e) => e.discipline_id).filter((id) => !seen.has(id) && seen.add(id)).slice(0, 8);
      for (const [position, disciplineId] of disciplineIds.entries()) {
        const points = p.points[position % p.points.length];
        const attendance = p.attendance[position % p.attendance.length];
        const total = 14 + (position % 3) * 2;
        const form = position % 3 === 1 ? 'credit' : position % 4 === 3 ? 'diff_credit' : 'exam';
        await upsert(tx, 'INSERT INTO discipline_progress(id,student_id,discipline_id,form,points,attended,total_classes) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(student_id,discipline_id) DO UPDATE SET form=EXCLUDED.form,points=EXCLUDED.points,attended=EXCLUDED.attended,total_classes=EXCLUDED.total_classes', [stableId(`progress:${owner}:${disciplineId}`), owner, disciplineId, form, points, Math.round(total * attendance / 100), total]);
        const works = [
          { kind: 'Работа на семинаре', max: 10, share: 0.9, days: -24, comment: '' },
          { kind: 'Контрольная работа', max: 20, share: points / 60, days: -12, comment: points < 35 ? 'Можно переписать на консультации' : '' },
          { kind: 'Эссе', max: 10, share: Math.min(1, points / 55), days: -4, comment: '' },
        ];
        for (const [w, work] of works.entries()) {
          await upsert(tx, 'INSERT INTO grades(id,student_id,discipline_id,kind,points,max_points,date,comment) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET kind=EXCLUDED.kind,points=EXCLUDED.points,max_points=EXCLUDED.max_points,date=EXCLUDED.date,comment=EXCLUDED.comment', [stableId(`grade:${owner}:${disciplineId}:${w}`), owner, disciplineId, work.kind, Math.round(work.max * work.share), work.max, at(work.days - position).slice(0, 10), work.comment]);
        }
      }
      // Прошлая сессия: дисциплины прошлого семестра условно берутся из списка с конца.
      const pastDisciplines = schedule.map((e) => e.discipline_id).filter((id, i, all) => all.indexOf(id) === i).reverse().slice(0, 6);
      await tx.query('DELETE FROM session_results WHERE student_id=$1', [owner]);
      for (const [position, disciplineId] of pastDisciplines.entries()) {
        const result = p.past[position % p.past.length];
        await tx.query('INSERT INTO session_results(id,student_id,discipline_id,form,result,term) VALUES ($1,$2,$3,$4,$5,$6)', [stableId(`session-result:${owner}:${position}`), owner, disciplineId, result === 'зачтено' ? 'credit' : 'exam', result, 'Весенний семестр 2025/26']);
      }

      // Заявки: у Артёма готовая справка, у Лины — заявление на пересдачу в работе.
      const demoRequests = index === 0
        ? [{ code: 'study', status: 'ready', purpose: 'По месту требования', comment: '', staff: 'Справка сформирована автоматически', created: -6 }, { code: 'call', status: 'in_progress', purpose: 'ООО «Пример»', comment: 'Нужна на зимнюю сессию', staff: '', created: -2 }]
        : [{ code: 'retake', status: 'in_progress', purpose: '', comment: 'Макроэкономика, контрольная работа №2', staff: 'Передали на кафедру, ждём дату', created: -3 }, { code: 'stipend', status: 'submitted', purpose: 'В соцзащиту', comment: '', staff: '', created: -1 }];
      for (const [position, item] of demoRequests.entries()) {
        const requestId = stableId(`request:${owner}:${position}`);
        await upsert(tx, "INSERT INTO requests(id,student_id,type_id,comment,purpose,status,staff_comment,created_at,updated_at,number) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,nextval('request_number_seq')) ON CONFLICT(id) DO UPDATE SET type_id=EXCLUDED.type_id,comment=EXCLUDED.comment,purpose=EXCLUDED.purpose,status=EXCLUDED.status,staff_comment=EXCLUDED.staff_comment,created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at", [requestId, owner, requestTypeId(item.code), item.comment, item.purpose, item.status, item.staff, at(item.created), at(item.created + 1)]);
        await tx.query('DELETE FROM request_events WHERE request_id=$1', [requestId]);
        await tx.query('INSERT INTO request_events(id,request_id,status,comment,actor_id,created_at) VALUES ($1,$2,$3,$4,$5,$6)', [stableId(`event:${requestId}:submitted`), requestId, 'submitted', 'Заявка подана', owner, at(item.created)]);
        if (item.status !== 'submitted') await tx.query('INSERT INTO request_events(id,request_id,status,comment,actor_id,created_at) VALUES ($1,$2,$3,$4,$5,$6)', [stableId(`event:${requestId}:current`), requestId, item.status, item.staff || 'Заявка принята в работу', STAFF_ID, at(item.created + 1)]);
        if (item.status === 'ready') {
          const exists = (await tx.query('SELECT 1 FROM certificates WHERE request_id=$1', [requestId])).rows.length;
          if (!exists) await tx.query('INSERT INTO certificates(code,request_id,issued_at,valid_until) VALUES ($1,$2,$3,$4)', [certificateCode(), requestId, at(item.created), at(item.created + 90)]);
        }
      }

      const notes = index === 0
        ? [{ kind: 'request', title: 'Справка об обучении готова', body: 'Откройте её в разделе «Заявки» или покажите QR-код.', days: -6, link: 'requests' }, { kind: 'schedule', title: 'Замена преподавателя', body: 'Завтра одно занятие проведёт другой преподаватель. Подробности в расписании.', days: 0, link: 'schedule' }, { kind: 'deadline', title: 'Через 2 недели — второй срез', body: 'Проверьте баллы по всем дисциплинам до 1 декабря.', days: -1, link: 'grades' }]
        : [{ kind: 'grades', title: 'Риск недопуска по одной дисциплине', body: 'Не хватает баллов для допуска к экзамену. Посмотрите, что можно сделать.', days: -1, link: 'grades' }, { kind: 'request', title: 'Заявление на пересдачу в работе', body: 'Деканат передал заявление на кафедру.', days: -2, link: 'requests' }, { kind: 'schedule', title: 'Аудитория изменилась', body: 'Сегодня одно занятие пройдёт в другой аудитории.', days: 0, link: 'schedule' }];
      for (const [position, note] of notes.entries()) {
        await upsert(tx, 'INSERT INTO notifications(id,user_id,kind,title,body,link,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET kind=EXCLUDED.kind,title=EXCLUDED.title,body=EXCLUDED.body,link=EXCLUDED.link', [stableId(`notification:${owner}:${position}`), owner, note.kind, note.title, note.body, note.link, at(note.days, -position)]);
      }
      // Старое уведомление из черновика этапа 1.
      await tx.query('DELETE FROM notifications WHERE id=$1', [stableId(`notification:${owner}`)]);

      const group = (await tx.query<{ group_id: string }>('SELECT group_id FROM students WHERE user_id=$1', [owner])).rows[0].group_id;
      const dates = [
        { title: 'Второй срез успеваемости', kind: 'checkpoint', from: '2026-12-01', to: null },
        { title: 'Сдать черновик курсовой работы', kind: 'deadline', from: '2026-12-10', to: null },
        { title: 'Зачётная неделя', kind: 'session', from: '2026-12-21', to: '2026-12-27' },
        { title: 'Экзаменационная сессия', kind: 'session', from: '2027-01-09', to: '2027-01-29' },
        { title: 'Зимние каникулы', kind: 'holiday', from: '2027-01-30', to: '2027-02-08' },
      ];
      for (const [position, date] of dates.entries()) {
        await upsert(tx, 'INSERT INTO key_dates(id,group_id,title,kind,starts_on,ends_on) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,kind=EXCLUDED.kind,starts_on=EXCLUDED.starts_on,ends_on=EXCLUDED.ends_on', [stableId(`key-date:${group}:${position}`), group, date.title, date.kind, date.from, date.to]);
      }
    }
    await tx.query('DELETE FROM schedule_changes');
    await tx.query('DELETE FROM deadlines');

    const events = [
      { title: 'Лаборатория ИИ-агентов: открытая встреча', organizer: 'Лаборатория ИИ-агентов', place: 'Ауд. 530', days: 3, h: 18, category: 'Наука', capacity: 40, description: 'Показываем проекты участников и набираем новую команду. Опыт программирования не обязателен.' },
      { title: 'Воркшоп по цифровому моделированию', organizer: 'Лаборатория цифрового моделирования', place: 'Ауд. 530', days: 6, h: 16, category: 'Наука', capacity: 25, description: 'Собираем простую модель спроса на туристические услуги в Python за полтора часа.' },
      { title: 'Ярмарка стажировок', organizer: 'Центр карьеры', place: 'Главный холл', days: 9, h: 12, category: 'Карьера', capacity: 300, description: 'Компании из финансов, туризма и консалтинга рассказывают о летних стажировках.' },
      { title: 'Дебаты: цифровые валюты центробанков', organizer: 'Дебатный клуб', place: 'Ауд. 214', days: 5, h: 19, category: 'Клубы', capacity: 60, description: 'Британский парламентский формат. Можно прийти зрителем.' },
      { title: 'Кейс-чемпионат по модернизации студенческих сервисов', organizer: 'Студенческий IT-клуб', place: 'Онлайн и ауд. 101', days: 14, h: 11, category: 'Карьера', capacity: 80, description: 'Команды по 3–4 человека, кейс от партнёрского вуза. Регистрация до старта.' },
      { title: 'Турнир по мини-футболу', organizer: 'Спортивный клуб', place: 'Спортзал', days: 11, h: 17, category: 'Спорт', capacity: 48, description: 'Собирайте команду курса или записывайтесь, мы подберём.' },
    ];
    for (const [position, event] of events.entries()) {
      const start = new Date(now.getTime() + event.days * 86_400_000);
      start.setUTCHours(event.h - 3, 0, 0, 0);
      await upsert(tx, 'INSERT INTO events(id,title,organizer,place,starts_at,category,description,capacity) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,organizer=EXCLUDED.organizer,place=EXCLUDED.place,starts_at=EXCLUDED.starts_at,category=EXCLUDED.category,description=EXCLUDED.description,capacity=EXCLUDED.capacity', [stableId(`event:${position}`), event.title, event.organizer, event.place, start.toISOString(), event.category, event.description, event.capacity]);
    }

    await tx.query("DELETE FROM announcements WHERE title IN ('Демонстрационные консультации','Учебный конкурс проектов','Проверка расписания','Срок подачи справок')");
    const announcements = [
      { title: 'Тестируем новый личный кабинет', body: 'Кабинет можно установить на телефон: в браузере нажмите «Поделиться» → «На экран „Домой“». Пишите, чего не хватает, — через раздел «Заявки».', days: 0 },
      { title: 'Консультации перед сессией', body: 'С 15 декабря кафедры проводят консультации по всем экзаменационным дисциплинам. Расписание появится в разделе «Расписание».', days: -2 },
      { title: 'Продление приёма заявлений на общежитие', body: 'Заявления на весенний семестр принимаются до 5 декабря.', days: -5 },
    ];
    for (const [position, a] of announcements.entries()) {
      await upsert(tx, 'INSERT INTO announcements(id,title,body,audience,created_by,created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,body=EXCLUDED.body,created_at=EXCLUDED.created_at', [stableId(`announcement:v2:${position}`), a.title, a.body, 'all', STAFF_ID, at(a.days, -position)]);
    }
  });
  await seedExtra(db, now);
  await refreshDemoChanges(db, now);
}

/** Держит демонстрационные изменения расписания на «сегодня» и «завтра» при любой дате проверки. */
export async function refreshDemoChanges(db: Database, now = new Date()): Promise<void> {
  const plan = [
    { student: 0, kind: 'substitute', day: 1, note: 'Преподаватель на конференции', teacher: 'Громова Т. А.' },
    { student: 0, kind: 'room', day: 0, note: 'Аудитория на ремонте', room: '418' },
    { student: 1, kind: 'room', day: 0, note: 'Аудитория занята под олимпиаду', room: '301' },
    { student: 1, kind: 'cancelled', day: 2, note: 'Занятие перенесено на консультацию 15 декабря' },
  ];
  await db.transaction(async (tx) => {
    for (const [position, item] of plan.entries()) {
      const id = stableId(`lesson-change:${position}`);
      await tx.query('DELETE FROM lesson_changes WHERE id=$1', [id]);
      const owner = studentId(DEMO_STUDENTS[item.student].login);
      const entries = await studentSchedule(tx, owner);
      // Ищем ближайший учебный день начиная с нужного смещения.
      const from = new Date(now.getTime() + item.day * 86_400_000);
      from.setUTCHours(0, 0, 0, 0);
      const list = occurrences(entries, from, new Date(from.getTime() + 6 * 86_400_000));
      const sameDay = list.filter((o) => o.date === list[0]?.date);
      const target = sameDay[Math.min(1, sameDay.length - 1)];
      if (!target) continue;
      await tx.query('INSERT INTO lesson_changes(id,schedule_entry_id,on_date,kind,new_room,new_teacher,note,created_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (schedule_entry_id,on_date) DO NOTHING', [id, target.entry.id, target.date, item.kind, item.room ?? null, item.teacher ?? null, item.note, STAFF_ID, now.toISOString()]);
    }
  });
}
