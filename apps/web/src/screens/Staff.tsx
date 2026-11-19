import { useState, type FormEvent } from 'react';
import { ApiError, api, type Announcement, type Lesson, type RequestStatus, type StaffGroup, type StaffRequest } from '../api';
import { Icon } from '../icons';
import { capital, fmtDayLong, fmtStamp } from '../format';
import { Empty, LessonItem, PageHead, Screen, STATUS, StatusChip, go, useLoad, useRoute } from '../ui';

const ORDER: RequestStatus[] = ['submitted', 'accepted', 'in_progress', 'ready', 'issued', 'rejected'];
const ACTIVE = new Set<RequestStatus>(['submitted', 'accepted', 'in_progress']);

function RequestRow({ r, onDone }: { r: StaffRequest; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<RequestStatus>(r.status);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { await api(`/staff/requests/${r.id}/status`, { method: 'POST', body: { status, comment } }); setOpen(false); setComment(''); onDone(); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Не удалось сохранить.'); }
    finally { setBusy(false); }
  }
  return <li className="staffrow">
    <button type="button" className="study-head" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="study-main"><strong>{r.title}</strong><span className="muted">№{r.number} · {r.full_name} · {r.group_name}</span></span>
      <StatusChip status={r.status} /><Icon name="chevron" size={18} />
    </button>
    {open && <form className="form" onSubmit={(e) => void save(e)}>
      <p className="muted">Подана {fmtStamp(r.created_at)}{r.purpose ? ` · для: ${r.purpose}` : ''}</p>
      {r.comment && <p>Комментарий студента: {r.comment}</p>}
      <fieldset className="field"><legend>Новый статус</legend>
        <div className="seg wrap" role="radiogroup" aria-label="Новый статус">{ORDER.map((s) => <button key={s} type="button" role="radio" aria-checked={status === s} className={status === s ? 'is-on' : ''} onClick={() => setStatus(s)}>{STATUS[s].label}</button>)}</div></fieldset>
      <div className="field"><label htmlFor={`c-${r.id}`}>Комментарий студенту</label><textarea id={`c-${r.id}`} rows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например: заберите справку в кабинете 112" /></div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <button className="btn" type="submit" disabled={busy || (status === r.status && !comment.trim())}>{busy ? 'Сохраняем…' : 'Сохранить и уведомить студента'}</button>
    </form>}
  </li>;
}

export function StaffRequests() {
  const load = useLoad<{ requests: StaffRequest[] }>('/staff/requests');
  const [all, setAll] = useState(false);
  return <>
    <PageHead title="Очередь заявок" />
    <div className="seg" role="radiogroup" aria-label="Фильтр"><button type="button" role="radio" aria-checked={!all} className={!all ? 'is-on' : ''} onClick={() => setAll(false)}>В обработке</button><button type="button" role="radio" aria-checked={all} className={all ? 'is-on' : ''} onClick={() => setAll(true)}>Все</button></div>
    <Screen load={load} skeleton={4}>{({ requests }) => {
      const list = all ? requests : requests.filter((r) => ACTIVE.has(r.status));
      return list.length ? <ul className="plain cardlist staff">{list.map((r) => <RequestRow key={`${r.id}${r.status}`} r={r} onDone={load.reload} />)}</ul>
        : <Empty icon="check" title="Очередь пуста" text="Новые заявки студентов появятся здесь." />;
    }}</Screen>
  </>;
}

function ChangeForm({ lesson, onDone }: { lesson: Lesson; onDone: () => void }) {
  const [kind, setKind] = useState<'cancelled' | 'room' | 'substitute'>('cancelled');
  const [room, setRoom] = useState(''); const [teacher, setTeacher] = useState(''); const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { await api('/staff/lesson-changes', { method: 'POST', body: { lesson_id: lesson.id, kind, new_room: kind === 'room' ? room : undefined, new_teacher: kind === 'substitute' ? teacher : undefined, note } }); onDone(); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Не удалось сохранить.'); }
    finally { setBusy(false); }
  }
  return <form className="form inline" onSubmit={(e) => void save(e)}>
    <div className="seg wrap" role="radiogroup" aria-label="Что изменилось">{([['cancelled', 'Отмена'], ['room', 'Другая аудитория'], ['substitute', 'Замена']] as const).map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={kind === v} className={kind === v ? 'is-on' : ''} onClick={() => setKind(v)}>{l}</button>)}</div>
    {kind === 'room' && <div className="field"><label htmlFor={`r-${lesson.id}`}>Новая аудитория</label><input id={`r-${lesson.id}`} value={room} maxLength={20} onChange={(e) => setRoom(e.target.value)} /></div>}
    {kind === 'substitute' && <div className="field"><label htmlFor={`t-${lesson.id}`}>Кто проведёт</label><input id={`t-${lesson.id}`} value={teacher} maxLength={80} onChange={(e) => setTeacher(e.target.value)} /></div>}
    <div className="field"><label htmlFor={`n-${lesson.id}`}>Пояснение для студентов</label><input id={`n-${lesson.id}`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></div>
    {error && <p className="field-error" role="alert">{error}</p>}
    <button className="btn" type="submit" disabled={busy}>{busy ? 'Публикуем…' : 'Опубликовать изменение'}</button>
  </form>;
}

export function StaffLessons() {
  const load = useLoad<{ groups: StaffGroup[] }>('/staff/lessons');
  const [editing, setEditing] = useState<string | null>(null);
  return <>
    <PageHead title="Изменения в расписании" />
    <Screen load={load} skeleton={4}>{({ groups }) => groups.length ? <>{groups.map((g) => <section className="block" key={g.group}><h2>{g.group}</h2>
      {g.lessons.length ? <ul className="plain">{g.lessons.map((l) => <li key={l.id} className="staffrow"><ul className="lessons"><LessonItem lesson={l} /></ul>
        <p className="muted tiny">{capital(fmtDayLong(l.date))}</p>
        {editing === l.id ? <ChangeForm lesson={l} onDone={() => { setEditing(null); load.reload(); }} /> : <button type="button" className="btn secondary compact" onClick={() => setEditing(l.id)}>Изменить занятие</button>}</li>)}</ul>
        : <p className="muted">В ближайшие дни занятий нет.</p>}</section>)}</> : <Empty icon="calendar" title="Групп нет" />}</Screen>
  </>;
}

function NewsForm() {
  const [title, setTitle] = useState(''); const [body, setBody] = useState(''); const [image, setImage] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function save(e: FormEvent) {
    e.preventDefault(); setError('');
    if (title.trim().length < 3 || body.trim().length < 3) { setError('Заполните заголовок и текст — не короче трёх символов.'); return; }
    setBusy(true);
    try { await api('/staff/announcements', { method: 'POST', body: { title: title.trim(), body: body.trim(), image: image || undefined } }); go('/staff/news'); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Не удалось опубликовать.'); }
    finally { setBusy(false); }
  }
  return <>
    <PageHead title="Новая новость" back="#/staff/news" />
    <form className="form block" onSubmit={(e) => void save(e)} noValidate>
      <div className="field"><label htmlFor="at">Заголовок</label><input id="at" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="field"><label htmlFor="ab">Текст</label><textarea id="ab" rows={5} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} /></div>
      <fieldset className="field"><legend>Картинка</legend><div className="pickers">{['', ...[0, 1, 2, 3, 4].map((i) => `/img/news/n${i}.svg`)].map((p) => <button key={p || 'none'} type="button" role="radio" aria-checked={image === p} aria-label={p ? `Картинка ${p.replace(/\D/g, '') ? Number(p.replace(/\D/g, '')) + 1 : ''}` : 'Без картинки'} className={`picker${image === p ? ' is-on' : ''}`} onClick={() => setImage(p)}>{p ? <img src={p} alt="" width={160} height={90} /> : <span>Без картинки</span>}</button>)}</div></fieldset>
      {error && <p className="field-error" role="alert">{error}</p>}
      <button className="btn" type="submit" disabled={busy}>{busy ? 'Публикуем…' : 'Опубликовать'}</button>
    </form>
  </>;
}

export function StaffNews() {
  const { path } = useRoute();
  return path[2] === 'new' ? <NewsForm /> : <NewsList />;
}

function NewsList() {
  const load = useLoad<{ announcements: Announcement[] }>('/staff/announcements');
  return <>
    <PageHead title="Новости" action={<a className="btn compact" href="#/staff/news/new" aria-label="Опубликовать новость"><Icon name="plus" size={18} />Создать</a>} />
    <Screen load={load} skeleton={3}>{({ announcements }) => announcements.length ? <ul className="plain cardlist">{announcements.map((a) => <li key={a.id} className="newscard static">
      {a.image && <img className="poster" src={a.image} alt="" width={800} height={450} loading="lazy" />}
      <div><strong>{a.title}</strong><p>{a.body}</p><span className="muted">{a.author} · {fmtStamp(a.created_at)}</span></div></li>)}</ul>
      : <Empty icon="megaphone" title="Новостей пока нет" text="Опубликуйте первую — студенты увидят её на главной и в уведомлениях."><a className="btn" href="#/staff/news/new">Создать новость</a></Empty>}</Screen>
  </>;
}
