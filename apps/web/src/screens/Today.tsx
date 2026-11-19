import { useEffect, useState } from 'react';
import type { Account, Announcement, Notice, Today } from '../api';
import { Icon } from '../icons';
import { capital, fmtDate, fmtDayLong, fmtTime, greeting, plural, untilText } from '../format';
import { Chip, Empty, LessonItem, Screen, StatusChip, useLoad } from '../ui';
import { STEPS } from './Requests';

function useNow(period = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = window.setInterval(() => setNow(new Date()), period); return () => window.clearInterval(id); }, [period]);
  return now;
}

function Hero({ data, name, now }: { data: Today; name: string; now: Date }) {
  const live = data.lessons.filter((l) => l.change?.kind !== 'cancelled');
  const current = live.find((l) => new Date(l.starts_at) <= now && now < new Date(l.ends_at));
  const next = live.find((l) => new Date(l.starts_at) > now);
  const tomorrow = data.next_day?.lessons.find((l) => l.change?.kind !== 'cancelled');
  const lesson = current ?? next;
  const room = lesson ? (lesson.change?.new_room ?? lesson.room) : null;
  return <section className="hero" aria-labelledby="hero-title">
    <p className="hero-hello">{greeting(now)}, {name}</p>
    {lesson ? <>
      <p className="hero-kicker">{current ? `Идёт сейчас, до ${fmtTime(lesson.ends_at)}` : `Следующая пара через ${untilText(new Date(lesson.starts_at).getTime() - now.getTime())}`}</p>
      <h1 id="hero-title">{lesson.discipline}</h1>
      <p className="hero-meta"><Icon name="clock" size={16} />{fmtTime(lesson.starts_at)}–{fmtTime(lesson.ends_at)}<Icon name="pin" size={16} />{room ? `ауд. ${room}` : 'аудитория уточняется'}</p>
      {lesson.change && <p className="hero-change"><Icon name="swap" size={16} />{lesson.change.kind === 'substitute' ? `Замена: ${lesson.change.new_teacher}` : `Новая аудитория: ${lesson.change.new_room}`}</p>}
    </> : <>
      <p className="hero-kicker">{data.lessons.length ? 'Пары на сегодня закончились' : 'Сегодня без пар'}</p>
      <h1 id="hero-title">{tomorrow && data.next_day ? `${capital(fmtDayLong(data.next_day.date).split(',')[0] ?? '')}: первая пара в ${fmtTime(tomorrow.starts_at)}` : 'Ближайшая неделя свободна от пар'}</h1>
      {tomorrow && <p className="hero-meta"><Icon name="pin" size={16} />{tomorrow.discipline}{tomorrow.room ? `, ауд. ${tomorrow.room}` : ''}</p>}
    </>}
  </section>;
}

function Body({ data, account }: { data: Today; account: Account }) {
  const now = useNow();
  const name = account.user.name.split(' ')[0] ?? account.user.name;
  const today = data.today;
  const upcoming = data.changes.filter((c) => c.date !== today || new Date(c.ends_at) > now);
  return <div className="today-grid">
    <div className="col-main">
      <Hero data={data} name={name} now={now} />
      {upcoming.length > 0 && <section className="block" aria-labelledby="changes-title">
        <h2 id="changes-title">Изменения в расписании</h2>
        <ul className="lessons">{upcoming.map((l) => <li key={l.id} className="mini-day"><span className="mini-date">{capital(fmtDayLong(l.date).split(',')[0] ?? '')}</span><ul className="lessons"><LessonItem lesson={l} /></ul></li>)}</ul>
      </section>}
      <section className="block" aria-labelledby="day-title">
        <div className="block-head"><h2 id="day-title">Сегодня, {fmtDate(today)}</h2><a href="#/schedule">Вся неделя</a></div>
        {data.lessons.length ? <ul className="lessons">{data.lessons.map((l) => <LessonItem key={l.id} lesson={l} past={new Date(l.ends_at) < now} />)}</ul>
          : <Empty icon="calendar" title="Сегодня пар нет" text="Хороший день, чтобы закрыть долги или оформить справку." />}
      </section>
    </div>
    <div className="col-side">
      <section className="block" aria-labelledby="req-title">
        <div className="block-head"><h2 id="req-title">Мои заявки</h2><a href="#/requests">Все</a></div>
        {data.requests.length ? <ul className="plain">{data.requests.map((r) => {
          const step = Math.max(0, STEPS.indexOf(r.status));
          return <li key={r.id}><a className="rowlink" href={`#/requests/${r.id}`}><div><strong>{r.title}</strong><span className="muted">№{r.number} · {step + 1} из {STEPS.length} этапов</span></div><StatusChip status={r.status} /></a></li>;
        })}</ul> : <Empty icon="doc" title="Активных заявок нет" text="Справку можно заказать за минуту."><a className="btn" href="#/requests/new">Заказать справку</a></Empty>}
      </section>
      <section className="block" aria-labelledby="dates-title">
        <h2 id="dates-title">Ближайшие сроки</h2>
        {data.key_dates.length ? <ul className="plain">{data.key_dates.map((d) => {
          const days = Math.round((new Date(`${d.starts_on}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000);
          return <li key={d.id} className="rowlink static"><div><strong>{d.title}</strong><span className="muted">{fmtDate(d.starts_on)}{d.ends_on ? ` – ${fmtDate(d.ends_on)}` : ''}</span></div><Chip tone={days <= 3 ? 'warn' : 'info'} icon="clock">{days <= 0 ? 'идёт' : `через ${days} ${plural(days, 'день', 'дня', 'дней')}`}</Chip></li>;
        })}</ul> : <Empty icon="calendar" title="Сроков пока нет" />}
      </section>
      <section className="block" aria-labelledby="study-title">
        <div className="block-head"><h2 id="study-title">Учёба</h2><a href="#/study">Успеваемость</a></div>
        {data.attention.length ? <ul className="plain">{data.attention.map((d) => <li key={d.id}><a className="rowlink" href="#/study"><div><strong>{d.discipline}</strong><span className="muted">{d.points} из {d.max} баллов · посещаемость {d.attendance}%</span></div><Chip tone={d.status === 'risk' ? 'risk' : 'warn'} icon="alert">{d.status === 'risk' ? 'Риск' : 'Внимание'}</Chip></a></li>)}</ul>
          : <p className="calm"><Icon name="shield" size={20} />Все дисциплины в зелёной зоне. Допуск к сессии есть.</p>}
      </section>
      <NewsTeaser />
      {data.unread > 0 && <a className="notice-link" href="#/notifications"><Icon name="bell" size={20} />Непрочитанных уведомлений: {data.unread}<Icon name="chevron" size={18} /></a>}
    </div>
  </div>;
}

function NewsTeaser() {
  const load = useLoad<{ notifications: Notice[]; announcements: Announcement[] }>('/notifications');
  const item = load.data?.announcements[0];
  if (!item) return null;
  return <a className="newscard" href="#/notifications">{item.image && <img className="poster" src={item.image} alt="" width={800} height={450} loading="lazy" />}<div><strong>{item.title}</strong><span className="muted">Новости деканата</span></div></a>;
}

export function TodayScreen({ account }: { account: Account }) {
  const load = useLoad<Today>('/today');
  return <Screen load={load} skeleton={5}>{(data) => <Body data={data} account={account} />}</Screen>;
}
