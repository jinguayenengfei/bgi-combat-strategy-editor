// 条件表达式解析/释义/校验自测：node tools/test_cond.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { readSources, root } from './build.mjs';

const ctx = { console };
vm.createContext(ctx);
// 只加载前三个文件即可（角色表 / 指令表 / 条件）
const src = readSources({ skipMissing: true }).filter(s => ['data_avatars.js', 'data_commands.js', 'cond.js'].includes(s.file)).map(s => s.code).join('\n');
vm.runInContext(src, ctx);

const run = (code) => vm.runInContext(code, ctx);
const { condValidate, condParse, condToText, condExplain, condRewriteIndexes, isValidActionName } = run(
  '({condValidate, condParse, condToText, condExplain, condRewriteIndexes, isValidActionName, COND_FUNCTIONS})'
);

const cases = [
  't>1.5 && since>0.7',
  'e-ready',
  '(low-hp || since(41)<3) && q-ready',
  'since>8 || since>since(45)',
  'count=0 || since(38)>since(44)',
  'low-hp&&q-ready',
  'false',
  '',
  'count(31, t-15, t) + count(100, t-15, t) * 2 - count(30, t-15, t)>0',
  'min(since(), 5) > 3',
  'last-exec(2,true,3)',
  'q-ready(芙宁娜) && e-ready(芙宁娜)',
  'e-cd<2',
  'in-party(芙宁娜) && q-ready',
  't-5>0',
  '芙芙e-开场',
  'since(芙芙e)>5',
  't==5',
  'q-ready（芙宁娜）',
  'True',
  'since(不存在的动作)>5',
  'q-redy',
  'count(1,2,3,4)',
  'a<b<c',
  't>1 && (q-ready',
];

const actionNames = ['检查战斗结束', '芙芙e', '芙芙q', '奶奶开盾'];
for (const c of cases) {
  const r = condValidate(c, { actionNames, knownIndexes: new Set([1, 20, 30, 41, 44, 100]) });
  const parsed = condParse(c, actionNames);
  console.log('--- ' + JSON.stringify(c));
  if (parsed.error) console.log('  解析错误: ' + parsed.error);
  else {
    console.log('  规范写法: ' + condToText(parsed.ast));
    console.log('  释义: ' + condExplain(parsed.ast));
  }
  if (r.errors.length) console.log('  [错误] ' + r.errors.join(' | '));
  if (r.warnings.length) console.log('  [警告] ' + r.warnings.join(' | '));
}

const rw = condRewriteIndexes(condParse('count(31, t-15, t) + count(100, t-15, t) * 2 - count(30, t-15, t)>0', actionNames).ast, new Map([[31, 31001], [100, 41001], [30, 39001]]));
console.log('--- 引用重写后: ' + condToText(rw.ast));

for (const n of ['检查战斗结束', '芙芙-e-开场', 'e2', '真', 't', 'true', '1', 'a b', 'a,b']) {
  const v = isValidActionName(n, actionNames);
  console.log(`名称 ${JSON.stringify(n)} → ${v.ok ? '合法' : '非法：' + v.reason}`);
}

console.log('\n别名合并检查（不应被拆成减号）:');
for (const c of ['e-ready', 'last-exec(5)', 'low-hp', 'e-cd>0', 'q-ready', 'battle-time(5)', 'last-check>3', '芙芙e-开场']) {
  const r = condParse(c, actionNames);
  console.log('  ' + c + ' → ' + (r.error ? 'ERR ' + r.error : condToText(r.ast)));
}

/* ---------- 回归：规范化渲染 → 重新解析 必须保语义（一元运算符的括号） ---------- */
const stripAst = (n) => {
  if (!n || typeof n !== 'object') return n;
  if (n.type === 'binary') return ['binary', n.op, stripAst(n.left), stripAst(n.right)];
  if (n.type === 'unary') return ['unary', n.op, stripAst(n.operand)];
  if (n.type === 'call') return ['call', n.name, (n.args || []).map(stripAst)];
  if (n.type === 'ident') return ['ident', n.name];
  if (n.type === 'number') return ['number', n.value];
  if (n.type === 'bool') return ['bool', n.value];
  return [n.type];
};

console.log('\n往返保语义检查（规范化写法 → 重新解析）:');
const roundTripCases = [
  ['!(in-party(钟离) || in-party(玛薇卡))', '!(in-party(钟离) || in-party(玛薇卡))'],
  ['!(in-party(钟离) && in-party(玛薇卡))', '!(in-party(钟离) && in-party(玛薇卡))'],
  ['!(t < 14)', '!(t < 14)'],
  ['-(t - 5)', '-(t - 5)'],
  ['!(t>1.5) || q-ready', '!(t > 1.5) || q-ready'],
  ['!low-hp && in-party(钟离)', '!low-hp && in-party(钟离)'],
  ['!(!(t))', '!!t'],
];
let roundTripBad = 0;
for (const [src, want] of roundTripCases) {
  const p1 = condParse(src, actionNames);
  const text = p1.error ? 'ERR ' + p1.error : condToText(p1.ast);
  const p2 = p1.error ? { error: '未渲染' } : condParse(text, actionNames);
  const same = !p1.error && !p2.error && JSON.stringify(stripAst(p1.ast)) === JSON.stringify(stripAst(p2.ast));
  const ok = same && text === want;
  if (!ok) roundTripBad++;
  console.log(`  ${ok ? '✔' : '✘'} ${src} → ${text}`
    + (ok ? '' : `（期望 ${want}${p2.error ? '；重新解析：' + p2.error : ''}）`));
}
if (roundTripBad) {
  console.log(`  ${roundTripBad} 项往返检查失败`);
  process.exitCode = 1;
} else {
  console.log('  全部通过');
}
