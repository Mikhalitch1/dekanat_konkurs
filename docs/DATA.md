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
- Студент 1: Артём Тестов, группа ТИГ(б)-О-23/1, курс и направление из шапки расписания (курс 2); подгруппа I, английский 2-29, французский 2-4(2). На следующих этапах — оценки по 6 дисциплинам, смесь зелёных, жёлтых и одной красной.
- Студент 2: Лина Образцова, группа ФЭТ(б)-О-23/1, курс и направление из шапки расписания (курс 2); подгруппа I, английский 2-22, испанский 2-5(2); другое расписание и оценки.
- Сотрудник: Мария Деканова (вымышленная).
- Заявки в разных статусах, переносы и отмена пары на ближайшую неделю, 3–4 объявления, дедлайны.
- Даты генерируются относительно текущей недели, чтобы демо всегда выглядело актуально.
- Демо-пароли выдаются только жюри, в БД хранятся хэши.

## Статусы заявки
submitted → accepted → in_progress → ready → issued (или rejected с комментарием).

## Реализованная схема этапа 0

Миграция db/migrations/000_schedule.sql содержит только часть, необходимую импорту: groups, teachers, disciplines, students и schedule_entries. Users, вход, пароли и остальные таблицы добавляются на этапе 1 и последующих этапах. Пока students.user_id — стабильный UUID демонстрационного пользователя без внешнего ключа к ещё не созданной users; login нужен для выбора демо-профиля в скриптах.

Дополнения к минимальной модели:
- groups: course, program, faculty из шапки исходника.
- students: subgroup, language_groups (массив строк «язык:номер группы»), elective_option. У обоих демо-студентов subgroup=I, elective_option=1.
- schedule_entries: subgroup (NULL — общее для группы), language, language_group, elective_option, parity, а также внутренние source_sheet, source_cell, source_merge, source_text для аудита. Source_text всегда обезличен и без исторических дат. Поля source_* не входят в студенческий DTO.
- Чётность первой недели — только FIRST_WEEK_PARITY в config/schedule.ts. Чётность не выводится из номера ISO-недели. Занятия разворачиваются в конкретные starts_at/ends_at на две недели от московского понедельника; готовый сид без исходника переносится с сохранением соответствия недель.
- Объединение C:D означает обе недели; только C или D — соответствующую неделю. Вертикальное объединение занятия охватывает время от начала первой до конца последней строки. Вертикальное объединение времени B задаёт один интервал для нескольких вариантов. Пустота вне объединения не заполняется.

Все пользовательские значения передаются параметрами SQL. Студенческая выборка связывает запись с students.group_id и учитывает subgroup, сочетание языка и номера языковой группы, elective_option. На этапе 1 идентификатор для этой внутренней функции должен поступать исключительно из сессии.
