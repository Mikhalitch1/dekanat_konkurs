import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, type Certificate, type RequestEvent, type RequestItem, type RequestStatus, type RequestType } from '../api';
import { Icon } from '../icons';
import { fmtDate, fmtStamp, plural } from '../format';
import { Empty, PageHead, Screen, STATUS, StatusChip, go, useLoad, useRoute } from '../ui';

export const STEPS: RequestStatus[] = ['submitted', 'accepted', 'in_progress', 'ready', 'issued'];

function Tracker({ item, events }: { item: RequestItem; events: RequestEvent[] }) {
  const rejected = item.status === 'rejected';
  const current = STEPS.indexOf(item.status);
  const stamp = (s: RequestStatus) => [...events].reverse().find((e) => e.status === s);
  const due = new Date(new Date(item.created_at).getTime() + item.sla_days * 86_400_000);
  const finished = ['ready', 'issued', 'rejected'].includes(item.status);
  return <section className="block" aria-labelledby="track-title">
    <h2 id="track-title">Где сейчас заявка</h2>
    {!finished && <p className="eta"><Icon name="clock" size={18} />Ожидаем до {fmtDate(due.toISOString().slice(0, 10))} — срок {item.sla_days} {plural(item.sla_days, 'рабочий день', 'рабочих дня', 'рабочих дней')}</p>}
    <ol className="tracker">
      {STEPS.map((s, i) => {
        const e = stamp(s);
        const state = rejected ? (i === 0 ? 'done' : 'off') : i < current ? 'done' : i === current ? 'now' : 'next';
        return <li key={s} className={`track-${state}`}>
          <span className="track-mark" aria-hidden="true">{state === 'done' || (state === 'now' && i === STEPS.length - 1) ? <Icon name="check" size={16} /> : null}</span>
          <div><strong>{STATUS[s].label}</strong>
            <span className="muted">{state === 'now' ? 'Сейчас' : state === 'next' ? 'Впереди' : e ? fmtStamp(e.created_at) : state === 'done' ? 'Этап пройден' : ''}{e && state === 'now' ? ` · ${fmtStamp(e.created_at)}` : ''}</span>
            {e?.comment && !/^(Заявка подана|Статус:)/u.test(e.comment) && <p className="track-note">{e.comment}</p>}
          </div>
        </li>;
      })}
      {rejected && <li className="track-reject"><span className="track-mark" aria-hidden="true"><Icon name="x" size={16} /></span><div><strong>Отклонена</strong><span className="muted">{item.staff_comment || 'Причина не указана — уточните в деканате'}</span></div></li>}
    </ol>
  </section>;
}

function CertificateCard({ c }: { c: Certificate }) {
  const valid = new Date(c.valid_until) > new Date();
  return <section className="block cert" aria-labelledby="cert-title">
    <h2 id="cert-title">Справка готова</h2>
    <div className="cert-body">
      <div className="cert-qr" role="img" aria-label="QR-код для проверки справки" dangerouslySetInnerHTML={{ __html: c.qr }} />
      <div><p>Код проверки: <strong className="mono">{c.code}</strong></p>
        <p className="muted">Выдана {fmtDate(c.issued_at.slice(0, 10))}, действует до {fmtDate(c.valid_until.slice(0, 10))}{valid ? '' : ' (срок истёк)'}</p>
        <a className="btn secondary compact" href={`/verify/${c.code}`} target="_blank" rel="noreferrer">Страница проверки</a></div>
    </div>
  </section>;
}

function Detail({ id }: { id: string }) {
  const load = useLoad<{ request: RequestItem; events: RequestEvent[]; certificate: Certificate | null }>(`/requests/${id}`);
  return <>
    <PageHead title={load.data ? load.data.request.title : 'Заявка'} sub={load.data ? `№${load.data.request.number} · подана ${fmtStamp(load.data.request.created_at)}` : undefined} back="#/requests" action={load.data ? <StatusChip status={load.data.request.status} /> : undefined} />
    <Screen load={load} skeleton={4}>{({ request, events, certificate }) => <>
      {certificate && <CertificateCard c={certificate} />}
      <Tracker item={request} events={events} />
      <section className="block"><h2>Данные заявки</h2><dl className="facts">
        {request.purpose && <div><dt>Куда нужна</dt><dd>{request.purpose}</dd></div>}
        {request.comment && <div><dt>Ваш комментарий</dt><dd>{request.comment}</dd></div>}
        {request.staff_comment && <div><dt>Ответ деканата</dt><dd>{request.staff_comment}</dd></div>}
      </dl>{!request.purpose && !request.comment && !request.staff_comment && <p className="muted">Дополнительных данных нет.</p>}</section>
    </>}</Screen>
  </>;
}

