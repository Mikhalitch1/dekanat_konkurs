import { DEMO_STUDENTS } from '../../config/schedule.js';
import { stableId } from '../import-schedule/index.js';
import { studentId, type Database } from './database.js';
import { encryptPii, type PassportData } from './pii.js';
import { STAFF_ID } from './seed-core.js';

/** Все персональные данные ниже сгенерированы и вымышлены: серии паспортов с несуществующим кодом региона 00, СНИЛС из неназначаемого диапазона 000-. */
const CONTACTS = [
  { personal_email: 'artem.testov05@example.org', phone: '+7 (900) 555-01-14', birth: '2005-03-14', reg: 'г. Тверь, ул. Сиреневая, д. 14, кв. 52', live: 'Московская обл., г. Одинцово, общежитие кампуса, корп. 2, комн. 318',
    snils: '000-114-205 41', passport: { series: '00 05', number: '314052', issued_by: 'ТЕСТОВОЕ ОТДЕЛЕНИЕ УФМС (вымышленные данные)', issued_on: '2019-04-02', division_code: '000-014' } },
  { personal_email: 'lina.obraztsova05@example.org', phone: '+7 (900) 555-02-27', birth: '2005-07-27', reg: 'г. Казань, ул. Яблоневая, д. 7, кв. 19', live: 'Московская обл., г. Одинцово, общежитие кампуса, корп. 1, комн. 207',
    snils: '000-227-306 58', passport: { series: '00 05', number: '727019', issued_by: 'ТЕСТОВОЕ ОТДЕЛЕНИЕ УФМС (вымышленные данные)', issued_on: '2019-08-09', division_code: '000-027' } },
] as const satisfies readonly { passport: PassportData; [k: string]: unknown }[];

// Базовый балл мероприятия по уровню; итог = базовый × коэффициент роли, до 0,5 балла. Общий потолок надбавки к рейтингу — 10.
export const LEVEL_POINTS: Record<string, number> = { club: 0.5, faculty: 1, university: 1.5, interuniversity: 2 };
export const ROLE_FACTOR: Record<string, number> = { participant: 1, organizer: 1.5, prize3: 1.5, prize2: 2, prize1: 2.5 };
export const EXTRA_CAP = 10;
export const award = (base: number, role: string) => Math.round(base * (ROLE_FACTOR[role] ?? 0) * 2) / 2;

const UPCOMING = [
  { level: 'university', program: '18:00 — показ проектов участников. 19:00 — разбор подходов к ИИ-агентам. 19:40 — набор команды и вопросы.' },
  { level: 'faculty', program: '16:00 — вводная часть. 16:30 — практикум: модель спроса на туристические услуги. 17:15 — разбор решений.' },
  { level: 'university', program: '12:00 — открытие. 12:30–15:00 — стенды компаний. 15:00 — разбор резюме и собеседований.' },
  { level: 'club', program: '19:00 — регламент. 19:15 — два раунда дебатов. 20:30 — оценка судей и обратная связь.' },
  { level: 'interuniversity', program: '11:00 — выдача кейса. 11:30–16:00 — работа команд. 16:30 — защита. 17:30 — награждение.' },
  { level: 'faculty', program: '17:00 — жеребьёвка. 17:30–19:30 — матчи группового этапа. 19:45 — финал и награждение.' },
];

const PAST = [
  { key: 'p0', title: 'Хакатон «Цифровой деканат»', organizer: 'Студенческий IT-клуб', place: 'Ауд. 101', days: -12, h: 11, category: 'Карьера', capacity: 60, level: 'interuniversity', description: 'Командный хакатон: за сутки собрать прототип студенческого сервиса.', results: [[0, 'prize1'], [1, 'participant']] },
  { key: 'p1', title: 'Школа студенческих лидеров', organizer: 'Деканат', place: 'Ауд. 214', days: -25, h: 15, category: 'Клубы', capacity: 40, level: 'faculty', description: 'Серия встреч о том, как организовать студенческий проект.', results: [[0, 'organizer']] },
  { key: 'p2', title: 'Открытая лекция о цифровой экономике', organizer: 'Кафедра экономики', place: 'Актовый зал', days: -8, h: 17, category: 'Наука', capacity: 200, level: 'university', description: 'Приглашённый лектор рассказал о платформах, данных и новых профессиях.', results: [[0, 'participant'], [1, 'participant']] },
  { key: 'p3', title: 'Турнир по настольному теннису', organizer: 'Спортивный клуб', place: 'Спортзал', days: -20, h: 16, category: 'Спорт', capacity: 32, level: 'club', description: 'Личный турнир среди студентов всех курсов.', results: [[1, 'prize2']] },
  { key: 'p4', title: 'Дебаты первокурсников', organizer: 'Дебатный клуб', place: 'Ауд. 214', days: -30, h: 18, category: 'Клубы', capacity: 50, level: 'faculty', description: 'Знакомство с форматом британских парламентских дебатов.', results: [[1, 'organizer']] },
] as const;

