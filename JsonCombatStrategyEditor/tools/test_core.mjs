// 核心逻辑自测：node tools/test_core.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { readSources, findSampleJson } from './build.mjs';

const ctx = { console };
vm.createContext(ctx);
const src = readSources({ skipMissing: true })
  .filter(s => ['data_avatars.js', 'data_commands.js', 'cond.js', 'core.js'].includes(s.file))
  .map(s => s.code).join('\n');
vm.runInContext(src, ctx);
const g = (code) => vm.runInContext(code, ctx);

const A = g('({state, AVATARS, parseIndex, makeIndex, computePriority, priorityRange, buildExpression, buildMorePriorities, addAction, changeActionType, parseActionString, buildJson, analyzeImport, applyImport, planRenumber, applyRenumber, validateStrategy, changeActionType, expandPriorities})');

console.log('=== parseIndex 自检 ===');
for (const ix of [1, 9, 1000, 10001, 11111, 90001, 51111, 0, 10, 99999, 100000]) {
  console.log(` ${ix} → ${JSON.stringify(A.parseIndex(ix))}`);
}
for (const p of [[0, 0, 0, 1], [1, 1, 11, 1], [9, 0, 0, 1], [5, 1, 1, 2]]) {
  console.log(` makeIndex(${p}) → ${g('makeIndex')(...p)}`);
}

// 1) 示例策略导入
const sample = JSON.parse(fs.readFileSync(findSampleJson(), 'utf8'));
const res = g('analyzeImport')(sample);
console.log('=== 导入分析 ===');
console.log('致命错误:', res.fatal);
console.log('问题数:', res.problems.length);
for (const p of res.problems.slice(0, 20)) console.log('  -', p.kind, p.text);
g('applyImport')(res);
console.log('导入动作数:', A.state.strategy.actions.length);

// 2) 校验
let v = g('validateStrategy')();
console.log('\n=== 导入后校验 ===');
console.log('错误', v.errors.length, '警告', v.warnings.length);
for (const e of v.errors) console.log('  [错误]', e.text);
for (const w of v.warnings.slice(0, 10)) console.log('  [警告]', w.text);

// 3) 编号重排
const plan = g('planRenumber')();
console.log('\n=== 重排方案 ===');
if (plan.error) console.log('  ', plan.error);
else {
  console.log('  变更条数:', plan.changes.length);
  for (const c of plan.changes) console.log(`   ${c.character || '当前角色'} ${c.name}: ${c.from} -> ${c.to}`);
}
const notes = g('applyRenumber')(plan);
console.log('  重写说明:', notes.slice(0, 5));
v = g('validateStrategy')();
console.log('  重排后错误', v.errors.length, '警告', v.warnings.length);
for (const e of v.errors) console.log('  [错误]', e.text);

// 4) 导出
const out = g('buildJson')();
console.log('\n=== 导出预览 ===');
console.log(JSON.stringify(out.info, null, 1));
console.log('actions 数:', out.actions.length);
console.log('前 3 条:', JSON.stringify(out.actions.slice(0, 3), null, 1));
const check = g('analyzeImport')(out);
console.log('回读问题:', check.fatal, check.problems.length);
for (const p of check.problems) console.log('  -', p.kind, p.text);

// 5) 新增动作 + 容量上限
g('state').strategy.actions = [];
console.log('\n=== 新建流程 ===');
console.log(g('JSON.stringify(addAction("芙宁娜", 5, {name:"芙宁娜-q", action:"q,wait(0.1),ready"}))'));
console.log(g('JSON.stringify(addAction("芙宁娜", 5, {name:"芙宁娜-q2"}))'));
console.log('index:', g('state').strategy.actions.map(a => a.index));
console.log('切换类型到 1（开盾）:', g('JSON.stringify(changeActionType(state.strategy.actions[1].id, 1))'));
console.log('index/ensureCast:', g('state').strategy.actions.map(a => [a.index, a.ensureCast]));
for (let i = 0; i < 8; i++) g('addAction("芙宁娜", 1, {name:"开盾' + i + '"})');
console.log('开盾类型已放置:', g('state').strategy.actions.filter(a => a.type === 1).length, '条');
console.log('第 10 条（应失败）:', g('JSON.stringify(addAction("芙宁娜", 1, {}))'));

// 6) priority 推导
console.log('\n=== priority 推导 ===');
for (const spec of [
  { type: 0 }, { type: 1 }, { type: 4, element: 3 }, { type: 4, element: 3, character: '芙宁娜' }, { type: 9 }
]) {
  const before = g('computePriority')(spec, 'before', g('state').strategy.actions);
  const after = g('computePriority')(spec, 'after', g('state').strategy.actions);
  if (!before || !after) { console.log(` ${g('scopeLabel')(spec)} → 该段无法定位（元素/角色不匹配）`); continue; }
  console.log(` ${g('scopeLabel')(spec)} → 优先于: ${before.priority}${before.empty ? '(空段，取边界)' : ''} / 次于: ${after.priority}${after.empty ? '(空段，取边界)' : ''}`);
}