function NewRequest({ code, defaults }: { code: string | null; defaults: { purpose: string; comment: string } }) {
  const types = useLoad<{ types: RequestType[] }>('/request-types');
  const [typeId, setTypeId] = useState<string | null>(null);
  const [purpose, setPurpose] = useState(defaults.purpose);
  const [comment, setComment] = useState(defaults.comment);
  const [copies, setCopies] = useState(1);
  const [errors, setErrors] = useState<{ purpose?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (code && types.data) { const t = types.data.types.find((x) => x.code === code); if (t) setTypeId(t.id); } }, [code, types.data]);
  const type = types.data?.types.find((t) => t.id === typeId) ?? null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!type) return;
    if (type.needs_purpose && !purpose.trim()) { setErrors({ purpose: 'Укажите, куда нужна справка — например, «по месту требования».' }); return; }
    setBusy(true); setErrors({});
    try {
      const result = await api<{ id: string }>('/requests', { method: 'POST', body: { type_id: type.id, purpose: purpose.trim(), comment: comment.trim(), copies } });
      go(`/requests/${result.id}`);
    } catch (e) { setErrors({ form: e instanceof ApiError ? e.message : 'Не удалось отправить заявку.' }); setBusy(false); }
  }

  return <>
    <PageHead title="Новая заявка" back="#/requests" />
    <Screen load={types} skeleton={4}>{({ types: list }) => <>
      <ul className="typelist" role="radiogroup" aria-label="Тип заявки">{list.map((t) => <li key={t.id}>
        <button type="button" role="radio" aria-checked={t.id === typeId} className={`typeopt${t.id === typeId ? ' is-on' : ''}`} onClick={() => setTypeId(t.id)}>
          <span className="radio" aria-hidden="true" />
          <span><strong>{t.title}</strong><span className="muted">{t.description}</span></span>
          <span className={`chip tone-${t.instant ? 'ok' : 'info'}`}><Icon name="clock" size={14} />{t.instant ? 'сразу' : `до ${t.sla_days} дн.`}</span>
        </button></li>)}</ul>
      {type && <form className="form block" onSubmit={(e) => void submit(e)} noValidate>
        <h2>{type.title}</h2>
        {type.needs_purpose && <div className="field"><label htmlFor="purpose">Куда нужна справка</label>
          <input id="purpose" value={purpose} maxLength={200} onChange={(e) => setPurpose(e.target.value)} aria-invalid={Boolean(errors.purpose)} aria-describedby="purpose-help" placeholder="По месту требования" />
          {errors.purpose ? <p className="field-error" id="purpose-help" role="alert">{errors.purpose}</p>   : null}</div>}
        <div className="field"><label htmlFor="comment">Комментарий для деканата <span className="muted">(необязательно)</span></label>
          <textarea id="comment" rows={3} value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} /></div>
        <div className="field narrow"><label htmlFor="copies">Количество экземпляров</label>
          <select id="copies" value={copies} onChange={(e) => setCopies(Number(e.target.value))}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
        {errors.form && <p className="field-error" role="alert">{errors.form}</p>}
        <button type="submit" className="btn" disabled={busy}>{busy ? 'Отправляем…' : type.instant ? 'Получить справку' : 'Отправить заявку'}</button>
      </form>}
    </>}</Screen>
  </>;
}

function List() {
  const load = useLoad<{ requests: RequestItem[] }>('/requests');
  return <>
    <PageHead title="Заявки и справки" action={<a className="btn compact" href="#/requests/new"><Icon name="plus" size={18} />Новая</a>} />
    <Screen load={load} skeleton={3}>{({ requests }) => requests.length ? <ul className="plain cardlist">{requests.map((r) => {
      const step = Math.max(0, STEPS.indexOf(r.status));
      return <li key={r.id}><a className="reqcard" href={`#/requests/${r.id}`}>
        <div className="reqcard-top"><strong>{r.title}</strong><StatusChip status={r.status} /></div>
        <p className="muted">№{r.number} · {fmtStamp(r.created_at)}</p>
        <div className="steps" aria-hidden="true">{STEPS.map((s, i) => <i key={s} className={r.status === 'rejected' ? 'off' : i <= step ? 'on' : ''} />)}</div>
        {r.certificate && <p className="reqcard-note"><Icon name="shield" size={16} />Справка с QR-кодом готова</p>}
      </a></li>;
    })}</ul> : <Empty icon="doc" title="Заявок пока нет" text="Справка об обучении формируется сразу, остальные обрабатывает деканат — статус будет виден здесь."><a className="btn" href="#/requests/new">Заказать справку</a></Empty>}</Screen>
  </>;
}

export function RequestsScreen() {
  const { path, query } = useRoute();
  const sub = path[1];
  if (sub === 'new') return <NewRequest code={query.get('type')} defaults={{ purpose: query.get('purpose') ?? '', comment: query.get('comment') ?? '' }} />;
  if (sub) return <Detail id={sub} />;
  return <List />;
}
