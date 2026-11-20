import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, OFFLINE_DATA, SESSION_EXPIRED, api, clearOfflineData, setCsrf, type Account } from './api';
import { Icon, Logo, type IconName } from './icons';
import { RequestScope } from './request-scope';
import { AssistantScreen, MoreScreen, NotificationsScreen, ProfileScreen, type ThemeMode } from './screens/More';
import { EventsScreen, LibraryScreen, PortfolioScreen } from './screens/Life';
import { RequestsScreen } from './screens/Requests';
import { StaffEvents } from './screens/StaffEvents';
import { ScheduleScreen } from './screens/Schedule';
import { StaffLessons, StaffNews, StaffRequests } from './screens/Staff';
import { StaffStudent, StaffStudents } from './screens/StaffStudents';
import { StudyScreen } from './screens/Study';
import { TodayScreen } from './screens/Today';
import { VerifyScreen } from './screens/Verify';
import { Skeleton, useRoute } from './ui';

const STUDENT_NAV: { to: string; key: string; label: string; icon: IconName }[] = [
  { to: '#/today', key: 'today', label: 'Сегодня', icon: 'today' },
  { to: '#/schedule', key: 'schedule', label: 'Расписание', icon: 'calendar' },
  { to: '#/study', key: 'study', label: 'Учёба', icon: 'study' },
  { to: '#/requests', key: 'requests', label: 'Заявки', icon: 'doc' },
  { to: '#/more', key: 'more', label: 'Ещё', icon: 'more' },
];
const STAFF_NAV: typeof STUDENT_NAV = [
  { to: '#/staff/requests', key: 'requests', label: 'Заявки', icon: 'doc' },
  { to: '#/staff/students', key: 'students', label: 'Студенты', icon: 'people' },
  { to: '#/staff/lessons', key: 'lessons', label: 'Занятия', icon: 'calendar' },
  { to: '#/staff/events', key: 'events', label: 'События', icon: 'spark' },
  { to: '#/staff/news', key: 'news', label: 'Новости', icon: 'megaphone' },
];
const MORE_GROUP = new Set(['notifications', 'assistant', 'events', 'profile', 'more', 'portfolio', 'library']);

function useTheme(): [ThemeMode, (t: ThemeMode) => void] {
  const read = (): ThemeMode => { try { const v = localStorage.getItem('dekanat-theme'); return v === 'light' || v === 'dark' ? v : 'auto'; } catch { return 'auto'; } };
  const [theme, setTheme] = useState<ThemeMode>(read);
  useEffect(() => {
    if (theme === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme;
    try { if (theme === 'auto') localStorage.removeItem('dekanat-theme'); else localStorage.setItem('dekanat-theme', theme); } catch { /* хранилище недоступно */ }
  }, [theme]);
  return [theme, setTheme];
}

function Chrome({ children, nav, active, unread, staff }: { children: ReactNode; nav?: typeof STUDENT_NAV; active?: string; unread?: number; staff?: boolean }) {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const on = (e: Event) => setOffline((e as CustomEvent<boolean>).detail === true);
    window.addEventListener(OFFLINE_DATA, on); return () => window.removeEventListener(OFFLINE_DATA, on);
  }, []);
  return <div className="app">
    {offline && <p className="offline-bar" role="status">Нет сети: показаны данные, сохранённые на этом устройстве.</p>}
    <header className="topbar">
      <a className="brand" href={staff ? '#/staff/requests' : '#/today'} aria-label="Цифровой деканат — на главную"><Logo size={30} /><span>Цифровой деканат</span></a>
      {nav && !staff && <a className="iconbtn" href="#/notifications" aria-label={unread ? `Уведомления, непрочитанных: ${unread}` : 'Уведомления'}><Icon name="bell" />{unread ? <span className="badge">{unread}</span> : null}</a>}
      {staff && <a className="role-tag" href="#/profile">Сотрудник</a>}
    </header>
    <div className={nav ? 'shell' : 'shell bare'}>
      {nav && <nav className="nav" aria-label="Основная навигация">{nav.map((n) => <a key={n.key} href={n.to} className={active === n.key ? 'is-active' : ''} aria-current={active === n.key ? 'page' : undefined}>
        <span className="nav-icon"><Icon name={n.icon} />{n.key === 'more' && unread ? <span className="dot-badge" aria-hidden="true" /> : null}</span><span>{n.label}</span></a>)}</nav>}
      <main className="page" id="main" tabIndex={-1}>{children}</main>
    </div>
  </div>;
}

function Login({ onSignIn, error, busy, expired }: { onSignIn: (login: string, password: string) => void; error: string; busy: boolean; expired: boolean }) {
  const [login, setLogin] = useState(''); const [password, setPassword] = useState('');
  return <Chrome>
    <section className="login">
      <form className="form login-form" onSubmit={(e: FormEvent) => { e.preventDefault(); onSignIn(login.trim(), password); }} noValidate>
        <h2>Вход</h2>
        {expired && <p className="notice" role="status">Сессия завершилась. Войдите снова.</p>}
        <div className="field"><label htmlFor="login">Логин</label><input id="login" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={login} onChange={(e) => setLogin(e.target.value)} maxLength={100} disabled={busy} /></div>
        <div className="field"><label htmlFor="password">Пароль</label><input id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={200} disabled={busy} /></div>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button type="submit" className="btn" disabled={busy || !login.trim() || !password}>{busy ? 'Входим…' : 'Войти'}</button>
        <p className="fineprint">Концепт для конкурса, не официальный сервис вуза.</p>
      </form>
    </section>
  </Chrome>;
}

