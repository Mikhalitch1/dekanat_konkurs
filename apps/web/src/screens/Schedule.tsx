import { useEffect, useState } from 'react';
import type { Schedule } from '../api';
import { Icon } from '../icons';
import { addDays, capital, fmtDate, fmtDayLong, fmtDayNum, fmtDayShort, mskToday } from '../format';
import { Empty, LessonItem, PageHead, Screen, useLoad } from '../ui';

export function ScheduleScreen() {
  const today = mskToday();
  const [week, setWeek] = useState<string | null>(null);
  const load = useLoad<Schedule>(`/schedule${week ? `?week=${week}` : ''}`);
  const start = load.data?.week_start ?? null;
  const [selected, setSelected] = useState(today);
  useEffect(() => {
    if (!start) return;
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    setSelected((cur) => days.includes(cur) ? cur : days.includes(today) ? today : (days.find((d) => load.data?.lessons.some((l) => l.date === d)) ?? start));
  }, [start]);

  return <>
    <PageHead title="Расписание" sub={load.data ? `${fmtDate(load.data.week_start)} – ${fmtDate(addDays(load.data.week_start, 6))} · ${load.data.parity} неделя` : 'Занятия вашей группы и подгруппы'}
      action={<a className="btn secondary compact" href="/api/schedule.ics" download><Icon name="download" size={18} />В календарь</a>} />
    <div className="weeknav">
      <button type="button" className="btn secondary compact" onClick={() => start && setWeek(addDays(start, -7))} disabled={!start} aria-label="Предыдущая неделя"><Icon name="back" size={18} /></button>
      <button type="button" className="btn secondary compact" onClick={() => { setWeek(null); setSelected(today); }} disabled={!week}>Эта неделя</button>
      <button type="button" className="btn secondary compact" onClick={() => start && setWeek(addDays(start, 7))} disabled={!start} aria-label="Следующая неделя"><Icon name="chevron" size={18} /></button>
    </div>
    <Screen load={load} skeleton={5}>{(data) => {
      const days = Array.from({ length: 7 }, (_, i) => addDays(data.week_start, i));
      const lessons = data.lessons.filter((l) => l.date === selected);
      return <>
        <div className="daytabs" role="tablist" aria-label="Дни недели">
          {days.map((d) => {
            const count = data.lessons.filter((l) => l.date === d).length;
            const changed = data.lessons.some((l) => l.date === d && l.change);
            return <button key={d} type="button" role="tab" aria-selected={d === selected} className={`daytab${d === today ? ' is-today' : ''}`} onClick={() => setSelected(d)}>
              <span>{fmtDayShort(d)}</span><strong>{fmtDayNum(d)}</strong>
              <i className={changed ? 'dot dot-warn' : count ? 'dot' : 'dot dot-off'} aria-label={changed ? 'есть изменения' : count ? `${count} занятий` : 'занятий нет'} />
            </button>;
          })}
        </div>
        <section className="block" aria-label={fmtDayLong(selected)}>
          <h2>{capital(fmtDayLong(selected))}</h2>
          {lessons.length ? <ul className="lessons">{lessons.map((l) => <LessonItem key={l.id} lesson={l} />)}</ul>
            : <Empty icon="calendar" title="В этот день занятий нет" text="Выберите другой день или откройте соседнюю неделю." />}
        </section>
      </>;
    }}</Screen>
  </>;
}
