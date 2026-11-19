import { request } from 'node:https';
import assert from 'node:assert/strict';
import { loadEnvironment } from './lib/files.js';
loadEnvironment();
type Body=Record<string,unknown>;
async function call(path:string,cookie='',method='GET',body?:Body,token?:string) {
  return new Promise<{status:number;body:Body;cookie:string}>((resolve,reject)=>{
    const req=request(new URL(path,'https://localhost:8443'),{rejectUnauthorized:false,method,headers:{Origin:'https://localhost:8443',Cookie:cookie,'Content-Type':'application/json',...(token?{'X-CSRF-Token':token}:{})}},res=>{
      let text='';res.on('data',chunk=>{text+=chunk;});res.on('end',()=>{
        try {resolve({status:res.statusCode!,body:text?JSON.parse(text) as Body:{},cookie:res.headers['set-cookie']?.map(c=>c.split(';')[0]).join('; ')||cookie});}catch{reject(new Error('Expected API JSON'));}
      });
    });req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
  });
}
async function login(login:string,password:string|undefined) {
  assert(password,'Required demo password env');
  const anon=await call('/api/csrf');assert.equal(anon.status,200);
  const result=await call('/api/login',anon.cookie,'POST',{login,password},String(anon.body.csrfToken));
  assert.equal(result.status,200);return result;
}
assert.equal((await call('/api/schedule')).status,401);
const a=await login('student-artem',process.env.DEMO_PASSWORD_STUDENT_ARTEM);
const b=await login('student-lina',process.env.DEMO_PASSWORD_STUDENT_LINA);
const scheduleA=await call('/api/schedule',a.cookie),scheduleB=await call('/api/schedule',b.cookie);
assert.equal(scheduleA.status,200);assert.equal(scheduleB.status,200);
assert(!/source_|password_hash/.test(JSON.stringify([scheduleA.body,scheduleB.body])));
assert.notDeepEqual(scheduleA.body,scheduleB.body);
assert.equal((await call('/api/staff/requests',a.cookie)).status,403);
assert.equal((await call('/api/logout',a.cookie,'POST',{})).status,403);
assert.equal((await call('/api/logout',a.cookie,'POST',{},String(a.body.csrfToken))).status,204);
assert.equal((await call('/api/me',a.cookie)).status,401);
const staff=await login('staff-maria',process.env.DEMO_PASSWORD_STAFF);
assert.equal((await call('/api/staff/requests',staff.cookie)).status,200);
for(const session of [b,staff]) await call('/api/logout',session.cookie,'POST',{},String(session.body.csrfToken));
console.log('HTTPS smoke: 3 logins, isolated schedules, no source/hash fields, 401/403, CSRF and logout revocation — passed.');
