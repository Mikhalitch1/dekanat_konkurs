import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, type StudentBrief, type StudentCard } from '../api';
import { Icon } from '../icons';
import { fmtDate } from '../format';
import { Empty, PageHead, Screen, useLoad } from '../ui';
import { DocsPanel } from './More';

export function StaffStudents() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const id = window.setTimeout(() => setDebounced(q.trim()), 250); return () => window.clearTimeout(id); }, [q]);
  const load = useLoad<{ students: StudentBrief[] }>(`/staff/students?q=${encodeURIComponent(debounced)}`);
  return <>
    <PageHead title="Студенты" />
    <div className="field"><label htmlFor="sq">Поиск</label><input id="sq" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Фамилия, группа или зачётка" autoComplete="off" maxLength={80} /></div>
    <Screen load={load} skeleton={4}>{({ students }) => students.length ? <ul className="plain cardlist">{students.map((s) => <li key={s.id}>
      <a className="menurow" href={`#/staff/students/${s.id}`}><span className="avatar sm" aria-hidden="true">{s.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
        <span><strong>{s.full_name}</strong><span className="muted">{s.group_name} · {s.course} курс{s.record_book ? ` · зачётка ${s.record_book}` : ''}</span></span><Icon name="chevron" size={18} /></a></li>)}</ul>
      : <Empty icon="people" title="Никого не нашли" text="Проверьте написание или попробуйте номер группы." />}</Screen>
  </>;
}

function num(v: string) { return Number(v.replace(',', '.')); }

function ProfileForm({ card, onDone }: { card: StudentCard; onDone: () => void }) {
  const s = card.student;
  const [f, setF] = useState({ full_name: s.full_name, faculty: s.faculty, program: s.program, course: String(s.course), group_id: s.group_id, subgroup: s.subgroup, email: s.email, personal_email: s.personal_email, phone: s.phone, reg_address: s.reg_address, live_address: s.live_address });
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [ok, setOk] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setOk(false); };
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setOk(false);
    try { await api(`/staff/students/${s.id}/profile`, { method: 'POST', body: { ...f, course: Number(f.course) } }); setOk(true); onDone(); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Не удалось сохранить.'); }
    finally { setBusy(false); }
  }
  return <form className="form block" onSubmit={(e) => void save(e)}>
    <h2>Профиль</h2>
    <div className="field"><label htmlFor="p-name">ФИО</label><input id="p-name" value={f.full_name} onChange={set('full_name')} maxLength={120} required /></div>
    <div className="field"><label htmlFor="p-fac">Факультет</label><input id="p-fac" value={f.faculty} onChange={set('faculty')} maxLength={200} required /></div>
    <div className="field"><label htmlFor="p-prog">Направление</label><input id="p-prog" value={f.program} onChange={set('program')} maxLength={300} required /></div>
    <div className="row2">
      <div className="field"><label htmlFor="p-course">Курс</label><select id="p-course" value={f.course} onChange={set('course')}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
      <div className="field"><label htmlFor="p-sub">Подгруппа</label><select id="p-sub" value={f.subgroup} onChange={set('subgroup')}><option value="I">I</option><option value="II">II</option></select></div>
    </div>
    <div className="field"><label htmlFor="p-group">Группа</label><select id="p-group" value={f.group_id} onChange={set('group_id')}>{card.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
    <div className="field"><label htmlFor="p-mail">Университетская почта</label><input id="p-mail" type="email" value={f.email} onChange={set('email')} maxLength={120} required /></div>
    <div className="field"><label htmlFor="p-pmail">Личная почта</label><input id="p-pmail" type="email" value={f.personal_email} onChange={set('personal_email')} maxLength={120} /></div>
    <div className="field"><label htmlFor="p-phone">Телефон</label><input id="p-phone" type="tel" value={f.phone} onChange={set('phone')} maxLength={30} /></div>
    <div className="field"><label htmlFor="p-reg">Адрес регистрации</label><input id="p-reg" value={f.reg_address} onChange={set('reg_address')} maxLength={300} /></div>
    <div className="field"><label htmlFor="p-live">Адрес проживания</label><input id="p-live" value={f.live_address} onChange={set('live_address')} maxLength={300} /></div>
    {error && <p className="field-error" role="alert">{error}</p>}
    {ok && <p className="success" role="status"><Icon name="check" size={18} />Сохранено, студент получит уведомление.</p>}
    <button className="btn" type="submit" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить профиль'}</button>
  </form>;
}

