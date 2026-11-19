import { existsSync } from 'node:fs';
import { mkdir, writeFile, chmod, readFile, appendFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

await mkdir('.local/tls',{recursive:true});
if (!existsSync('.env')) {
  const db=randomBytes(24).toString('hex');
  await writeFile('.env',`POSTGRES_PASSWORD=${db}\nDATABASE_URL=postgres://dekanat:${db}@localhost:54329/dekanat\nAPP_ORIGIN=https://localhost:8443\nDEMO_PASSWORD_STUDENT_ARTEM=${randomBytes(18).toString('base64url')}\nDEMO_PASSWORD_STUDENT_LINA=${randomBytes(18).toString('base64url')}\nDEMO_PASSWORD_STAFF=${randomBytes(18).toString('base64url')}\nPII_KEY=${randomBytes(32).toString('base64')}\n`,{mode:0o600});
}
if (!(await readFile('.env','utf8')).includes('PII_KEY=')) await appendFile('.env',`PII_KEY=${randomBytes(32).toString('base64')}\n`);
await chmod('.env',0o600);
if (!existsSync('.local/tls/localhost.crt')) {
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout','.local/tls/localhost.key','-out','.local/tls/localhost.crt','-days','30','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
  await chmod('.local/tls/localhost.key',0o600);
}
console.log('Локальное окружение готово. Пароли находятся только в .env. Адрес: https://localhost:8443');
