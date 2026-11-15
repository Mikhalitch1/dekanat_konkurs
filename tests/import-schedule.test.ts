import ExcelJS from 'exceljs';
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAnonymizer, extractSourceSurnames, importScheduleFile, importWorkbook } from '../scripts/import-schedule/index.js';

const now = new Date('2026-11-12T12:00:00+03:00');

function fixture(): { workbook: ExcelJS.Workbook; sheet: ExcelJS.Worksheet } {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('ТИГ2 ');
  sheet.getCell('A2').value = 'Факультет учебных примеров';
  sheet.getCell('A9').value = '2 курс, очная форма обучения';
  sheet.getCell('A10').value = 'НАПРАВЛЕНИЕ ПОДГОТОВКИ - 43.03.02 Туризм';
  sheet.getCell('C13').value = 'ТИГ(б)-О-23/1';
  sheet.mergeCells('A14:A20');
  sheet.getCell('A14').value = 'Понедельник';
  sheet.getCell('B14').value = '09.00-10.20';
  sheet.getCell('B15').value = '10.35-11.55';
  return { workbook, sheet };
}

describe('schedule import', () => {
  it('imports a C:D merge on both weeks, and leaves genuinely empty cells empty', () => {
    const { workbook, sheet } = fixture();
    sheet.mergeCells('C14:D14');
    sheet.getCell('C14').value = 'Алгебра (ЛК) Тестин А.Б. ауд.101';
    sheet.getCell('C15').value = 'Анализ (ПЗ) ауд.102';
    const result = importWorkbook(workbook, { now });
    expect(result.entries).toHaveLength(3);
    expect(result.entries.filter((e) => e.source_cell === 'C14').map((e) => e.parity)).toEqual(['odd', 'even']);
    expect(result.entries.filter((e) => e.source_cell === 'C15').map((e) => e.parity)).toEqual(['odd']);
    expect(result.entries.every((e) => e.source_cell !== 'D15')).toBe(true);
    expect(result.report.nonempty_cells).toBe(2);
    expect(result.entries[0]?.type).toBe('lecture');
  });

  it('extends a vertical lesson to the end time of its final covered row', () => {
    const { workbook, sheet } = fixture();
    sheet.mergeCells('C14:C15');
    sheet.getCell('C14').value = 'Исследовательский семинар (ПЗ) ауд.103';
    const result = importWorkbook(workbook, { now });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ starts_at: '2026-11-09T06:00:00.000Z', ends_at: '2026-11-09T08:55:00.000Z', source_merge: 'C14:C15', parity: 'odd' });
  });

  it('supports a rectangular long lesson on both weeks', () => {
    const { workbook, sheet } = fixture();
    sheet.mergeCells('C14:D15');
    sheet.getCell('C14').value = 'Проектирование (ЛК/ПЗ) ауд.104';
    const result = importWorkbook(workbook, { now });
    expect(result.entries).toHaveLength(2);
    expect(result.entries.map((e) => e.ends_at.slice(11, 16))).toEqual(['08:55', '08:55']);
    expect(result.report.nonempty_cells).toBe(1);
    expect(result.entries[0]?.type).toBe('lecture_practice');
  });

  it('preserves subgroup and language group alternatives separately', () => {
    const { workbook, sheet } = fixture();
    sheet.getCell('C14').value = 'Эконометрика (ПЗ) (II гр.) ауд.105';
    sheet.getCell('C15').value = 'Иностранный язык (ПЗ) английский язык гр.2-22 ауд.449 гр.2-24 ауд.515 испанский язык гр.2-1(1) ауд.421';
    const result = importWorkbook(workbook, { now });
    expect(result.entries.find((e) => e.source_cell === 'C14')?.subgroup).toBe('II');
    expect(result.entries.filter((e) => e.source_cell === 'C15').map((e) => [e.language, e.language_group, e.room])).toEqual([
      ['английский', '2-22', '449'], ['английский', '2-24', '515'], ['испанский', '2-1(1)', '421'],
    ]);
  });

  it('keeps unlabeled parallel electives distinct instead of stacking them for every student', () => {
    const { workbook, sheet } = fixture();
    sheet.mergeCells('B14:B15');
    sheet.getCell('C14').value = 'Проект А (ЛК) ауд.106';
    sheet.getCell('C15').value = 'Проект Б (ЛК) ауд.107';
    const result = importWorkbook(workbook, { now });
    expect(result.entries.map((e) => e.elective_option)).toEqual(['1', '2']);
    expect(result.report.warnings.filter((w) => w.reason.startsWith('parallel_elective'))).toHaveLength(2);
  });

  it('uses distinct IDs for different languages sharing one language-group number', () => {
    const { workbook, sheet } = fixture();
    sheet.getCell('C14').value = 'Второй иностранный язык (ПЗ) арабский язык гр.2-2(2) ауд.415 немецкий язык гр.2-2(2) ауд.536';
    const result = importWorkbook(workbook, { now });
    expect(result.entries).toHaveLength(2);
    expect(new Set(result.entries.map((e) => e.id)).size).toBe(2);
    expect(result.entries.map((e) => [e.language, e.language_group, e.room])).toEqual([
      ['арабский', '2-2(2)', '415'], ['немецкий', '2-2(2)', '536'],
    ]);
  });

  it('deduplicates exactly repeated variants while preserving different rooms', () => {
    const { workbook, sheet } = fixture();
    sheet.getCell('C14').value = 'Иностранный язык (ПЗ) английский язык гр.2-22 ауд.415 гр.2-22 ауд.415 гр.2-22 ауд.536';
    const result = importWorkbook(workbook, { now });
    expect(result.entries).toHaveLength(2);
    expect(new Set(result.entries.map((e) => e.id)).size).toBe(2);
  });

  it('ignores all text dates, reports them, and uses the current Moscow week', () => {
    const { workbook, sheet } = fixture();
    sheet.getCell('C14').value = 'Алгебра (ПЗ) 22.03.2024 ауд.108';
    const result = importWorkbook(workbook, { now });
    expect(result.entries[0]?.starts_at).toBe('2026-11-09T06:00:00.000Z');
    expect(result.entries[0]?.source_text).not.toContain('22.03.2024');
    expect(result.report.ignored_dates[0]?.dates).toEqual(['22.03.2024']);
    expect(result.report.ignored_dates[0]?.text).not.toContain('22.03.2024');
  });

  it('takes course/program from the header and supports an even first week', () => {
    const { workbook, sheet } = fixture();
    sheet.getCell('D14').value = 'Алгебра (ЛК) ауд.109';
    const result = importWorkbook(workbook, { now: new Date('2035-03-04T21:15:00Z'), firstWeekParity: 'even', weeks: 1 });
    expect(result.groups[0]).toMatchObject({ course: 2, program: '43.03.02 Туризм', faculty: 'Факультет учебных примеров' });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.parity).toBe('even');
    expect(result.report.week_start).toBe('2035-03-05');
  });

  it('anonymizes entire cells including surname-only repeats and all-sheet signatures', () => {
    const { workbook, sheet } = fixture();
    sheet.getCell('C14').value = 'Алгебра (ЛК) Тестин А.Б. ауд.110, консультация: Тестин';
    sheet.getCell('D5').value = 'В.Г. Примерова';
    const hidden = workbook.addWorksheet('Архив');
    hidden.state = 'hidden';
    hidden.getCell('A1').value = 'Архивин Д.Е.';
    const sourceNames = extractSourceSurnames(workbook);
    expect(sourceNames).toContain('Тестин');
    expect(sourceNames).toContain('Примерова');
    expect(sourceNames).toContain('Архивин');
    const result = importWorkbook(workbook, { now });
    const serialized = JSON.stringify(result);
    for (const name of sourceNames) expect(serialized).not.toContain(name);
    const anonymous = createAnonymizer(workbook);
    expect(anonymous('Тестин А.Б.')).toBe(anonymous('Тестин'));
    expect(result.teachers[0]?.full_name).toMatch(/^Преподаватель [a-f0-9]{10}$/u);
    expect(result.report.skipped_sheets).toEqual(['Архив']);
  });

  it('reports strange cells honestly and does not inherit unrelated missing times', () => {
    const { workbook, sheet } = fixture();
    sheet.getCell('C14').value = 'Алгебра (ПЗ) ауд.111';
    sheet.getCell('C17').value = 'Неоднозначный практикум';
    sheet.getCell('C18').value = 'обед';
    const result = importWorkbook(workbook, { now });
    expect(result.report.nonempty_cells).toBe(3);
    expect(result.report.recognized_cells).toBe(2);
    expect(result.report.recognition_rate).toBeCloseTo(2 / 3);
    expect(result.report.unrecognized).toMatchObject([{ cell: 'C17', reason: 'missing_time' }]);
    expect(result.entries).toHaveLength(1);
  });

  it('keeps teachers with the same surname and different initials distinct', () => {
    const { workbook, sheet } = fixture();
    sheet.getCell('C14').value = 'Алгебра (ПЗ) Тестин А.Б. ауд.111';
    sheet.getCell('C15').value = 'Алгебра (ПЗ) Тестин В.Г. ауд.112';
    sheet.getCell('D5').value = 'Примерова Анна Викторовна';
    const result = importWorkbook(workbook, { now });
    expect(result.teachers).toHaveLength(2);
    expect(result.teachers[0]?.id).not.toBe(result.teachers[1]?.id);
    expect(extractSourceSurnames(workbook)).toContain('Примерова');
    expect(createAnonymizer(workbook)('Примерова Анна Викторовна')).not.toContain('Примерова');
    expect(createAnonymizer(workbook)('Тестин')).not.toContain('Тестин');
  });

  it('is deterministic and rejects invalid bounded import parameters', () => {
    const { workbook, sheet } = fixture();
    sheet.getCell('C14').value = 'Алгебра (ПЗ) ауд.112';
    expect(importWorkbook(workbook, { now })).toEqual(importWorkbook(workbook, { now }));
    expect(() => importWorkbook(workbook, { now, weeks: 0 })).toThrow('weeks');
  });

  const localSource = readdirSync('.').find((name) => name.endsWith('.xlsx'));
  it.skipIf(!localSource)('produces unique entry IDs across the entire local source workbook', async () => {
    const result = await importScheduleFile(localSource!, { now });
    expect(result.entries.length).toBeGreaterThan(0);
    expect(new Set(result.entries.map((entry) => entry.id)).size).toBe(result.entries.length);
  });
});
