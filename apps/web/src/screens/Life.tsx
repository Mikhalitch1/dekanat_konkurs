import { useEffect, useState } from 'react';
import { ApiError, api, type Book, type EventItem, type EventRole, type Portfolio } from '../api';
import { Icon } from '../icons';
import { fmtDateTime, fmtDate, plural } from '../format';
import { Chip, Empty, PageHead, Screen, useLoad, useRoute } from '../ui';

export const LEVEL: Record<string, string> = { club: 'Клубное', faculty: 'Факультетское', university: 'Вузовское', interuniversity: 'Межвузовское' };
export const ROLE: Record<EventRole, string> = { participant: 'Участник', organizer: 'Организатор', prize1: '1 место', prize2: '2 место', prize3: '3 место', absent: 'Не явился' };
const FACTOR = { participant: 1, organizer: 1.5, prize3: 1.5, prize2: 2, prize1: 2.5 };
const pts = (base: number, f: number) => Math.round(base * f * 2) / 2;
export const num = (n: number) => String(n).replace('.', ',');

function Poster({ src, alt = '' }: { src: string; alt?: string }) {
  return <img className="poster" src={src || '/img/events/e0.svg'} alt={alt} width={800} height={450} loading="lazy" />;
}

function EventState({ e, now }: { e: EventItem; now: Date }) {
  if (e.completed_at) return e.my_role && e.my_role !== 'absent' ? <Chip tone="ok" icon="check">{ROLE[e.my_role]} · +{num(e.my_awarded ?? 0)}</Chip> : <Chip tone="info" icon="clock">Завершено</Chip>;
  if (new Date(e.starts_at) < now) return <Chip tone="warn" icon="clock">Ждём итоги</Chip>;
  return e.joined ? <Chip tone="ok" icon="check">Вы записаны</Chip> : e.capacity - e.registered <= 0 ? <Chip tone="risk" icon="x">Мест нет</Chip> : <Chip tone="info" icon="clock">{e.capacity - e.registered} мест</Chip>;
}

