import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ApiError, api, type Lesson, type RequestStatus } from './api';
import { Icon, type IconName } from './icons';
import { fmtTime } from './format';

/* ——— роутинг по hash ——— */
const subscribe = (cb: () => void) => { window.addEventListener('hashchange', cb); return () => window.removeEventListener('hashchange', cb); };
const snapshot = () => window.location.hash || '#/';
export function useRoute() {
  const hash = useSyncExternalStore(subscribe, snapshot);
  const [path, query = ''] = hash.slice(1).split('?');
  return { path: path.split('/').filter(Boolean), query: new URLSearchParams(query), hash };
}
export const go = (to: string) => { window.location.hash = to; };

/* ——— загрузка данных ——— */
export interface Loaded<T> { data: T | null; error: string; loading: boolean; reload: () => void }
export function useLoad<T>(path: string | null): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; error: string; loading: boolean }>({ data: null, error: '', loading: path !== null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    setState((s) => ({ ...s, error: '', loading: true }));
    api<T>(path, { signal: controller.signal })
      .then((data) => setState({ data, error: '', loading: false }))
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setState((s) => ({ ...s, loading: false, error: e instanceof ApiError ? e.message : 'Не удалось загрузить данные.' }));
      });
    return () => controller.abort();
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

/* ——— состояния ——— */
export function Skeleton({ rows = 3, label = 'Загрузка' }: { rows?: number; label?: string }) {
  return <div className="skeletons" role="status" aria-busy="true" aria-label={label}>{Array.from({ length: rows }, (_, i) => <div className="skeleton" key={i} />)}</div>;
}
export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="errorbox" role="alert"><Icon name="alert" /><div><p><strong>Не получилось загрузить</strong></p><p>{message}</p>{onRetry && <button type="button" className="btn secondary" onClick={onRetry}>Повторить</button>}</div></div>;
}
export function Empty({ icon = 'check', title, text, children }: { icon?: IconName; title: string; text?: string; children?: ReactNode }) {
  return <div className="empty"><span className="empty-icon"><Icon name={icon} size={26} /></span><p className="empty-title">{title}</p>{text && <p className="muted">{text}</p>}{children}</div>;
}
export function Screen<T>({ load, skeleton = 4, children }: { load: Loaded<T>; skeleton?: number; children: (data: T) => ReactNode }) {
  if (load.loading && !load.data) return <Skeleton rows={skeleton} />;
  if (load.error && !load.data) return <ErrorBox message={load.error} onRetry={load.reload} />;
  if (!load.data) return null;
  return <>{children(load.data)}</>;
}

/* ——— элементы ——— */
export const STATUS: Record<RequestStatus, { label: string; tone: string; icon: IconName }> = {
  submitted: { label: 'Подана', tone: 'info', icon: 'send' },
  accepted: { label: 'Принята', tone: 'info', icon: 'check' },
  in_progress: { label: 'В работе', tone: 'warn', icon: 'clock' },
  ready: { label: 'Готова', tone: 'ok', icon: 'check' },
  issued: { label: 'Выдана', tone: 'ok', icon: 'check' },
  rejected: { label: 'Отклонена', tone: 'risk', icon: 'x' },
};
export function Chip({ tone, icon, children }: { tone: string; icon: IconName; children: ReactNode }) {
  return <span className={`chip tone-${tone}`}><Icon name={icon} size={14} />{children}</span>;
}
export function StatusChip({ status }: { status: RequestStatus }) {
  const s = STATUS[status];
  return <Chip tone={s.tone} icon={s.icon}>{s.label}</Chip>;
}

export function PageHead({ title, sub, back, action }: { title: string; sub?: string; back?: string; action?: ReactNode }) {
  return <div className="page-head">
    <div>{back && <a className="backlink" href={back}><Icon name="back" size={18} />Назад</a>}<h1>{title}</h1>{sub && <p className="muted">{sub}</p>}</div>
    {action}
  </div>;
}

export function LessonItem({ lesson, past = false }: { lesson: Lesson; past?: boolean }) {
  const c = lesson.change;
  const cancelled = c?.kind === 'cancelled';
  const room = c?.new_room ?? lesson.room, teacher = c?.new_teacher ?? lesson.teacher;
  return <li className={`lesson${cancelled ? ' is-cancelled' : ''}${past ? ' is-past' : ''}${c ? ' has-change' : ''}`}>
    <div className="lesson-time"><strong>{fmtTime(lesson.starts_at)}</strong><span>{fmtTime(lesson.ends_at)}</span></div>
    <div className="lesson-body">
      <h3>{lesson.discipline}</h3>
      <p className="muted">{lesson.kind} · {room ? `ауд. ${room}` : 'аудитория уточняется'}{teacher ? ` · ${teacher}` : ''}</p>
      {c && <p className={`change change-${c.kind}`}>
        <Icon name={cancelled ? 'x' : 'swap'} size={16} />
        <span><strong>{cancelled ? 'Занятие отменено' : c.kind === 'room' ? `Новая аудитория: ${c.new_room}` : `Замена преподавателя: ${c.new_teacher}`}</strong>{c.note ? `. ${c.note}` : ''}</span>
      </p>}
    </div>
  </li>;
}
