import { z } from 'zod';

/**
 * Помощник деканата. Получает только данные текущего студента (из сессии),
 * без ФИО, логина и номеров документов. Ключ модели живёт только в окружении сервера.
 */
export interface AssistantContext {
  firstName: string;
  course: number;
  group: string;
  program: string;
  today: string;
  lessons: { day: string; time: string; title: string; room: string | null; teacher: string | null; change: string | null }[];
  progress: { discipline: string; form: string; points: number; attendance: number; status: string; advice: string }[];
  requests: { title: string; status: string; number: number | null }[];
  keyDates: { title: string; from: string; to: string | null }[];
  requestTypes: { code: string; title: string }[];
  rating: { place: number | null; total: number | null };
}
export type AssistantAction =
  | { type: 'create_request'; code: string; purpose: string; comment: string }
  | { type: 'open'; tab: 'today' | 'schedule' | 'grades' | 'requests' | 'events' };
export interface AssistantReply { reply: string; action: AssistantAction | null; source: 'model' | 'local' }

export const RULES = `Правила деканата (условные правила конкурсного концепта):
- Итоговый балл по дисциплине = до 60 баллов за семестр + до 40 на экзамене или зачёте.
- Допуск к экзамену: не меньше 30 семестровых баллов и посещаемость не ниже 70%.
- Оценки: 85–100 — отлично, 70–84 — хорошо, 50–69 — удовлетворительно.
- Недостающие баллы можно добрать на консультации преподавателя или переписав контрольную по заявлению на пересдачу.
- Справка об обучении формируется сразу и проверяется по QR-коду. Справка-вызов готовится 3 рабочих дня, выписка оценок — 5.
- Академический отпуск: заявление в кабинете, затем деканат запрашивает подтверждающие документы.
- Пропуск по болезни закрывается справкой в течение 3 дней после выздоровления — загрузить её можно в разделе «Заявки» комментарием к заявке.
- Деканат работает пн–пт 10:00–17:00, ауд. 112.`;

const actionSchema = z.union([
  z.object({ type: z.literal('create_request'), code: z.string().max(30), purpose: z.string().max(200).default(''), comment: z.string().max(500).default('') }),
  z.object({ type: z.literal('open'), tab: z.enum(['today', 'schedule', 'grades', 'requests', 'events']) }),
  z.null(),
]);
const modelReply = z.object({ reply: z.string().min(1).max(2000), action: actionSchema.optional().default(null) });

export interface HistoryItem { role: 'user' | 'assistant'; text: string }

function systemPrompt(ctx: AssistantContext): string {
  return `Ты — помощник деканата в личном кабинете студента. Отвечай по-русски, коротко (до 4 предложений), дружелюбно и по делу, обращайся на «ты».
Используй только данные ниже. Если данных нет — честно скажи и подскажи, где посмотреть. Не выдумывай пары, оценки и даты.
Ты видишь данные только этого студента. На вопросы о других студентах отвечай, что такие данные недоступны.
Если студенту нужна справка или заявление — предложи действие create_request с кодом из списка типов; студент сам подтвердит отправку.
Если ответ лучше посмотреть в разделе — можно предложить действие open.
Верни строго JSON: {"reply": "текст", "action": null | {"type":"create_request","code":"...","purpose":"...","comment":"..."} | {"type":"open","tab":"today|schedule|grades|requests|events"}}

${RULES}

Данные студента (${ctx.today}):
${JSON.stringify({ ...ctx, firstName: undefined }, null, 0)}`;
}

export async function askModel(ctx: AssistantContext, message: string, history: HistoryItem[], env = process.env): Promise<AssistantReply | null> {
  const key = env.OPENROUTER_API_KEY;
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Digital dean office concept' },
      body: JSON.stringify({
        model: env.OPENROUTER_MODEL || 'google/gemini-2.5-flash',
        temperature: 0.3,
        max_tokens: 600,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt(ctx) },
          ...history.slice(-6).map((h) => ({ role: h.role, content: h.text })),
          { role: 'user', content: message },
        ],
      }),
    });
    if (!response.ok) return null;
    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? '';
    const json = content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1);
    const parsed = modelReply.safeParse(JSON.parse(json));
    if (!parsed.success) return null;
    const proposed = parsed.data.action;
    const action = proposed?.type === 'create_request' && !ctx.requestTypes.some((t) => t.code === proposed.code) ? null : proposed;
    return { reply: parsed.data.reply, action, source: 'model' };
  } catch {
    return null;
  } finally { clearTimeout(timer); }
}

const has = (text: string, ...words: string[]) => words.some((w) => text.includes(w));

