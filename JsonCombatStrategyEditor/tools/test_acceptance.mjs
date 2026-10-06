// 端到端验收：node tools/test_acceptance.mjs
// 用工作区里实测可用的《公式化锄地（已修复）.json》跑完整链路，并逐项断言与 BetterGI 源码语义一致。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { readSources, findSampleJson, workspaceRoot } from './build.mjs';
import { createDom } from './dom.mjs';

const dom = createDom();
const ctx = {
  console, window: dom.window, document: dom.document, localStorage: dom.localStorage,
  Blob: class { }, FileReader: class { readAsText() { } },
  alert: () => { }, confirm: () => true,
  setTimeout, clearTimeout, setInterval, clearInterval, URL: dom.window.URL,
};
ctx.globalThis = ctx;
vm.createContext(ctx);
const src = readSources({ skipMissing: true }).map(s => s.code).join('\n');
vm.runInContext(src, ctx);
const g = (c) => vm.runInContext(c, ctx);

const R = [];
let fail = 0;
const ok = (name, detail) => { R.push(['✔', name, detail]); };
const bad = (name, detail) => { R.push(['✘', name, detail]); fail++; };
const tick = () => new Promise(r => setTimeout(r, 0));
// 支持同步与异步（导入/导出的弹窗回调在微任务里执行，需要 await tick()）
const checks = [];
const check = (name, fn) => { checks.push([name, fn]); };
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
async function runChecks() {
  for (const [name, fn] of checks) {
    try { const d = await fn(); ok(name, d); }
    catch (e) { bad(name, e && e.message ? e.message : String(e)); }
  }
}

const STATIC_IDS = ['tabs', 'hdrStatus', 'hdrIssues', 'btnIssues', 'paneInfo', 'paneActions', 'panePreview', 'side', 'footInfo', 'modal', 'modalTitle', 'modalBody', 'modalFoot'];
for (const id of STATIC_IDS) dom.document.mount(dom.document.getElementById(id));
dom.window.dispatch('DOMContentLoaded');
const $ = dom.window.$;

/* ============ 1. 导入真实策略 ============ */
const sampleText = fs.readFileSync(findSampleJson(), 'utf8');
let importPlan = null;

check('导入：真实示例策略能被接受（非语法/结构错误）', async () => {
  g('doImportFromText')(sampleText, '公式化锄地（已修复）.json');
  assert($('modalTitle').innerHTML.includes('导入前检查'), '未弹出导入前检查：' + $('modalTitle').innerHTML);
  const body = $('modalBody').innerHTML;
  assert(body.includes('index 编号不符合'), '未识别出编号问题');
  assert(body.includes('共 28 条动作'), '动作数识别错误');
  const btn = $('modalFoot').children.find(b => b.textContent.includes('调整编号后导入'));
  assert(btn, '缺少「调整编号后导入」按钮');
  btn.click();
  await tick(); await tick();
  // 示例策略里有尾数不为 0 的 priority（爱可菲q 的 43），需要先确认修正
  if ($('modalTitle').innerHTML.includes('priority 需要修正')) {
    const fix = $('modalFoot').children.find(b => b.textContent.includes('修正后导入'));
    assert(fix, '缺少「修正后导入」按钮');
    fix.click();
    await tick(); await tick();
  }
  const acts = g('state').strategy.actions;
  assert(acts.length === 28, '导入后动作数应为 28，实际 ' + acts.length);
  return `导入 ${acts.length} 条动作，信息 name=${g('state').strategy.info.name}`;
});

check('导入：info 三个字段与 config 均按原样保留', () => {
  const info = g('state').strategy.info;
  assert(info.name === '公式化锄地', 'name 丢失');
  assert(info.author === 'mno', 'author 丢失');
  assert(info.description.startsWith('配队公式'), 'description 丢失');
  assert(JSON.stringify(info.config) === '{}', 'config 应为空对象');
  return `${info.name} / ${info.author} / description ${info.description.length} 字`;
});

check('导入：编号按规则重排，类型 0 仍为 1 位', () => {
  const acts = g('state').strategy.actions;
  const byName = (n) => acts.find(a => a.name === n);
  // 元素号：1 冰 / 2 火 / 3 水 / 4 雷 / 5 风 / 6 岩 / 7 草
  const cases = [
    ['检查战斗结束', 1],
    ['奶奶开盾', 11161],       // 茜特菈莉 = 冰(1) · 16 → 1 1 16 1
    ['芙芙e', 43111],          // 芙宁娜 = 水(3) · 11 → 4 3 11 1
    ['木偶喷冰4秒', 81201],    // 桑多涅 = 冰(1) · 20，charge 推定类型 8 → 8 1 20 1
    ['等待', 90001],
  ];
  for (const [n, expect] of cases) {
    const a = byName(n);
    assert(a, `找不到动作「${n}」`);
    assert(a.index === expect, `「${n}」index 应为 ${expect}，实际 ${a.index}`);
  }
  // 类型 0 只用于当前角色
  assert(byName('检查战斗结束').character === '', '类型 0 动作的 character 应为空');
  return cases.map(([n, i]) => `${n}=${i}`).join('，');
});

check('导入：条件里的 index 引用随重排同步改写', () => {
  const acts = g('state').strategy.actions;
  const akf = acts.find(a => a.name === '爱可菲q');
  const furinaQ = acts.find(a => a.name === '芙芙q');
  assert(akf.conditionText.includes(String(furinaQ.index)), `引用未改写：${akf.conditionText}`);
  const woody = acts.find(a => a.name === '木偶喷冰4秒');
  const woodyE = acts.find(a => a.name === '木偶e');
  assert(woody.conditionText.includes(String(woodyE.index)), `引用未改写：${woody.conditionText}`);
  return `爱可菲q：${akf.conditionText}`;
});

check('导入后校验：0 错误（可导出）', () => {
  const v = g('validateStrategy')();
  assert(v.errors.length === 0, '仍有错误：' + v.errors.map(e => e.text).slice(0, 3).join(' | '));
  return `错误 0，警告 ${v.warnings.length}`;
});

/* ============ 2. 编辑动作 ============ */
check('编辑：新增动作自动编号并默认勾选开盾的 ensureCast', () => {
  g('state').ui.editingCharacter = '芙宁娜';
  const r = g('addAction')('芙宁娜', 1, { name: '芙宁娜-开盾', action: 'attack,e' });
  assert(r.ok, r.error);
  assert(r.action.index === 13111, 'index 应为 13111（开盾·水·芙宁娜11·第1条），实际 ' + r.action.index);
  assert(r.action.ensureCast === true, '开盾应默认 ensureCast=true');
  return `index=${r.action.index} ensureCast=${r.action.ensureCast}`;
});

check('编辑：必要/排除队友与自动排除拼进所有 expression', () => {
  const acts = g('state').strategy.actions;
  const a = acts.find(x => x.name === '芙宁娜-开盾');
  a.conditionText = 'e-ready';
  a.teammates.include = ['枫原万叶'];
  a.teammates.exclude = ['钟离'];
  const other = acts.find(x => x.name === '芙芙e');
  other.teammates.include = ['玛薇卡'];
  a.teammates.autoExclude = [other.id];
  a.morePriorities.push({ id: 'mp', text: 'low-hp', priority: 10000, cmp: 'before', scope: { type: 1, element: '', character: '' }, manualPriority: false });
  const main = g('buildExpression')(a, acts);
  const more = g('buildMorePriorities')(a, acts);
  for (const expr of [main, more[0].expression]) {
    assert(expr.includes('in-party(枫原万叶)'), '缺少必要队友：' + expr);
    assert(expr.includes('钟离'), '缺少排除队友：' + expr);
    assert(expr.includes('!(') && expr.includes('in-party(玛薇卡)'), '缺少自动排除：' + expr);
  }
  assert(main.startsWith('(e-ready) &&'), '主条件未在最前或未整体加括号：' + main);
  return main;
});

