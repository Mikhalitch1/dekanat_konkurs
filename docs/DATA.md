# DATA

## Таблицы (минимум)
users(id uuid, login, password_hash, role)
students(user_id, full_name, faculty, program, course, group_id)
groups(id, name)
disciplines(id, name, teacher_id, kind)
teachers(id, full_name)
schedule_entries(id, group_id, discipline_id, room, starts_at, ends_at, type)
schedule_changes(id, schedule_entry_id, kind[moved|cancelled|room], note, created_at)
grades(id, student_id, discipline_id, kind, points, max_points, date)
session_results(id, student_id, discipline_id, form[exam|credit], result, term)
request_types(id, title, description, sla_days)
requests(id, student_id, type_id, comment, status, created_at, updated_at)
request_events(id, request_id, status, comment, actor_id, created_at)
announcements(id, title, body, audience, created_by, created_at)
notifications(id, user_id, kind, title, body, read_at, created_at)
deadlines(id, student_id, discipline_id, title, due_at)

## Сиды (вымышленные)
- Студент 1: Артём Тестов, группа Б-101, 2 курс, оценки по 6 дисциплинам, смесь зелёных, жёлтых и одной красной.
- Студент 2: Лина Образцова, другая группа, другое расписание и оценки.
- Сотрудник: Мария Деканова (вымышленная).
- Заявки в разных статусах, переносы и отмена пары на ближайшую неделю, 3–4 объявления, дедлайны.
- Даты генерируются относительно текущей недели, чтобы демо всегда выглядело актуально.
- Демо-пароли выдаются только жюри, в БД хранятся хэши.

## Статусы заявки
submitted → accepted → in_progress → ready → issued (или rejected с комментарием).
