import { loadEnvironment, prepareSeed } from './lib/files.js';

loadEnvironment();
try {
  const {data,fromSource} = await prepareSeed();
  console.log(JSON.stringify({source:fromSource?'xlsx':'sanitized-seed',groups:data.groups.length,entries:data.entries.length,recognized:data.report.recognized_cells,total:data.report.nonempty_cells,recognition_rate:data.report.recognition_rate,unrecognized:data.report.unrecognized.length}));
} catch {
  console.error('Импорт не выполнен. Проверьте наличие XLSX/сида, конфиг и валидацию. Исходные данные в лог не выводятся.');
  process.exitCode=1;
}