function ProgressRow({ studentId, p, works, onDone }: { studentId: string; p: StudentCard['progress'][number]; works: StudentCard['works']; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [points, setPoints] = useState(String(p.points)); const [att, setAtt] = useState(String(p.attended)); const [tot, setTot] = useState(String(p.total_classes));
  const [kind, setKind] = useState(''); const [wp, setWp] = useState(''); const [wm, setWm] = useState('10'); const [comment, setComment] = useState('');
  const [rf, setRf] = useState<'exam' | 'credit'>(p.form === 'exam' ? 'exam' : 'credit'); const [rv, setRv] = useState(''); const [term, setTerm] = useState('Зимняя сессия 2026/27');
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [ok, setOk] = useState('');
  async function run(name: string, path: string, body: unknown, after?: () => void) {
    setBusy(name); setError(''); setOk('');
    try { await api(`/staff/students/${studentId}/${path}`, { method: 'POST', body }); setOk('Сохранено, студент получит уведомление.'); after?.(); onDone(); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Не удалось сохранить.'); }
    finally { setBusy(''); }
  }
  const mine = works.filter((w) => w.discipline_id === p.discipline_id);
  return <li className="staffrow">
    <button type="button" className="study-head" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="study-main"><strong>{p.discipline}</strong><span className="muted">Посещено {p.attended} из {p.total_classes}</span></span>
      <span className="study-points"><strong>{p.points}</strong><span className="muted">из 60</span></span><Icon name="chevron" size={18} />
    </button>
    {open && <div className="form pad">
      <form className="form" onSubmit={(e) => { e.preventDefault(); void run('progress', 'progress', { discipline_id: p.discipline_id, points: num(points), attended: Number(att), total_classes: Number(tot) }); }}>
        <h3>Баллы и посещаемость</h3>
        <div className="row3">
          <div className="field"><label htmlFor={`pt-${p.id}`}>Баллы</label><input id={`pt-${p.id}`} inputMode="decimal" value={points} onChange={(e) => setPoints(e.target.value)} /></div>
          <div className="field"><label htmlFor={`at-${p.id}`}>Посещено</label><input id={`at-${p.id}`} inputMode="numeric" value={att} onChange={(e) => setAtt(e.target.value)} /></div>
          <div className="field"><label htmlFor={`tt-${p.id}`}>Занятий</label><input id={`tt-${p.id}`} inputMode="numeric" value={tot} onChange={(e) => setTot(e.target.value)} /></div>
        </div>
        <button className="btn secondary compact" type="submit" disabled={busy !== ''}>{busy === 'progress' ? 'Сохраняем…' : 'Сохранить баллы'}</button>
      </form>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void run('work', 'works', { discipline_id: p.discipline_id, kind, points: num(wp), max_points: num(wm), comment }, () => { setKind(''); setWp(''); setComment(''); }); }}>
        <h3>Выставить оценку за работу</h3>
        <div className="field"><label htmlFor={`k-${p.id}`}>Работа</label><input id={`k-${p.id}`} value={kind} onChange={(e) => setKind(e.target.value)} placeholder="Контрольная, эссе, тест" maxLength={60} required /></div>
        <div className="row2">
          <div className="field"><label htmlFor={`wp-${p.id}`}>Получено</label><input id={`wp-${p.id}`} inputMode="decimal" value={wp} onChange={(e) => setWp(e.target.value)} required /></div>
          <div className="field"><label htmlFor={`wm-${p.id}`}>Максимум</label><input id={`wm-${p.id}`} inputMode="decimal" value={wm} onChange={(e) => setWm(e.target.value)} required /></div>
        </div>
        <div className="field"><label htmlFor={`wc-${p.id}`}>Комментарий</label><input id={`wc-${p.id}`} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={200} /></div>
        <p className="help">Баллы добавятся к сумме за семестр (не больше 60).</p>
        <button className="btn compact" type="submit" disabled={busy !== '' || !kind.trim() || wp === ''}>{busy === 'work' ? 'Сохраняем…' : 'Выставить оценку'}</button>
      </form>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void run('result', 'session-results', { discipline_id: p.discipline_id, form: rf, result: rv, term }, () => setRv('')); }}>
        <h3>Итог сессии</h3>
        <div className="row2">
          <div className="field"><label htmlFor={`rf-${p.id}`}>Форма</label><select id={`rf-${p.id}`} value={rf} onChange={(e) => setRf(e.target.value as 'exam' | 'credit')}><option value="exam">Экзамен</option><option value="credit">Зачёт</option></select></div>
          <div className="field"><label htmlFor={`rv-${p.id}`}>Результат</label><input id={`rv-${p.id}`} value={rv} onChange={(e) => setRv(e.target.value)} placeholder="5 или зачтено" maxLength={30} required /></div>
        </div>
        <div className="field"><label htmlFor={`rt-${p.id}`}>Семестр</label><input id={`rt-${p.id}`} value={term} onChange={(e) => setTerm(e.target.value)} maxLength={60} required /></div>
        <button className="btn secondary compact" type="submit" disabled={busy !== '' || !rv.trim()}>{busy === 'result' ? 'Сохраняем…' : 'Записать итог'}</button>
      </form>
      {error && <p className="field-error" role="alert">{error}</p>}
      {ok && <p className="success" role="status"><Icon name="check" size={18} />{ok}</p>}
      {mine.length > 0 && <><h3>Уже выставлено</h3><ul className="plain works">{mine.map((w) => <li key={w.id} className="rowlink static"><div><strong>{w.kind}</strong><span className="muted">{fmtDate(w.date)}{w.comment ? ` · ${w.comment}` : ''}</span></div><strong className="score">{w.points}<span className="muted"> / {w.max_points}</span></strong></li>)}</ul></>}
    </div>}
  </li>;
}