const BOOKS = [
  ['Микроэкономика: базовый курс', 'Орлова М. А., Дорофеев И. Н.', 2023, 'Экономика', 'Учебник', 'Спрос, предложение, поведение потребителей и фирм. Задачи с решениями и разбором типичных ошибок.', 412, 'Читальный зал, 2 этаж, ЭК-12', 6],
  ['Макроэкономика для бакалавров', 'Серова Т. А.', 2022, 'Экономика', 'Учебник', 'Национальные счета, инфляция, безработица и экономический рост на примерах открытых экономик.', 368, 'Читальный зал, 2 этаж, ЭК-14', 4],
  ['Менеджмент гостеприимства', 'Климов Д. К.', 2024, 'Туризм', 'Учебник', 'Организация работы отелей и ресторанов, стандарты сервиса, управление качеством и персоналом.', 296, 'Абонемент, ТР-03', 8],
  ['Туристские ресурсы мира', 'Назарова Е. С., Белов О. П.', 2021, 'Туризм', 'Учебное пособие', 'Природные и культурные ресурсы регионов мира, маршруты и особенности спроса.', 340, 'Абонемент, ТР-07', 3],
  ['Основы международного права', 'Громова Н. Г.', 2023, 'Право', 'Учебник', 'Источники права, договоры, ответственность государств, международные организации.', 454, 'Читальный зал, 1 этаж, ПР-02', 5],
  ['Деловой английский: практикум', 'Ефимова А. В.', 2024, 'Языки', 'Практикум', 'Переписка, переговоры, презентации. Лексика по темам, упражнения и аудиозаписи.', 224, 'Абонемент, ЯЗ-21', 10],
  ['Французский для международных отношений', 'Соколова В. Р.', 2022, 'Языки', 'Учебное пособие', 'Профессиональная лексика, дипломатическая переписка, чтение и перевод текстов.', 258, 'Абонемент, ЯЗ-34', 2],
  ['Python для анализа данных', 'Ладыгин С. Л.', 2024, 'Цифровые навыки', 'Практикум', 'Таблицы, визуализация и простые модели на Python. Все примеры запускаются в браузере.', 318, 'Читальный зал, 2 этаж, ИТ-05', 7],
  ['Статистика и эконометрика', 'Вершинин Д. К.', 2023, 'Математика', 'Учебник', 'Выборки, проверка гипотез, регрессия. Разобрано оформление результатов в отчётах.', 390, 'Читальный зал, 2 этаж, МТ-09', 4],
  ['Финансы и кредит', 'Фролова И. Н.', 2022, 'Экономика', 'Учебник', 'Бюджетная система, банки, рынки капитала и личные финансы.', 372, 'Абонемент, ЭК-31', 1],
] as const;

