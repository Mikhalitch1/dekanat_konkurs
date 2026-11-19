CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  login text NOT NULL UNIQUE,
  password_hash text,
  role text NOT NULL CHECK (role IN ('student','staff')),
  display_name text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT false,
  CHECK (NOT active OR (password_hash IS NOT NULL AND password_hash LIKE '$argon2id$%'))
);
-- Existing stage-0 profiles have no credentials and remain unable to log in.
INSERT INTO users(id,login,role,active)
  SELECT user_id,login,'student',false FROM students ON CONFLICT (id) DO NOTHING;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='students_user_fk') THEN
    ALTER TABLE students ADD CONSTRAINT students_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY CHECK (length(token_hash)=64),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  csrf_token text NOT NULL CHECK (length(csrf_token)>=32),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS schedule_changes (
  id uuid PRIMARY KEY,
  schedule_entry_id uuid NOT NULL REFERENCES schedule_entries(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('moved','cancelled','room')),
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS grades (
  id uuid PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
  discipline_id uuid NOT NULL REFERENCES disciplines(id),
  kind text NOT NULL,
  points numeric NOT NULL CHECK (points>=0),
  max_points numeric NOT NULL CHECK (max_points>0 AND points<=max_points),
  date date NOT NULL
);
CREATE INDEX IF NOT EXISTS grades_student ON grades(student_id);
CREATE TABLE IF NOT EXISTS session_results (
  id uuid PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
  discipline_id uuid NOT NULL REFERENCES disciplines(id),
  form text NOT NULL CHECK (form IN ('exam','credit')),
  result text NOT NULL,
  term text NOT NULL
);
CREATE TABLE IF NOT EXISTS request_types (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL,
  sla_days integer NOT NULL CHECK (sla_days>0)
);
CREATE TABLE IF NOT EXISTS requests (
  id uuid PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
  type_id uuid NOT NULL REFERENCES request_types(id),
  comment text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('submitted','accepted','in_progress','ready','issued','rejected')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS requests_student ON requests(student_id);
CREATE TABLE IF NOT EXISTS request_events (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('submitted','accepted','in_progress','ready','issued','rejected')),
  comment text NOT NULL DEFAULT '',
  actor_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS announcements (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  body text NOT NULL,
  audience text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS deadlines (
  id uuid PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
  discipline_id uuid NOT NULL REFERENCES disciplines(id),
  title text NOT NULL,
  due_at timestamptz NOT NULL
);
