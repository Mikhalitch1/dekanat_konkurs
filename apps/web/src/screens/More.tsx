import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api, type Account, type Contacts, type Docs, type Announcement, type AssistantAction, type AssistantReply, type Notice } from '../api';
import { Icon, type IconName } from '../icons';
import { fmtStamp } from '../format';
import { Empty, PageHead, Screen, go, useLoad } from '../ui';

export type ThemeMode = 'auto' | 'light' | 'dark';

export function MoreScreen({ unread }: { unread: number }) {
  const items: { href: string; icon: IconName; title: string; text: string; badge?: number }[] = [
    { href: '#/notifications', icon: 'bell', title: 'Уведомления и объявления', text: 'Новости деканата, изменения, дедлайны', badge: unread },
    { href: '#/assistant', icon: 'spark', title: 'Помощник', text: 'Спросите про расписание, долги или справки' },
    { href: '#/events', icon: 'people', title: 'События', text: 'Афиши, запись и баллы за участие' },
    { href: '#/portfolio', icon: 'spark', title: 'Портфолио', text: 'Достижения и внеучебные баллы' },
    { href: '#/library', icon: 'doc', title: 'Библиотека', text: 'Каталог учебников и бронь книг' },
    { href: '#/profile', icon: 'user', title: 'Профиль и настройки', text: 'Данные студента, тема, выход' },
  ];
  return <>
    <PageHead title="Ещё" />
    <ul className="plain cardlist">{items.map((i) => <li key={i.href}><a className="menurow" href={i.href}>
      <span className="menu-icon"><Icon name={i.icon} /></span><span><strong>{i.title}</strong><span className="muted">{i.text}</span></span>
      {i.badge ? <span className="count" aria-label={`${i.badge} непрочитанных`}>{i.badge}</span> : <Icon name="chevron" size={18} />}
    </a></li>)}</ul>
  </>;
}

export function NotificationsScreen({ onRead }: { onRead: () => void }) {
  const load = useLoad<{ notifications: Notice[]; announcements: Announcement[] }>('/notifications');
  const marked = useRef(false);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!load.data || marked.current) return;
    marked.current = true;
    setSeen(new Set(load.data.notifications.filter((n) => !n.read_at).map((n) => n.id)));
    void api('/notifications/read', { method: 'POST' }).then(onRead).catch(() => undefined);
  }, [load.data, onRead]);
  const ICON: Record<string, IconName> = { schedule: 'swap', request: 'doc', grades: 'study', profile: 'user', portfolio: 'spark' };
  return <>
    <PageHead title="Уведомления" back="#/more" />
    <Screen load={load} skeleton={4}>{({ notifications, announcements }) => <>
      <section className="block" aria-labelledby="n-title"><h2 id="n-title">Для вас</h2>
        {notifications.length ? <ul className="plain">{notifications.map((n) => <li key={n.id}><a className={`noticerow${seen.has(n.id) ? ' is-new' : ''}`} href={`#/${n.link === 'requests' ? 'requests' : n.link === 'schedule' ? 'schedule' : n.link === 'grades' ? 'study' : n.link === 'profile' ? 'profile' : n.link === 'portfolio' ? 'portfolio' : 'today'}`}>
          <span className="menu-icon"><Icon name={ICON[n.kind] ?? 'bell'} /></span>
          <span><strong>{n.title}{seen.has(n.id) && <span className="newtag"> новое</span>}</strong><span>{n.body}</span><span className="muted">{fmtStamp(n.created_at)}</span></span></a></li>)}</ul>
          : <Empty icon="bell" title="Уведомлений нет" text="Здесь появятся изменения расписания и статусы заявок." />}</section>
      <section className="block" aria-labelledby="a-title"><h2 id="a-title">Объявления деканата</h2>
        {announcements.length ? <ul className="plain">{announcements.map((a) => <li key={a.id} className="announce">{a.image && <img className="poster" src={a.image} alt="" width={800} height={450} loading="lazy" />}<h3>{a.title}</h3><p>{a.body}</p><p className="muted">{a.author} · {fmtStamp(a.created_at)}</p></li>)}</ul>
          : <Empty icon="megaphone" title="Объявлений нет" text="Когда деканат что-то опубликует, это появится здесь." />}</section>
    </>}</Screen>
  </>;
}

