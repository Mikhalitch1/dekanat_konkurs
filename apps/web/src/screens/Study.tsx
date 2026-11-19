import { useState } from 'react';
import type { Discipline, Grades, Light } from '../api';
import { Icon, type IconName } from '../icons';
import { fmtDate, plural } from '../format';
import { Chip, Empty, PageHead, Screen, useLoad } from '../ui';

const LIGHT: Record<Light, { label: string; tone: string; icon: IconName }> = {
  ok: { label: 'Всё хорошо', tone: 'ok', icon: 'check' },
  attention: { label: 'Нужно внимание', tone: 'warn', icon: 'alert' },
  risk: { label: 'Есть риск', tone: 'risk', icon: 'alert' },
};
const FORM: Record<string, string> = { exam: 'Экзамен', credit: 'Зачёт', diff_credit: 'Зачёт с оценкой' };

function Row({ d, open, toggle }: { d: Discipline; open: boolean; toggle: () => void }) {
  const l = LIGHT[d.status];
  return <li className={`study-row light-${d.status}`}>
    <button type="button" className="study-head" aria-expanded={open} onClick={toggle}>
      <span className={`light-dot light-dot-${d.status}`}><Icon name={l.icon} size={15} /><span className="sr">{l.label}</span></span>
      <span className="study-main"><strong>{d.discipline}</strong><span className="muted">{d.form} · посещаемость {d.attendance}%</span></span>
      <span className="study-points"><strong>{d.points}</strong><span className="muted">из {d.max}</span></span>
      <Icon name="chevron" size={18} />
    </button>
    <progress className={`meter meter-${d.status}`} value={d.points} max={d.max} aria-label={`${d.points} баллов из ${d.max}`} />
    {open && <div className="study-detail">
      <Chip tone={l.tone} icon={l.icon}>{l.label}</Chip>
      <dl className="facts">
        <div><dt>Прогноз по семестру</dt><dd>{d.projected} из 100 — {d.projected_grade}</dd></div>
        <div><dt>Пропущено</dt><dd>{d.total - d.attended} из {d.total}</dd></div>
        <div><dt>Можно пропустить</dt><dd>{d.can_miss} {plural(d.can_miss, 'занятие', 'занятия', 'занятий')}</dd></div>
      </dl>
      <p className="why"><strong>Почему так.</strong> {d.advice.charAt(0).toUpperCase() + d.advice.slice(1)}.</p>
      <h3>Работы и контрольные</h3>
      {d.works.length ? <ul className="plain works">{d.works.map((w) => <li key={w.id} className="rowlink static"><div><strong>{w.kind}</strong><span className="muted">{fmtDate(w.date)}{w.comment ? ` · ${w.comment}` : ''}</span></div><strong className="score">{w.points}<span className="muted"> / {w.max_points}</span></strong></li>)}</ul>
        : <p className="muted">Оценённых работ пока нет.</p>}
    </div>}
  </li>;
}

function Body({ data }: { data: Grades }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const s = data.summary;
  const order: Light[] = ['risk', 'attention', 'ok'];
  const sorted = [...data.progress].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  return <>
    <section className="summary" aria-label="Итоги">
      <div className="stat stat-lead"><span className="muted">Средний балл по сессиям</span><strong>{s.gpa !== null ? String(s.gpa).replace('.', ',') : '—'}</strong>{s.rating_place && <span>{s.rating_place} место из {s.rating_total} в рейтинге</span>}</div>
      <div className="stat"><span className="muted">Посещаемость</span><strong>{s.attendance ?? '—'}%</strong><span>пропущено {s.missed}</span></div>
      <a className="stat statlink" href="#/portfolio"><span className="muted">Внеучебные баллы</span><strong>{String(s.extra_points).replace('.', ',')}</strong><span>из 10, портфолио</span></a>
      <div className="stat"><span className="muted">Требуют внимания</span><strong>{s.risk + s.attention}</strong><span>{s.risk ? `${s.risk} с риском` : 'рисков нет'}</span></div>
    </section>
    <section className="block" aria-labelledby="cur-title">
      <h2 id="cur-title">Текущий семестр</h2>
      {sorted.length ? <ul className="study-list">{sorted.map((d) => <Row key={d.id} d={d} open={openId === d.id} toggle={() => setOpenId(openId === d.id ? null : d.id)} />)}</ul>
        : <Empty icon="study" title="Баллов пока нет" text="Они появятся после первых контрольных." />}
      <details className="how"><summary>Как считается прогноз</summary>
        <p>Прогноз = набранные баллы + 40 × (набранные ÷ 60): мы считаем, что вы сохраните темп. Допуск к сессии — от 30 баллов и посещаемости от 70%. Это оценка, а не гарантия оценки.</p></details>
    </section>
    <section className="block" aria-labelledby="past-title">
      <h2 id="past-title">Прошлые сессии</h2>
      {data.past.length ? <ul className="plain">{data.past.map((r) => <li key={r.id} className="rowlink static"><div><strong>{r.discipline}</strong><span className="muted">{FORM[r.form] ?? r.form} · {r.term}</span></div><strong className="score">{r.result}</strong></li>)}</ul>
        : <Empty icon="study" title="Результатов пока нет" />}
    </section>
  </>;
}

export function StudyScreen() {
  const load = useLoad<Grades>('/grades');
  return <><PageHead title="Успеваемость" /><Screen load={load} skeleton={5}>{(d) => <Body data={d} />}</Screen></>;
}