check('编辑：额外触发条件 priority 按分段基准值推导', () => {
  const acts = g('state').strategy.actions;
  const cases = [
    [{ type: 1 }, 'before', 10000],
    [{ type: 1 }, 'after', 20000],
    [{ type: 4, element: 3 }, 'before', 43000],          // 水元素 = 元素号 3
    [{ type: 4, element: 3 }, 'after', 44000],
    [{ type: 1, element: 3 }, 'before', 13000],          // 开盾的水元素段 = 10000 + 3×1000
    [{ type: 4, element: 3, character: '芙宁娜' }, 'before', 43110],
    [{ type: 9 }, 'after', 100000],
  ];
  for (const [scope, cmp, expect] of cases) {
    const c = g('computePriority')(scope, cmp, acts);
    assert(c && c.priority === expect, `${g('scopeLabel')(scope)} ${cmp} 应为 ${expect}，实际 ${c && c.priority}`);
  }
  return cases.map(([s, c, e]) => `${g('scopeLabel')(s)}/${c}=${e}`).join('，');
});

check('编辑：切换动作类型与容量上限提示', () => {
  const acts = g('state').strategy.actions;
  const a = acts.find(x => x.name === '芙宁娜-开盾');
  const before = a.slot;
  const r = g('changeActionType')(a.id, 4);
  assert(r.ok, r.error);
  const pi = g('parseIndex')(a.index);
  assert(pi.ok && pi.type === 4, '切换后 index 的类型位应为 4，实际 ' + a.index);
  assert(pi.code === 3 && pi.seq === 11, '切换后元素/角色位应保持水/芙宁娜，实际 ' + a.index);
  assert(pi.slot !== before || a.slot !== before, '切换类型后应重新分配尾数');
  // 填满开盾类型后再转入应失败并给出原因
  for (let i = 0; i < 9; i++) g('addAction')('芙宁娜', 1, { name: '盾' + i });
  const r2 = g('changeActionType')(a.id, 1);
  assert(!r2.ok, '开盾类型已满时不应允许转入');
  assert(r2.error.includes('上限'), '错误信息应说明上限：' + r2.error);
  g('changeActionType')(a.id, 4);
  return `切换为类型 4 → index=${a.index}；满员时拒绝转入：${r2.error.slice(0, 26)}…`;
});

check('编辑：指令串校验能识别非法写法', () => {
  const cases = [
    ['q,wait(0.1),ready', 0],
    ['attack(0.01),keypress(e)', 0],
    ['e|e', 1],
    ['round(1),attack', 1],
    ['E', 1],
    ['walk(s 0.2)', 1],
    ['aim', 1],
  ];
  for (const [s, minErr] of cases) {
    const r = g('parseActionString')(s);
    assert(r.errors.length >= minErr, `「${s}」应至少有 ${minErr} 个错误，实际 ${r.errors.length}`);
  }
  return cases.map(([s, e]) => `${s}:${e}个错误`).join('，');
});

check('编辑：首个指令切人预判符合源码名单', () => {
  const sw = g('firstSwitchInfo')(g('parseActionString')('attack,e').parts);
  assert(sw.canSwitch === true, 'attack 应能触发切人');
  const no = g('firstSwitchInfo')(g('parseActionString')('wait(0.2)').parts);
  assert(no.canSwitch === false, 'wait 不应触发切人');
  const kd = g('firstSwitchInfo')(g('parseActionString')('keypress(e)').parts);
  assert(kd.canSwitch === false, 'keypress 不应触发切人');
  return 'attack=可切人，wait/keypress=不切人';
});

/* ============ 3. 导出 ============ */
let exported = null;
check('导出：结构、字段顺序与 index 升序', () => {
  const v = g('validateStrategy')();
  if (v.errors.length) throw new Error('校验未通过：' + v.errors.map(e => e.text).slice(0, 3).join(' | '));
  exported = g('buildJson')();
  const keys = Object.keys(exported.info);
  assert(keys.join(',') === 'name,author,description,config,preActions', 'info 字段顺序不对：' + keys.join(','));
  assert(exported.info.config && typeof exported.info.config === 'object', 'config 必须是对象');
  const idx = exported.actions.map(a => a.index);
  const sorted = [...idx].sort((a, b) => a - b);
  assert(idx.join(',') === sorted.join(','), 'actions 未按 index 升序');
  for (const a of exported.actions) {
    assert(a.condition && typeof a.condition === 'object' && typeof a.condition.expression === 'string',
      'condition 必须是 {expression} 对象：' + JSON.stringify(a.condition));
    assert(Number.isInteger(a.index), 'index 必须是整数');
    if (a.morePriorities) for (const mp of a.morePriorities) {
      assert(typeof mp.expression === 'string' && Number.isInteger(mp.priority), 'morePriorities 结构不对');
    }
  }
  return `${exported.actions.length} 条动作，info 顺序 ${keys.join('>')}`;
});

check('导出：动作名全部可作为条件标识符（对照内置函数名黑名单）', () => {
  const names = g('allActionNames')(g('state').strategy.actions);
  for (const a of exported.actions) {
    if (!a.name) continue;
    const v = g('isValidActionName')(a.name, names);
    assert(v.ok, `动作名「${a.name}」非法：${v.reason}`);
  }
  const reserved = g('COND_FUNCTION_NAMES');
  for (const a of exported.actions) assert(!reserved.includes(a.name), `动作名「${a.name}」与内置函数同名`);
  return `${exported.actions.length} 条动作名全部合法`;
});

check('导出：index 全部符合编号规则且与角色自洽', () => {
  for (const a of exported.actions) {
    const pi = g('parseIndex')(a.index);
    assert(pi.ok, `index=${a.index} 不符合规则：${pi.reason}`);
    if (a.character) {
      const av = g('getAvatar')(a.character);
      assert(av, `角色「${a.character}」不在角色表`);
      assert(pi.code === av.code && pi.seq === av.seq, `index=${a.index} 与角色 ${a.character} 编号不符`);
    } else {
      assert(pi.code === 0 && pi.seq === 0, `通用动作 index=${a.index} 应使用元素0/角色00`);
    }
  }
  return `${exported.actions.length} 条全部自洽`;
});

check('导出：删掉一个动作后同类型编号保持稳定（不自动紧凑）', () => {
  const acts = g('state').strategy.actions;
  let shields = acts.filter(a => a.character === '芙宁娜' && a.type === 1).sort((x, y) => x.index - y.index);
  if (shields.length < 2) { // 上一条检查可能已把开盾动作转走，补两条
    g('addAction')('芙宁娜', 1, { name: '稳定A' });
    g('addAction')('芙宁娜', 1, { name: '稳定B' });
    shields = g('state').strategy.actions.filter(a => a.character === '芙宁娜' && a.type === 1).sort((x, y) => x.index - y.index);
  }
  const keep = shields[shields.length - 1].index;
  g('removeAction')(shields[0].id);
  const after = g('state').strategy.actions.filter(a => a.character === '芙宁娜' && a.type === 1).map(a => a.index);
  assert(after.includes(keep), '删除后其他动作编号不应变化');
  return `保留 ${keep}，剩余 [${after.join(',')}]`;
});

check('导入回读：导出的 JSON 能被重新导入且无编号问题', () => {
  const res = g('analyzeImport')(g('buildJson')());
  assert(res.fatal.length === 0, '致命错误：' + res.fatal.join('；'));
  const idxProblems = res.problems.filter(p => p.kind === 'index');
  assert(idxProblems.length === 0, '回读出现编号问题：' + idxProblems.slice(0, 2).map(p => p.text).join(' | '));
  return `回读 ${res.actions.length} 条，索引问题 0`;
});