function useJoin(reload: () => void) {
  const [busy, setBusy] = useState<string | null>(null); const [error, setError] = useState('');
  async function toggle(e: EventItem) {
    setBusy(e.id); setError('');
    try { await api(`/events/${e.id}/${e.joined ? 'leave' : 'join'}`, { method: 'POST' }); reload(); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Не получилось записаться.'); }
    finally { setBusy(null); }
  }
  return { busy, error, toggle };
}

function JoinButton({ e, now, busy, onClick, wide = false }: { e: EventItem; now: Date; busy: boolean; onClick: () => void; wide?: boolean }) {
  if (e.completed_at || new Date(e.starts_at) < now) return null;
  const full = !e.joined && e.capacity - e.registered <= 0;
  return <button type="button" className={`btn${e.joined ? ' secondary' : ''}${wide ? '' : ' compact'}`} disabled={busy || full} onClick={onClick}>{e.joined ? 'Отменить запись' : 'Участвовать'}</button>;
}

function Detail({ id }: { id: string }) {
  const load = useLoad<{ event: EventItem; now: string }>(`/events/${id}`);
  const join = useJoin(load.reload);
  return <>
    <PageHead title={load.data ? load.data.event.title : 'Мероприятие'} back="#/events" />
    <Screen load={load} skeleton={3}>{({ event: e, now }) => {
      const n = new Date(now);
      return <>
        <Poster src={e.poster} alt={`Афиша: ${e.title}`} />
        <div className="chiprow"><Chip tone="info" icon="spark">{e.category}</Chip><Chip tone="info" icon="people">{LEVEL[e.level]}</Chip><EventState e={e} now={n} /></div>
        <section className="block"><dl className="facts">
          <div><dt>Когда</dt><dd>{fmtDateTime(e.starts_at)}</dd></div><div><dt>Где</dt><dd>{e.place}</dd></div>
          <div><dt>Организатор</dt><dd>{e.organizer}</dd></div><div><dt>Места</dt><dd>{e.registered} из {e.capacity}</dd></div></dl>
          <p>{e.description}</p>
          {join.error && <p className="field-error" role="alert">{join.error}</p>}
          <JoinButton e={e} now={n} busy={join.busy === e.id} onClick={() => void join.toggle(e)} wide />
        </section>
        {e.program && <section className="block"><h2>Программа</h2><p>{e.program}</p></section>}
        <section className="block"><h2>Баллы за внеучебную деятельность</h2>
          <ul className="plain"><li className="rowlink static"><span>Участие</span><strong>+{num(pts(e.points, FACTOR.participant))}</strong></li>
            <li className="rowlink static"><span>Организация</span><strong>+{num(pts(e.points, FACTOR.organizer))}</strong></li>
            <li className="rowlink static"><span>Призовое место</span><strong>до +{num(pts(e.points, FACTOR.prize1))}</strong></li></ul>
          <p className="muted">Баллы начисляются после мероприятия, а достижение появляется в портфолио.</p></section>
      </>;
    }}</Screen>
  </>;
}

export function EventsScreen() {
  const { path } = useRoute();
  if (path[1]) return <Detail id={path[1]} />;
  return <EventList />;
}

function EventList() {
  const load = useLoad<{ events: EventItem[]; now: string }>('/events');
  const [tab, setTab] = useState<'up' | 'past'>('up');
  const join = useJoin(load.reload);
  return <>
    <PageHead title="События" />
    <div className="seg" role="radiogroup" aria-label="Показать"><button type="button" role="radio" aria-checked={tab === 'up'} className={tab === 'up' ? 'is-on' : ''} onClick={() => setTab('up')}>Предстоящие</button><button type="button" role="radio" aria-checked={tab === 'past'} className={tab === 'past' ? 'is-on' : ''} onClick={() => setTab('past')}>Прошедшие</button></div>
    {join.error && <p className="field-error" role="alert">{join.error}</p>}
    <Screen load={load} skeleton={3}>{({ events, now }) => {
      const n = new Date(now);
      const list = events.filter((e) => (tab === 'past') === Boolean(e.completed_at));
      return list.length ? <ul className="plain cardlist events">{list.map((e) => <li key={e.id} className="eventcard">
        <a href={`#/events/${e.id}`} className="eventlink"><Poster src={e.poster} alt={`Афиша: ${e.title}`} />
          <div className="eventbody"><div className="chiprow"><Chip tone="info" icon="spark">{e.category}</Chip><EventState e={e} now={n} /></div>
            <h3>{e.title}</h3><p className="muted">{fmtDateTime(e.starts_at)} · {e.place}</p></div></a>
        <div className="eventfoot"><span className="muted">{LEVEL[e.level]} · до +{num(pts(e.points, FACTOR.prize1))} баллов</span><JoinButton e={e} now={n} busy={join.busy === e.id} onClick={() => void join.toggle(e)} /></div>
      </li>)}</ul> : <Empty icon="people" title={tab === 'up' ? 'Новых мероприятий пока нет' : 'Прошедших мероприятий нет'} text={tab === 'up' ? 'Загляните позже: деканат и клубы добавляют их заранее.' : undefined} />;
    }}</Screen>
  </>;
}

const KIND_ICON = { participation: 'check', organization: 'people', prize: 'spark' } as const;
const KIND_LABEL = { participation: 'Участие', organization: 'Организация', prize: 'Призовое место' } as const;

export function PortfolioScreen() {
  const load = useLoad<Portfolio>('/portfolio');
  return <>
    <PageHead title="Портфолио" back="#/more" />
    <Screen load={load} skeleton={4}>{({ items, summary: s }) => <>
      <section className="summary" aria-label="Итоги">
        <div className="stat stat-lead"><span className="muted">Баллы за внеучебную деятельность</span><strong>{num(s.points)} <span className="of">из {s.cap}</span></strong>
          <progress className="meter meter-light" value={s.points} max={s.cap} aria-label={`${num(s.points)} из ${s.cap}`} />
          {s.raw_points > s.cap && <span>Набрано {num(s.raw_points)}, в рейтинг идёт максимум {s.cap}</span>}</div>
        <div className="stat"><span className="muted">Участие</span><strong>{s.participation}</strong></div>
        <div className="stat"><span className="muted">Организация</span><strong>{s.organization}</strong></div>
        <div className="stat"><span className="muted">Призовые места</span><strong>{s.prizes}</strong></div>
      </section>
      <section className="block"><h2>Достижения</h2>
        {items.length ? <ul className="plain">{items.map((i) => <li key={i.id}><a className="achieve" href={i.event_id ? `#/events/${i.event_id}` : '#/portfolio'}>
          <span className={`menu-icon kind-${i.kind}`}><Icon name={KIND_ICON[i.kind]} /></span>
          <span><strong>{i.title}</strong><span>{KIND_LABEL[i.kind]}{i.place ? `, ${i.place} место` : ''}</span><span className="muted">{fmtDate(i.earned_on)}</span></span>
          <Chip tone="ok" icon="check">+{num(i.points)}</Chip></a></li>)}</ul>
          : <Empty icon="spark" title="Пока пусто" text="Запишитесь на мероприятие — после него здесь появится достижение."><a className="btn" href="#/events">Смотреть события</a></Empty>}
        <details className="how"><summary>Как начисляются баллы</summary>
          <p>Базовый балл зависит от уровня: клубное 0,5, факультетское 1, вузовское 1,5, межвузовское 2. Затем умножаем: участие ×1, организация ×1,5, 3 место ×1,5, 2 место ×2, 1 место ×2,5. В рейтинг идёт не больше {s.cap} баллов. Правила условные, это концепт.</p></details>
      </section>
    </>}</Screen>
  </>;
}

export function LibraryScreen() {
  const [q, setQ] = useState(''); const [debounced, setDebounced] = useState(''); const [category, setCategory] = useState('');
  useEffect(() => { const id = window.setTimeout(() => setDebounced(q.trim()), 250); return () => window.clearTimeout(id); }, [q]);
  const load = useLoad<{ books: Book[]; categories: string[] }>(`/library?q=${encodeURIComponent(debounced)}&category=${encodeURIComponent(category)}`);
  const [open, setOpen] = useState<string | null>(null); const [busy, setBusy] = useState<string | null>(null); const [error, setError] = useState('');
  async function toggle(b: Book) {
    setBusy(b.id); setError('');
    try { await api(`/library/${b.id}/${b.reserved ? 'cancel' : 'reserve'}`, { method: 'POST' }); load.reload(); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Не получилось забронировать.'); }
    finally { setBusy(null); }
  }
  return <>
    <PageHead title="Библиотека" back="#/more" />
    <div className="field"><label htmlFor="lq">Поиск</label><input id="lq" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название или автор" maxLength={80} autoComplete="off" /></div>
    {load.data && <div className="cats" role="radiogroup" aria-label="Раздел">{['', ...load.data.categories].map((c) => <button key={c || 'all'} type="button" role="radio" aria-checked={category === c} className={`catchip${category === c ? ' is-on' : ''}`} onClick={() => setCategory(c)}>{c || 'Все'}</button>)}</div>}
    {error && <p className="field-error" role="alert">{error}</p>}
    <Screen load={load} skeleton={4}>{({ books }) => books.length ? <ul className="plain cardlist">{books.map((b) => <li key={b.id} className="book">
      <div className="book-top"><img className="cover" src={b.cover} alt="" width={300} height={420} loading="lazy" />
        <div className="book-info"><h3>{b.title}</h3><p className="muted">{b.authors}, {b.year}</p>
          <div className="chiprow"><Chip tone="info" icon="doc">{b.category}</Chip>{b.reserved ? <Chip tone="ok" icon="check">Забронирована</Chip> : b.available > 0 ? <Chip tone="ok" icon="check">В наличии: {b.available}</Chip> : <Chip tone="risk" icon="x">Нет в наличии</Chip>}</div></div></div>
      {open === b.id && <div className="book-more"><p>{b.description}</p><dl className="facts"><div><dt>Издание</dt><dd>{b.kind}, {b.pages} {plural(b.pages, 'страница', 'страницы', 'страниц')}</dd></div><div><dt>Где взять</dt><dd>{b.shelf}</dd></div></dl></div>}
      <div className="eventfoot"><button type="button" className="btn secondary compact" aria-expanded={open === b.id} onClick={() => setOpen(open === b.id ? null : b.id)}>{open === b.id ? 'Свернуть' : 'Подробнее'}</button>
        <button type="button" className={`btn compact${b.reserved ? ' secondary' : ''}`} disabled={busy === b.id || (!b.reserved && b.available <= 0)} onClick={() => void toggle(b)}>{b.reserved ? 'Отменить бронь' : 'Забронировать'}</button></div>
    </li>)}</ul> : <Empty icon="doc" title="Ничего не нашли" text="Попробуйте другое слово или выберите раздел «Все»." />}</Screen>
  </>;
}
