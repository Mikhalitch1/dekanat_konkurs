import { useState, type FormEvent } from 'react';
import { ApiError, api, type EventRole, type StaffEvent } from '../api';
import { Icon } from '../icons';
import { fmtDateTime } from '../format';
import { Chip, Empty, PageHead, Screen, go, useLoad, useRoute } from '../ui';
import { LEVEL, ROLE, num } from './Life';

const ROLES: EventRole[] = ['absent', 'participant', 'organizer', 'prize3', 'prize2', 'prize1'];

function Create({ posters, onDone }: { posters: string[]; onDone: () => void }) {
  const [f, setF] = useState({ title: '', organizer: '', place: '', date: '', time: '18:00', category: 'Наука', description: '', program: '', capacity: '40', level: 'faculty', poster: '' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function save(e: FormEvent) {
    e.preventDefault(); setError('');
    if (!f.date) { setError('Укажите дату мероприятия.'); return; }
    setBusy(true);
    try {
      await api('/staff/events', { method: 'POST', body: { title: f.title, organizer: f.organizer, place: f.place, starts_at: `${f.date}T${f.time}:00+03:00`, category: f.category, description: f.description, program: f.program, capacity: Number(f.capacity), level: f.level, poster: f.poster || undefined } });
      onDone();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Не удалось создать.'); }
    finally { setBusy(false); }
  }
  return <form className="form block" onSubmit={(e) => void save(e)} noValidate>
    <div className="field"><label htmlFor="ev-t">Название</label><input id="ev-t" value={f.title} onChange={set('title')} maxLength={120} /></div>
    <div className="field"><label htmlFor="ev-o">Организатор</label><input id="ev-o" value={f.organizer} onChange={set('organizer')} maxLength={120} /></div>
    <div className="field"><label htmlFor="ev-p">Место</label><input id="ev-p" value={f.place} onChange={set('place')} maxLength={120} /></div>
    <div className="row2"><div className="field"><label htmlFor="ev-d">Дата</label><input id="ev-d" type="date" value={f.date} onChange={set('date')} /></div><div className="field"><label htmlFor="ev-h">Время</label><input id="ev-h" type="time" value={f.time} onChange={set('time')} /></div></div>
    <div className="row2"><div className="field"><label htmlFor="ev-l">Уровень</label><select id="ev-l" value={f.level} onChange={set('level')}>{Object.entries(LEVEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      <div className="field"><label htmlFor="ev-c">Категория</label><input id="ev-c" value={f.category} onChange={set('category')} maxLength={30} /></div></div>
    <div className="field narrow"><label htmlFor="ev-n">Мест</label><input id="ev-n" inputMode="numeric" value={f.capacity} onChange={set('capacity')} /></div>
    <div className="field"><label htmlFor="ev-s">Описание</label><textarea id="ev-s" rows={3} value={f.description} onChange={set('description')} maxLength={1000} /></div>
    <div className="field"><label htmlFor="ev-r">Программа</label><textarea id="ev-r" rows={3} value={f.program} onChange={set('program')} maxLength={1000} /></div>
    <fieldset className="field"><legend>Афиша</legend><div className="pickers">{['', ...posters].map((p) => <button key={p || 'auto'} type="button" role="radio" aria-checked={f.poster === p} aria-label={p ? `Афиша ${Number(p.replace(/\D/g, '')) + 1}` : 'Афиша подобрать автоматически'} className={`picker${f.poster === p ? ' is-on' : ''}`} onClick={() => setF({ ...f, poster: p })}>{p ? <img src={p} alt="" width={160} height={90} /> : <span>Авто</span>}</button>)}</div></fieldset>
    {error && <p className="field-error" role="alert">{error}</p>}
    <button className="btn" type="submit" disabled={busy}>{busy ? 'Создаём…' : 'Создать мероприятие'}</button>
  </form>;
}

function CreateScreen() {
  const load = useLoad<{ posters: string[] }>('/staff/events');
  return <>
    <PageHead title="Новое мероприятие" back="#/staff/events" />
    <Screen load={load} skeleton={3}>{({ posters }) => <Create posters={posters} onDone={() => go('/staff/events')} />}</Screen>
  </>;
}

function List() {
  const load = useLoad<{ events: StaffEvent[]; posters: string[] }>('/staff/events');
  return <>
    <PageHead title="События" action={<a className="btn compact" href="#/staff/events/new" aria-label="Создать мероприятие"><Icon name="plus" size={18} />Создать</a>} />
    <Screen load={load} skeleton={3}>{({ events }) => <>
      {events.length ? <ul className="plain cardlist">{events.map((e) => <li key={e.id}><a className="menurow" href={`#/staff/events/${e.id}`}>
        <img className="thumb" src={e.poster} alt="" width={96} height={54} /><span><strong>{e.title}</strong><span className="muted">{fmtDateTime(e.starts_at)} · записано {e.registered} из {e.capacity}</span></span>
        {e.completed_at ? <Chip tone="ok" icon="check">Итоги</Chip> : <Chip tone="warn" icon="clock">Идёт набор</Chip>}</a></li>)}</ul> : <Empty icon="people" title="Мероприятий нет" />}
    </>}</Screen>
  </>;
}

function Complete({ id }: { id: string }) {
  const load = useLoad<{ event: { id: string; title: string; organizer: string; category: string; description: string; program: string; poster: string; capacity: number; starts_at: string; place: string; level: string; points: number; completed_at: string | null }; people: { student_id: string; full_name: string; group_name: string; role: EventRole | null; awarded: number | null }[] }>(`/staff/events/${id}`);
  const [roles, setRoles] = useState<Record<string, EventRole>>({});
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [done, setDone] = useState(false);
  async function save() {
    if (!load.data) return;
    setBusy(true); setError('');
    try {
      await api(`/staff/events/${id}/complete`, { method: 'POST', body: { results: load.data.people.map((p) => ({ student_id: p.student_id, role: roles[p.student_id] ?? 'participant' })) } });
      setDone(true); load.reload();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Не удалось начислить баллы.'); }
    finally { setBusy(false); }
  }
  return <>
    <PageHead title={load.data ? load.data.event.title : 'Мероприятие'} back="#/staff/events" />
    <Screen load={load} skeleton={3}>{({ event, people }) => <>
      <img className="poster" src={event.poster} alt={`Афиша: ${event.title}`} width={800} height={450} />
      <section className="block"><dl className="facts"><div><dt>Когда</dt><dd>{fmtDateTime(event.starts_at)}</dd></div><div><dt>Где</dt><dd>{event.place}</dd></div><div><dt>Организатор</dt><dd>{event.organizer}</dd></div><div><dt>Записано</dt><dd>{people.length} из {event.capacity}</dd></div></dl>
        <p>{event.description}</p>{event.program && <p className="muted">{event.program}</p>}</section>
      <section className="block"><h2>Участники и баллы</h2>
      <p className="muted">{fmtDateTime(event.starts_at)} · {event.place} · {LEVEL[event.level]}, базовый балл {num(event.points)}</p>
      {event.completed_at ? <p className="success"><Icon name="check" size={18} />Мероприятие завершено, баллы начислены.</p> : <p className="muted">Выберите роль каждого записавшегося. Баллы и достижение в портфолио появятся у студента сразу.</p>}
      {people.length ? <ul className="plain">{people.map((p) => <li key={p.student_id} className="rolerow">
        <div><strong>{p.full_name}</strong><span className="muted">{p.group_name}</span></div>
        {event.completed_at ? <Chip tone={p.role && p.role !== 'absent' ? 'ok' : 'info'} icon="check">{p.role ? `${ROLE[p.role]}${p.awarded ? ` · +${num(p.awarded)}` : ''}` : '—'}</Chip>
          : <><label className="sr" htmlFor={`r-${p.student_id}`}>Роль: {p.full_name}</label><select id={`r-${p.student_id}`} value={roles[p.student_id] ?? 'participant'} onChange={(e) => setRoles({ ...roles, [p.student_id]: e.target.value as EventRole })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}</select></>}
      </li>)}</ul> : <Empty icon="people" title="Никто не записался" text="Начислять баллы пока некому." />}
      {error && <p className="field-error" role="alert">{error}</p>}
      {done && <p className="success" role="status"><Icon name="check" size={18} />Готово. Студенты получили уведомления.</p>}
      {!event.completed_at && people.length > 0 && <button type="button" className="btn" disabled={busy} onClick={() => void save()}>{busy ? 'Начисляем…' : 'Завершить и начислить баллы'}</button>}
    </section></>}</Screen>
  </>;
}

export function StaffEvents() {
  const { path } = useRoute();
  return path[2] === 'new' ? <CreateScreen /> : path[2] ? <Complete id={path[2]} /> : <List />;
}