check('导入修复：condition 裸字符串被识别并可修复', () => {
  const obj = {
    info: { name: 't', author: 'a', preActions: [] },
    actions: [{ name: 'a1', character: '', action: 'wait(0.2)', condition: 'e-ready', index: 90001 }],
  };
  const res = g('analyzeImport')(obj);
  assert(res.fatal.length === 0, '不应判为致命');
  assert(res.problems.some(p => p.kind === 'cond-string'), '未识别出裸字符串 condition');
  g('applyImport')(res);
  const out = g('buildJson')();
  assert(typeof out.actions[0].condition === 'object', '修复后仍不是对象');
  return '识别并修复为 ' + JSON.stringify(out.actions[0].condition);
});

check('导入拒绝：actions 为空 / info 为 null 被直接拒绝', () => {
  const a = g('analyzeImport')({ info: {}, actions: [] });
  assert(a.fatal.length > 0, 'actions 为空应致命');
  const b = g('analyzeImport')({ info: null, actions: [{ name: 'x', action: 'wait(0.1)' }] });
  assert(b.fatal.some(x => x.includes('Info')), 'info 为 null 应致命');
  return a.fatal[0] + '；' + b.fatal[0];
});

/* ============ 4. 界面 ============ */
// 前面的导入/编辑检查会改动 state，这里恢复成真实示例策略再验证界面
function restoreSample() {
  const res = g('analyzeImport')(JSON.parse(sampleText));
  g('applyImport')(res);
  g('applyRenumber')(g('planRenumber')());
  g('state').ui.filterElement = 'all';
  g('state').ui.filterRarity = 'all';
  g('state').ui.filterHasAction = 'all';
  g('state').ui.onlyTeam = false;
  g('state').ui.team = [];
  g('state').ui.characterSearch = '';
}

check('界面：三个页签与角色列表渲染', () => {
  restoreSample();
  g('setTab')('actions');
  const html = $('paneActions').innerHTML;
  assert(html.includes('角色列表'), '缺少角色列表');
  assert(html.includes('正在编辑'), '缺少动作编辑区');
  g('setTab')('preview');
  assert($('panePreview').innerHTML.includes('优先级排序预览'), '缺少预览表');
  g('setTab')('info');
  assert($('paneInfo').innerHTML.includes('战斗前动作列表'), '缺少战斗前动作区');
  return `三个页签均正常（当前 ${g('state').strategy.actions.length} 条动作）`;
});

check('界面：角色列表筛选（元素/星级/有无动作/搜索）', () => {
  g('setTab')('actions');
  const all = g('filteredAvatars')().length;
  g('state').ui.filterElement = '3';           // 水元素
  const hydro = g('filteredAvatars')();
  assert(hydro.every(x => x.av.code === 3), '元素筛选失效');
  g('state').ui.filterElement = 'all';
  g('state').ui.filterHasAction = 'yes';
  const hasAct = g('filteredAvatars')();
  assert(hasAct.some(x => x.key === '芙宁娜'), '应有芙宁娜：' + hasAct.map(x => x.key).join(','));
  g('state').ui.filterHasAction = 'all';
  g('state').ui.characterSearch = '万叶';
  const search = g('filteredAvatars')();
  assert(search.length === 1 && search[0].key === '枫原万叶', '搜索失效：' + search.map(x => x.key));
  g('state').ui.characterSearch = '';
  return `全部 ${all} → 水元素 ${hydro.length} → 有动作 ${hasAct.length} → 搜索万叶 ${search.length}`;
});

check('界面：模拟队伍过滤影响预览与角色栏筛选', () => {
  restoreSample();
  g('state').ui.team = ['芙宁娜', '枫原万叶', '纳西妲', '茜特菈莉'];
  const list = g('expandPriorities')(g('state').strategy.actions, g('state').ui.team);
  const names = [...new Set(list.map(x => x.name))];
  assert(!names.includes('尼可开盾'), '队伍外的动作应被剔除');
  for (let i = 1; i < list.length; i++) assert(list[i].priority >= list[i - 1].priority, '条目未按 priority 升序');
  g('state').ui.onlyTeam = true;
  g('state').ui.filterRarity = 'all';
  const avs = g('filteredAvatars')().map(x => x.key);
  assert(avs.every(k => k === '' || g('state').ui.team.includes(k)), '“只看当前队伍”失效');
  g('state').ui.onlyTeam = false;
  return `${list.length} 个条目，涉及 ${names.length} 个动作；角色栏 ${avs.length} 项`;
});

check('界面：优先级预览展开数 = Σ(1+更多条件数)', () => {
  restoreSample();
  const acts = g('state').strategy.actions;
  const expect = acts.reduce((s, a) => s + 1 + (a.morePriorities || []).length, 0);
  const got = g('expandPriorities')(acts, null).length;
  assert(got === expect, `应为 ${expect}，实际 ${got}`);
  return `${acts.length} 个动作 → ${got} 个条目`;
});

check('界面：localStorage 草稿写入与读回', () => {
  restoreSample();
  g('saveDraftNow')();
  const raw = dom.localStorage.getItem('bgi_strategy_editor_drafts_v1');
  assert(raw, '草稿未写入');
  const drafts = JSON.parse(raw);
  const key = '公式化锄地';
  assert(drafts[key], '未按策略名归档：' + Object.keys(drafts).join(','));
  assert(Array.isArray(drafts[key].json.actions), '草稿结构不对');
  return `${key}：${drafts[key].json.actions.length} 条动作`;
});

/* ============ 4.5 info.version / 动作 tags / 未识别字段 ============ */

check('info.version：写在 author 下面、description 上面，空版本省略该字段', () => {
  restoreSample();
  const info = g('state').strategy.info;
  assert(!('version' in g('buildJson')().info), '空版本不应写出 version 字段');
  info.version = 'v2.1';
  const o = g('buildJson')();
  const keys = Object.keys(o.info);
  assert(keys.join(',') === 'name,author,version,description,config,preActions', '字段顺序不对：' + keys.join(','));
  const back = g('analyzeImport')(o);
  assert(back.info.version === 'v2.1', '版本回读丢失：' + JSON.stringify(back.info.version));
  const res = g('analyzeImport')({ info: { name: 'n' }, actions: [{ name: 'x', action: 'wait(0.2)', index: 90001 }] });
  assert(res.info.version === '', '无 version 的策略导入后版本应为空：' + JSON.stringify(res.info.version));
  info.version = '';
  g('applyImport')(g('analyzeImport')(JSON.parse(sampleText)));
  g('applyRenumber')(g('planRenumber')());
  return `name,author,version,description,config,preActions → 回读 ${back.info.version}；空版本省略`;
});

check('动作 tags：注释写在 index 下面 / morePriorities 上面，空注释省略', () => {
  restoreSample();
  const act = g('state').strategy.actions[0];
  act.morePriorities = [{ id: 'mpk', text: 't<10', priority: 100000, cmp: 'after', scope: { type: 9, element: '', character: '' } }];
  act.tags = '';
  let e = g('buildJson')().actions.find(x => x.index === act.index);
  assert(!('tags' in e), '空注释不应写 tags');
  assert(Object.keys(e).join(',') === 'name,character,action,condition,ensureCast,index,morePriorities', '空注释时的字段顺序不对：' + Object.keys(e).join(','));
  act.tags = '开场先手\n第二行说明';
  e = g('buildJson')().actions.find(x => x.index === act.index);
  assert(Object.keys(e).join(',') === 'name,character,action,condition,ensureCast,index,tags,morePriorities', 'tags 位置不对：' + Object.keys(e).join(','));
  const back = g('analyzeImport')(g('buildJson')()).actions.find(x => x.index === act.index);
  assert(back.tags === '开场先手\n第二行说明', '注释回读不一致：' + JSON.stringify(back.tags));
  act.tags = '';
  return 'index 下面 / morePriorities 上面 → 回读 ' + JSON.stringify(back.tags);
});

