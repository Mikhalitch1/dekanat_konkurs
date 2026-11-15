import { createHash } from 'node:crypto';
import type ExcelJS from 'exceljs';

// These patterns describe names; no source name or reversible mapping is stored.
const surnameFirst = /([А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?)\s*([А-ЯЁA-Z])\.\s*(?:([А-ЯЁA-Z])\.?)?/gu;
const initialsFirst = /([А-ЯЁA-Z])\.\s*(?:([А-ЯЁA-Z])\.\s*)?([А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?)/gu;
const fullName = /([А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?)\s+([А-ЯЁ][а-яё]+)\s+([А-ЯЁ][а-яё]*(?:вич|вна))(?![А-ЯЁа-яё])/gu;
interface Person { surname: string; identity: string }

export function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object' && 'richText' in value) {
    return value.richText.map((piece) => piece.text).join('');
  }
  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') return value.text;
  // Formula results are deliberately not interpreted as source lessons.
  return '';
}

function person(surname: string, first: string, second = ''): Person {
  return { surname, identity: `${surname}:${first[0]}${second[0] ?? ''}`.toLocaleLowerCase('ru').replaceAll('ё', 'е') };
}

function peopleIn(text: string): Person[] {
  text = text.normalize('NFC');
  return [
    ...Array.from(text.matchAll(new RegExp(surnameFirst))).map((m) => person(m[1]!, m[2]!, m[3])),
    ...Array.from(text.matchAll(new RegExp(initialsFirst))).map((m) => person(m[3]!, m[1]!, m[2])),
    ...Array.from(text.matchAll(new RegExp(fullName))).map((m) => person(m[1]!, m[2]!, m[3])),
  ];
}

function sourcePeople(workbook: ExcelJS.Workbook): Person[] {
  const people = new Map<string, Person>();
  for (const sheet of workbook.worksheets) {
    sheet.eachRow((row) => row.eachCell((cell) => {
      if (cell.isMerged && cell.master.address !== cell.address) return;
      for (const entry of peopleIn(cellText(cell))) people.set(entry.identity, entry);
    }));
  }
  return [...people.values()];
}

export function extractSourceSurnames(workbook: ExcelJS.Workbook): string[] {
  return [...new Set(sourcePeople(workbook).map((p) => p.surname))].sort((a, b) => b.length - a.length || a.localeCompare(b, 'ru'));
}

export function stableId(value: string): string {
  const digest = createHash('sha256').update(`dekanat-stage0:${value}`).digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function alias(identity: string): string {
  const key = identity.toLocaleLowerCase('ru').replaceAll('ё', 'е');
  return `Преподаватель ${createHash('sha256').update(`teacher:${key}`).digest('hex').slice(0, 10)}`;
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createAnonymizer(workbook: ExcelJS.Workbook): (text: string) => string {
  const people = sourcePeople(workbook);
  const surnames = [...new Set(people.map((p) => p.surname))].sort((a, b) => b.length - a.length);
  const surnameAliases = new Map(surnames.map((surname) => {
    const identities = new Set(people.filter((p) => p.surname === surname).map((p) => p.identity));
    return [surname, alias(identities.size === 1 ? [...identities][0]! : `${surname}:unspecified`)];
  }));
  return (text: string): string => {
    let result = text.normalize('NFC').replace(new RegExp(fullName), (_match, surname: string, first: string, second: string) => alias(person(surname, first, second).identity));
    result = result.replace(new RegExp(surnameFirst), (_match, surname: string, first: string, second: string) => alias(person(surname, first, second).identity));
    result = result.replace(new RegExp(initialsFirst), (_match, first: string, second: string, surname: string) => alias(person(surname, first, second).identity));
    // Replace surname-only repetitions anywhere in a cell, not just a teacher field.
    for (const surname of surnames) {
      result = result.replace(new RegExp(escaped(surname), 'giu'), surnameAliases.get(surname)!);
    }
    return result;
  };
}

export function normalizeText(text: string): string {
  return text.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

export function datesIn(text: string): string[] {
  return text.match(/\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/gu) ?? [];
}

export function withoutDates(text: string): string {
  return normalizeText(text.replace(/\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/gu, ' '));
}
