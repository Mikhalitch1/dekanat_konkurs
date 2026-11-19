import { Icon, Logo } from '../icons';
import { fmtDate } from '../format';
import { Screen, useLoad } from '../ui';

interface Check { title: string; holder: string; group: string; issued_at: string; valid_until: string; valid: boolean }

export function VerifyScreen({ code }: { code: string }) {
  const load = useLoad<Check>(`/verify/${encodeURIComponent(code)}`);
  return <main className="verify page">
    <div className="brand big"><Logo size={44} /><strong>Проверка справки</strong></div>
    <Screen load={load}>{(c) => <section className={`block verdict ${c.valid ? 'ok' : 'bad'}`}>
      <p className="verdict-mark"><Icon name={c.valid ? 'shield' : 'alert'} size={30} /></p>
      <h1>{c.valid ? 'Справка подлинная' : 'Срок справки истёк'}</h1>
      <dl className="facts"><div><dt>Документ</dt><dd>{c.title}</dd></div><div><dt>Владелец</dt><dd>{c.holder}, группа {c.group}</dd></div>
        <div><dt>Выдана</dt><dd>{fmtDate(c.issued_at.slice(0, 10))}</dd></div><div><dt>Действует до</dt><dd>{fmtDate(c.valid_until.slice(0, 10))}</dd></div></dl>
    </section>}</Screen>
    <p className="fineprint">Концепт для конкурса, не официальный сервис вуза.</p>
  </main>;
}