interface Msg { role: 'user' | 'assistant'; text: string; action?: AssistantAction | null; source?: 'model' | 'local' }
const TABS: Record<string, string> = { today: '/today', schedule: '/schedule', grades: '/study', requests: '/requests', events: '/events' };

export function AssistantScreen() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [messages, busy]);

  async function ask(message: string) {
    const clean = message.trim();
    if (!clean || busy) return;
    const history = messages.slice(-10).map((m) => ({ role: m.role, text: m.text.slice(0, 2000) }));
    setMessages((m) => [...m, { role: 'user', text: clean }]); setText(''); setBusy(true); setError('');
    try {
      const r = await api<AssistantReply>('/assistant', { method: 'POST', body: { message: clean, history } });
      setMessages((m) => [...m, { role: 'assistant', text: r.reply, action: r.action, source: r.source }]);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Помощник не ответил. Повторите вопрос.'); }
    finally { setBusy(false); }
  }
  const open = (a: AssistantAction) => a.type === 'open' ? go(TABS[a.tab] ?? '/today') : go(`/requests/new?type=${encodeURIComponent(a.code)}&purpose=${encodeURIComponent(a.purpose)}&comment=${encodeURIComponent(a.comment)}`);
  const chips = ['Что у меня завтра?', 'Какие у меня долги?', 'Как заказать справку?', 'Где моя заявка?'];
  return <>
    <PageHead title="Помощник" back="#/more" />
    <section className="chat" aria-label="Диалог с помощником">
      {messages.length === 0 && <div className="chat-empty"><Empty icon="spark" title="Спросите о своей учёбе" text="Например:">
        <div className="chips">{chips.map((c) => <button key={c} type="button" className="btn secondary compact" onClick={() => void ask(c)}>{c}</button>)}</div></Empty></div>}
      <ul className="bubbles" aria-live="polite">{messages.map((m, i) => <li key={i} className={`bubble bubble-${m.role}`}><p>{m.text}</p>
        {m.action && <button type="button" className="btn compact" onClick={() => open(m.action!)}>{m.action.type === 'create_request' ? 'Оформить заявку' : 'Открыть раздел'}</button>}
        {m.role === 'assistant' && <span className="muted tiny">{m.source === 'model' ? 'Ответ ИИ по вашим данным' : 'Ответ по правилам деканата'}</span>}</li>)}
        {busy && <li className="bubble bubble-assistant" aria-label="Помощник отвечает"><span className="typing"><i /><i /><i /></span></li>}</ul>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div ref={end} />
      <form className="chatform" onSubmit={(e: FormEvent) => { e.preventDefault(); void ask(text); }}>
        <label htmlFor="ask" className="sr">Ваш вопрос</label>
        <input id="ask" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder="Спросите про расписание или справки" autoComplete="off" />
        <button type="submit" className="btn" disabled={busy || !text.trim()} aria-label="Отправить"><Icon name="send" size={20} /></button>
      </form>
    </section>
  </>;
}