check('未识别字段：被忽略但会提醒（redArrowAim 不静默）', () => {
  const res = g('analyzeImport')({
    info: { name: 'n', author: 'a' },
    actions: [{ name: 'x', action: 'wait(0.2)', index: 90001, condition: { expression: '' }, redArrowAim: true, Tags: '大写写法也算 tags' }],
  });
  const un = res.problems.filter(p => p.kind === 'unknown-field');
  assert(un.length === 1 && un[0].text.includes('redArrowAim'), '未提醒 redArrowAim：' + JSON.stringify(res.problems.map(p => p.kind)));
  assert(res.actions[0].tags === '大写写法也算 tags', 'Tags 应被识别为 tags');
  assert(!g('buildJson')().actions.some(a => 'redArrowAim' in a), '未知字段不应被导出');
  const clean = g('analyzeImport')(g('buildJson')()).problems.filter(p => p.kind === 'unknown-field');
  assert(clean.length === 0, '本编辑器自己的导出不应误报：' + clean.map(p => p.text).join(' | '));
  return un[0].text.slice(0, 40) + '…';
});

check('草稿归档：按「策略名称 + 版本」两个条件，二者有其一不同就是不同草稿', () => {
  dom.localStorage.clear();
  const info = g('state').strategy.info;
  info.name = '归档测试';
  info.version = '';
  g('saveDraftNow')();
  const k1 = g('draftKey')();
  info.version = 'v2';
  g('saveDraftNow')();
  const k2 = g('draftKey')();
  info.name = '归档测试2';
  g('saveDraftNow')();
  const k3 = g('draftKey')();
  assert(k1 !== k2 && k2 !== k3 && k1 !== k3, '名称或版本不同应产生不同草稿：' + [k1, k2, k3].join(' / '));
  const keys = Object.keys(JSON.parse(dom.localStorage.getItem('bgi_strategy_editor_drafts_v1')));
  assert(keys.length === 3, '应有 3 份草稿，实际 ' + keys.length + '：' + keys.join(','));
  // 回到「归档测试 / v2」再保存：同名同版本只保留一份
  info.name = '归档测试';
  info.version = 'v2';
  g('saveDraftNow')();
  const keys2 = Object.keys(JSON.parse(dom.localStorage.getItem('bgi_strategy_editor_drafts_v1')));
  assert(keys2.length === 3, '同名同版本不应重复归档：' + keys2.join(','));
  const p = g('parseDraftKey')(k2);
  assert(p.name === '归档测试' && p.version === 'v2', '草稿键解析不对：' + JSON.stringify(p));
  info.name = '';
  info.version = '';
  dom.localStorage.clear();
  restoreSample();
  return `${k1} ／ ${k2} ／ ${k3}（3 份，重名同版本覆盖）`;
});

check('界面：星级补录只影响筛选与显示，不进 JSON', () => {
  restoreSample();
  g('state').rarity = {};
  g('state').ui.filterRarity = '5';
  assert(!g('filteredAvatars')().some(x => x.key === '芙宁娜'), '未标注星级时不应出现');
  g('state').rarity['芙宁娜'] = '5';
  assert(g('filteredAvatars')().some(x => x.key === '芙宁娜'), '补录五星后应出现');
  g('state').ui.filterRarity = 'all';
  const text = JSON.stringify(g('buildJson')());
  assert(!text.includes('"rarity"') && !text.includes('"star"'), '星级不应进入导出的 JSON');
  return '星级仅本地保存，未污染导出';
});

check('界面：导出被拒绝时给出错误列表（不生成文件）', () => {
  const a = g('state').strategy.actions[0];
  const old = a.name;
  a.name = 'true';
  g('validateStrategy')();
  g('doExport')();
  const title = $('modalTitle').innerHTML;
  assert(title.includes('拒绝'), '应拒绝导出：' + title);
  g('closeModal')(null);
  a.name = old;
  g('validateStrategy')();
  return title;
});

/* ============ 5. 新增能力 ============ */

check('表达式：基础条件与队友条件取与时整体加括号', () => {
  const acts = g('state').strategy.actions;
  const a = acts.find(x => x.conditionText && x.conditionText.trim());
  if (!a) return '没有可用动作，跳过';
  const oldCond = a.conditionText;
  const oldTeammates = JSON.parse(JSON.stringify(a.teammates));
  a.conditionText = 'low-hp || q-ready';
  a.teammates.include = ['枫原万叶'];
  const expr = g('buildExpression')(a, acts);
  assert(expr.includes('(low-hp || q-ready)'), '基础条件未整体加括号：' + expr);
  assert(expr.startsWith('(low-hp || q-ready) &&'), '括号位置不对：' + expr);
  const more = g('buildMorePriorities')(a, acts);
  for (const m of more) assert(!m.expression.includes('low-hp') || m.expression.includes('(low-hp'), '其他触发条件未加括号：' + m.expression);
  a.conditionText = oldCond;
  a.teammates = oldTeammates;
  return expr;
});

check('隐式转换：数值与布尔互转的位置能被检出', () => {
  const names = ['测试动作'];
  const cases = [
    ['low-hp + 1', 1],
    ['min(low-hp, 3)', 1],
    ['e-cd < 2', 0],
    ['since + 1', 0],
    ['q-ready && low-hp', 0],
    ['last-exec(low-hp, 1)', 1],
  ];
  for (const [expr, min] of cases) {
    const p = g('condParse')(expr, names);
    assert(!p.error, `${expr} 不应有语法错误：${p.error}`);
    const conv = g('condCollectConversions')(p.ast, names);
    assert(conv.length >= min, `${expr} 应至少检出 ${min} 处隐式转换，实际 ${conv.length}`);
  }
  return cases.map(([e, n]) => `${e}:${n}`).join('，');
});

check('priority 段边界：各类型段首尾相接，类型 0 是 0~9999，类型 9 的段内最大值是 99999', () => {
  const t0 = g('prioritySpan')({ type: 0 });
  assert(t0 && t0.before === 0 && t0.hi === 9999 && t0.after === 10000, '类型 0 段边界应为 0~9999（次于取 10000），实际 ' + JSON.stringify(t0));
  const t9 = g('prioritySpan')({ type: 9 });
  assert(t9 && t9.before === 90000 && t9.hi === 99999 && t9.after === 100000, '类型 9 的段应为 90000~99999（次于取 100000），实际 ' + JSON.stringify(t9));
  assert(g('computePriority')({ type: 0 }, 'before', g('state').strategy.actions).priority === 0, '优先于类型 0 应取段内最小值 0');
  assert(g('prioritySpan')({ type: 0, element: 1 }) === null, '类型 0 不能再按元素细分');
  return `0:${t0.before}~${t0.hi}（次于 ${t0.after}），9:${t9.before}~${t9.hi}（次于 ${t9.after}）`;
});

