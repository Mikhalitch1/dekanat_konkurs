import type { ReactNode } from 'react';

const paths: Record<string, ReactNode> = {
  today: <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M8 3v4M16 3v4M4 10h16" /></>,
  study: <><path d="M4 19V5M4 19h16" /><path d="m8 15 3-4 3 2 5-7" /></>,
  doc: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h6" /></>,
  more: <><circle cx="6" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="18" cy="12" r="1.4" /></>,
  bell: <><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z" /><path d="M10 21h4" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  alert: <><path d="M12 4 2.8 20h18.4z" /><path d="M12 10v5M12 17.5v.5" /></>,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  back: <path d="m15 6-6 6 6 6" />,
  download: <><path d="M12 4v11M7.5 11 12 15.5 16.5 11" /><path d="M5 20h14" /></>,
  send: <path d="M4 12 20 4l-4 16-4-6.5z" />,
  user: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></>,
  logout: <><path d="M10 4H5v16h5" /><path d="M15 8l4 4-4 4M19 12H9" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  pin: <><path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  spark: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 17v4M17 19h4" /></>,
  swap: <><path d="M7 7h12l-3-3M17 17H5l3 3" /></>,
  people: <><circle cx="9" cy="9" r="3" /><path d="M3 19c.6-3 2.8-4.5 6-4.5s5.4 1.5 6 4.5" /><path d="M16 6.5a3 3 0 0 1 0 5.5M18 14.8c1.6.6 2.7 2 3 4.2" /></>,
  megaphone: <><path d="M4 10v4l12 5V5z" /><path d="M7 15l1 5h3l-1-4" /></>,
  shield: <><path d="M12 3l8 3v6c0 4.5-3.2 7.6-8 9-4.8-1.4-8-4.5-8-9V6z" /><path d="m9 12 2.2 2.2L15.5 10" /></>,
};

export type IconName = keyof typeof paths;
export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

/** Собственный знак: арка-дверь деканата с галочкой. Не копирует знак вуза. */
export function Logo({ size = 34 }: { size?: number }) {
  return <svg className="logo" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
    <rect width="40" height="40" rx="11" className="logo-bg" />
    <path d="M10 31V19a10 10 0 0 1 20 0v12" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
    <path d="m15.5 22.5 3.6 3.6 6.4-7.2" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
