import {expect,it} from 'vitest';
import {RequestScope} from '../apps/web/src/request-scope.js';
it('ignores delayed account A success, 401 and finally after logout/login B, even if fetch ignores abort',async()=>{
  const scope=new RequestScope();const a=scope.begin();
  let resolve!:()=>void;const delayed=new Promise<void>(r=>{resolve=r;});
  let displayed='';let authenticated=true;let loading=true;
  const old=delayed.then(()=>{if(a.current()) displayed='A';if(a.current()) authenticated=false;if(a.current())loading=false;});
  scope.invalidate();const b=scope.begin();if(b.current())displayed='B';
  resolve();await old;
  expect(a.signal.aborted).toBe(true);expect(displayed).toBe('B');expect(authenticated).toBe(true);expect(loading).toBe(true);
});