check('导入：其他触发条件尾数不为 0 时弹出“修正后导入/放弃导入”', async () => {
  const obj = {
    info: { name: '尾数测试', author: '', preActions: [] },
    actions: [
      { name: '尾数动作', character: '', action: 'wait(0.2)', index: 90001, morePriorities: [{ expression: 'low-hp', priority: 41005 }] },
    ],
  };
  g('doImportFromText')(JSON.stringify(obj), 'tail.json');
  assert($('modalTitle').innerHTML.includes('导入前检查'), '未弹出导入前检查');
  const btn = $('modalFoot').children.find(b => b.textContent.trim() === '导入');
  assert(btn, '缺少导入按钮');
  btn.click();
  await tick(); await tick();
  assert($('modalTitle').innerHTML.includes('priority 需要修正'), '未弹出尾数修正询问：' + $('modalTitle').innerHTML);
  const fix = $('modalFoot').children.find(b => b.textContent.includes('修正后导入'));
  assert(fix, '缺少「修正后导入」按钮');
  fix.click();
  await tick(); await tick();
  const a = g('state').strategy.actions.find(x => x.name === '尾数动作');
  assert(a, '导入后找不到动作');
  // 41005 → 所在段（辅助·元素1）的最大值 + 1 = 42000
  assert(a.morePriorities[0].priority === 42000, 'priority 应被修正为 42000，实际 ' + a.morePriorities[0].priority);
  assert(a.morePriorities[0].cmp === 'after', '判定顺序应改为次于');
  g('closeModal')(null);
  return `41005 → ${a.morePriorities[0].priority}`;
});

check('导入：动作类型按 ensureCast 与指令内容推定', () => {
  const c = (action, ensureCast) => g('inferActionType')(action, '', ensureCast);
  assert(c('e,wait(0.2)', true) === 1, 'ensureCast + e 应为开盾(1)');
  assert(c('e,wait(0.2)', false) === 4, '无 ensureCast + e 应为辅助(4)');
  assert(c('q,wait(0.1),ready', false) === 5, '只有 q 应为爆发(5)');
  assert(c('attack,charge(1)', false) === 8, '只有攻击指令应为纯挂元素普攻(8)');
  assert(c('wait(0.2)', false) === 9, '没有攻击指令应为兜底(9)');
  return '1/4/5/8/9 全部符合规则';
});

check('隐式转换：类型正确的数值函数不再被误报', () => {
  const names = ['测试动作'];
  const cases = [
    't() > 3',
    'since(测试动作) < 3',
    'count(测试动作) = 0',
    'e-cd < 2 && q-ready',
    'low-hp || q-ready',
    'min(t, since) > 5',
    'last-exec(5, true, 测试动作)',
    't - 15 > 0',
    'count > t',
  ];
  for (const expr of cases) {
    const p = g('condParse')(expr, names);
    assert(!p.error, `${expr} 不应有语法错误：${p.error}`);
    const conv = g('condCollectConversions')(p.ast, names);
    assert(conv.length === 0, `${expr} 不应报隐式转换，实际 ${conv.length} 处：` + conv.map(c => c.text + '（' + c.reason + '）').join('；'));
  }
  // 真的写错了类型时要能检出
  const bad = [['low-hp + 1', 1], ['min(low-hp, 3)', 1], ['last-exec(low-hp, 1)', 1]];
  for (const [expr, min] of bad) {
    const p = g('condParse')(expr, names);
    const conv = g('condCollectConversions')(p.ast, names);
    assert(conv.length >= min, `${expr} 应至少检出 ${min} 处隐式转换，实际 ${conv.length}`);
  }
  return `${cases.length} 个正常表达式未误报，3 个错误表达式仍能检出`;
});

/* ============ 6. 元素号变更与导入修复 ============ */

check('编号：元素号按新规则分配（1 冰 / 2 火 / 3 水 / 4 雷 / 5 风 / 6 岩 / 7 草）', () => {
  const el = (n) => g('getAvatar')(n).code;
  assert(el('神里绫华') === 1, '神里绫华 应为冰元素(1)，实际 ' + el('神里绫华'));
  assert(el('迪卢克') === 2, '迪卢克 应为火元素(2)，实际 ' + el('迪卢克'));
  assert(el('芙宁娜') === 3, '芙宁娜 应为水元素(3)，实际 ' + el('芙宁娜'));
  assert(el('菲谢尔') === 4, '菲谢尔 应为雷元素(4)，实际 ' + el('菲谢尔'));
  assert(el('枫原万叶') === 5, '枫原万叶 应为风元素(5)，实际 ' + el('枫原万叶'));
  assert(el('钟离') === 6, '钟离 应为岩元素(6)，实际 ' + el('钟离'));
  assert(el('纳西妲') === 7, '纳西妲 应为草元素(7)，实际 ' + el('纳西妲'));
  const labels = g('ELEMENTS').map(e => `${e.code}${e.name}`).join(' ');
  assert(labels === '0元素未定 1冰 2火 3水 4雷 5风 6岩 7草', '元素表顺序不对：' + labels);
  return labels;
});

check('导入：index 元素位按角色所属元素自动修正，且不改动尾数顺序', () => {
  const obj = {
    info: { name: '元素位修正', author: '', preActions: [] },
    actions: [
      // 旧编号：水=1、冰=3（芙宁娜 水·11、茜特菈莉 冰·16）
      { name: '芙芙e', character: '芙宁娜', action: 'e', condition: { expression: 'since(41111)<3' }, index: 41111 },
      { name: '奶奶开盾', character: '茜特菈莉', action: 'attack,e', index: 13161 },
    ],
  };
  const res = g('analyzeImport')(obj);
  assert(res.fatal.length === 0, '不应致命：' + res.fatal.join('；'));
  const fixes = res.problems.filter(p => p.kind === 'element-fix');
  assert(fixes.length === 2, '应有 2 处元素位修正，实际 ' + fixes.length + '：' + JSON.stringify(res.problems.map(p => p.kind)));
  assert(!res.problems.some(p => p.kind === 'index'), '元素位不符不应触发整体重排编号');
  const a1 = res.actions.find(a => a.name === '芙芙e');
  assert(a1.index === 43111, '芙宁娜 e 应修正为 43111（辅助·水·芙宁娜·1），实际 ' + a1.index);
  assert(a1.conditionText.includes('43111'), '条件里的 index 引用应同步改写：' + a1.conditionText);
  const a2 = res.actions.find(a => a.name === '奶奶开盾');
  assert(a2.index === 11161, '茜特菈莉开盾应修正为 11161（开盾·冰·茜特菈莉·1），实际 ' + a2.index);
  assert(a2.type === 1 && a2.slot === 1, '动作类型与尾数应保持为 1/1');
  return `${fixes.length} 处：41111→43111、13161→11161`;
});

check('导入：morePriorities 不会丢失（含尾数为 0 的条目）', () => {
  const obj = {
    info: { name: '额外条件保留', author: '', preActions: [] },
    actions: [{
      name: '草神q', character: '纳西妲', action: 'q,wait(0.1),ready',
      condition: { expression: 'q-ready' },
      index: 57041,   // 爆发 · 草(7) · 纳西妲(04) · 第 1 条
      morePriorities: [
        { expression: 'low-hp', priority: 0 },
        { expression: 'q-ready', priority: 20 },
        { expression: 't<10', priority: 15 },
      ],
    }],
  };
  const res = g('analyzeImport')(obj);
  assert(res.fatal.length === 0, '不应致命：' + res.fatal.join('；'));
  assert(!res.problems.some(p => p.kind === 'index'), 'index 57041 应被接受');
  assert(res.actions[0].morePriorities.length === 3, 'analyzeImport 阶段就丢了条目');
  g('applyImport')(res, { fixPriorityTail: true });
  const a = g('state').strategy.actions.find(x => x.name === '草神q');
  assert(a, '导入后找不到动作');
  assert(a.morePriorities.length === 3, 'applyImport 后应保留 3 条，实际 ' + a.morePriorities.length);
  const texts = a.morePriorities.map(mp => mp.text);
  for (const t of ['low-hp', 'q-ready', 't<10']) assert(texts.includes(t), `缺少其他触发条件「${t}」：` + JSON.stringify(texts));
  return '3 条其他触发条件全部保留：' + texts.join('、');
});

