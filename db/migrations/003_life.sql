-- Контакты и документы студентов (чувствительные поля хранятся зашифрованными).
ALTER TABLE students ADD COLUMN IF NOT EXISTS personal_email text NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS birth_date date;
ALTER TABLE students ADD COLUMN IF NOT EXISTS reg_address text NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS live_address text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS student_documents (
  student_id uuid PRIMARY KEY REFERENCES students(user_id) ON DELETE CASCADE,
  snils_enc text NOT NULL,
  passport_enc text NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS access_log (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  student_id uuid NOT NULL,
  action text NOT NULL,
  at timestamptz NOT NULL
);

-- Мероприятия, баллы за внеучебную деятельность и портфолио.
ALTER TABLE events ADD COLUMN IF NOT EXISTS poster text NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS level text NOT NULL DEFAULT 'faculty';
ALTER TABLE events ADD COLUMN IF NOT EXISTS points numeric NOT NULL DEFAULT 1;
ALTER TABLE events ADD COLUMN IF NOT EXISTS program text NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS awarded numeric;
CREATE TABLE IF NOT EXISTS portfolio_items (
  id uuid PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
  event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('participation','organization','prize')),
  place integer,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  points numeric NOT NULL DEFAULT 0 CHECK (points >= 0),
  earned_on date NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (student_id, event_id)
);
CREATE INDEX IF NOT EXISTS portfolio_student ON portfolio_items(student_id, earned_on DESC);

-- Новости с картинками.
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS image text NOT NULL DEFAULT '';

-- Библиотека.
CREATE TABLE IF NOT EXISTS books (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  authors text NOT NULL,
  year integer NOT NULL,
  category text NOT NULL,
  kind text NOT NULL,
  description text NOT NULL,
  pages integer NOT NULL,
  shelf text NOT NULL,
  cover text NOT NULL DEFAULT '',
  copies integer NOT NULL CHECK (copies >= 0)
);
CREATE TABLE IF NOT EXISTS book_reservations (
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (book_id, student_id)
);