// 7) 指令串解析
console.log('\n=== 指令串校验 ===');
for (const s of [
  'q,wait(0.1),ready',
  'attack,e',
  'keydown(w),wait(0.05),keyup(w),click',
  'skill(hold)',
  'walk(s, 0.2)',
  'charge(4.15)',
  'attack(0.01),keypress(e)',
  'wait(0.2)',
  'click(middle),scroll(10)',
  'e|e',
  'round(1),attack',
  'E',
  'attack(0)',
  'moveby(1800,0)',
  'keydown(E)',
  'keydown(lbutton)',
  'aim',
]) {
  const r = g('parseActionString')(s);
  const fs2 = g('firstSwitchInfo')(r.parts);
  console.log(` ${s}\n   错误: ${r.errors.join(' | ') || '无'}\n   首指令切人: ${fs2.canSwitch} ${fs2.reason || ''}`);
}

// 8) 队友条件组装
console.log('\n=== 队友条件组装 ===');
g('state').strategy.actions = [];
g('addAction')('', 9, { name: '兜底', action: 'wait(0.2)' });
g('addAction')('芙宁娜', 4, { name: '芙芙e', action: 'e,wait(0.3)' });
const fa = g('state').strategy.actions[1];
fa.conditionText = 'e-ready';
fa.teammates.include = ['枫原万叶'];
fa.teammates.exclude = ['钟离', '纳西妲'];
fa.teammates.autoExclude = [g('state').strategy.actions[0].id];
g('state').strategy.actions[0].teammates.include = ['玛薇卡'];
fa.morePriorities.push({ id: 'm1', text: 'since>20', priority: 0, cmp: 'before', scope: { type: 5, element: '', character: '' } });
console.log('基础 expression:', g('buildExpression')(fa, g('state').strategy.actions));
console.log('额外条目:', JSON.stringify(g('buildMorePriorities')(fa, g('state').strategy.actions), null, 1));
console.log('索引:', g('state').strategy.actions.map(a => [a.name, a.index, a.type, a.slot]));
v = g('validateStrategy')();
console.log('校验: 错误', v.errors.length, '警告', v.warnings.length);
for (const e of v.errors) console.log('  [错误]', e.text);
for (const w of v.warnings) console.log('  [警告]', w.text);
console.log('导出:', JSON.stringify(g('buildJson')(), null, 1));

// 9) 表达式整体加括号 + 隐式转换检查 + priority 段边界
console.log('\n=== 表达式与隐式转换 ===');
g('state').strategy.actions = [];
g('addAction')('', 9, { name: '兜底', action: 'wait(0.2)' });
g('addAction')('芙宁娜', 4, { name: '芙芙e', action: 'e,wait(0.3)' });
const fa2 = g('state').strategy.actions[1];
fa2.conditionText = 'low-hp || q-ready';
fa2.teammates.include = ['枫原万叶', '纳西妲'];
fa2.teammates.includeOps = ['or'];
console.log('基础+队友（混用与或）:', g('buildExpression')(fa2, g('state').strategy.actions));
fa2.teammates.includeOps = ['and'];
console.log('基础+队友（全部取与）:', g('buildExpression')(fa2, g('state').strategy.actions));
console.log('priority 段边界 type0:', JSON.stringify(g('prioritySpan')({ type: 0 })));
console.log('priority 段边界 type9:', JSON.stringify(g('prioritySpan')({ type: 9 })));
for (const expr of ['count > t', 'low-hp + 1', 'min(low-hp, 3)', 'e-cd < 2', 'since + 1', 'q-ready && low-hp']) {
  const p = g('condParse')(expr, ['兜底', '芙芙e']);
  const conv = p.error ? [] : g('condCollectConversions')(p.ast, ['兜底', '芙芙e']);
  console.log(` ${expr} → ${p.error ? '语法错误：' + p.error : (conv.length ? conv.map(c => c.text + '（' + c.reason + '）').join('；') : '无隐式转换')}`);
}

// 10) 导入时动作类型推定
console.log('\n=== 导入类型推定 ===');
for (const [act, ec] of [['e,wait(0.2)', true], ['e,wait(0.2)', false], ['q,wait(0.1),ready', false], ['attack,charge(1)', false], ['wait(0.2)', false]]) {
  console.log(` ${act}（ensureCast=${ec}）→ 类型 ${g('inferActionType')(act, '', ec)}`);
}