/* ============ 7. 合并 JSON 策略 ============ */

/** 用一份 JSON 对象走一遍合并的「校验 → 比对 → 应用」，decisions 省略时全部保留当前版本 */
function runMerge(obj, decisions) {
  const src = g('checkMergeSource')(obj);
  if (src.mode !== 'ok') return { mode: src.mode, reasons: src.reasons };
  const plan = g('planMerge')(src);
  const r = g('applyMergePlan')(plan, decisions || { info: {}, actions: {} });
  return { mode: 'ok', plan, r, src };
}
/** 把当前策略换成一份干净的基准：一份 JSON 走一遍 analyzeImport / applyImport */
const resetStrategy = (info, actions) => {
  const obj = {
    info: Object.assign({ name: '', author: '', version: '', description: '', config: {}, preActions: [] }, info || {}),
    actions: actions || [],
  };
  const res = g('analyzeImport')(obj);
  if (res.fatal.length) throw new Error('测试基准本身不合法：' + res.fatal.join('；'));
  g('applyImport')(res, { fixPriorityTail: true });
};

check('合并①：无法被 BetterGI 加载的策略按错误原因拒绝（fatal）', () => {
  const bad = runMerge({ info: { name: 'x' }, actions: [{ name: 'a', character: '', action: 'wait(0.2)', condition: 'low-hp', index: 1 }] });
  assert(bad.mode === 'fatal', '裸字符串 condition 应判定为 fatal，实际 ' + bad.mode);
  assert(bad.reasons.join('；').includes('裸字符串'), '未指出裸字符串问题：' + bad.reasons.join('；'));
  const bad2 = g('checkMergeSource')({ info: { name: 'x' }, actions: [{ name: 'true', character: '', action: 'wait(0.2)', index: 9, condition: { expression: '' } }] });
  assert(bad2.mode === 'fatal', '动作名不合法应判定为 fatal，实际 ' + bad2.mode);
  assert(bad2.reasons.join('；').includes('名称不合法'), '未指出名称不合法：' + bad2.reasons.join('；'));
  return '裸字符串 condition / 非法动作名都会按错误原因拒绝';
});

check('合并②：编号等方面需要先调整的策略提示「应先单独导入并编辑后，才可以与其他策略合并」', () => {
  const early = JSON.parse(fs.readFileSync(path.join(workspaceRoot, '一些早期的JSON战斗策略', '火芙万茜.json'), 'utf8'));
  const r = runMerge(early);
  assert(r.mode === 'needs-edit', '旧编号策略应判定为 needs-edit，实际 ' + r.mode);
  assert(r.reasons.some(t => t.includes('index')), '应列出编号问题：' + r.reasons.slice(0, 3).join('；'));
  // priority 尾数不为 0 的也要拒绝
  const tail = runMerge({
    info: { name: 'x' }, actions: [{
      name: '草神q', character: '纳西妲', action: 'q,wait(0.1),ready',
      condition: { expression: 'q-ready' }, index: 57041,
      morePriorities: [{ expression: 'low-hp', priority: 41005 }],
    }],
  });
  assert(tail.mode === 'needs-edit', 'priority 尾数不为 0 应判定为 needs-edit，实际 ' + tail.mode);
  return `旧编号策略列出 ${r.reasons.length} 条需调整项（含 priority 尾数）`;
});

check('合并③：当前策略有阻止导出的错误时拒绝合并', () => {
  resetStrategy({ name: '当前' }, [{ name: '芙芙e', character: '芙宁娜', action: 'e', condition: { expression: 'e-ready' }, index: 43111 }]);
  const a = g('state').strategy.actions[0];
  a.type = 5;                      // 与 index 的类型位不一致 -> 校验错误
  const v = g('validateStrategy')();
  assert(v.errors.length > 0, '构造的当前策略应有错误');
  g('doMerge')();
  assert($('modalTitle').innerHTML.includes('合并被拒绝'), '当前策略有错误时应拒绝合并：' + $('modalTitle').innerHTML);
  assert($('modalBody').innerHTML.includes('阻止导出') || $('modalBody').innerHTML.includes('先能正常导出'), '未说明原因');
  g('closeModal')(null);
  a.type = 4;
  g('state').strategy.actions[0].manualIndex = false;
  g('recomputeIndexes')(g('state').strategy.actions);
  return '当前策略不通过校验时不会进入合并流程';
});

check('合并④：info 逐字段比对 —— 当前为空采用导入、为空/相同保留当前、不同交给用户选择', () => {
  resetStrategy({ name: '当前名', author: '', version: 'v1', description: 'D-当前' }, [{ name: '芙芙e', character: '芙宁娜', action: 'e', index: 43111 }]);
  const imp = {
    info: { name: '导入名', author: '导入作者', version: 'v1', description: 'D-导入' },
    actions: [{ name: '芙芙e', character: '芙宁娜', action: 'e', index: 43111, condition: { expression: '' } }],
  };
  const src = g('checkMergeSource')(imp);
  const plan = g('planMerge')(src);
  const fields = plan.infoDiffs.map(d => d.field);
  assert(fields.join(',') === 'name,description', 'info 差异字段应为 name,description，实际 ' + fields.join(','));
  const r = g('applyMergePlan')(plan, { info: { name: 'imported', description: 'current' }, actions: {} });
  assert(r.ok, '合并失败：' + r.error);
  const info = g('state').strategy.info;
  assert(info.name === '导入名', 'name 应改用导入版本，实际 ' + info.name);
  assert(info.author === '导入作者', 'author 当前为空应采用导入版本，实际 ' + info.author);
  assert(info.version === 'v1', 'version 相同应保留当前版本，实际 ' + info.version);
  assert(info.description === 'D-当前', 'description 应保留当前版本，实际 ' + info.description);
  assert(r.infoNotes.some(n => n.includes('作者') && n.includes('采用')), '缺少采用说明：' + r.infoNotes.join('；'));
  return `冲突字段 ${fields.join('、')}；name→导入、description→当前、author→采用导入、version→保留`;
});

check('合并⑤：没有同名动作时按原动作类型重新分配 index，类型满了顺延（9 之后到 2）', () => {
  assert(g('mergeTypeOrder')(9).join(',') === '9,2,3,4,5,6,7,8', '类型 9 的顺延顺序不对：' + g('mergeTypeOrder')(9).join(','));
  assert(g('mergeTypeOrder')(4).join(',') === '4,5,6,7,8,9,2,3', '类型 4 的顺延顺序不对：' + g('mergeTypeOrder')(4).join(','));
  // 芙宁娜 类型 5 放满 9 条
  const cur = [];
  for (let i = 1; i <= 9; i++) cur.push({ name: `已满${i}`, character: '芙宁娜', action: 'q,wait(0.1),ready', index: g('makeIndex')(5, 3, 11, i), condition: { expression: '' } });
  resetStrategy({ name: '当前' }, cur);
  assert(g('state').strategy.actions.length === 9, '基准动作数不对：' + g('state').strategy.actions.length);
  const imp = {
    info: { name: '当前' },
    actions: [{ name: '新q', character: '芙宁娜', action: 'q,wait(0.1),ready', index: 53111, condition: { expression: 'q-ready && since(57041) > 1' } }],
  };
  const out = runMerge(imp);
  assert(out.mode === 'ok', '合并不应被拒绝：' + (out.reasons || []).join('；'));
  assert(out.r.ok, '合并失败：' + out.r.error);
  assert(out.r.added.length === 1, '应新增 1 条动作，实际 ' + out.r.added.length);
  const added = out.r.added[0].action;
  assert(added.type === 6, '类型 5 已满应顺延到类型 6，实际 ' + added.type);
  assert(added.index === 63111, '顺延后的 index 应为 63111，实际 ' + added.index);
  const back = g('buildJson')().actions.find(x => x.name === '新q');
  assert(back.index === 63111, '导出的 index 不对：' + back.index);
  // 引用了被导入策略里不存在的 index（57041）→ 原样保留 + 提示
  assert(out.r.warnings.length === 1, '应给出 1 条无法换算的提示，实际 ' + JSON.stringify(out.r.warnings));
  return `新q → 类型 6 / index 63111（类型 9 的顺延顺序也正确）`;
});

