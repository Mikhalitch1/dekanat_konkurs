// Единственный источник чётности первой недели демо. Менять здесь.
export const FIRST_WEEK_PARITY: 'odd' | 'even' = 'odd';

export const DEMO_STUDENTS = [
  { login: 'student-artem', full_name: 'Артём Тестов', group: 'ТИГ(б)-О-23/1', subgroup: 'I', language_groups: ['английский:2-29', 'французский:2-4(2)'], elective_option: '1' },
  { login: 'student-lina', full_name: 'Лина Образцова', group: 'ФЭТ(б)-О-23/1', subgroup: 'I', language_groups: ['английский:2-22', 'испанский:2-5(2)'], elective_option: '1' },
] as const;