function Authed({ account, onLogout, busy, theme, setTheme }: { account: Account; onLogout: () => void; busy: boolean; theme: ThemeMode; setTheme: (t: ThemeMode) => void }) {
  const { path } = useRoute();
  const staff = account.user.role === 'staff';
  const [unread, setUnread] = useState(0);
  const scope = useRef(new RequestScope());
  useEffect(() => {
    if (staff) return;
    const request = scope.current.begin();
    api<{ unread: number }>('/today', { signal: request.signal }).then((d) => { if (request.current()) setUnread(d.unread); }).catch(() => undefined);
    return () => scope.current.invalidate();
  }, [staff, path[0]]);
  const markRead = useCallback(() => setUnread(0), []);
  const first = path[0] ?? '';
  const nav = staff ? STAFF_NAV : STUDENT_NAV;

  useEffect(() => { document.getElementById('main')?.focus({ preventScroll: true }); window.scrollTo(0, 0); }, [path.join('/')]);

  let key = first, screen: ReactNode;
  if (staff) {
    const sub = path[1] ?? 'requests';
    if (first === 'profile') { key = 'profile'; screen = <ProfileScreen account={account} theme={theme} setTheme={setTheme} onLogout={onLogout} busy={busy} />; }
    else { key = sub; screen = sub === 'events' ? <StaffEvents /> : sub === 'students' ? (path[2] ? <StaffStudent id={path[2]} /> : <StaffStudents />) : sub === 'lessons' ? <StaffLessons /> : sub === 'news' ? <StaffNews /> : <StaffRequests />; }
  } else {
    switch (first) {
      case 'schedule': screen = <ScheduleScreen />; break;
      case 'study': screen = <StudyScreen />; break;
      case 'requests': screen = <RequestsScreen />; break;
      case 'more': screen = <MoreScreen unread={unread} />; break;
      case 'notifications': screen = <NotificationsScreen onRead={markRead} />; break;
      case 'events': screen = <EventsScreen />; break;
      case 'portfolio': screen = <PortfolioScreen />; break;
      case 'library': screen = <LibraryScreen />; break;
      case 'assistant': screen = <AssistantScreen />; break;
      case 'profile': screen = <ProfileScreen account={account} theme={theme} setTheme={setTheme} onLogout={onLogout} busy={busy} />; break;
      default: key = 'today'; screen = <TodayScreen account={account} />;
    }
    if (MORE_GROUP.has(key)) key = 'more';
  }
  return <Chrome nav={nav} active={key} unread={unread} staff={staff}>{screen}</Chrome>;
}

export function App() {
  const verify = window.location.pathname.match(/^\/verify\/([A-Z0-9]{10})\/?$/u);
  const [theme, setTheme] = useTheme();
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(!verify);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);

  async function boot() {
    setLoading(true); setError('');
    try {
      try { setCsrf((await api<{ csrfToken: string }>('/csrf')).csrfToken); } catch (e) { if (!(e instanceof ApiError && e.status === 0)) throw e; /* офлайн: токен понадобится только для отправки данных */ }
      try { setAccount(await api<Account>('/me')); } catch (e) { if (!(e instanceof ApiError && e.status === 401)) throw e; }
    } catch { setError('Сервис сейчас недоступен. Проверьте соединение и повторите.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (!verify) void boot(); }, []);
  useEffect(() => {
    const out = () => { void clearOfflineData(); setAccount(null); setExpired(true); void api<{ csrfToken: string }>('/csrf').then((t) => setCsrf(t.csrfToken)).catch(() => undefined); };
    window.addEventListener(SESSION_EXPIRED, out); return () => window.removeEventListener(SESSION_EXPIRED, out);
  }, []);

  async function signIn(login: string, password: string) {
    setBusy(true); setError(''); setExpired(false);
    try {
      await clearOfflineData();
      const r = await api<{ csrfToken: string }>('/login', { method: 'POST', body: { login, password } });
      setCsrf(r.csrfToken);
      const me = await api<Account>('/me');
      window.location.hash = me.user.role === 'staff' ? '#/staff/requests' : '#/today';
      setAccount(me);
    } catch (e) { setError(e instanceof ApiError ? (e.status === 401 ? 'Неверный логин или пароль. Проверьте раскладку и регистр.' : e.message) : 'Не удалось войти. Повторите попытку.'); }
    finally { setBusy(false); }
  }
  async function signOut() {
    setBusy(true);
    try {
      await api('/logout', { method: 'POST' });
      await clearOfflineData();
      if ('caches' in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
      try { sessionStorage.clear(); } catch { /* недоступно */ }
      setAccount(null); window.location.hash = '#/';
      setCsrf((await api<{ csrfToken: string }>('/csrf')).csrfToken);
    } catch { setError('Не удалось завершить сеанс. Повторите выход.'); }
    finally { setBusy(false); }
  }

  if (verify) return <Chrome><VerifyScreen code={verify[1]!} /></Chrome>;
  if (loading) return <Chrome><div className="page"><Skeleton rows={4} label="Загрузка кабинета" /></div></Chrome>;
  if (!account) return <>
    {error && !busy && !expired && error.startsWith('Сервис') ? <Chrome><div className="page"><div className="errorbox" role="alert"><Icon name="alert" /><div><p><strong>Нет связи</strong></p><p>{error}</p><button type="button" className="btn secondary" onClick={() => void boot()}>Повторить подключение</button></div></div></div></Chrome>
      : <Login onSignIn={(l, p) => void signIn(l, p)} error={error} busy={busy} expired={expired} />}
  </>;
  return <Authed account={account} onLogout={() => void signOut()} busy={busy} theme={theme} setTheme={setTheme} />;
}