check('合并⑥：同名动作内容相同时直接保留当前版本，条件里的 index 入参按动作名比对', () => {
  resetStrategy({ name: '当前' }, [
    { name: '检查战斗结束', character: '', action: 'check', index: 1, condition: { expression: 't>1.5' } },
    { name: '芙芙e', character: '芙宁娜', action: 'e', index: 43111, condition: { expression: 'since(1) > 10' } },
  ]);
  // 被导入策略里同一个动作编号不同（尾数 2），但条件按「动作名」描述同一件事
  const imp = {
    info: { name: '当前' },
    actions: [
      { name: '芙芙e', character: '芙宁娜', action: 'e', index: 43112, condition: { expression: 'since(检查战斗结束) > 10' } },
    ],
  };
  const out = runMerge(imp);
  assert(out.mode === 'ok' && out.r.ok, '合并失败：' + (out.r.error || (out.reasons || []).join('；')));
  const diffs = out.plan.items[0].diffs;
  assert(diffs.length === 0, 'index 换算成动作名后应判定为「内容相同」，实际差异：' + JSON.stringify(diffs.map(d => d.label)));
  assert(out.r.kept.length === 1, '应保留当前版本，实际 kept=' + out.r.kept.length);
  const cur = g('state').strategy.actions.find(a => a.name === '芙芙e');
  assert(cur.index === 43111, 'index 不应被改动：' + cur.index);
  assert(cur.conditionText === 'since(1) > 10', '比对用的换算不能写回：' + cur.conditionText);
  return '内容相同 → 原样保留（条件里的 index 换算只用于比对）';
});

check('合并⑦：同名动作内容不同 → 三种处理方式（保留 / 替换 / 改名后保留）', () => {
  resetStrategy({ name: '当前' }, [
    { name: '检查战斗结束', character: '', action: 'check', index: 1, condition: { expression: 't>1.5' } },
    { name: '芙芙e', character: '芙宁娜', action: 'e', index: 43111, condition: { expression: 'e-ready' } },
    { name: '芙芙q', character: '芙宁娜', action: 'q,wait(0.1),ready', index: 53111, condition: { expression: `since(43111) > 5` } },
  ]);
  const imp = (eAction, eIndex) => ({
    info: { name: '当前' },
    actions: [
      { name: '芙芙e', character: '芙宁娜', action: eAction, index: eIndex, condition: { expression: 'e-ready && low-hp' } },
      { name: '芙芙q', character: '芙宁娜', action: 'q,wait(0.1),ready', index: 53112, condition: { expression: `since(${eIndex}) > 5` } },
    ],
  });
  // (a) 保留当前版本
  let out = runMerge(imp('e,wait(0.3)', 43112), { info: {}, actions: { 0: 'keep', 1: 'keep' } });
  assert(out.plan.items[0].diffs.length > 0, '应识别出内容不同');
  let cur = g('state').strategy.actions.find(a => a.name === '芙芙e');
  assert(out.r.kept.length === 2 && cur.action === 'e', '保留当前版本时不该改内容：' + cur.action);
  assert(cur.index === 43111, 'index 不应变：' + cur.index);

  // (b) 使用导入版本替换：index 保留当前数值，条件里对「同名动作」的引用换算成本策略的 index
  resetStrategy({ name: '当前' }, [
    { name: '检查战斗结束', character: '', action: 'check', index: 1, condition: { expression: 't>1.5' } },
    { name: '芙芙e', character: '芙宁娜', action: 'e', index: 43111, condition: { expression: 'e-ready' } },
    { name: '芙芙q', character: '芙宁娜', action: 'q,wait(0.1),ready', index: 53111, condition: { expression: `since(43111) > 5` } },
  ]);
  out = runMerge(imp('e,wait(0.3)', 43112), { info: {}, actions: { 0: 'replace', 1: 'keep' } });
  assert(out.r.replaced.length === 1, '应有 1 条被替换');
  cur = g('state').strategy.actions.find(a => a.name === '芙芙e');
  assert(cur.action === 'e,wait(0.3)', '动作指令应被替换：' + cur.action);
  assert(cur.conditionText === 'e-ready && low-hp', '条件应被替换：' + cur.conditionText);
  assert(cur.index === 43111, 'index 应保留当前数值：' + cur.index);
  const q = g('state').strategy.actions.find(a => a.name === '芙芙q');
  assert(q && q.conditionText === 'since(43111) > 5', '导入版本里对芙芙e的引用应换算成本策略的 index：' + (q && q.conditionText));

  // (c) 导入的版本改名后保留：当前版本不动，导入版本另起名字并重新分配 index
  resetStrategy({ name: '当前' }, [
    { name: '检查战斗结束', character: '', action: 'check', index: 1, condition: { expression: 't>1.5' } },
    { name: '芙芙e', character: '芙宁娜', action: 'e', index: 43111, condition: { expression: 'e-ready' } },
    { name: '芙芙q', character: '芙宁娜', action: 'q,wait(0.1,ready)', index: 53111, condition: { expression: `since(43111) > 5` } },
  ]);
  out = runMerge(imp('e,wait(0.3)', 43112), { info: {}, actions: { 0: 'rename', 1: 'keep' } });
  assert(out.r.renamed.length === 1, '应有 1 条改名后新增，实际 ' + out.r.renamed.length);
  const renamed = g('state').strategy.actions.find(a => a.name === '芙芙e2');
  assert(renamed, '改名后的动作应叫「芙芙e2」：' + g('state').strategy.actions.map(a => a.name).join(','));
  assert(renamed.action === 'e,wait(0.3)', '改名后的动作内容应来自导入版本：' + renamed.action);
  assert(renamed.index === 43112, '改名后的动作应重新分配 index（类型 4 的尾数 2）：' + renamed.index);
  assert(g('state').strategy.actions.find(a => a.name === '芙芙e').action === 'e', '当前版本不应被改动');
  return '保留 / 替换（index 保留 + 引用换算）/ 改名后新增（重新分配 index）都正确';
});

check('合并⑧：替换时角色不同 → index 的元素/角色位跟着角色改写，其他条件里的引用同步改写', () => {
  resetStrategy({ name: '当前' }, [
    { name: '检查战斗结束', character: '', action: 'check', index: 1, condition: { expression: `since(43111) > 5` } },
    { name: '共用动作', character: '芙宁娜', action: 'e', index: 43111, condition: { expression: 'e-ready' } },
  ]);
  const av = g('getAvatar')('玛薇卡');
  const imp = {
    info: { name: '当前' },
    actions: [{ name: '共用动作', character: '玛薇卡', action: 'attack,e', index: g('makeIndex')(4, av.code, av.seq, 1), condition: { expression: 'e-ready && since>10' } }],
  };
  const out = runMerge(imp, { info: {}, actions: { 0: 'replace' } });
  assert(out.r.ok, '合并失败：' + out.r.error);
  const cur = g('state').strategy.actions.find(a => a.name === '共用动作');
  const want = g('makeIndex')(4, av.code, av.seq, 1);
  assert(cur.character === '玛薇卡', '角色应采用导入版本：' + cur.character);
  assert(cur.index === want, `index 的元素/角色位应跟着角色改写为 ${want}，实际 ${cur.index}`);
  assert(cur.type === 4, '动作类型位不应改变：' + cur.type);
  const chk = g('state').strategy.actions.find(a => a.name === '检查战斗结束');
  assert(chk.conditionText === `since(${want}) > 5`, '别的动作里指向它的 index 引用应同步改写：' + chk.conditionText);
  const v = g('validateStrategy')();
  assert(v.errors.length === 0, '合并后不应有错误：' + v.errors.map(e => e.text).join('；'));
  return `角色→玛薇卡，index 43111 → ${want}，引用同步改写`;
});