/** Запасной режим без модели: отвечает на частые вопросы по тем же данным. */
export function localAnswer(ctx: AssistantContext, message: string): AssistantReply {
  const q = message.toLowerCase();
  const reply = (text: string, action: AssistantAction | null = null): AssistantReply => ({ reply: text, action, source: 'local' });
  const other = /артём|артем|лин[аеуы]|друг|однокурсник|чуж/u.test(q) && has(q, 'оценк', 'балл', 'расписан', 'заявк');
  if (other) return reply('Я вижу только твои данные — информация о других студентах недоступна.');
  if (has(q, 'справк')) {
    const type = has(q, 'вызов') ? 'call' : has(q, 'стипенд') ? 'stipend' : has(q, 'выписк', 'оценк') ? 'transcript' : 'study';
    const purpose = has(q, 'военкомат') ? 'В военкомат' : has(q, 'виз') ? 'Для визы' : has(q, 'соцзащит') ? 'В соцзащиту' : 'По месту требования';
    const title = ctx.requestTypes.find((t) => t.code === type)?.title ?? 'Справка';
    return reply(type === 'study' ? `Справку об обучении можно получить сразу, с QR-кодом для проверки. Заполнил заявку — проверь и отправь.` : `Подготовил заявку «${title}». Проверь и отправь — статус появится в разделе «Заявки».`, { type: 'create_request', code: type, purpose, comment: '' });
  }
  if (has(q, 'пересда')) return reply('Пересдачу оформляют заявлением. Я его подготовил — допиши дисциплину и отправь.', { type: 'create_request', code: 'retake', purpose: '', comment: '' });
  if (has(q, 'академ')) return reply('Академический отпуск оформляется заявлением, потом деканат запросит документы. Подготовил заявление.', { type: 'create_request', code: 'leave', purpose: '', comment: '' });
  if (has(q, 'допуск', 'риск', 'недобор', 'хвост', 'как у меня', 'дела')) {
    const risky = ctx.progress.filter((p) => p.status !== 'ok');
    if (!risky.length) return reply('По всем дисциплинам допуск к сессии уже есть. Так держать!', { type: 'open', tab: 'grades' });
    return reply(risky.map((p) => `${p.discipline}: ${p.advice}`).join(' '), { type: 'open', tab: 'grades' });
  }
  if (has(q, 'пропуст', 'посещ')) {
    const low = [...ctx.progress].sort((a, b) => a.attendance - b.attendance)[0];
    return reply(low ? `Ниже всего посещаемость по дисциплине «${low.discipline}» — ${low.attendance}%. Для допуска нужно не меньше 70%.` : 'Данных о посещаемости пока нет.', { type: 'open', tab: 'grades' });
  }
  if (has(q, 'рейтинг', 'место')) return reply(ctx.rating.place ? `Ты на ${ctx.rating.place}-м месте из ${ctx.rating.total} на курсе.` : 'Рейтинг пока не рассчитан.', { type: 'open', tab: 'grades' });
  if (has(q, 'балл', 'оценк')) {
    const top = ctx.progress.slice(0, 4).map((p) => `${p.discipline} — ${p.points} из 60`).join('; ');
    return reply(top ? `Семестровые баллы: ${top}.` : 'Оценок пока нет.', { type: 'open', tab: 'grades' });
  }
  if (has(q, 'сесси', 'экзамен', 'срез', 'зачётн', 'зачетн', 'каникул', 'дедлайн', 'когда')) {
    const next = ctx.keyDates.slice(0, 3).map((d) => `${d.title} — ${d.from}${d.to ? `…${d.to}` : ''}`).join('; ');
    return reply(next ? `Ближайшие даты: ${next}.` : 'Важных дат пока нет.');
  }
  if (has(q, 'заявк', 'статус')) {
    const list = ctx.requests.slice(0, 3).map((r) => `«${r.title}» — ${r.status}`).join('; ');
    return reply(list ? `Твои заявки: ${list}.` : 'Активных заявок нет.', { type: 'open', tab: 'requests' });
  }
  if (has(q, 'пара', 'пары', 'занят', 'расписан', 'аудитор', 'завтра', 'сегодня', 'препод', 'замен')) {
    const day = has(q, 'завтра') ? ctx.lessons.filter((l) => l.day !== ctx.today) : ctx.lessons;
    const first = day[0];
    if (!first) return reply('На ближайшие дни занятий нет.', { type: 'open', tab: 'schedule' });
    const sameDay = day.filter((l) => l.day === first.day);
    return reply(`${first.day === ctx.today ? 'Сегодня' : first.day}: ${sameDay.map((l) => `${l.time} ${l.title}${l.room ? `, ауд. ${l.room}` : ''}${l.change ? ` (${l.change})` : ''}`).join('; ')}.`, { type: 'open', tab: 'schedule' });
  }
  if (has(q, 'мероприят', 'клуб', 'ивент', 'событ')) return reply('Мероприятия и клубы собраны в разделе «Ещё» → «Мероприятия». Записаться можно в одно касание.', { type: 'open', tab: 'events' });
  if (has(q, 'деканат', 'часы', 'работает')) return reply('Деканат работает пн–пт с 10:00 до 17:00, ауд. 112. Большинство вопросов можно решить здесь, без визита.');
  return reply('Могу подсказать расписание, баллы и допуск к сессии, важные даты, статус заявок или оформить справку. Спроси, например: «Когда у меня завтра первая пара?»');
}