export async function seedExtra(db: Database, now: Date): Promise<void> {
  const at = (days: number, h = 12) => { const d = new Date(now.getTime() + days * 86_400_000); d.setUTCHours(h - 3, 0, 0, 0); return d.toISOString(); };
  await db.transaction(async (tx) => {
    // Контакты и документы.
    for (const [i, student] of DEMO_STUDENTS.entries()) {
      const owner = studentId(student.login), c = CONTACTS[i]!;
      await tx.query('UPDATE students SET personal_email=$2,phone=$3,birth_date=$4,reg_address=$5,live_address=$6 WHERE user_id=$1', [owner, c.personal_email, c.phone, c.birth, c.reg, c.live]);
      await tx.query('INSERT INTO student_documents(student_id,snils_enc,passport_enc,updated_at) VALUES ($1,$2,$3,$4) ON CONFLICT(student_id) DO UPDATE SET snils_enc=EXCLUDED.snils_enc,passport_enc=EXCLUDED.passport_enc,updated_at=EXCLUDED.updated_at', [owner, encryptPii(c.snils), encryptPii(c.passport), now.toISOString()]);
    }

    // Предстоящие мероприятия: афиши, уровень, баллы, программа.
    for (const [i, u] of UPCOMING.entries()) {
      await tx.query('UPDATE events SET poster=$2,level=$3,points=$4,program=$5,completed_at=NULL WHERE id=$1', [stableId(`event:${i}`), `/img/events/e${i}.svg`, u.level, LEVEL_POINTS[u.level], u.program]);
    }

    // Прошедшие мероприятия, начисления и портфолио.
    for (const e of PAST) {
      const id = stableId(`event:${e.key}`);
      await tx.query('INSERT INTO events(id,title,organizer,place,starts_at,category,description,capacity,poster,level,points,program,completed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,starts_at=EXCLUDED.starts_at,description=EXCLUDED.description,poster=EXCLUDED.poster,level=EXCLUDED.level,points=EXCLUDED.points,completed_at=EXCLUDED.completed_at',
        [id, e.title, e.organizer, e.place, at(e.days, e.h), e.category, e.description, e.capacity, `/img/events/${e.key}.svg`, e.level, LEVEL_POINTS[e.level], '', at(e.days, e.h + 3)]);
      for (const [index, role] of e.results) {
        const owner = studentId(DEMO_STUDENTS[index]!.login), pts = award(LEVEL_POINTS[e.level]!, role);
        await tx.query('INSERT INTO event_registrations(event_id,student_id,created_at,role,awarded) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(event_id,student_id) DO UPDATE SET role=EXCLUDED.role,awarded=EXCLUDED.awarded', [id, owner, at(e.days - 5), role, pts]);
        const place = role.startsWith('prize') ? Number(role.slice(5)) : null;
        const kind = role === 'organizer' ? 'organization' : place ? 'prize' : 'participation';
        const text = kind === 'organization' ? 'Организатор' : place ? `${place} место` : 'Участник';
        await tx.query('INSERT INTO portfolio_items(id,student_id,event_id,kind,place,title,description,points,earned_on,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(student_id,event_id) DO UPDATE SET kind=EXCLUDED.kind,place=EXCLUDED.place,title=EXCLUDED.title,description=EXCLUDED.description,points=EXCLUDED.points,earned_on=EXCLUDED.earned_on',
          [stableId(`portfolio:${owner}:${e.key}`), owner, id, kind, place, e.title, `${text}. ${e.organizer}, ${e.place}.`, pts, at(e.days, e.h).slice(0, 10), at(e.days, e.h + 3)]);
      }
    }

    // Новости с картинками.
    const news = [
      { i: 0, img: 'n0' }, { i: 1, img: 'n1' }, { i: 2, img: 'n2' },
      { i: 3, img: 'n3', title: 'Итоги хакатона «Цифровой деканат»', body: 'Победители получили баллы за внеучебную деятельность и запись в портфолио. Работы финалистов можно посмотреть в разделе «События».', days: -11 },
      { i: 4, img: 'n4', title: 'В библиотеке новые учебники', body: 'В каталоге появились издания по экономике, туризму и цифровым навыкам. Книгу можно забронировать в разделе «Библиотека» и забрать на абонементе.', days: -9 },
    ];
    for (const n of news) {
      const id = stableId(`announcement:v2:${n.i}`);
      if (n.title) await tx.query('INSERT INTO announcements(id,title,body,audience,created_by,created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,body=EXCLUDED.body', [id, n.title, n.body, 'all', STAFF_ID, at(n.days!, 10)]);
      await tx.query('UPDATE announcements SET image=$2 WHERE id=$1', [id, `/img/news/${n.img}.svg`]);
    }

    // Библиотека.
    for (const [i, b] of BOOKS.entries()) {
      await tx.query('INSERT INTO books(id,title,authors,year,category,kind,description,pages,shelf,cover,copies) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,authors=EXCLUDED.authors,year=EXCLUDED.year,category=EXCLUDED.category,kind=EXCLUDED.kind,description=EXCLUDED.description,pages=EXCLUDED.pages,shelf=EXCLUDED.shelf,cover=EXCLUDED.cover,copies=EXCLUDED.copies', [stableId(`book:${i}`), ...b.slice(0, 8), `/img/books/b${i}.svg`, b[8]]);
    }
    await tx.query('INSERT INTO book_reservations(book_id,student_id,created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [stableId('book:7'), studentId(DEMO_STUDENTS[0].login), at(-1)]);
  });
}
