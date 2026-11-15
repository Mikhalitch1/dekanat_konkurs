export type WeekParity = 'odd' | 'even';

export interface Group {
  id: string;
  name: string;
  course: number;
  program: string;
  faculty: string;
}

export interface Teacher { id: string; full_name: string }
export interface Discipline { id: string; name: string; teacher_id: string | null; kind: string }

export interface Entry {
  id: string;
  group_id: string;
  discipline_id: string;
  room: string | null;
  starts_at: string;
  ends_at: string;
  type: string;
  subgroup: string | null;
  language: string | null;
  language_group: string | null;
  elective_option: string | null;
  source_sheet: string;
  source_cell: string;
  source_merge: string | null;
  source_text: string;
  parity: WeekParity;
}

export interface Issue {
  sheet: string;
  cell: string;
  reason: string;
  text: string;
  dates?: string[];
}

export interface CellAudit {
  sheet: string;
  cell: string;
  merge: string | null;
  classification: 'lesson' | 'break' | 'note' | 'unrecognized';
  text: string;
  weekday: number | null;
  start: string | null;
  end: string | null;
  parities: WeekParity[];
  entry_ids: string[];
}

export interface ImportReport {
  nonempty_cells: number;
  recognized_cells: number;
  recognition_rate: number;
  lesson_cells: number;
  lesson_candidates: number;
  lesson_coverage: number;
  unrecognized: Issue[];
  ignored_dates: Issue[];
  warnings: Issue[];
  cells: CellAudit[];
  skipped_sheets: string[];
  first_week_parity: WeekParity;
  week_start: string;
}

export interface ImportResult {
  groups: Group[];
  teachers: Teacher[];
  disciplines: Discipline[];
  entries: Entry[];
  report: ImportReport;
}

export interface ImportOptions {
  now?: Date;
  firstWeekParity?: WeekParity;
  weeks?: number;
}
