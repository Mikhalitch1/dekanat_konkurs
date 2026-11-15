CREATE TABLE IF NOT EXISTS groups (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE,
  course integer NOT NULL CHECK (course BETWEEN 1 AND 6),
  program text NOT NULL,
  faculty text NOT NULL
);
CREATE TABLE IF NOT EXISTS teachers (
  id uuid PRIMARY KEY,
  full_name text NOT NULL
);
CREATE TABLE IF NOT EXISTS disciplines (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  teacher_id uuid REFERENCES teachers(id),
  kind text NOT NULL
);
-- На этапе 1 user_id будет связан с users; здесь нет входа или паролей.
CREATE TABLE IF NOT EXISTS students (
  user_id uuid PRIMARY KEY,
  login text NOT NULL UNIQUE,
  full_name text NOT NULL,
  faculty text NOT NULL,
  program text NOT NULL,
  course integer NOT NULL CHECK (course BETWEEN 1 AND 6),
  group_id uuid NOT NULL REFERENCES groups(id),
  subgroup text NOT NULL CHECK (subgroup IN ('I', 'II')),
  language_groups text[] NOT NULL,
  elective_option text NOT NULL
);
CREATE TABLE IF NOT EXISTS schedule_entries (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES groups(id),
  discipline_id uuid NOT NULL REFERENCES disciplines(id),
  room text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  type text NOT NULL,
  subgroup text CHECK (subgroup IS NULL OR subgroup IN ('I', 'II')),
  language text,
  language_group text,
  elective_option text,
  parity text NOT NULL CHECK (parity IN ('odd', 'even')),
  source_sheet text NOT NULL,
  source_cell text NOT NULL,
  source_merge text,
  source_text text NOT NULL
);
CREATE INDEX IF NOT EXISTS schedule_group_time ON schedule_entries(group_id, starts_at);