export function ProfileScreen({ account, theme, setTheme, onLogout, busy }: { account: Account; theme: ThemeMode; setTheme: (t: ThemeMode) => void; onLogout: () => void; busy: boolean }) {
  const p = account.profile;
  return <>
    <PageHead title="Профиль" sub={account.user.role === 'staff' ? 'Сотрудник деканата' : 'Данные студента'} back={account.user.role === 'staff' ? undefined : '#/more'} />
    <section className="block profile-id"><span className="avatar" aria-hidden="true">{account.user.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span><div><h2>{account.user.name}</h2><p className="muted">{account.user.login}</p></div></section>
    {p && <section className="block"><h2>Учёба</h2><dl className="facts">
      <div><dt>Факультет</dt><dd>{p.faculty}</dd></div><div><dt>Направление</dt><dd>{p.program}</dd></div>
      <div><dt>Курс</dt><dd>{p.course}</dd></div><div><dt>Группа</dt><dd>{p.group_name}</dd></div><div><dt>Подгруппа</dt><dd>{p.subgroup}</dd></div>
      <div><dt>Зачётная книжка</dt><dd className="mono">{p.record_book}</dd></div><div><dt>Студенческий</dt><dd className="mono">{p.student_card}</dd></div><div><dt>Почта</dt><dd>{p.email}</dd></div></dl></section>}
    {p && <ContactsBlock />}
    {p && <DocsBlock />}
    <section className="block"><h2>Оформление</h2>
      <div className="seg" role="radiogroup" aria-label="Тема оформления">{([['auto', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']] as const).map(([v, l]) =>
        <button key={v} type="button" role="radio" aria-checked={theme === v} className={theme === v ? 'is-on' : ''} onClick={() => setTheme(v)}>{l}</button>)}</div></section>
    <section className="block">
      <button type="button" className="btn secondary" onClick={onLogout} disabled={busy}><Icon name="logout" size={18} />{busy ? 'Выходим…' : 'Выйти'}</button></section>
    <p className="fineprint">Концепт для конкурса, не официальный сервис вуза. Команда проекта.</p>
  </>;
}

function ContactsBlock() {
  const load = useLoad<Contacts>('/me/contacts');
  return <Screen load={load} skeleton={2}>{(c) => <section className="block"><h2>Контакты</h2><dl className="facts">
    <div><dt>Личная почта</dt><dd>{c.personal_email || '—'}</dd></div><div><dt>Телефон</dt><dd>{c.phone || '—'}</dd></div>
    <div><dt>Дата рождения</dt><dd>{c.birth_date ? c.birth_date.split('-').reverse().join('.') : '—'}</dd></div>
    <div className="wide"><dt>Адрес регистрации</dt><dd>{c.reg_address || '—'}</dd></div><div className="wide"><dt>Адрес проживания</dt><dd>{c.live_address || '—'}</dd></div></dl></section>}</Screen>;
}

export function DocsPanel({ path, title = 'Документы' }: { path: string; title?: string }) {
  const [docs, setDocs] = useState<Docs | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { setDocs(null); setError(''); void api<Docs>(path).then(setDocs).catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Не удалось загрузить документы.')); }, [path]);
  async function reveal() {
    setBusy(true); setError('');
    try { setDocs(await api<Docs>(`${path}?reveal=1`)); } catch (e) { setError(e instanceof ApiError ? e.message : 'Не удалось показать данные.'); } finally { setBusy(false); }
  }
  return <section className="block"><div className="block-head"><h2>{title}</h2>
    {docs && (docs.revealed ? <button type="button" className="btn secondary compact" onClick={() => { setDocs(null); void api<Docs>(path).then(setDocs); }}>Скрыть</button> : <button type="button" className="btn secondary compact" disabled={busy} onClick={() => void reveal()}>Показать</button>)}</div>
    {error && <p className="field-error" role="alert">{error}</p>}
    {!docs && !error && <div className="skeleton small" role="status" aria-label="Загрузка" />}
    {docs && <dl className="facts"><div><dt>СНИЛС</dt><dd className="mono">{docs.snils}</dd></div><div><dt>Паспорт РФ</dt><dd className="mono">{docs.passport.display}</dd></div>
      {docs.revealed && <><div className="wide"><dt>Кем выдан</dt><dd>{docs.passport.issued_by}</dd></div><div><dt>Дата выдачи</dt><dd>{docs.passport.issued_on?.split('-').reverse().join('.')}</dd></div><div><dt>Код подразделения</dt><dd className="mono">{docs.passport.division_code}</dd></div></>}</dl>}
  </section>;
}

function DocsBlock() { return <DocsPanel path="/me/documents" />; }