export function StaffStudent({ id }: { id: string }) {
  const load = useLoad<StudentCard>(`/staff/students/${id}`);
  return <>
    <PageHead title={load.data ? load.data.student.full_name : 'Студент'} back="#/staff/students" />
    <Screen load={load} skeleton={4}>{(card) => <>
      <p className="muted">{card.student.group_name} · логин {card.student.login} · зачётка {card.student.record_book ?? '—'}</p>
      <ProfileForm key={card.student.full_name + card.student.group_id} card={card} onDone={load.reload} />
      <DocsPanel path={`/staff/students/${card.student.id}/documents`} title="Паспорт и СНИЛС" />
      <section className="block"><h2>Успеваемость</h2>
        {card.progress.length ? <ul className="plain cardlist staff">{card.progress.map((p) => <ProgressRow key={p.id} studentId={card.student.id} p={p} works={card.works} onDone={load.reload} />)}</ul>
          : <Empty icon="study" title="Дисциплин нет" />}
        {card.past.length > 0 && <><h3>Итоги прошлых сессий</h3><ul className="plain">{card.past.map((r) => <li key={r.id} className="rowlink static"><div><strong>{r.discipline}</strong><span className="muted">{r.term}</span></div><strong className="score">{r.result}</strong></li>)}</ul></>}
      </section>
    </>}</Screen>
  </>;
}
