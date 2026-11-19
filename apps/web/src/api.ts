export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

let csrfToken = '';
export const setCsrf = (token: string) => { csrfToken = token; };
export const SESSION_EXPIRED = 'dekanat:session-expired';

export async function api<T>(path: string, options: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (method === 'POST') { headers['Content-Type'] = 'application/json'; headers['X-CSRF-Token'] = csrfToken; }
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { method, headers, credentials: 'same-origin', cache: 'no-store', signal: options.signal, body: method === 'POST' ? JSON.stringify(options.body ?? {}) : undefined });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('Нет соединения с сервером. Проверьте интернет и повторите.', 0);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: string } | null;
    if (response.status === 401 && !['/login', '/verify', '/me', '/csrf'].some((p) => path.startsWith(p))) window.dispatchEvent(new Event(SESSION_EXPIRED));
    throw new ApiError(data?.error ?? 'Не удалось выполнить запрос. Повторите попытку.', response.status);
  }
  return response.status === 204 ? undefined as T : await response.json() as T;
}

export type Role = 'student' | 'staff';
export interface User { id: string; login: string; role: Role; name: string }
export interface Profile { full_name: string; faculty: string; program: string; course: number; group_name: string; subgroup: string; record_book: string; student_card: string; enrolled_year: number; email: string }
export interface Account { user: User; profile: Profile | null }

export interface LessonChange { kind: 'cancelled' | 'room' | 'substitute'; note: string; new_room: string | null; new_teacher: string | null }
export interface Lesson { id: string; date: string; starts_at: string; ends_at: string; discipline: string; kind: string; room: string | null; teacher: string | null; change: LessonChange | null }
export interface Schedule { week_start: string; parity: string; lessons: Lesson[] }

export type RequestStatus = 'submitted' | 'accepted' | 'in_progress' | 'ready' | 'issued' | 'rejected';
export interface RequestItem { id: string; number: number | null; title: string; code: string | null; status: RequestStatus; purpose: string; comment: string; staff_comment: string; created_at: string; updated_at: string; sla_days: number; certificate: string | null }
export interface RequestEvent { id: string; status: RequestStatus; comment: string; created_at: string }
export interface Certificate { code: string; issued_at: string; valid_until: string; qr: string; url: string }
export interface RequestType { id: string; code: string; title: string; description: string; sla_days: number; instant: boolean; needs_purpose: boolean }

export type Light = 'ok' | 'attention' | 'risk';
export interface Work { id: string; kind: string; points: number; max_points: number; date: string; comment: string }
export interface Discipline { id: string; discipline: string; form: string; points: number; max: number; attendance: number; attended: number; total: number; can_miss: number; projected: number; projected_grade: string; status: Light; advice: string; works: Work[] }
export interface PastResult { id: string; discipline: string; form: string; result: string; term: string }
export interface Grades { summary: { extra_points: number; gpa: number | null; rating_place: number | null; rating_total: number | null; attendance: number | null; missed: number; risk: number; attention: number }; progress: Discipline[]; past: PastResult[] }

export interface KeyDate { id: string; title: string; kind: string; starts_on: string; ends_on: string | null }
export interface Today { now: string; today: string; lessons: Lesson[]; next_day: { date: string; lessons: Lesson[] } | null; changes: Lesson[]; attention: Discipline[]; requests: RequestItem[]; key_dates: KeyDate[]; unread: number }

export interface Notice { id: string; kind: string; title: string; body: string; link: string; read_at: string | null; created_at: string }
export interface Announcement { id: string; title: string; body: string; image: string; created_at: string; author: string }
export type EventRole = 'participant' | 'organizer' | 'prize1' | 'prize2' | 'prize3' | 'absent';
export interface EventItem { id: string; title: string; organizer: string; place: string; starts_at: string; category: string; description: string; program: string; capacity: number; registered: number; joined: boolean; poster: string; level: 'club' | 'faculty' | 'university' | 'interuniversity'; points: number; completed_at: string | null; my_role: EventRole | null; my_awarded: number | null }
export interface PortfolioItem { id: string; event_id: string | null; kind: 'participation' | 'organization' | 'prize'; place: number | null; title: string; description: string; points: number; earned_on: string; poster: string | null }
export interface Portfolio { items: PortfolioItem[]; summary: { participation: number; organization: number; prizes: number; raw_points: number; points: number; cap: number } }
export interface Book { id: string; title: string; authors: string; year: number; category: string; kind: string; description: string; pages: number; shelf: string; cover: string; copies: number; available: number; reserved: boolean }
export interface Contacts { personal_email: string; phone: string; birth_date: string | null; reg_address: string; live_address: string }
export interface Docs { revealed: boolean; snils: string; passport: { display: string; issued_by?: string; issued_on?: string; division_code?: string } }
export interface StaffEvent { id: string; title: string; starts_at: string; place: string; category: string; level: string; points: number; poster: string; completed_at: string | null; capacity: number; registered: number }

export type AssistantAction = { type: 'create_request'; code: string; purpose: string; comment: string } | { type: 'open'; tab: 'today' | 'schedule' | 'grades' | 'requests' | 'events' };
export interface AssistantReply { reply: string; action: AssistantAction | null; source: 'model' | 'local' }

export interface StaffRequest { id: string; number: number | null; status: RequestStatus; purpose: string; comment: string; staff_comment: string; created_at: string; updated_at: string; title: string; sla_days: number; full_name: string; group_name: string }
export interface StaffGroup { group: string; lessons: Lesson[] }

export interface StudentBrief { id: string; full_name: string; course: number; record_book: string | null; group_name: string }
export interface StudentCard {
  student: { id: string; login: string; full_name: string; faculty: string; program: string; course: number; group_id: string; group_name: string; subgroup: 'I' | 'II'; record_book: string | null; student_card: string | null; email: string; personal_email: string; phone: string; reg_address: string; live_address: string };
  groups: { id: string; name: string }[];
  progress: { id: string; discipline_id: string; discipline: string; form: string; points: number; attended: number; total_classes: number }[];
  works: { id: string; discipline_id: string; discipline: string; kind: string; points: number; max_points: number; date: string; comment: string }[];
  past: { id: string; discipline_id: string; discipline: string; form: string; result: string; term: string }[];
}
