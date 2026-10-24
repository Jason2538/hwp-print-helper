// 템플릿에 PDF 엔진(pdf.js)을 일반 스크립트로 바꿔 끼워 넣어 단일 HTML 파일을 만든다.
// (blob/모듈 가져오기를 쓰지 않으므로 file:// 로 열어도 막히지 않는다)
const fs = require('fs');
const path = require('path');

const lib = '/opt/npm-tools/node_modules/pdfjs-dist/legacy/build';
const tpl = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
const read = f => fs.readFileSync(path.join(lib, f), 'utf8');

function mainScript(src){
  src = src.replace(/import\.meta\.url/g, '""');
  const re = /export \{([^}]*)\};/g; let m, last = null;
  while ((m = re.exec(src))) last = m;
  if (!last) throw new Error('export 구문을 찾지 못했어요');
  const names = last[1].split(',').map(x => x.trim()).filter(Boolean);
  if (names.some(n => /\s/.test(n))) throw new Error('이름 바꾸기 export가 있어요');
  src = src.slice(0, last.index) + 'globalThis.__pdfjs = {' + names.join(',') + '};' + src.slice(last.index + last[0].length);
  return '(function(){\n' + src + '\n})();';
}
function workerScript(src){
  if (!/export\s*\{\s*WorkerMessageHandler\s*\}\s*;?/.test(src)) throw new Error('워커 export를 찾지 못했어요');
  src = src.replace(/export\s*\{\s*WorkerMessageHandler\s*\}\s*;?/, '').replace(/import\.meta\.url/g, '""');
  return '(function(){\n' + src + '\n})();';
}
const guard = t => { if (/<\/script|<!--/i.test(t)) throw new Error('HTML에 넣을 수 없는 문자열이 있어요'); return t; };

const hwpJs = ['/opt/npm-tools/node_modules/pako/dist/pako_inflate.min.js', path.join(__dirname, 'src/core.js'), path.join(__dirname, 'src/render.js'), path.join(__dirname, 'src/equation.js')]
  .map(f => fs.readFileSync(f, 'utf8')).join('\n;\n');

const out = tpl
  .split('__HWP_JS__').join(guard(hwpJs))
  .split('__PDF_JS__').join(guard(mainScript(read('pdf.mjs'))))
  .split('__WORKER_JS__').join(guard(workerScript(read('pdf.worker.min.mjs'))));

const dest = process.argv[2] || path.join(__dirname, 'print-helper.html');
fs.writeFileSync(dest, out);
console.log('written', dest, (out.length / 1048576).toFixed(2) + ' MB');