check('合并⑨：新导入动作的「自动排除」按名称映射到本策略的动作 id；队标条件引用按名换算', () => {
  resetStrategy({ name: '当前' }, [{ name: '检查战斗结束', character: '', action: 'check', index: 1, condition: { expression: 't>1.5' } }]);
  const imp = {
    info: { name: '当前' },
    actions: [
      { name: '独e', character: '芙宁娜', action: 'e', index: 43111, condition: { expression: 'e-ready' }, index2: 0 },
      { name: '独q', character: '芙宁娜', action: 'q,wait(0.1),ready', index: 53111, condition: { expression: `since(43111) > 3` } },
    ],
  };
  // 给「独e」加必要队友，让「独q」自动排除它
  imp.actions[0].condition = { expression: 'e-ready && in-party(钟离)' };
  const src = g('checkMergeSource')(imp);
  const plan = g('planMerge')(src);
  const srcE = src.actions.find(a => a.name === '独e');
  const srcQ = src.actions.find(a => a.name === '独q');
  srcQ.teammates.autoExclude = [srcE.id];
  const r = g('applyMergePlan')(plan, { info: {}, actions: {} });
  assert(r.ok, '合并失败：' + r.error);
  const e = g('state').strategy.actions.find(a => a.name === '独e');
  const q = g('state').strategy.actions.find(a => a.name === '独q');
  assert(q.teammates.autoExclude.length === 1 && q.teammates.autoExclude[0] === e.id, '自动排除应映射到本策略里「独e」的 id：' + JSON.stringify(q.teammates.autoExclude));
  assert(q.conditionText === `since(${e.index}) > 3`, '条件里的 index 引用应换算成本策略的 index：' + q.conditionText);
  const expr = g('buildExpression')(q, g('state').strategy.actions);
  assert(expr.includes('!(（') === false && expr.includes('!('), '自动排除表达式应正常生成：' + expr);
  const v = g('validateStrategy')();
  assert(v.errors.length === 0, '合并后不应有错误：' + v.errors.map(x => x.text).join('；'));
  return `独q 自动排除 → ${e.name}(${e.index})；表达式 ${expr}`;
});

check('合并⑩：当前策略里没被匹配到的动作原样保留；所有类型都满时拒绝合并', () => {
  resetStrategy({ name: '当前' }, [
    { name: '检查战斗结束', character: '', action: 'check', index: 1, condition: { expression: 't>1.5' } },
    { name: '独有动作', character: '芙宁娜', action: 'e', index: 43111, condition: { expression: 'e-ready' } },
  ]);
  const imp = { info: { name: '当前' }, actions: [{ name: '新动作', character: '芙宁娜', action: 'e', index: 43112, condition: { expression: '' } }] };
  let out = runMerge(imp);
  assert(out.r.ok, '合并失败：' + out.r.error);
  const own = g('state').strategy.actions.find(a => a.name === '独有动作');
  assert(own && own.index === 43111 && own.conditionText === 'e-ready', '当前策略独有的动作应原样保留');
  assert(g('buildJson')().actions.length === 3, '导出应有 3 条动作');

  // 把芙宁娜的 9 种类型全部塞满，再合并一条新动作 → 拒绝
  g('state').strategy.actions = [];
  g('state').strategy.info = { name: '满', author: '', version: '', description: '', config: {}, preActions: [] };
  for (let t = 1; t <= 9; t++) {
    for (let s = 1; s <= 9; s++) {
      const r2 = g('addAction')('芙宁娜', t, { name: `满${t}-${s}`, action: t === 5 ? 'q,wait(0.1),ready' : 'e' });
      if (!r2.ok) throw new Error(r2.error);
    }
  }
  const full = runMerge({ info: { name: '满' }, actions: [{ name: '再来一条', character: '芙宁娜', action: 'e', index: 43111, condition: { expression: '' } }] });
  assert(full.mode === 'ok', '来源校验应通过');
  assert(full.r.ok === false && /分配编号/.test(full.r.error), '所有类型都满时应拒绝合并：' + JSON.stringify(full.r));
  return '独有动作保留；9 种类型全满时拒绝合并并说明原因';
});

check('合并⑪：真实示例策略的副本（改 1 条指令 + 填版本）合并后仍能正常导出与校验', async () => {
  // 把当前策略重置成示例策略：走一遍真实的导入流程（含重新编号）
  g('doImportFromText')(sampleText, '公式化锄地（已修复）.json');
  $('modalFoot').children.find(b => b.textContent.includes('调整编号后导入')).click();
  await tick(); await tick();
  if ($('modalTitle').innerHTML.includes('priority 需要修正')) {
    $('modalFoot').children.find(b => b.textContent.includes('修正后导入')).click();
    await tick(); await tick();
  }
  g('closeModal')(null);
  const base = g('buildJson')();
  assert(base.actions.length === 28, '基准应是 28 条动作，实际 ' + base.actions.length);

  const copy = JSON.parse(JSON.stringify(base));
  copy.info.version = 'v-合并测试';
  copy.actions.find(a => a.name === '满芙普攻').action = 'attack,attack,attack';
  const src = g('checkMergeSource')(copy);
  assert(src.mode === 'ok', '示例策略副本应能作为合并来源：' + src.reasons.join('；'));
  const plan = g('planMerge')(src);
  assert(plan.infoDiffs.length === 0, '当前版本为空时应直接采用导入版本，不该有冲突：' + JSON.stringify(plan.infoDiffs.map(d => d.field)));
  const conflicts = plan.items.filter(it => it.cur && it.diffs.length);
  assert(conflicts.length === 1 && conflicts[0].src.name === '满芙普攻', '应只有 1 处动作差异，实际：' + JSON.stringify(conflicts.map(c => c.src.name)));
  const r = g('applyMergePlan')(plan, { info: {}, actions: { [conflicts[0].order]: 'replace' } });
  assert(r.ok, '合并失败：' + r.error);
  assert(r.replaced.length === 1 && r.kept.length === 27, `应替换 1 条、保留 27 条，实际 ${r.replaced.length} / ${r.kept.length}`);
  assert(g('state').strategy.info.version === 'v-合并测试', '版本应采用导入版本：' + g('state').strategy.info.version);
  const merged = g('state').strategy.actions.find(a => a.name === '满芙普攻');
  assert(merged.action === 'attack,attack,attack', '指令应被替换：' + merged.action);
  const v = g('validateStrategy')();
  assert(v.errors.length === 0, '合并后不应有错误：' + v.errors.map(x => x.text).join('；'));
  const out = g('buildJson')();
  const back = g('analyzeImport')(out);
  assert(back.fatal.length === 0 && back.problems.length === 0, '合并后的导出回读有问题：' + back.fatal.concat(back.problems.map(p => p.text)).join('；'));
  return `28 条动作里替换 1 条 + 采用导入版本；导出回读 ${out.actions.length} 条动作无问题`;
});

/* ============ 输出 ============ */
await runChecks();
for (const [m, n, d] of R) console.log(`${m} ${n}${d ? ' — ' + d : ''}`);
console.log(fail ? `\n共 ${fail} 项失败` : `\n端到端验收全部通过（${R.length} 项）`);
process.exit(fail ? 1 : 0);
