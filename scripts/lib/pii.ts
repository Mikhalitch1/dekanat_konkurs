import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** Шифрование чувствительных полей (AES-256-GCM). Ключ — только из окружения сервера. */
function key(): Buffer {
  const raw = process.env.PII_KEY;
  if (raw) {
    const buffer = Buffer.from(raw, 'base64');
    if (buffer.length !== 32) throw new Error('PII_KEY должен быть 32 байта в base64');
    return buffer;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('PII_KEY не задан');
  return createHash('sha256').update('dekanat-development-only-key').digest();
}

export function encryptPii(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${body.toString('base64url')}`;
}

export function decryptPii<T>(token: string): T {
  const [version, iv, tag, body] = token.split('.');
  if (version !== 'v1' || !iv || !tag || !body) throw new Error('Неверный формат');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')) as T;
}

export interface PassportData { series: string; number: string; issued_by: string; issued_on: string; division_code: string }
export const maskSnils = (snils: string) => `***-***-${snils.replace(/\D/g, '').slice(6, 9)} **`;
export const maskPassport = (p: PassportData) => `** ** ***${p.number.slice(-3)}`;
