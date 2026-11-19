-- Кабинет: прогресс по дисциплинам, рейтинг, заявки с данными, справки с QR, замены, мероприятия.
ALTER TABLE students ADD COLUMN IF NOT EXISTS record_book text;
ALTER TABLE students ADD COLUMN IF NOT EXISTS student_card text;
ALTER TABLE students ADD COLUMN IF NOT EXISTS enrolled_year integer;
ALTER TABLE students ADD COLUMN IF NOT EXISTS rating_place integer;
ALTER TABLE students ADD COLUMN IF NOT EXISTS rating_total integer;
ALTER TABLE students ADD COLUMN IF NOT EXISTS email text;

CREATE TABLE IF NOT EXISTS discipline_progress (
  id uuid PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
  discipline_id uuid NOT NULL REFERENCES disciplines(id),
  form text NOT NULL CHECK (form IN ('exam','credit','diff_credit')),
  points numeric NOT NULL CHECK (points >= 0 AND points <= 60),
  attended integer NOT NULL CHECK (attended >= 0),
  total_classes integer NOT NULL CHECK (total_classes >= attended),
  UNIQUE (student_id, discipline_id)
);

ALTER TABLE grades ADD COLUMN IF NOT EXISTS comment text NOT NULL DEFAULT '';

ALTER TABLE request_types ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE request_types ADD COLUMN IF NOT EXISTS instant boolean NOT NULL DEFAULT false;
ALTER TABLE request_types ADD COLUMN IF NOT EXISTS needs_purpose boolean NOT NULL DEFAULT false;
ALTER TABLE request_types ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT '';
ALTER TABLE requests ADD COLUMN IF NOT EXISTS copies integer NOT NULL DEFAULT 1;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS staff_comment text NOT NULL DEFAULT '';
ALTER TABLE requests ADD COLUMN IF NOT EXISTS number integer;
CREATE SEQUENCE IF NOT EXISTS request_number_seq START 1042;

CREATE TABLE IF NOT EXISTS certificates (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z0-9]{10}$'),
  request_id uuid NOT NULL UNIQUE REFERENCES requests(id) ON DELETE CASCADE,
  issued_at timestamptz NOT NULL,
  valid_until timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS lesson_changes (
  id uuid PRIMARY KEY,
  schedule_entry_id uuid NOT NULL REFERENCES schedule_entries(id) ON DELETE CASCADE,
  on_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('cancelled','room','substitute','moved')),
  new_room text,
  new_teacher text,
  new_time text,
  note text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL,
  UNIQUE (schedule_entry_id, on_date)
);

CREATE TABLE IF NOT EXISTS key_dates (
  id uuid PRIMARY KEY,
  group_id uuid REFERENCES groups(id),
  title text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('checkpoint','session','deadline','holiday')),
  starts_on date NOT NULL,
  ends_on date
);

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  organizer text NOT NULL,
  place text NOT NULL,
  starts_at timestamptz NOT NULL,
  category text NOT NULL,
  description text NOT NULL,
  capacity integer NOT NULL CHECK (capacity > 0)
);
CREATE TABLE IF NOT EXISTS event_registrations (
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (event_id, student_id)
);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, created_at DESC);
