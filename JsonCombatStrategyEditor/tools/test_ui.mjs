// UI 冒烟测试：node tools/test_ui.mjs
// 用极简 DOM 模拟跑一遍 boot + 主要交互，检查有没有运行时异常
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { readSources, findSampleJson } from './build.mjs';
import { createDom } from './dom.mjs';

const dom = createDom();
const ctx = {
  console,
  window: dom.window,
  document: dom.document,
  localStorage: dom.localStorage,
  Blob: class { constructor() { } },
  FileReader: class { readAsText() { } },
  alert: (m) => { console.log('  [alert] ' + String(m).slice(0, 200)); },
  confirm: () => true,
  setTimeout, clearTimeout, setInterval, clearInterval,
  URL: dom.window.URL,
};
ctx.globalThis = ctx;
vm.createContext(ctx);

const src = readSources({ skipMissing: true }).map(s => s.code).join('\n');
if (!src.includes('通用 UI 工具')) throw new Error('ui_common.js 未进入打包顺序');
vm.runInContext(src, ctx);
const g = (c) => vm.runInContext(c, ctx);

let failures = 0;
function check(name, fn) {
  try {
    const r = fn();
    console.log(`✔ ${name}${r ? ' — ' + r : ''}`);
  } catch (e) {
    failures++;
    console.log(`✘ ${name}\n   ${e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n   ') : e}`);
  }
}

// 触发 boot
// 触发 boot 前：把模板里声明的静态元素挂到根上（模拟 index.html 里已有的 #paneInfo 等）
const STATIC_IDS = ['tabs', 'hdrStatus', 'hdrIssues', 'btnIssues', 'paneInfo', 'paneActions', 'panePreview', 'side', 'footInfo', 'modal', 'modalTitle', 'modalBody', 'modalFoot'];
for (const id of STATIC_IDS) dom.document.mount(dom.document.getElementById(id));

check('boot() 启动', () => { dom.window.dispatch('DOMContentLoaded'); return 'ok'; });

check('信息页渲染', () => {
  const html = dom.window.$('paneInfo').innerHTML;
  if (!html.includes('基本信息')) throw new Error('信息页内容缺失');
  return html.length + ' 字符';
});

check('动作页渲染', () => {
  g('setTab("actions")');
  const html = dom.window.$('paneActions').innerHTML;
  if (!html.includes('角色列表')) throw new Error('角色列表缺失');
  if (!html.includes('正在编辑')) throw new Error('动作区缺失');
  return html.length + ' 字符';
});

check('预览页渲染', () => {
  g('setTab("preview")');
  const html = dom.window.$('panePreview').innerHTML;
  if (!html.includes('优先级排序预览')) throw new Error('预览表缺失');
  return html.length + ' 字符';
});

check('侧栏校验面板渲染', () => {
  const html = dom.window.$('side').innerHTML;
  if (!html.includes('校验结果')) throw new Error('校验面板缺失');
  return html.length + ' 字符';
});

check('预置兜底等待动作', () => {
  const acts = g('state').strategy.actions;
  if (!acts.length) throw new Error('没有预置动作');
  const a = acts[0];
  if (a.type !== 9) throw new Error('预置动作类型应为 9，实际 ' + a.type);
  if (a.index !== 90001) throw new Error('预置动作 index 应为 90001，实际 ' + a.index);
  if (a.conditionText !== 'false') throw new Error('预置主条件应为 false');
  const mp = a.morePriorities[0];
  if (!mp || mp.priority !== 100000) throw new Error('预置额外条件 priority 应为 100000');
  return JSON.stringify({ index: a.index, cond: a.conditionText, mp: mp.priority });
});

check('新增动作（芙宁娜·开盾）', () => {
  g('state.ui.editingCharacter = "芙宁娜"');
  const r = g('addAction("芙宁娜", 1, {name:"芙宁娜-开盾", action:"attack,e"})');
  if (!r.ok) throw new Error(r.error);
  const a = r.action;
  // 芙宁娜 = 水元素（元素号 3）· 角色编号 11 → 1 3 11 1
  if (a.index !== 13111) throw new Error('index 应为 13111，实际 ' + a.index);
  if (a.ensureCast !== true) throw new Error('开盾应默认勾选确保E技能');
  return 'index=' + a.index;
});

check('动作容量上限（同角色同类型 9 条）', () => {
  for (let i = 0; i < 8; i++) g('addAction("芙宁娜", 1, {name:"盾X' + i + '"})');
  const r = g('addAction("芙宁娜", 1, {})');
  if (r.ok) throw new Error('第 10 条不应成功');
  return r.error.slice(0, 40) + '…';
});

check('切换动作类型', () => {
  const acts = g('state').strategy.actions.filter(a => a.character === '芙宁娜' && a.type === 1);
  const r = g('changeActionType')(acts[0].id, 4);
  if (!r.ok) throw new Error(r.error);
  if (acts[0].index !== 43111) throw new Error('切换后 index 应为 43111，实际 ' + acts[0].index);
  return 'index=' + acts[0].index;
});

check('交换动作顺序', () => {
  const acts = g('state').strategy.actions.filter(a => a.character === '芙宁娜' && a.type === 1).sort((x, y) => x.index - y.index);
  const before = acts.map(a => a.index).join(',');
  const r = g('swapActionOrder')(acts[0].id, 1);
  if (!r.ok) throw new Error(r.error);
  const after = acts.map(a => a.index).join(',');
  return before + ' → ' + after;
});

check('队友条件与表达式组装', () => {
  const a = g('state').strategy.actions.find(x => x.name === '芙宁娜-开盾');
  a.conditionText = 'e-ready';
  a.teammates.include = ['枫原万叶'];
  a.teammates.exclude = ['钟离'];
  const expr = g('buildExpression')(a, g('state').strategy.actions);
  if (!expr.includes('in-party(枫原万叶)')) throw new Error('缺少必要队友条件');
  if (!expr.includes('!(in-party(钟离))')) throw new Error('缺少排除队友条件：' + expr);
  if (!expr.startsWith('(e-ready) &&')) throw new Error('缺少基础条件或基础条件未整体加括号：' + expr);
  return expr;
});

check('额外触发条件 priority 推导', () => {
  const a = g('state').strategy.actions.find(x => x.name === '芙宁娜-开盾');
  const calc = g('computePriority')({ type: 1, element: '', character: '' }, 'before', g('state').strategy.actions);
  if (calc.priority !== 10000) throw new Error('优先于开盾应得 10000，实际 ' + calc.priority);
  const c2 = g('computePriority')({ type: 4, element: 3, character: '' }, 'after', g('state').strategy.actions);
  if (c2.priority !== 44000) throw new Error('次于水元素辅助应得 44000，实际 ' + c2.priority);
  a.morePriorities.push({ id: 'x1', text: 'low-hp', priority: 10000, cmp: 'before', scope: { type: 1, element: '', character: '' } });
  const bp = g('buildMorePriorities')(a, g('state').strategy.actions);
  if (!bp[0].expression.includes('low-hp') || !bp[0].expression.includes('in-party(枫原万叶)')) throw new Error('额外条件未拼接队友条件：' + bp[0].expression);
  return bp[0].expression;
});

check('校验器（含错误动作）', () => {
  const v = g('validateStrategy')();
  return `错误 ${v.errors.length} / 警告 ${v.warnings.length}`;
});

check('导出 JSON 结构与排序', () => {
  const obj = g('buildJson')();
  const idx = obj.actions.map(a => a.index);
  const sorted = [...idx].sort((a, b) => a - b);
  if (JSON.stringify(idx) !== JSON.stringify(sorted)) throw new Error('导出未按 index 升序：' + idx);
  if (obj.info.config === undefined) throw new Error('缺少 config 字段');
  if (!('description' in obj.info)) throw new Error('缺少 description 字段');
  const k = Object.keys(obj.info);
  if (k.indexOf('description') !== k.indexOf('author') + 1) throw new Error('description 应紧跟在 author 之后：' + k);
  for (const a of obj.actions) {
    if (typeof a.condition !== 'object' || typeof a.condition.expression !== 'string') throw new Error('condition 必须是对象：' + JSON.stringify(a.condition));
  }
  return `${obj.actions.length} 条动作，info 顺序 ${k.join('>')}`;
});

check('导出 -> 导入回读一致', () => {
  const obj = g('buildJson')();
  const res = g('analyzeImport')(obj);
  if (res.fatal.length) throw new Error(res.fatal.join('；'));
  if (res.problems.filter(p => p.kind === 'index').length) throw new Error('回读出现编号问题：' + JSON.stringify(res.problems.slice(0, 2)));
  return `回读 ${res.actions.length} 条，问题 ${res.problems.length} 处`;
});

check('导入示例策略 + 重排编号', () => {
  const sample = JSON.parse(fs.readFileSync(findSampleJson(), 'utf8'));
  const res = g('analyzeImport')(sample);
  if (res.fatal.length) throw new Error(res.fatal.join('；'));
  if (!res.problems.some(p => p.kind === 'index')) throw new Error('示例策略本应有编号问题');
  g('applyImport')(res);
  const plan = g('planRenumber')();
  if (plan.error) throw new Error(plan.error);
  g('applyRenumber')(plan);
  const v = g('validateStrategy')();
  if (v.errors.length) throw new Error('重排后仍有错误：' + v.errors.map(e => e.text).slice(0, 3).join(' | '));
  const chest = g('state').strategy.actions.find(a => a.name === '检查战斗结束');
  if (chest.index !== 1) throw new Error('类型 0 动作 index 应为 1，实际 ' + chest.index);
  const furina = g('state').strategy.actions.find(a => a.name === '芙芙e');
  if (furina.index !== 43111) throw new Error('芙芙e 应重排为 43111，实际 ' + furina.index);
  return `${g('state').strategy.actions.length} 条动作，错误 0，警告 ${v.warnings.length}`;
});

check('条件引用随重排同步改写', () => {
  const acts = g('state').strategy.actions;
  const akf = acts.find(a => a.name === '爱可菲q');
  // 原： (low-hp || since(41)<3) && q-ready   41 → 芙芙q 的新编号
  const furinaQ = acts.find(a => a.name === '芙芙q');
  if (!akf.conditionText.includes(String(furinaQ.index))) throw new Error('引用未改写：' + akf.conditionText + '（应为 ' + furinaQ.index + '）');
  return akf.conditionText;
});

check('模拟队伍过滤后的优先级条目', () => {
  g('state.ui.team = ["芙宁娜","枫原万叶","纳西妲","茜特菈莉"]');
  const list = g('expandPriorities')(g('state').strategy.actions, g('state').ui.team);
  const names = uniqNames(list);
  if (names.includes('尼可开盾')) throw new Error('队伍外的尼可动作不应出现');
  const sorted = list.map(x => x.priority);
  for (let i = 1; i < sorted.length; i++) if (sorted[i] < sorted[i - 1]) throw new Error('未按 priority 排序');
  return `${list.length} 个条目，涉及 ${names.length} 个动作`;
});
function uniqNames(list) { return [...new Set(list.map(x => x.name))]; }

check('渲染（带真实数据）不抛异常', () => {
  const $ = dom.window.$;
  if (!$) throw new Error('window.$ 未暴露');
  g('renderInfoPanel()');
  const info = $('paneInfo').innerHTML;
  if (!info.includes('基本信息')) throw new Error('信息页内容缺失');
  g('state.ui.editingCharacter = "芙宁娜"');
  g('renderActionsPanel()');
  const acts = $('paneActions').innerHTML;
  if (!acts.includes('角色列表')) throw new Error('动作页角色列表缺失');
  if (!acts.includes('正在编辑')) throw new Error('动作页编辑区缺失');
  g('renderPreviewPanel()');
  const pv = $('panePreview').innerHTML;
  if (!pv.includes('优先级排序预览')) throw new Error('预览页表格缺失');
  g('renderSide()');
  if (!$('side').innerHTML.includes('校验结果')) throw new Error('侧栏缺失');
  return `信息${info.length} / 动作${acts.length} / 预览${pv.length} 字符`;
});

check('条件行构造器 -> 表达式', () => {
  const e1 = g('buildCondExpr')([{ text: 'e-ready' }, { text: 'q-ready' }], 'all');
  if (e1 !== 'e-ready && q-ready') throw new Error('all 模式拼接错误：' + e1);
  const e2 = g('buildCondExpr')([{ text: 'low-hp' }, { text: 'q-ready' }], 'any');
  if (e2 !== 'low-hp || q-ready') throw new Error('any 模式拼接错误：' + e2);
  const rows = g('parseCondRows')('since>8 || since>since(45)');
  if (!rows || rows.mode !== 'any' || rows.rows.length !== 2) throw new Error('反解失败：' + JSON.stringify(rows));
  return `${e1} ／ 反解 ${rows.rows.length} 行（${rows.mode}）`;
});

check('动作名合法性校验', () => {
  const names = g('allActionNames')(g('state').strategy.actions);
  const bad = g('isValidActionName')('true', names);
  if (bad.ok) throw new Error('true 不应合法');
  const good = g('isValidActionName')('芙芙-e-开场', ['芙芙-e-开场']);
  if (!good.ok) throw new Error('芙芙-e-开场 应合法：' + good.reason);
  return 'ok';
});

/* ---------------- 界面交互模拟 ---------------- */

// 先清空预置内容与本地草稿，保证界面测试从干净状态开始
dom.localStorage.clear();
g('state').strategy.actions = [];
g('state').strategy.info = { name: '', author: '', description: '', config: {}, preActions: [] };
g('state').ui.editingCharacter = '';

const $ = dom.window.$;
const makeAction = (character, type, opts) => {
  const r = g('addAction')(character, type, opts || {});
  if (!r.ok) throw new Error(r.error);
  return g('state').strategy.actions.find(a => a.id === r.action.id);
};
const clickAct = (act, extra) => {
  const nodes = dom.document.querySelectorAll('[data-act="' + act + '"]');
  if (!nodes.length) throw new Error('找不到 data-act=' + act + ' 的按钮');
  const node = nodes.find(n => !extra || Object.entries(extra).every(([k, v]) => n.getAttribute(k) === v)) || nodes[0];
  const h = g('app').handlers[act];
  if (!h) throw new Error('没有注册处理器：' + act);
  h(node, { target: node, preventDefault() { }, stopPropagation() { } });
  return node;
};

check('界面：添加新动作（填写类型与名称后点击按钮）', () => {
  g('state.ui.editingCharacter = "芙宁娜"');
  g('renderActionsPanel()');
  const typeEl = $('newType');
  const nameEl = $('newName');
  if (!typeEl || !nameEl) throw new Error('工具栏缺少输入框');
  typeEl.value = '5';
  nameEl.value = '芙宁娜-q';
  clickAct('new-action');
  const a = g('state').strategy.actions.find(x => x.name === '芙宁娜-q');
  if (!a) throw new Error('动作未创建');
  if (a.index !== 53111) throw new Error('index 应为 53111，实际 ' + a.index);
  if (a.type !== 5) throw new Error('类型应为 5');
  return 'index=' + a.index + ' 类型=' + a.type;
});

check('界面：角色搜索输入后重新渲染且不丢内容', () => {
  g('renderActionsPanel()');
  g('state.ui.characterSearch = "芙"');
  g('renderActionsPanel()');
  const html = $('paneActions').innerHTML;
  if (!html.includes('芙宁娜')) throw new Error('筛选后未显示芙宁娜');
  if (!html.includes('value="芙"')) throw new Error('搜索框内容丢失');
  g('state.ui.characterSearch = ""');
  g('renderActionsPanel()');
  return 'ok';
});

check('界面：星级筛选隐藏未标注角色', () => {
  const listAll = g('filteredAvatars')().map(x => x.key);
  if (!listAll.includes('芙宁娜')) throw new Error('未筛选时应包含芙宁娜');
  g('state.rarity = {}');
  g('state.ui.filterRarity = "5"');
  const listNoRarity = g('filteredAvatars')().map(x => x.key);
  if (listNoRarity.includes('芙宁娜')) throw new Error('未标注星级时按五星筛选不应出现芙宁娜');
  g('state.rarity = { "芙宁娜": "5" }');
  const listWithRarity = g('filteredAvatars')().map(x => x.key);
  if (!listWithRarity.includes('芙宁娜')) throw new Error('标注五星后应出现');
  g('state.ui.filterRarity = "all"');
  g('state.rarity = {}');
  g('renderActionsPanel()');
  return `全部 ${listAll.length} 人 → 五星筛选 ${listNoRarity.length} 人 → 标注后 ${listWithRarity.length} 人`;
});

/* 快捷插入指令：现在是在“快捷插入指令”这一项下面就地展开（不再弹窗） */
const qcPanel = (id) => dom.document.querySelector('[data-qk="' + id + '"]');
const qcRender = (id) => g('renderQuickCommandPanel')(id, { kind: 'act', actionId: id }, '');
const qcDisp = (el, type, ev) => el.dispatch(type, Object.assign({ target: el, preventDefault() { }, stopPropagation() { } }, ev || {}));
const qcPick = (id, label) => {
  const panel = qcPanel(id);
  const c = panel.querySelectorAll('[data-cq]').find(x => x.textContent.trim() === label);
  if (!c) throw new Error('找不到「' + label + '」词条');
  qcDisp(c, 'click');
};
const qcInsert = (id, mode) => {
  const b = qcPanel(id).querySelector('[data-cqins="' + mode + '"]');
  if (!b) throw new Error('找不到插入按钮（' + mode + '）');
  qcDisp(b, 'click');
};

check('界面：快捷插入指令面板（点按q技能）', () => {
  const a = g('state').strategy.actions.find(x => x.name === '芙宁娜-q');
  a.action = '';
  $('paneActions').innerHTML = qcRender(a.id);
  g('bindQuickCommandPanels')();
  qcPick(a.id, '点按q技能');
  qcInsert(a.id, 'replace');
  if (a.action !== 'q,wait(0.1),ready') throw new Error('插入结果不对：' + JSON.stringify(a.action));
  return a.action;
});

check('界面：快捷插入指令面板（带参数，连续普攻）', () => {
  const a = g('state').strategy.actions.find(x => x.name === '芙宁娜-q');
  a.action = '';
  $('paneActions').innerHTML = qcRender(a.id);
  g('bindQuickCommandPanels')();
  qcPick(a.id, '连续普攻');
  const p0 = qcPanel(a.id).querySelector('[data-cqp="0"]');
  if (!p0) throw new Error('缺少参数输入框');
  p0.value = '1.2';
  qcDisp(p0, 'input');
  qcInsert(a.id, 'append');
  if (a.action !== 'attack(1.2)') throw new Error('插入结果不对：' + a.action);
  return a.action;
});

check('界面：快捷插入指令的按键图（就地展开，不再弹窗）', () => {
  const a = g('state').strategy.actions.find(x => x.name === '芙宁娜-q');
  a.action = '';
  $('paneActions').innerHTML = qcRender(a.id);
  g('bindQuickCommandPanels')();
  qcPick(a.id, '点按按键');
  const keyBtn = qcPanel(a.id).querySelector('[data-qvk="0"]');
  if (!keyBtn) throw new Error('找不到按键图按钮');
  qcDisp(keyBtn, 'click');
  const kb = qcPanel(a.id).querySelector('[data-qvkset="0:VK_LBUTTON"]');
  if (!kb) throw new Error('按键图里找不到鼠标左键');
  qcDisp(kb, 'click');
  const p0 = qcPanel(a.id).querySelector('[data-cqp="0"]');
  if (!p0 || p0.value !== 'VK_LBUTTON') throw new Error('点击按键图未填入：' + (p0 && p0.value));
  qcInsert(a.id, 'replace');
  if (a.action !== 'keypress(VK_LBUTTON)') throw new Error('按键插入结果不对：' + a.action);
  return a.action;
});

check('界面：快捷插入指令（空参数时自动省略括号与逗号）', () => {
  const a = g('state').strategy.actions.find(x => x.name === '芙宁娜-q');
  a.action = '';
  $('paneActions').innerHTML = qcRender(a.id);
  g('bindQuickCommandPanels')();
  qcPick(a.id, '连续普攻');
  const p0 = qcPanel(a.id).querySelector('[data-cqp="0"]');
  p0.value = '';
  qcDisp(p0, 'input');
  qcInsert(a.id, 'replace');
  if (a.action !== 'attack') throw new Error('空参数应省略括号：' + JSON.stringify(a.action));
  a.action = '';
  $('paneActions').innerHTML = qcRender(a.id);
  g('bindQuickCommandPanels')();
  qcPick(a.id, '移动');
  const dir = qcPanel(a.id).querySelector('[data-cqp="0"]');
  if (!dir || dir.value !== 'w') throw new Error('「移动」的默认方向应为前 w，实际 ' + (dir && dir.value));
  qcInsert(a.id, 'replace');
  if (a.action !== 'walk(w,0.2)') throw new Error('移动插入结果不对：' + a.action);
  return a.action;
});

check('界面：动作名称快捷填入命名规则', () => {
  const a = g('state').strategy.actions.find(x => x.name === '芙宁娜-q');
  const list = g('actionNameQuickList')(a);
  if (list[0] !== '芙宁娜-普攻') throw new Error('第一项应为 芙宁娜-普攻，实际 ' + list[0]);
  // 再造一条同为「芙宁娜-q」的动作，检查快捷名不会重名
  const other = makeAction('芙宁娜', 5, { name: '芙宁娜-q' });
  const list2 = g('actionNameQuickList')(a);
  if (list2.includes('芙宁娜-q')) throw new Error('已存在的名字不应出现在候选里：' + list2.join('、'));
  g('removeAction')(other.id);
  return list.join('、') + ' ／ 有重名时：' + list2.join('、');
});

check('界面：额外触发条件重算 priority', () => {
  const a = g('state').strategy.actions.find(x => x.name === '芙宁娜-q');
  a.morePriorities.length = 0;
  a.morePriorities.push({ id: 'mp1', text: 'low-hp', priority: 1, cmp: 'before', scope: { type: 1, element: '', character: '' }, manualPriority: false });
  g('state').ui.editingCharacter = '芙宁娜';
  g('state').ui.collapsed[a.id] = false;
  g('renderActionsPanel()');
  const node = dom.document.querySelector('[data-act="more-recalc"]');
  if (!node) throw new Error('找不到重算按钮');
  clickAct('more-recalc', { 'data-id': a.id });
  if (a.morePriorities[0].priority !== 10000) throw new Error('重算后应为 10000，实际 ' + a.morePriorities[0].priority);
  return 'priority=' + a.morePriorities[0].priority;
});

check('界面：拖动排序按钮（↑↓）', () => {
  // 用一份干净的数据做排序验证
  g('state').strategy.actions = [];
  const a1 = makeAction('芙宁娜', 1, { name: '芙宁娜-开盾A', action: 'e' });
  const a2 = makeAction('芙宁娜', 1, { name: '芙宁娜-开盾B', action: 'e' });
  const before = [a1.index, a2.index];
  const r = g('swapActionOrder')(a1.id, 1);
  if (!r.ok) throw new Error(r.error);
  g('recomputeIndexes')(g('state').strategy.actions);
  const cur = g('state').strategy.actions;
  const after = [cur.find(x => x.id === a1.id).index, cur.find(x => x.id === a2.id).index];
  if (after[0] !== before[1] || after[1] !== before[0]) throw new Error(`排序未交换：${before} → ${after}`);
  // 界面里也要渲染出排序按钮
  g('state').ui.editingCharacter = '芙宁娜';
  g('renderActionsPanel()');
  if (!dom.document.querySelectorAll('[data-act="card-down"]').length) throw new Error('界面缺少排序按钮');
  return before.join() + ' → ' + after.join();
});

check('界面：草稿写入 localStorage', () => {
  g('saveDraftNow()');
  const raw = dom.localStorage.getItem('bgi_strategy_editor_drafts_v1');
  if (!raw) throw new Error('草稿未写入');
  const obj = JSON.parse(raw);
  const k = Object.keys(obj)[0];
  if (!obj[k].json || !Array.isArray(obj[k].json.actions)) throw new Error('草稿结构不对');
  return k + '（' + obj[k].json.actions.length + ' 条动作）';
});

check('界面：校验失败时拒绝导出', () => {
  const a = g('state').strategy.actions[0];
  const oldName = a.name;
  a.name = 'true';           // 非法动作名
  g('validateStrategy')();
  g('doExport')();
  const title = $('modalTitle').innerHTML;
  if (!title.includes('拒绝')) throw new Error('应弹出拒绝导出提示，实际：' + title);
  g('closeModal')(null);
  a.name = oldName;
  g('validateStrategy')();
  return title;
});

/* ---------------- 条件快捷添加 / 手输指令实时校验 ---------------- */

check('界面：快捷添加条件（选函数 → 出参数框 → 可插入）', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '芙宁娜';
  const a = makeAction('芙宁娜', 5, { name: '芙宁娜-q2', action: 'q,wait(0.1),ready' });
  a.conditionText = '';
  g('state').ui.collapsed[a.id] = false;
  g('renderActionsPanel')();
  const box = dom.document.querySelector('[data-cfbox="cond:' + a.id + '"]');
  if (!box) throw new Error('找不到「快捷添加条件」面板');
  const sel = box.querySelector('[data-cfp="fn"]');
  if (!sel) throw new Error('条件函数下拉框缺少 data-cfp="fn"');
  if (!box.querySelector('[data-cf="ins"]').disabled) throw new Error('未选函数时「插入此片段到光标位置」应禁用');
  if (!box.querySelector('[data-cf="insend"]').disabled) throw new Error('未选函数时「插入此片段到末尾」应禁用');
  sel.value = 'since';
  sel.dispatch('change');
  if (box.querySelector('[data-cf="ins"]').disabled) throw new Error('选好函数后「插入此片段到光标位置」仍不可用');
  if (box.querySelector('[data-cf="insend"]').disabled) throw new Error('选好函数后「插入此片段到末尾」仍不可用');
  if (box.textContent.includes('先选一个条件函数')) throw new Error('选好函数后仍显示“先选一个条件函数”');
  const pa = box.querySelector('[data-cfparams] [data-cfp="a"]');
  if (!pa) throw new Error('选好函数后没有出现参数选择器');
  const target = a;
  if (!pa.children.some(o => String(o.value) === String(target.index))) throw new Error('动作参数下拉里没有当前动作');
  pa.value = String(target.index);
  pa.dispatch('change');
  box.querySelector('[data-cf="insend"]').dispatch('click');
  if (a.conditionText !== `since(${target.index})`) throw new Error('插入到末尾结果不对：' + JSON.stringify(a.conditionText));
  return a.conditionText;
});

check('界面：快捷添加条件的运算符插入（光标位置 / 末尾）', () => {
  const a = g('state').strategy.actions.find(x => x.name === '芙宁娜-q2');
  a.conditionText = 'low-hp';
  g('renderActionsPanel')();
  const ta = dom.document.querySelector('textarea[data-cond-ref="cond:' + a.id + '"]');
  if (!ta) throw new Error('找不到条件输入框');
  ta.focus();
  ta.setSelectionRange(6, 6);            // 光标放到末尾
  g('syncCondSelection')();
  let box = dom.document.querySelector('[data-cfbox="cond:' + a.id + '"]');
  box.querySelector('[data-cfpos="cursor"]').dispatch('click');
  const andBtn = box.querySelectorAll('[data-cfi]').find(x => x.getAttribute('data-cfi') === '&&');
  andBtn.dispatch('click');
  if (a.conditionText !== 'low-hp &&') throw new Error('插入到光标位置结果不对：' + JSON.stringify(a.conditionText));
  // 切到“末尾”后再插入
  box = dom.document.querySelector('[data-cfbox="cond:' + a.id + '"]');
  box.querySelector('[data-cfpos="append"]').dispatch('click');
  const trueBtn = box.querySelectorAll('[data-cfi]').find(x => x.getAttribute('data-cfi') === 'true');
  trueBtn.dispatch('click');
  if (a.conditionText !== 'low-hp && true') throw new Error('插入到末尾结果不对：' + JSON.stringify(a.conditionText));
  // 快捷添加面板的片段状态在重建后保留
  box = dom.document.querySelector('[data-cfbox="cond:' + a.id + '"]');
  if (!box.querySelector('[data-cfpos="append"]').classList.contains('on')) throw new Error('插入位置没有保留为“末尾”');
  return a.conditionText;
});

check('界面：添加其他触发条件能带入手输的触发条件', () => {
  const a = g('state').strategy.actions.find(x => x.name === '芙宁娜-q2');
  a.morePriorities.length = 0;
  g('renderActionsPanel')();
  const ta = dom.document.querySelector('textarea[data-cond-ref="morenew:' + a.id + '"]');
  if (!ta) throw new Error('找不到「添加其他触发条件」的条件输入框');
  ta.value = 'low-hp';
  g('onFieldChange')(ta, true);
  // 判定范围用表单自己的下拉选择（不再用全局 id，多张卡片互不干扰）
  const pickType = (v) => {
    const form = dom.document.querySelector('[data-moreaddform="' + a.id + '"]');
    if (!form) throw new Error('找不到「添加其他触发条件」的判定范围表单');
    const sel = form.querySelector('[data-na="type"]');
    sel.value = v;
    form.dispatch('change', { target: sel });
  };
  pickType('5');
  clickAct('more-add2', { 'data-id': a.id });
  const mp = a.morePriorities[a.morePriorities.length - 1];
  if (!mp) throw new Error('没有添加出其他触发条件');
  if (mp.text !== 'low-hp') throw new Error('其他触发条件未带入手输内容：' + JSON.stringify(a.morePriorities));
  if (mp.priority !== 60000) throw new Error('priority 应为次于爆发的 60000，实际 ' + mp.priority);
  // 判定范围的选择要保留（不能因为重建面板就被重置）
  const form2 = dom.document.querySelector('[data-moreaddform="' + a.id + '"]');
  if (form2.querySelector('[data-na="type"]').value !== '5') throw new Error('添加后判定范围被重置了');
  // 再用“快捷添加条件”拼一条
  const box = dom.document.querySelector('[data-cfbox="morenew:' + a.id + '"]');
  if (!box) throw new Error('「添加其他触发条件」里没有快捷添加条件面板');
  const sel = box.querySelector('[data-cfp="fn"]');
  sel.value = 'q-ready';
  sel.dispatch('change');
  box.querySelector('[data-cf="insend"]').dispatch('click');
  const ta2 = dom.document.querySelector('textarea[data-cond-ref="morenew:' + a.id + '"]');
  if (!ta2 || ta2.value !== 'q-ready') throw new Error('快捷添加的片段没有出现在条件输入框里：' + (ta2 && ta2.value));
  clickAct('more-add2', { 'data-id': a.id });
  const mp2 = a.morePriorities[a.morePriorities.length - 1];
  if (mp2.text !== 'q-ready') throw new Error('快捷添加的片段没有进入新条目：' + JSON.stringify(a.morePriorities.map(x => x.text)));
  return a.morePriorities.map(x => `${x.text}@${x.priority}`).join('，');
});

check('界面：手输动作指令实时触发校验与释义刷新', () => {
  const a = g('state').strategy.actions.find(x => x.name === '芙宁娜-q2');
  a.action = '';
  g('state').ui.collapsed[a.id] = false;
  g('renderActionsPanel')();
  const ta = dom.document.querySelector('textarea[data-kind="act"][data-id="' + a.id + '"][data-field="action"]');
  if (!ta) throw new Error('找不到动作指令输入框');
  ta.value = 'E';
  g('onFieldChange')(ta, true);
  if (a.action !== 'E') throw new Error('指令没有写进模型');
  const fb = dom.document.querySelector('[data-cmdcheck="act:' + a.id + '"]');
  if (!fb || !fb.innerHTML.includes('未知指令')) throw new Error('手输指令后没有出现校验反馈：' + (fb && fb.innerHTML));
  if (!$('side').innerHTML.includes('未知指令')) throw new Error('右侧校验面板没有同步更新');
  ta.value = 'q,wait(0.1),ready';
  g('onFieldChange')(ta, true);
  const fb2 = dom.document.querySelector('[data-cmdcheck="act:' + a.id + '"]');
  if (fb2.innerHTML.includes('未知指令')) throw new Error('改成合法指令后仍然报错');
  const tokens = dom.document.querySelector('[data-cmdtokens="act:' + a.id + '"]');
  if (!tokens || !tokens.innerHTML.includes('元素爆发')) throw new Error('释义表没有实时刷新');
  if (Number(dom.document.querySelector('[data-cmdcount="act:' + a.id + '"]').textContent) !== 3) throw new Error('释义条数没有刷新');
  // 动作名合法性也在右侧面板实时显示
  const nameEl = dom.document.querySelector('input[data-kind="act"][data-id="' + a.id + '"][data-field="name"]');
  nameEl.value = 'true';
  g('onFieldChange')(nameEl, true);
  if (!$('side').innerHTML.includes('不能使用布尔字面量')) throw new Error('动作名校验没有实时刷新');
  nameEl.value = '芙宁娜-q2';
  g('onFieldChange')(nameEl, true);
  return 'E → 报未知指令；q,wait(0.1),ready → 通过；非法动作名会实时提示';
});

check('界面：战斗前动作手输指令实时触发校验', () => {
  g('state').strategy.info.preActions = [{ character: '', cmd: '' }];
  g('setTab')('info');
  const ta = dom.document.querySelector('input[data-kind="pre"][data-idx="0"][data-field="cmd"]');
  if (!ta) throw new Error('找不到战斗前动作输入框');
  ta.value = 'walk(s 0.2)';
  g('onFieldChange')(ta, true);
  const fb = dom.document.querySelector('[data-cmdcheck="pre:0"]');
  if (!fb || !fb.innerHTML.includes('walk 必须有两个参数')) throw new Error('手输战斗前指令后没有实时校验：' + (fb && fb.innerHTML));
  if (!$('side').innerHTML.includes('walk 必须有两个参数')) throw new Error('右侧校验面板没有同步更新');
  ta.value = 'e,wait(0.3)';
  g('onFieldChange')(ta, true);
  if (dom.document.querySelector('[data-cmdcheck="pre:0"]').innerHTML.includes('errbox')) throw new Error('合法指令仍然报错');
  g('state').strategy.info.preActions = [];
  return 'walk(s 0.2) → 报参数错误；e,wait(0.3) → 通过';
});

check('界面：隐式转换检查支持展开/收起', () => {
  g('state').ui.showIssues = true;
  g('state').lastIssues = g('validateStrategy')();
  const hasToggle = () => $('side').innerHTML.includes('data-act="toggle-conv"');
  g('state').ui.convOpen = false;
  g('renderSide')();
  if (!hasToggle()) throw new Error('缺少展开/收起的点击区');
  if ($('side').innerHTML.includes('没有发现数值与布尔互转的位置')) throw new Error('收起时不应渲染检查内容');
  g('state').ui.convOpen = true;
  g('renderSide')();
  if (!hasToggle()) throw new Error('展开后仍应保留点击区');
  if (!$('side').innerHTML.includes('没有发现数值与布尔互转的位置')) throw new Error('展开后应渲染检查内容');
  g('state').ui.convOpen = false;
  g('renderSide')();
  return '可展开与收起';
});

check('界面：导入示例策略走弹窗流程', () => {
  const sample = fs.readFileSync(findSampleJson(), 'utf8');
  g('doImportFromText')(sample, '公式化锄地（已修复）.json');
  const title = $('modalTitle').innerHTML;
  if (!title.includes('导入前检查')) throw new Error('未弹出导入检查，实际：' + title);
  const body = $('modalBody').innerHTML;
  if (!body.includes('index 编号不符合')) throw new Error('未提示编号问题');
  const btns = dom.document.querySelectorAll('[data-act]');
  // 直接调用内部逻辑：模拟点击“调整编号后导入”
  const foot = $('modalFoot');
  const okBtn = foot.children.find(b => b.textContent.includes('调整编号后导入'));
  if (!okBtn) throw new Error('找不到导入按钮');
  okBtn.click();
  return title;
});

/* ================= 回归：本次修复的 7 个问题 ================= */

/** 造一条干净的动作卡片并渲染 */
function freshAction(name, type, cond) {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '枫原万叶';
  const a = makeAction('枫原万叶', type || 4, { name: name || '万叶e', action: 'e,wait(0.2)' });
  a.conditionText = cond === undefined ? 'e-ready' : cond;
  g('state').ui.collapsed[a.id] = false;
  g('state').ui.detailsOpen[a.id + ':cond'] = true;
  g('renderActionsPanel')();
  return a;
}

check('回归②：快捷插入指令插入后保持展开，已输入指令的释义默认收起', () => {
  const a = freshAction('万叶e', 4, 'e-ready');
  const quick = dom.document.querySelector(`details[data-details="act:${a.id}:quick"]`);
  const explain = dom.document.querySelector(`details[data-details="act:${a.id}:explain"]`);
  if (!quick) throw new Error('找不到「快捷插入指令」区块');
  if (!explain) throw new Error('找不到「已输入指令的释义」区块');
  if (!quick.open) throw new Error('「快捷插入指令」应默认展开');
  if (explain.open) throw new Error('「已输入指令的释义」应默认收起');
  // 点一个词条插入（applyCommandInsert 会重建面板）
  g('state').qc['act:' + a.id] = { sel: null, vals: {}, pick: null };
  g('renderActionsPanel')();
  const panel = dom.document.querySelector('[data-qk="act:' + a.id + '"]');
  const chip = panel.querySelectorAll('[data-cq]').find(x => x.textContent.trim() === '点按e技能');
  chip.dispatch('click');
  const insBtn = dom.document.querySelector('[data-qk="act:' + a.id + '"]').querySelector('[data-cqins="append"]');
  insBtn.dispatch('click');
  if (!a.action.includes('e')) throw new Error('指令未插入：' + a.action);
  const quick2 = dom.document.querySelector(`details[data-details="act:${a.id}:quick"]`);
  const explain2 = dom.document.querySelector(`details[data-details="act:${a.id}:explain"]`);
  if (!quick2.open) throw new Error('插入后「快捷插入指令」被收起了（应保持展开）');
  if (explain2.open) throw new Error('插入后「已输入指令的释义」不应自动展开');
  return 'action=' + JSON.stringify(a.action);
});

check('回归⑥：快捷添加条件插入后，隐式转换检查立即刷新（不再滞后一次）', () => {
  const a = freshAction('万叶e', 4, '');
  g('state').ui.showIssues = true;
  g('state').ui.convOpen = true;
  const box = dom.document.querySelector('[data-cfbox="cond:' + a.id + '"]');
  const sel = box.querySelector('[data-cfp="fn"]');
  sel.value = 'q-ready';
  sel.dispatch('change');
  box.querySelector('[data-cf="insend"]').dispatch('click');
  // 再插一个 since：q-ready || since —— since 是数值，|| 需要布尔
  const box2 = dom.document.querySelector('[data-cfbox="cond:' + a.id + '"]');
  box2.querySelector('[data-cfp="fn"]').value = 'since';
  box2.querySelector('[data-cfp="fn"]').dispatch('change');
  box2.querySelector('[data-cf="insend"]').dispatch('click');
  if (a.conditionText !== 'q-ready since') throw new Error('拼接结果异常：' + a.conditionText);
  // 手工补上 || 再看
  a.conditionText = 'q-ready || since';
  g('refreshLiveIssues')();
  const conv = g('state').lastIssues.conversions || [];
  if (!conv.some(c => c.text === 'since()')) throw new Error('应检出 since 处隐式转换，实际：' + JSON.stringify(conv.map(c => c.text)));
  if (!$('side').innerHTML.includes('隐式转换检查')) throw new Error('侧栏缺少隐式转换检查');
  // 类型正确时不报
  a.conditionText = 'q-ready || since > 2';
  g('refreshLiveIssues')();
  if ((g('state').lastIssues.conversions || []).length) throw new Error('q-ready || since > 2 不应报隐式转换');
  a.conditionText = 't < since < count';
  g('refreshLiveIssues')();
  const conv2 = g('state').lastIssues.conversions || [];
  if (!conv2.length) throw new Error('t < since < count 应报隐式转换（(t<since) 的结果是布尔，又参与 < 比较）');
  return conv2.map(c => c.text).join('；');
});

check('回归⑦：手输内容改正后，动作卡片里的报错立即消失', () => {
  const a = freshAction('万叶e', 4, 'e-ready');
  const cmd = dom.document.querySelector(`textarea[data-kind="act"][data-id="${a.id}"][data-field="action"]`);
  if (!cmd) throw new Error('找不到动作指令输入框');
  cmd.value = 'E';
  g('onFieldChange')(cmd, true);
  const box = () => dom.document.querySelector(`[data-cardissues="${a.id}"]`);
  if (!box() || !box().innerHTML.includes('未知指令')) throw new Error('卡片里没有立即显示报错：' + (box() && box().innerHTML.slice(0, 80)));
  if (!dom.document.querySelector(`[data-cardbadges="${a.id}"]`).innerHTML.includes('badge err')) throw new Error('卡片角标没有刷新');
  cmd.value = 'e,wait(0.2)';
  g('onFieldChange')(cmd, true);
  if (box().innerHTML.includes('未知指令')) throw new Error('改正后卡片里仍显示旧报错');
  // 条件表达式也一样
  const ta = dom.document.querySelector(`textarea[data-cond-ref="cond:${a.id}"]`);
  ta.value = 'q-redy';
  g('onFieldChange')(ta, true);
  if (!box().innerHTML.includes('未知的条件函数')) throw new Error('条件报错没有实时出现在卡片里：' + box().innerHTML.slice(0, 200));
  ta.value = 'q-ready';
  g('onFieldChange')(ta, true);
  if (box().innerHTML.includes('未知的条件函数')) throw new Error('条件改正后卡片里仍显示旧报错');
  return '指令与条件的报错都会就地刷新';
});

check('回归④：快捷添加条件的比较选项 / 动作与角色选择器 / 组合函数 / 括号', () => {
  const a = freshAction('万叶e', 4, '');
  const cfbox = () => dom.document.querySelector('[data-cfbox="cond:' + a.id + '"]');
  const pickFn = (v) => {
    const el = cfbox().querySelector('[data-cfp="fn"]');
    el.value = v;
    el.dispatch('change');
  };
  // 比较运算被拆成「比较选项 + 数值输入框」
  pickFn('t');
  const box = cfbox();
  const cmpSel = box.querySelector('[data-cfp="cmp"]');
  if (!cmpSel) throw new Error('数值型函数没有「比较」下拉');
  if (cmpSel.children.length !== 7) throw new Error('比较选项应为 7 种，实际 ' + cmpSel.children.length);
  cmpSel.value = '>';
  cmpSel.dispatch('change');
  const num = cfbox().querySelector('[data-cfp="num"]');
  if (!num) throw new Error('缺少数值输入框');
  num.value = '10';
  num.dispatch('input');
  box.querySelector('[data-cf="insend"]').dispatch('click');
  if (a.conditionText !== 't > 10') throw new Error('大于插入结果不对：' + a.conditionText);
  // 不小于 → !(a < b)
  a.conditionText = '';
  g('renderActionsPanel')();
  pickFn('t');
  const box2 = cfbox();
  box2.querySelector('[data-cfp="cmp"]').value = '!<';
  box2.querySelector('[data-cfp="cmp"]').dispatch('change');
  const num2 = cfbox().querySelector('[data-cfp="num"]');
  num2.value = '14';
  num2.dispatch('input');
  cfbox().querySelector('[data-cf="insend"]').dispatch('click');
  if (a.conditionText !== '! (t < 14)') throw new Error('不小于插入结果不对：' + a.conditionText);
  // 空选时只插入函数本身
  a.conditionText = '';
  g('renderActionsPanel')();
  pickFn('t');
  cfbox().querySelector('[data-cfp="cmp"]').value = '';
  cfbox().querySelector('[data-cfp="cmp"]').dispatch('change');
  cfbox().querySelector('[data-cf="insend"]').dispatch('click');
  if (a.conditionText !== 't') throw new Error('空选比较时应只插入 t：' + a.conditionText);
  // 动作参数用下拉（按角色筛选 + 搜索角色），插入的是 index
  a.conditionText = '';
  g('renderActionsPanel')();
  pickFn('since');
  const box3 = cfbox();
  const charFilter = box3.querySelector('[data-cfchar="a"]');
  if (!charFilter) throw new Error('动作参数缺少角色筛选下拉');
  const charSearch = box3.querySelector('[data-cfcharq="a"]');
  if (!charSearch) throw new Error('动作参数缺少角色搜索框');
  if (box3.querySelector('input[data-cfp="a"]')) throw new Error('动作参数不应再是输入框');
  const actSel = box3.querySelector('[data-cfp="a"]');
  if (!actSel.children.some(o => String(o.value) === String(a.index))) throw new Error('动作下拉里缺少已添加的动作');
  actSel.value = String(a.index);
  actSel.dispatch('change');
  // 角色筛选：只留枫原万叶（选中项即使被搜索词过滤也保留，避免选择凭空消失）
  const box3b = cfbox();
  const cf = box3b.querySelector('[data-cfchar="a"]');
  cf.value = '枫原万叶';
  cf.dispatch('change');
  const box3c = cfbox();
  if (!box3c.querySelector('[data-cfp="a"]').children.some(o => String(o.value) === String(a.index))) throw new Error('角色筛选把本角色动作滤掉了');
  // 角色搜索词过滤角色下拉（先把筛选恢复成「全部角色」，否则当前选中项会被保留）
  const cfReset = box3c.querySelector('[data-cfchar="a"]');
  cfReset.value = '';
  cfReset.dispatch('change');
  const cs = cfbox().querySelector('[data-cfcharq="a"]');
  cs.value = '不存在';
  cs.dispatch('input');
  const box3d = cfbox();
  if (box3d.querySelector('[data-cfchar="a"]').children.some(o => o.value === '枫原万叶')) throw new Error('角色搜索框没有过滤角色下拉');
  cs.value = '';
  cs.dispatch('input');
  const box3e = cfbox();
  box3e.querySelector('[data-cfp="a"]').value = String(a.index);
  box3e.querySelector('[data-cfp="a"]').dispatch('change');
  box3e.querySelector('[data-cf="insend"]').dispatch('click');
  if (a.conditionText !== `since(${a.index})`) throw new Error('since 插入结果不对：' + a.conditionText);
  // 组合 1：min(since(…),since(…)) < 数值
  a.conditionText = '';
  g('renderActionsPanel')();
  pickFn('combo-min-since');
  const box4 = cfbox();
  const nSel = box4.querySelector('[data-cfp="n"]');
  if (!nSel || nSel.children.length !== 9) throw new Error('组合函数的项数应为 1~9，实际 ' + (nSel && nSel.children.length));
  if (!box4.querySelector('[data-cfp="arg1"]') || !box4.querySelector('[data-cfp="cmp"]')) throw new Error('组合 1 缺少逐项动作选择或比较项');
  box4.querySelector('[data-cfp="cmp"]').value = '<';
  box4.querySelector('[data-cfp="cmp"]').dispatch('change');
  const num4 = cfbox().querySelector('[data-cfp="num"]');
  num4.value = '5';
  num4.dispatch('input');
  cfbox().querySelector('[data-cf="insend"]').dispatch('click');
  if (a.conditionText !== 'min(since(),since()) < 5') throw new Error('组合 1 插入结果不对：' + a.conditionText);
  // 组合 2：max(count(…,…,…),…) > 数值
  a.conditionText = '';
  g('renderActionsPanel')();
  pickFn('combo-max-count');
  const box5 = cfbox();
  if (!box5.querySelector('[data-cfp="b"]') || !box5.querySelector('[data-cfp="c"]')) throw new Error('组合 2 缺少统一应用的起始/结束秒');
  box5.querySelector('[data-cfp="b"]').value = '0.5';
  box5.querySelector('[data-cfp="b"]').dispatch('input');
  cfbox().querySelector('[data-cfp="c"]').value = '3';
  cfbox().querySelector('[data-cfp="c"]').dispatch('input');
  const num5 = cfbox().querySelector('[data-cfp="num"]');
  num5.value = '2';
  num5.dispatch('input');
  cfbox().querySelector('[data-cf="insend"]').dispatch('click');
  if (a.conditionText !== 'max(count(),count()) > 2') throw new Error('组合 2 插入结果不对：' + a.conditionText);
  // 括号运算符
  a.conditionText = '';
  g('renderActionsPanel')();
  const parenBtn = cfbox().querySelectorAll('[data-cfi]').find(x => x.getAttribute('data-cfi') === '()');
  if (!parenBtn) throw new Error('运算符里缺少「括号」');
  parenBtn.dispatch('click');
  if (a.conditionText !== '()') throw new Error('括号插入结果不对：' + a.conditionText);
  // 参数输入框旁的「表达式快捷输入」按钮应当已经移除
  if (cfbox().querySelector('[data-cfarg]')) throw new Error('「表达式快捷输入」按钮应已移除');
  return '比较 7 项 / 不小于扩展为 ! (a < b) / 动作下拉带角色筛选与搜索 / 组合 1、2 / 括号';
});

check('回归①：priority 数值在导入/读草稿时自动变成「优先于/次于某类动作」', () => {
  const asAction = (mps) => ({
    info: { name: 'p', author: '', preActions: [] },
    actions: [{ name: 'a1', character: '', action: 'wait(0.2)', index: 90001, condition: { expression: '' }, morePriorities: mps }],
  });
  const cases = [
    [10000, 'after', 0],       // 优先于开盾 = 次于战斗检查与标记 → 优先选“次于”
    [0, 'before', 0],
    [44000, 'after', 4],       // 优先于雷元素辅助 = 次于水元素辅助 → 优先选“次于”
    [90000, 'after', 8],
    [100000, 'after', 9],
  ];
  for (const [p, cmp, type] of cases) {
    const res = g('analyzeImport')(asAction([{ expression: 'low-hp', priority: p }]));
    g('applyImport')(res);
    const mp = g('state').strategy.actions[0].morePriorities[0];
    if (!mp.scope || mp.scope.type !== type || mp.cmp !== cmp) {
      throw new Error(`priority=${p} 应还原成 ${cmp} 类型${type}，实际 ${JSON.stringify({ scope: mp.scope, cmp: mp.cmp, manual: mp.manualPriority })}`);
    }
    if (mp.manualPriority) throw new Error(`priority=${p} 不应再是手工数值`);
  }
  // 还原不了的数值仍然保留原值
  const res2 = g('analyzeImport')(asAction([{ expression: 'low-hp', priority: 12345 }]));
  g('applyImport')(res2);
  const mp2 = g('state').strategy.actions[0].morePriorities[0];
  if (mp2.priority !== 12345) throw new Error('还原不了的数值应原样保留，实际 ' + mp2.priority);
  if (!g('importNeeds')(res2.problems).hasPriorityTail) throw new Error('尾数不为 0 的数值应提示需要修正');
  return cases.map(([p, c, t]) => `${p}→${c === 'after' ? '次于' : '优先于'}${t}`).join('，');
});

check('回归⑤：必要/排除队友支持重复角色与逐项与或，排除后组合语义正确', () => {
  const a = freshAction('万叶e', 4, 'e-ready');
  a.teammates.include = ['钟离', '钟离'];
  a.teammates.includeOps = ['or'];
  a.teammates.exclude = ['纳西妲', '芙宁娜'];
  a.teammates.excludeOps = [];              // 默认「或」：任一在场就排除 → !(X || Y)
  if (g('includeExprOf')(a.teammates) !== 'in-party(钟离) || in-party(钟离)') throw new Error('必要队友表达式不对：' + g('includeExprOf')(a.teammates));
  // 生成「整段加括号后取非」!(X || Y)：用户选的「与 / 或」原样出现在括号里，
  // 因此可以用「或」切分「角色组合」，靠运算优先级实现精准选择（BetterGI 里括号内先整体求值）
  if (g('excludeExprOf')(a.teammates) !== '!(in-party(纳西妲) || in-party(芙宁娜))') throw new Error('排除队友（或）表达式不对：' + g('excludeExprOf')(a.teammates));
  if (g('teammateExpr')(a, g('state').strategy.actions) !== '(in-party(钟离) || in-party(钟离)) && !(in-party(纳西妲) || in-party(芙宁娜))') throw new Error('排除队友（或）的队友条件片段不对：' + g('teammateExpr')(a, g('state').strategy.actions));
  a.teammates.excludeOps = ['and'];         // 「与」：两个同时在场才排除 → !(X && Y)
  if (g('excludeExprOf')(a.teammates) !== '!(in-party(纳西妲) && in-party(芙宁娜))') throw new Error('排除队友（与）表达式不对：' + g('excludeExprOf')(a.teammates));
  if (g('teammateExpr')(a, g('state').strategy.actions) !== '(in-party(钟离) || in-party(钟离)) && !(in-party(纳西妲) && in-party(芙宁娜))') throw new Error('排除队友（与）的队友条件片段不对：' + g('teammateExpr')(a, g('state').strategy.actions));
  // 排除队友写成「整段取非」的形状，与 analyzeImport 的拆分规则一一对应；
  // 取非之前是「用户所选的项 + 运算符」的纯 in-party 算式，导入时能原样还原
  const exText = g('excludeExprOf')(a.teammates);
  if (!/^!\(.*\)$/.test(exText)) throw new Error('排除队友应写成整段取非的 !( … ) 形状：' + exText);
  if (g('excludeGroupTextOf')(a.teammates) !== 'in-party(纳西妲) && in-party(芙宁娜)') throw new Error('排除队友取非之前的算式不对：' + g('excludeGroupTextOf')(a.teammates));

  // 界面上两个红标签允许同名角色，且排除也带逐项「与/或」下拉
  g('renderActionsPanel')();
  const tags = dom.document.querySelectorAll(`[data-act="team-remove"][data-id="${a.id}"][data-field="include"]`);
  if (tags.length !== 2) throw new Error('同名角色应能重复出现，实际 ' + tags.length);
  const exOps = dom.document.querySelectorAll(`select[data-field="excludeOp"][data-id="${a.id}"]`);
  if (!exOps.length) throw new Error('排除队友缺少逐项「与/或」下拉');
  // 只有一个排除角色时没有运算符下拉；清空的组合不产生表达式
  a.teammates.exclude = ['纳西妲'];
  a.teammates.excludeOps = [];
  if (g('excludeExprOf')(a.teammates) !== '!(in-party(纳西妲))') throw new Error('单项排除队友不对：' + g('excludeExprOf')(a.teammates));
  if (g('excludeChainText')({ items: [], ops: [] }) !== '') throw new Error('空组合应返回空字符串');
  a.teammates.exclude = ['纳西妲', '芙宁娜'];
  a.teammates.excludeOps = ['and'];
  // 删除第一个之后，运算符跟着对齐
  g('app').handlers['team-remove']({ getAttribute: (k) => ({ 'data-id': a.id, 'data-field': 'include', 'data-sub': '0', 'data-name': '钟离' })[k] }, {});
  if (a.teammates.include.length !== 1 || a.teammates.includeOps.length !== 0) throw new Error('删除重复角色后运算符没对齐');
  return '必要/排除都支持重复角色与逐项与或；排除用整体取非的 !( … )，运算符与所选一致';
});

check('回归③：导出再导入时，触发条件与队友条件能正确拆回两部分', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '枫原万叶';
  const e = makeAction('枫原万叶', 4, { name: '万叶e', action: 'e,wait(0.2)' });
  const q = makeAction('枫原万叶', 5, { name: '万叶q', action: 'q,wait(0.1),ready' });
  const other = makeAction('纳西妲', 4, { name: '草神e', action: 'e' });
  e.conditionText = 'low-hp || q-ready';
  e.teammates.include = ['钟离', '纳西妲'];
  e.teammates.includeOps = ['or'];
  e.teammates.exclude = ['芙宁娜'];
  e.teammates.excludeOps = [];
  e.teammates.autoExclude = [q.id];
  q.teammates.include = ['钟离'];
  other.teammates.include = ['玛薇卡'];
  e.morePriorities = [{ id: 'm1', text: 'since(999)>20', priority: 10000, cmp: 'after', scope: { type: 1, element: '', character: '' }, manualPriority: false }];
  const expr = g('buildExpression')(e, g('state').strategy.actions);
  if (!expr.startsWith('(low-hp || q-ready) && (')) throw new Error('合并格式不对：' + expr);
  const json = g('buildJson')();
  const res = g('analyzeImport')(json);
  g('applyImport')(res);
  const back = g('state').strategy.actions.find(x => x.name === '万叶e');
  if (back.conditionText !== 'low-hp || q-ready') throw new Error('触发条件没有正确拆回：' + JSON.stringify(back.conditionText));
  if (back.morePriorities[0].text !== 'since(999) > 20') throw new Error('其他触发条件没有正确拆回：' + JSON.stringify(back.morePriorities[0].text));
  if (back.teammates.include.join(',') !== '钟离,纳西妲' || back.teammates.includeOps.join(',') !== 'or') throw new Error('必要队友没有正确拆回：' + JSON.stringify(back.teammates));
  if (back.teammates.exclude.join(',') !== '芙宁娜') throw new Error('排除队友没有正确拆回：' + JSON.stringify(back.teammates));
  if (!back.teammates.autoExclude.length) throw new Error('自动排除没有还原成勾选状态');
  // 拆出来的内容再导出应与第一次一致
  if (g('buildExpression')(back, g('state').strategy.actions) !== expr) throw new Error('再导出的 expression 与原来不一致');
  // 没有队友条件时，触发条件直接写入 expression（不额外加括号）
  const otherBack = g('state').strategy.actions.find(x => x.name === '草神e');
  if (g('buildExpression')(otherBack, g('state').strategy.actions) !== '(true) && (in-party(玛薇卡))') throw new Error('只有队友条件时的合并格式不对：' + g('buildExpression')(otherBack, g('state').strategy.actions));
  const noTm = makeAction('纳西妲', 5, { name: '草神q', action: 'q,wait(0.1),ready' });
  noTm.conditionText = 'q-ready';
  if (g('buildExpression')(noTm, g('state').strategy.actions) !== 'q-ready') throw new Error('没有队友条件时不应多加括号');
  return expr;
});

check('回归④b：多张卡片的「添加其他触发条件」表单互不干扰', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '枫原万叶';
  const a1 = makeAction('枫原万叶', 4, { name: '万叶e', action: 'e' });
  const a2 = makeAction('枫原万叶', 5, { name: '万叶q', action: 'q,wait(0.1),ready' });
  g('state').ui.collapsed[a1.id] = false;
  g('state').ui.collapsed[a2.id] = false;
  g('state').ui.detailsOpen[a2.id + ':moreadd'] = true;
  g('renderActionsPanel')();
  const form2 = dom.document.querySelector(`[data-moreaddform="${a2.id}"]`);
  if (!form2) throw new Error('卡片里没有「添加其他触发条件」表单');
  const sel2 = form2.querySelector('[data-na="type"]');
  sel2.value = '5';
  form2.dispatch('change', { target: sel2 });
  const form1 = dom.document.querySelector(`[data-moreaddform="${a1.id}"]`);
  if (form1.querySelector('[data-na="type"]').value !== '') throw new Error('另一张卡片的表单被影响了（判定范围串到了别的动作上）');
  const btn = dom.document.querySelectorAll('[data-act="more-add2"]').find(b => b.getAttribute('data-id') === a2.id);
  g('app').handlers['more-add2'](btn, {});
  if (a1.morePriorities.length !== 0) throw new Error('条目加到了错误的动作上');
  if (a2.morePriorities.length !== 1 || a2.morePriorities[0].priority !== 60000) throw new Error('条目没有加到目标动作或 priority 不对：' + JSON.stringify(a2.morePriorities));
  if (g('state').ui.moreAddForm[a2.id].type !== '5') throw new Error('添加后表单的判定范围被重置');
  return `a1 0 条 / a2 ${a2.morePriorities.length} 条 priority=${a2.morePriorities[0].priority}`;
});

check('回归③c：旧版本格式的 expression（队友条件直接拼在条件里）也能拆回两部分', () => {
  // 旧版本写出来的是「(触发条件) && (必要队友 && !(排除队友)) && (!(自动排除))」这种形状。
  // 旧版的「整组取非」与用户手选的「排除队友」形状相同，这里按排除队友还原（语义完全一致）；
  // 旧版的「逐项取非」!in-party(…) 只可能是自动排除，按自动排除还原。
  const obj = {
    info: { name: '旧格式', author: '', preActions: [] },
    actions: [
      {
        name: '万叶e', character: '枫原万叶', action: 'e,wait(0.2)', index: 45111,
        condition: { expression: '(e-ready) && (in-party(枫原万叶) && !(in-party(钟离) || in-party(纳西妲))) && (!(in-party(玛薇卡)))' },
      },
      { name: '万叶a', character: '枫原万叶', action: 'attack', index: 45112, condition: { expression: '(true) && (in-party(玛薇卡))' } },
      { name: '万叶a2', character: '枫原万叶', action: 'attack', index: 45114, condition: { expression: '(true) && (in-party(茜特菈莉))' } },
      {
        name: '万叶q', character: '枫原万叶', action: 'q,wait(0.1),ready', index: 45113,
        condition: { expression: '(t < 10) && (in-party(芙宁娜) && !in-party(玛薇卡))' },
      },
      { name: '万叶q2', character: '枫原万叶', action: 'q,wait(0.2),ready', index: 45115, condition: { expression: '(true) && (in-party(希诺宁))' } },
      { name: '万叶q3', character: '枫原万叶', action: 'q,wait(0.3),ready', index: 45116, condition: { expression: '(true) && (in-party(玛拉妮))' } },
    ],
  };
  const res = g('analyzeImport')(obj);
  if (res.fatal.length) throw new Error(res.fatal.join('；'));
  g('applyImport')(res);
  const a = g('state').strategy.actions.find(x => x.name === '万叶e');
  if (a.conditionText !== 'e-ready') throw new Error('触发条件没有正确拆回：' + JSON.stringify(a.conditionText));
  if (a.teammates.include.join(',') !== '枫原万叶') throw new Error('必要队友没有拆回：' + JSON.stringify(a.teammates));
  if (a.teammates.exclude.join(',') !== '钟离,纳西妲,玛薇卡') throw new Error('排除队友没有拆回：' + JSON.stringify(a.teammates));
  // 旧格式没有格式标记（true 占位），两种写法同形，一律按排除队友还原，绝不吞掉手选内容。
  // `!(A||B)` 反推回用户选的「与」（两个同时在场才排除），`!(C)` 是单项、跟在后面用「或」并列。
  if (a.teammates.excludeOps.join(',') !== 'or,and') throw new Error('排除队友的运算符没有拆回：' + JSON.stringify(a.teammates.excludeOps));
  if (a.teammates.autoExclude.length) throw new Error('旧版取非项不应被吞成自动排除：' + JSON.stringify(a.teammates.autoExclude));
  // 旧写法同样按排除队友还原（表达式语义不变）
  const q = g('state').strategy.actions.find(x => x.name === '万叶q');
  if (q.conditionText !== 't < 10') throw new Error('触发条件没有正确拆回：' + JSON.stringify(q.conditionText));
  if (q.teammates.include.join(',') !== '芙宁娜') throw new Error('必要队友没有拆回：' + JSON.stringify(q.teammates));
  if (q.teammates.exclude.join(',') !== '玛薇卡') throw new Error('旧版取非项应按排除队友还原：' + JSON.stringify(q.teammates));
  if (g('excludeExprOf')(a.teammates) !== '!(in-party(钟离) || in-party(纳西妲) && in-party(玛薇卡))') throw new Error('排除队友表达式不对：' + g('excludeExprOf')(a.teammates));
  return a.conditionText + ' ／ ' + g('teammateExpr')(a, g('state').strategy.actions);
});

check('回归③b：自动排除（勾选 + 「同一动作类型」）能被还原，且表达式再导出一致', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '枫原万叶';
  const e1 = makeAction('枫原万叶', 4, { name: '万叶e1', action: 'e' });
  const e2 = makeAction('枫原万叶', 4, { name: '万叶e2', action: 'e,wait(0.2)' });
  const e3 = makeAction('枫原万叶', 4, { name: '万叶e3', action: 'e,wait(0.5)' });
  const q1 = makeAction('枫原万叶', 5, { name: '万叶q', action: 'q,wait(0.1),ready' });
  for (const a of [e1, e2, e3, q1]) a.teammates.autoExcludeSameType = false;
  e2.teammates.include = ['钟离'];
  e3.teammates.include = ['玛薇卡', '希诺宁'];
  e3.teammates.includeOps = ['or'];
  q1.teammates.include = ['芙宁娜'];
  e1.conditionText = 'e-ready';
  e1.teammates.include = ['纳西妲'];
  e1.teammates.autoExcludeSameType = true;   // 同类动作 e2、e3 都会被自动排除
  const expr = g('buildExpression')(e1, g('state').strategy.actions);
  if (!expr.includes('!(in-party(钟离))')) throw new Error('自动排除没有写进表达式：' + expr);
  if (!expr.includes('!(in-party(玛薇卡) || in-party(希诺宁))')) throw new Error('多角色必要队友的自动排除没写对：' + expr);
  const res = g('analyzeImport')(g('buildJson')());
  g('applyImport')(res);
  const back = g('state').strategy.actions.find(a => a.name === '万叶e1');
  if (back.teammates.autoExclude.length !== 2) throw new Error('自动排除没有还原成勾选状态：' + JSON.stringify(back.teammates));
  if (!back.teammates.autoExcludeSameType) throw new Error('同类动作的必要队友都被勾上了，应还原勾选「自动排除同一动作类型」');
  if (g('buildExpression')(back, g('state').strategy.actions) !== expr) throw new Error('再导出的 expression 与原来不一致：\n  ' + expr + '\n  ' + g('buildExpression')(back, g('state').strategy.actions));
  // 同类动作里只有 1 个设了必要队友时区分不了勾没勾，还原成「不勾」并保留显式勾选项
  const only = makeAction('纳西妲', 4, { name: '草神e', action: 'e' });
  const only2 = makeAction('纳西妲', 4, { name: '草神e2', action: 'e,wait(0.2)' });
  only.teammates.autoExcludeSameType = false;
  only2.teammates.autoExcludeSameType = false;
  only.teammates.exclude = ['钟离'];
  only2.teammates.include = ['钟离'];
  const expr2 = g('buildExpression')(only, g('state').strategy.actions);
  const res2 = g('analyzeImport')(g('buildJson')());
  g('applyImport')(res2);
  const back2 = g('state').strategy.actions.find(a => a.name === '草神e');
  if (back2.teammates.exclude.join(',') !== '钟离') throw new Error('手动排除的队友应保留：' + JSON.stringify(back2.teammates.exclude));
  if (back2.teammates.autoExclude.length) throw new Error('没有标记的整组取非不应被吞成自动排除');
  if (g('buildExpression')(back2, g('state').strategy.actions) !== expr2) throw new Error('手动排除的表达式再导出不一致');
  return expr;
});

/* ================= 回归：本次改动的 7 个问题 ================= */

check('本次②：手输内容后用「快捷添加条件」插入片段，输入框里的内容不会被清空', () => {
  const a = freshAction('万叶e', 4, '');
  g('state').ui.detailsOpen[a.id + ':moreadd'] = true;
  g('renderActionsPanel')();
  const sel = `textarea[data-cond-ref="morenew:${a.id}"]`;
  const ta = dom.document.querySelector(sel);
  if (!ta) throw new Error('找不到「添加其他触发条件」的条件输入框');
  ta.focus();
  ta.value = 'low-hp';
  ta.dispatch('input');                       // 真实浏览器里输入会冒泡到 document 的委托监听
  if (g('state').ui.newMoreText[a.id] !== 'low-hp') throw new Error('手输内容没有进入模型：' + JSON.stringify(g('state').ui.newMoreText));
  const cfbox = () => dom.document.querySelector(`[data-cfbox="morenew:${a.id}"]`);
  const andBtn = cfbox().querySelectorAll('[data-cfi]').find(x => x.getAttribute('data-cfi') === '&&');
  andBtn.dispatch('click');
  const ta2 = dom.document.querySelector(sel);
  if (!ta2) throw new Error('插入后找不到条件输入框');
  if (ta2.value !== 'low-hp &&') throw new Error('插入后输入框内容不对：' + JSON.stringify(ta2.value));
  if (g('state').ui.newMoreText[a.id] !== 'low-hp &&') throw new Error('插入后模型内容不对：' + JSON.stringify(g('state').ui.newMoreText));
  // 再用快捷添加插入一个函数片段，手输的部分也要保留
  const box = cfbox();
  const fsel = box.querySelector('[data-cfp="fn"]');
  fsel.value = 'q-ready';
  fsel.dispatch('change');
  cfbox().querySelector('[data-cf="insend"]').dispatch('click');
  const ta3 = dom.document.querySelector(sel);
  if (ta3.value !== 'low-hp && q-ready') throw new Error('插入函数片段后输入框内容不对：' + JSON.stringify(ta3.value));
  // 点「添加这条其他触发条件」后，新条目要带上这些内容
  const form = dom.document.querySelector(`[data-moreaddform="${a.id}"]`);
  const typeSel = form.querySelector('[data-na="type"]');
  typeSel.value = '5';
  form.dispatch('change', { target: typeSel });
  const btn = dom.document.querySelectorAll('[data-act="more-add2"]').find(b => b.getAttribute('data-id') === a.id);
  g('app').handlers['more-add2'](btn, {});
  const mp = a.morePriorities[a.morePriorities.length - 1];
  if (!mp || mp.text !== 'low-hp && q-ready') throw new Error('新条目没有带上输入框里的内容：' + JSON.stringify((a.morePriorities || []).map(x => x.text)));
  return mp.text;
});

check('本次③：手输修正其他触发条件后，条目里的报错红字一起消失', () => {
  const a = freshAction('万叶e', 4, 'e-ready');
  a.morePriorities = [{ id: 'mp1', text: 'since >', priority: 10000, cmp: 'after', scope: { type: 1, element: '', character: '' }, manualPriority: false }];
  g('state').ui.detailsOpen[a.id + ':more:0'] = true;
  g('renderActionsPanel')();
  const hintOf = () => dom.document.querySelector(`[data-morehint="${a.id}:0"]`);
  if (!hintOf()) throw new Error('找不到其他触发条件条目的提示行');
  if (!hintOf().innerHTML.includes('表达式在末尾意外结束')) throw new Error('报错时提示行里没有红字：' + hintOf().innerHTML);
  const mta = dom.document.querySelector(`textarea[data-cond-ref="more:${a.id}:0"]`);
  if (!mta) throw new Error('找不到其他触发条件的输入框');
  mta.focus();
  mta.value = 'since > 5';
  mta.dispatch('input');
  if (a.morePriorities[0].text !== 'since > 5') throw new Error('手输内容没有写进模型：' + a.morePriorities[0].text);
  if (hintOf().innerHTML.includes('表达式在末尾意外结束')) throw new Error('修正后提示行里仍残留旧报错：' + hintOf().innerHTML);
  if (!hintOf().innerHTML.trim()) throw new Error('修正后提示行应显示释义');
  return 'since > → 红字；since > 5 → ' + hintOf().textContent.slice(0, 20);
});

check('本次④⑤：快捷插入指令的「点按e技能」注释与「长按后松开按键」', () => {
  const a = freshAction('万叶e', 4, 'e-ready');
  const q = g('QUICK_COMMANDS');
  const eItem = q.find(x => x.label === '点按e技能');
  if (!eItem) throw new Error('找不到「点按e技能」词条');
  if (eItem.cn.includes('e,hold')) throw new Error('「点按e技能」注释里仍有过时的 e,hold 写法：' + eItem.cn);
  if (!eItem.cn.includes('e(hold)') || !eItem.cn.includes('e(wait)')) throw new Error('「点按e技能」注释没有改成 e(hold) / e(wait)：' + eItem.cn);
  const item = q.find(x => x.label === '长按后松开按键');
  if (!item) throw new Error('指令列表里没有「长按后松开按键」');
  if (item.tpl !== 'keydown({key}),wait({t}),keyup({key})') throw new Error('「长按后松开按键」的模板不对：' + item.tpl);
  const keys = item.params.map(p => p.key);
  const keyParam = item.params.find(p => p.key === 'key');
  const secParam = item.params.find(p => p.key === 't');
  if (!keyParam || keyParam.type !== 'vk') throw new Error('参数1 应该是可用按键图选择的按键');
  if (!secParam || secParam.type !== 'number') throw new Error('参数2 应该是持续按下的秒数（数值输入）');
  if (keys.filter(k => k === 'key').length !== 1) throw new Error('keydown 与 keyup 应共用同一个参数');
  // 真正插入一次：默认 VK_E + 0.5 秒
  a.action = '';
  $('paneActions').innerHTML = qcRender(a.id);
  g('bindQuickCommandPanels')();
  qcPick(a.id, '长按后松开按键');
  qcInsert(a.id, 'replace');
  if (a.action !== 'keydown(VK_E),wait(0.5),keyup(VK_E)') throw new Error('插入结果不对：' + JSON.stringify(a.action));
  return a.action;
});

check('本次⑥：keydown 没有对应 keyup 时给出警告', () => {
  const p1 = g('parseActionString')('keydown(e),attack');
  if (!p1.warnings.some(w => w.includes('keyup') && w.includes('E'))) throw new Error('缺少「按下了却没松开」的警告：' + JSON.stringify(p1.warnings));
  const p2 = g('parseActionString')('keydown(e),wait(0.5),keyup(e)');
  if (p2.warnings.length) throw new Error('成对的 keydown/keyup 不应报警：' + JSON.stringify(p2.warnings));
  // 按键名大小写 / VK_ 前缀不同也算同一个键
  const p3 = g('parseActionString')('keydown(VK_E),keyup(E)');
  if (p3.warnings.length) throw new Error('同一个按键的不同写法不应报警：' + JSON.stringify(p3.warnings));
  // 松开的是别的键仍要提醒
  const p4 = g('parseActionString')('keydown(q),keyup(e)');
  if (!p4.warnings.length) throw new Error('松开了别的按键时应该提醒');
  // 两个键都按下了、只松开一个 → 只提醒没松开的那个
  const p5 = g('parseActionString')('keydown(q),keydown(e),keyup(e)');
  if (p5.warnings.length !== 1 || !p5.warnings[0].includes('Q')) throw new Error('应只提醒没松开的 Q：' + JSON.stringify(p5.warnings));
  // 动作卡片里的报错条也要显示这条警告
  const a = freshAction('万叶e', 4, 'e-ready');
  a.action = 'keydown(e),attack';
  g('state').lastIssues = g('validateStrategy')();
  g('renderActionsPanel')();
  const box = dom.document.querySelector(`[data-cardissues="${a.id}"]`);
  if (!box || !box.innerHTML.includes('keyup')) throw new Error('动作卡片里没有显示 keydown 的警告');
  return 'keydown(e),attack → 警告；成对写法 → 无警告';
});

check('本次⑦：描述一键填写的内容已更新', () => {
  g('setTab')('info');
  g('app').handlers['desc-template']();
  const d = g('state').strategy.info.description;
  for (const kw of ['请注意！！！', 'BGI配队逻辑', '地图追踪行走配置', '扫描掉落物光柱', '聚集材料动作', '二次拾取', '游泳检测：开启', '万叶拾取队伍名']) {
    if (!d.includes(kw)) throw new Error('一键填写的描述里缺少「' + kw + '」');
  }
  if (d.includes('自动拾取掉落物')) throw new Error('描述里仍有旧版的「自动拾取掉落物」');
  const area = dom.document.querySelector('textarea[data-kind="info"][data-field="description"]');
  if (!area || !area.value.includes('请注意！！！')) throw new Error('描述输入框没有跟着刷新');
  return d.length + ' 字符';
});

check('本次①：带自动排除的队友条件能正确拆回并再导出一致（含恒真标记 !(false)）', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '枫原万叶';
  const e1 = makeAction('枫原万叶', 4, { name: '万叶e1', action: 'e' });
  const e2 = makeAction('枫原万叶', 4, { name: '万叶e2', action: 'e,wait(0.2)' });
  const q1 = makeAction('枫原万叶', 5, { name: '万叶q', action: 'q,wait(0.1),ready' });
  for (const a of [e1, e2, q1]) a.teammates.autoExcludeSameType = false;
  q1.teammates.include = ['芙宁娜'];
  e2.teammates.include = ['玛薇卡', '茜特菈莉'];
  e2.teammates.includeOps = ['and'];
  e1.conditionText = 'low-hp';
  e1.teammates.include = ['纳西妲', '芙宁娜'];
  e1.teammates.includeOps = ['or'];
  e1.teammates.exclude = ['钟离'];
  e1.teammates.excludeOps = [];
  e1.teammates.autoExclude = [q1.id, e2.id]; // 自动排除的必要队友分别是 1 人与 2 人
  const expr = g('buildExpression')(e1, g('state').strategy.actions);
  if (expr !== '(low-hp) && ((in-party(纳西妲) || in-party(芙宁娜)) && !(in-party(钟离)) && (true) && (!(in-party(芙宁娜)) && !(in-party(玛薇卡) && in-party(茜特菈莉))))') {
    throw new Error('带自动排除的 expression 不对：' + expr);
  }
  const res = g('analyzeImport')(g('buildJson')());
  g('applyImport')(res);
  const back = g('state').strategy.actions.find(x => x.name === '万叶e1');
  if (back.conditionText !== 'low-hp') throw new Error('触发条件没有拆回：' + JSON.stringify(back.conditionText));
  if (back.teammates.include.join(',') !== '纳西妲,芙宁娜') throw new Error('必要队友没有拆回：' + JSON.stringify(back.teammates.include));
  if (back.teammates.includeOps.join(',') !== 'or') throw new Error('必要队友的运算符没有拆回：' + JSON.stringify(back.teammates.includeOps));
  if (back.teammates.exclude.join(',') !== '钟离') throw new Error('排除队友没有拆回：' + JSON.stringify(back.teammates.exclude));
  if (back.teammates.autoExclude.length !== 2) throw new Error('自动排除没有拆回：' + JSON.stringify(back.teammates));
  const autoNames = back.teammates.autoExclude.map(id => g('state').strategy.actions.find(x => x.id === id).name).sort();
  if (autoNames.join(',') !== '万叶e2,万叶q') throw new Error('自动排除没有拆回：' + JSON.stringify(autoNames));
  if (g('buildExpression')(back, g('state').strategy.actions) !== expr) throw new Error('再导出的 expression 与原来不一致：\n  ' + expr + '\n  ' + g('buildExpression')(back, g('state').strategy.actions));
  // 没有排除队友时用 !(false) 占位（恒真，不影响条件语义），它同时是「新格式」的标记
  back.teammates.exclude = [];
  back.teammates.excludeOps = [];
  const expr2 = g('buildExpression')(back, g('state').strategy.actions);
  if (!expr2.includes('&& !(false) && (true) &&')) throw new Error('没有排除队友时应写 !(false) 占位：' + expr2);
  const res2 = g('analyzeImport')(g('buildJson')());
  g('applyImport')(res2);
  const back2 = g('state').strategy.actions.find(x => x.name === '万叶e1');
  if (back2.teammates.exclude.length) throw new Error('!(false) 不应被拆成排除队友：' + JSON.stringify(back2.teammates.exclude));
  if (back2.teammates.autoExclude.length !== 2) throw new Error('自动排除没有被拆回：' + JSON.stringify(back2.teammates));
  if (g('buildExpression')(back2, g('state').strategy.actions) !== expr2) throw new Error('!(false) 形式的再导出一致性失败');
  // 手选的「排除队友」表达式恰好等于另一个动作的必要队友时，导入只会把它还原成那个动作的
  // 「自动排除」勾选：表达式与语义完全相同，界面上的表现是勾选而不是手写排除。
  e1.teammates.exclude = ['玛薇卡', '茜特菈莉'];
  e1.teammates.excludeOps = ['and'];
  const expr3 = g('buildExpression')(e1, g('state').strategy.actions);
  const res3 = g('analyzeImport')(g('buildJson')());
  g('applyImport')(res3);
  const back3 = g('state').strategy.actions.find(x => x.name === '万叶e1');
  if (back3.teammates.exclude.length) throw new Error('与动作必要队友相同的排除队友应还原成自动排除勾选：' + JSON.stringify(back3.teammates.exclude));
  if (back3.teammates.autoExclude.length !== 2) throw new Error('自动排除没有被拆回：' + JSON.stringify(back3.teammates));
  // 两种写法只是自动排除项的先后顺序不同（导出时自动排除总排在手选排除之后），语义完全等价
  for (const kw of ['in-party(纳西妲) || in-party(芙宁娜)', '!(in-party(玛薇卡) && in-party(茜特菈莉))', '!(in-party(芙宁娜))']) {
    if (!g('buildExpression')(back3, g('state').strategy.actions).includes(kw)) throw new Error('等价写法再导出缺少片段 ' + kw);
  }
  return expr.length + ' 字符';
});

/* ================= 本次「队友条件表达式组成 / 拆分」改动 ================= */

check('本次⑧：队友条件三种结构的表达式形态与作用域', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '枫原万叶';
  const mk = (name, type, opts) => makeAction('枫原万叶', type, Object.assign({ name, action: 'e' }, opts));
  const cur = () => g('state').strategy.actions;
  // a) 只有必要队友
  const a1 = mk('叶a', 4);
  a1.conditionText = 'e-ready';
  a1.teammates.include = ['钟离', '纳西妲'];
  a1.teammates.includeOps = ['or'];
  if (g('buildExpression')(a1, cur()) !== '(e-ready) && (in-party(钟离) || in-party(纳西妲))') throw new Error('结构 a) 不对：' + g('buildExpression')(a1, cur()));
  // b) 排除队友（或）：用户选的「或」原样出现在括号里，整段加括号后取非
  const a2 = mk('叶b', 4);
  a2.teammates.autoExcludeSameType = false;   // 本用例只看「排除队友」这一段
  a2.conditionText = 'e-ready';
  a2.teammates.exclude = ['纳西妲', '芙宁娜'];
  a2.teammates.excludeOps = [];
  if (g('excludeGroupTextOf')(a2.teammates) !== 'in-party(纳西妲) || in-party(芙宁娜)') throw new Error('排除队友取非之前的算式不对：' + g('excludeGroupTextOf')(a2.teammates));
  if (g('buildExpression')(a2, cur()) !== '(e-ready) && (!(in-party(纳西妲) || in-party(芙宁娜)))') throw new Error('结构 b) 不对：' + g('buildExpression')(a2, cur()));
  // b) 排除队友（与）
  a2.teammates.excludeOps = ['and'];
  if (g('buildExpression')(a2, cur()) !== '(e-ready) && (!(in-party(纳西妲) && in-party(芙宁娜)))') throw new Error('结构 b)「与」不对：' + g('buildExpression')(a2, cur()));
  // b) 必要 + 排除
  a2.teammates.include = ['钟离'];
  a2.teammates.includeOps = [];
  if (g('buildExpression')(a2, cur()) !== '(e-ready) && ((in-party(钟离)) && !(in-party(纳西妲) && in-party(芙宁娜)))') throw new Error('结构 b) 必要+排除不对：' + g('buildExpression')(a2, cur()));
  // c) 自动排除：必要队友为空时用 (true) 占位、排除队友为空时用 !(false) 标记
  const other = makeAction('枫原万叶', 5, { name: '叶q', action: 'q,wait(0.1),ready' });
  other.teammates.include = ['玛薇卡', '希诺宁'];
  other.teammates.includeOps = ['or'];
  const a3 = mk('叶c', 4);
  a3.teammates.autoExcludeSameType = false;
  a3.conditionText = 'e-ready';
  a3.teammates.autoExclude = [other.id];
  const e3 = g('buildExpression')(a3, cur());
  if (e3 !== '(e-ready) && ((true) && !(false) && (true) && (!(in-party(玛薇卡) || in-party(希诺宁))))') throw new Error('结构 c) 不对：' + e3);
  // 三部分都选上
  a3.teammates.include = ['钟离'];
  a3.teammates.exclude = ['纳西妲'];
  const e4 = g('buildExpression')(a3, cur());
  if (e4 !== '(e-ready) && ((in-party(钟离)) && !(in-party(纳西妲)) && (true) && (!(in-party(玛薇卡) || in-party(希诺宁))))') throw new Error('结构 c) 三部分不对：' + e4);
  return e4;
});

check('本次⑨：队友条件「保存 → 导入」完整往返（三种结构 + 触发条件 + 其他触发条件）', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '枫原万叶';
  const mk = (name, type, opts) => makeAction('枫原万叶', type, Object.assign({ name, action: 'e' }, opts));
  const other = makeAction('枫原万叶', 5, { name: '叶q', action: 'q,wait(0.1),ready' });
  other.teammates.include = ['玛薇卡', '希诺宁'];
  other.teammates.includeOps = ['or'];
  const cases = [
    ['结构a', { include: ['钟离', '纳西妲'], includeOps: ['or'] }],
    ['结构b或', { exclude: ['纳西妲', '芙宁娜'], excludeOps: [] }],
    ['结构b与', { include: ['钟离'], includeOps: [], exclude: ['纳西妲', '芙宁娜'], excludeOps: ['and'] }],
    ['结构c', { include: ['钟离', '纳西妲'], includeOps: ['and'], exclude: ['芙宁娜'], excludeOps: [], auto: true }],
    ['结构c空必要', { exclude: [], auto: true }],
  ];
  const out = [];
  for (const [label, cfg] of cases) {
    g('state').strategy.actions = [other];
    const a = mk('叶' + label, 4);
    a.teammates.autoExcludeSameType = false;   // 本用例只验证「自动排除」勾选项的往返
    a.conditionText = 'low-hp || q-ready';
    a.teammates.include = cfg.include || [];
    a.teammates.includeOps = cfg.includeOps || [];
    a.teammates.exclude = cfg.exclude || [];
    a.teammates.excludeOps = cfg.excludeOps || [];
    a.teammates.autoExclude = cfg.auto ? [other.id] : [];
    a.morePriorities = [{ id: 'm1', text: 't < 10', priority: 60000, cmp: 'after', scope: { type: 6, element: '', character: '' }, manualPriority: false }];
    const before = {
      cond: g('buildExpression')(a, g('state').strategy.actions),
      more: g('buildMorePriorities')(a, g('state').strategy.actions)[0].expression,
    };
    const res = g('analyzeImport')(g('buildJson')());
    if (res.fatal.length) throw new Error(label + ' 导入失败：' + res.fatal.join('；'));
    g('applyImport')(res);
    const back = g('state').strategy.actions.find(x => x.name === a.name);
    if (back.conditionText !== 'low-hp || q-ready') throw new Error(label + ' 触发条件没有还原：' + JSON.stringify(back.conditionText));
    if (back.morePriorities[0].text !== 't < 10') throw new Error(label + ' 其他触发条件没有还原：' + JSON.stringify(back.morePriorities[0].text));
    // 运算符用「规范化比较」：运算符数组为空表示全用默认「或」，与显式写出的 or 等价
    const normOps = (list, n) => {
      const out = [];
      for (let i = 0; i < Math.max(0, n - 1); i++) out.push(list && list[i] === 'and' ? 'and' : 'or');
      return out.join(',');
    };
    if (back.teammates.include.join(',') !== a.teammates.include.join(',')) throw new Error(label + ' 必要队友没有还原：' + JSON.stringify(back.teammates.include));
    if (normOps(back.teammates.includeOps, back.teammates.include.length) !== normOps(a.teammates.includeOps, a.teammates.include.length)) throw new Error(label + ' 必要队友运算符没有还原：' + JSON.stringify(back.teammates.includeOps));
    if (back.teammates.exclude.join(',') !== a.teammates.exclude.join(',')) throw new Error(label + ' 排除队友没有还原：' + JSON.stringify(back.teammates.exclude) + ' 期望 ' + JSON.stringify(a.teammates.exclude) + ' expr=' + before.cond);
    if (normOps(back.teammates.excludeOps, back.teammates.exclude.length) !== normOps(a.teammates.excludeOps, a.teammates.exclude.length)) throw new Error(label + ' 排除队友运算符没有还原：' + JSON.stringify(back.teammates.excludeOps));
    if ((back.teammates.autoExclude.length > 0) !== !!cfg.auto) throw new Error(label + ' 自动排除勾选没有还原：' + JSON.stringify(back.teammates.autoExclude));
    const after = {
      cond: g('buildExpression')(back, g('state').strategy.actions),
      more: g('buildMorePriorities')(back, g('state').strategy.actions)[0].expression,
    };
    if (after.cond !== before.cond || after.more !== before.more) {
      throw new Error(label + ' 再导出的 expression 不一致：\n  ' + before.cond + '\n  ' + after.cond);
    }
    out.push(label + '→' + after.cond);
  }
  return out.join(' ； ');
});

check('本次⑩：释义里入参为动作的函数按动作名显示，并带 index 与动作指令的悬停提示', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '枫原万叶';
  const a = makeAction('枫原万叶', 4, { name: '万叶e', action: 'e,wait(0.2)' });
  const b = makeAction('枫原万叶', 5, { name: '万叶q', action: 'q,wait(0.1),ready' });
  const ctxX = g('condExplainCtx')(a.id);
  const html = g('condExplain')(g('condParse')(`since(${b.index}) < 3 && count(${a.index},0,10) > 2 && since(99999) > 1`, g('allActionNames')(g('state').strategy.actions)).ast, ctxX);
  if (!html.includes('动作「万叶q」')) throw new Error('入参为动作时应显示动作名：' + html);
  if (!html.includes('（本动作）')) throw new Error('引用自身时应显示「本动作」：' + html);
  if (!html.includes('index=' + b.index) || !html.includes('q,wait(0.1),ready')) throw new Error('悬停提示里应含 index 与动作指令：' + html);
  if (!html.includes('index=99999')) throw new Error('找不到对应动作时应退回 index 文本：' + html);
  // 不传上下文时是纯文本（给不支持 HTML 的地方用）
  const plain = g('condExplain')(g('condParse')(`since(${b.index}) < 3`, []).ast);
  if (!plain.includes('index=' + b.index) || plain.includes('<span')) throw new Error('无上下文时应是纯文本：' + plain);
  // 「若本动作是通用动作……」这类补充说明已从释义里删掉
  for (const e of ['q-ready', 'e-ready', 'e-cd', 'onfield']) {
    const t = g('condExplain')(g('condParse')(e, []).ast, ctxX);
    if (t.includes('通用动作')) throw new Error(`释义 ${e} 里仍保留「通用动作」说明：` + t);
  }
  return html.replace(/<[^>]+>/g, '').slice(0, 40) + '…';
});

check('本次⑪：动作卡片里条件释义中的动作名带悬停提示（渲染不报错且含 aref）', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '枫原万叶';
  const a = makeAction('枫原万叶', 4, { name: '万叶e', action: 'e,wait(0.2)' });
  const b = makeAction('枫原万叶', 5, { name: '万叶q', action: 'q,wait(0.1),ready' });
  a.conditionText = `since(${b.index}) < 3`;
  a.morePriorities = [{ id: 'm1', text: `count(${a.index}) > 1`, priority: 60000, cmp: 'after', scope: { type: 6, element: '', character: '' }, manualPriority: false }];
  g('state').ui.collapsed[a.id] = false;
  g('state').ui.detailsOpen[a.id + ':more:0'] = true;
  g('renderActionsPanel')();
  const mainPrev = dom.document.querySelector(`#condPreview-cond-${a.id}-`);
  if (!mainPrev) throw new Error('找不到主条件的释义区');
  if (!mainPrev.innerHTML.includes('aref') || !mainPrev.innerHTML.includes('万叶q')) throw new Error('主条件释义里没有动作名悬停提示：' + mainPrev.innerHTML.slice(0, 200));
  const hint = dom.document.querySelector(`[data-morehint="${a.id}:0"]`);
  if (!hint || !hint.innerHTML.includes('（本动作）')) throw new Error('其他触发条件释义里没有把自身显示成「本动作」：' + (hint && hint.innerHTML));
  return '主条件与其他触发条件释义都已带动作名';
});

check('本次⑫：手写的「整段取非」排除队友（!(甲 && 乙) / !(甲 || 乙)）也能拆回角色组合', () => {
  const obj = {
    info: { name: '新格式', author: '', preActions: [] },
    actions: [
      { name: '叶a', character: '枫原万叶', action: 'e', index: 45111, condition: { expression: '(e-ready) && (in-party(纳西妲))' } },
      { name: '叶b', character: '枫原万叶', action: 'attack', index: 45112, condition: { expression: '(true) && (!(in-party(玛薇卡) && in-party(茜特菈莉)))' } },
      // 必要队友为空、排除队友也为空、只勾自动排除：队友条件里只有占位与自动排除项
      { name: '叶c', character: '枫原万叶', action: 'attack', index: 45113, condition: { expression: '(true) && ((true) && !(false) && (true) && (!(in-party(纳西妲))))' } },
      // 必要队友 + 排除队友 + 自动排除（结构 c）：自动排除项来自「钟离」这个必要队友
      { name: '叶d', character: '枫原万叶', action: 'charge(1)', index: 45114, condition: { expression: '(t < 10) && ((in-party(玛薇卡)) && !(in-party(玛拉妮)) && (true) && (!(in-party(钟离))))' } },
      { name: '叶e', character: '枫原万叶', action: 'e,wait(0.2)', index: 45115, condition: { expression: '(true) && (in-party(玛薇卡) && in-party(茜特菈莉))' } },
      { name: '叶f', character: '枫原万叶', action: 'e,wait(0.5)', index: 45116, condition: { expression: '(true) && (in-party(钟离))' } },
      // 手写的「或」组合整段取非
      { name: '叶g', character: '枫原万叶', action: 'e,wait(0.8)', index: 45117, condition: { expression: '(true) && (!(in-party(芙宁娜) || in-party(希诺宁)))' } },
    ],
  };
  const res = g('analyzeImport')(obj);
  if (res.fatal.length) throw new Error(res.fatal.join('；'));
  g('applyImport')(res);
  const get = (n) => g('state').strategy.actions.find(a => a.name === n);
  const a = get('叶a');
  if (a.conditionText !== 'e-ready') throw new Error('叶a 触发条件不对：' + a.conditionText);
  if (a.teammates.include.join(',') !== '纳西妲') throw new Error('叶a 必要队友不对：' + JSON.stringify(a.teammates));
  const b = get('叶b');
  if (b.teammates.exclude.join(',') !== '玛薇卡,茜特菈莉' || b.teammates.excludeOps.join(',') !== 'and') throw new Error('叶b「与」排除队友不对：' + JSON.stringify(b.teammates));
  if (g('excludeExprOf')(b.teammates) !== '!(in-party(玛薇卡) && in-party(茜特菈莉))') throw new Error('叶b 排除队友表达式不对：' + g('excludeExprOf')(b.teammates));
  const c = get('叶c');
  if (c.teammates.exclude.length || !c.teammates.autoExclude.length) throw new Error('叶c 应只还原自动排除：' + JSON.stringify(c.teammates));
  if (g('buildExpression')(c, g('state').strategy.actions) !== obj.actions[2].condition.expression) throw new Error('叶c 再导出不一致：' + g('buildExpression')(c, g('state').strategy.actions));
  const d = get('叶d');
  if (d.conditionText !== 't < 10') throw new Error('叶d 触发条件不对：' + d.conditionText);
  if (d.teammates.include.join(',') !== '玛薇卡') throw new Error('叶d 必要队友不对：' + JSON.stringify(d.teammates));
  if (d.teammates.exclude.join(',') !== '玛拉妮') throw new Error('叶d 排除队友不对：' + JSON.stringify(d.teammates));
  const dAuto = d.teammates.autoExclude.map(id => g('state').strategy.actions.find(x => x.id === id).name);
  if (dAuto.join(',') !== '叶f') throw new Error('叶d 自动排除应还原成叶f：' + JSON.stringify(dAuto));
  // 排除队友（或）的手写形式
  const e = g('state').strategy.actions.find(x => x.name === '叶e');
  if (e.teammates.include.join(',') !== '玛薇卡,茜特菈莉') throw new Error('叶e 必要队友不对：' + JSON.stringify(e.teammates));
  const f = g('state').strategy.actions.find(x => x.name === '叶f');
  if (f.teammates.include.join(',') !== '钟离') throw new Error('叶f 必要队友不对：' + JSON.stringify(f.teammates));
  // 手工把「或」写成整段取非的排除队友也应能拆回同一组角色
  const gAct = g('state').strategy.actions.find(x => x.name === '叶g');
  if (gAct.teammates.exclude.join(',') !== '芙宁娜,希诺宁' || gAct.teammates.excludeOps.join(',') !== 'or') throw new Error('叶g 排除队友不对：' + JSON.stringify(gAct.teammates));
  if (g('excludeExprOf')(gAct.teammates) !== '!(in-party(芙宁娜) || in-party(希诺宁))') throw new Error('叶g 再导出表达式不对：' + g('excludeExprOf')(gAct.teammates));
  return '叶a~叶g 七种写法全部拆回';
});

/* ---------------- 本次 1~4：version / tags / 草稿归档 / 延迟保存 ---------------- */

check('本次①：信息页有「版本」输入框，位置在「作者」下面、「描述」上面', () => {
  g('state').ui.tab = 'info';
  g('renderInfoPanel')();
  const html = $('paneInfo').innerHTML;
  const iAuthor = html.indexOf('data-field="author"');
  const iVersion = html.indexOf('data-field="version"');
  const iDesc = html.indexOf('data-field="description"');
  if (iAuthor < 0 || iVersion < 0 || iDesc < 0) throw new Error('缺少 作者 / 版本 / 描述 输入框');
  if (!(iAuthor < iVersion && iVersion < iDesc)) throw new Error('「版本」应在「作者」下面、「描述」上面：' + [iAuthor, iVersion, iDesc].join(','));
  return '作者 → 版本 → 描述';
});

check('本次①：导出 info 的 version 位置正确，空版本省略', () => {
  g('state').strategy.info = { name: 'N', author: 'A', version: '', description: 'D', config: {}, preActions: [] };
  const empty = g('buildJson')();
  if ('version' in empty.info) throw new Error('空版本不应写出 version');
  if (Object.keys(empty.info).join(',') !== 'name,author,description,config,preActions') throw new Error('字段顺序不对：' + Object.keys(empty.info).join(','));
  g('state').strategy.info.version = 'v9';
  const withV = g('buildJson')();
  if (Object.keys(withV.info).join(',') !== 'name,author,version,description,config,preActions') throw new Error('有版本时字段顺序不对：' + Object.keys(withV.info).join(','));
  const back = g('analyzeImport')(withV);
  if (back.info.version !== 'v9') throw new Error('回读版本丢失');
  g('state').strategy.info.version = '';
  return Object.keys(withV.info).join('>');
});

check('本次④：动作卡片有「注释」区块，位于「其他触发条件」下面且默认收起', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '';
  const a = makeAction('', 9, { name: '注释测试', action: 'wait(0.2)' });
  g('state').ui.collapsed[a.id] = false;
  g('renderActionsPanel')();
  const dets = dom.document.querySelectorAll('details[data-details]').filter(d => d.getAttribute('data-details') === a.id + ':tags');
  if (!dets.length) throw new Error('缺少 data-details=' + a.id + ':tags 的区块');
  if (dets[0].hasAttribute('open')) throw new Error('「注释」默认应收起');
  const html = $('paneActions').innerHTML;
  if (!(html.indexOf('其他触发条件') < html.indexOf('<summary>注释'))) throw new Error('「注释」应在「其他触发条件」下面');
  // 输入注释 -> 写进 tags，导出时位置在 index 下面、morePriorities 上面
  const ta = dom.document.querySelector('textarea[data-kind="act"][data-field="tags"]');
  if (!ta) throw new Error('找不到注释输入框');
  ta.value = '这是注释';
  g('onFieldChange')(ta, true);
  if (a.tags !== '这是注释') throw new Error('注释没有写进 tags：' + JSON.stringify(a.tags));
  a.morePriorities = [{ id: 'mpz', text: 't<5', priority: 100000, cmp: 'after', scope: { type: 9, element: '', character: '' } }];
  const e = g('buildJson')().actions.find(x => x.index === a.index);
  if (Object.keys(e).join(',') !== 'name,character,action,condition,ensureCast,index,tags,morePriorities') throw new Error('tags 位置不对：' + Object.keys(e).join(','));
  a.tags = '';
  const e2 = g('buildJson')().actions.find(x => x.index === a.index);
  if ('tags' in e2) throw new Error('空注释不应写 tags');
  return '默认收起 / 写在 index 下面（' + ta.value + '）';
});

check('本次③：改「策略名称 / 版本」不立刻写草稿，光标进入别的输入框 / 点别的按钮才写；改别的内容立刻写', () => {
  dom.localStorage.clear();
  g('state').strategy.actions = [];
  const a = makeAction('', 9, { name: '草稿测试', action: 'wait(0.2)' });
  g('state').strategy.info = { name: '', author: '', version: '', description: '', config: {}, preActions: [] };
  g('state').ui.tab = 'info';
  g('renderInfoPanel')();
  const nameEl = dom.document.querySelector('input[data-kind="info"][data-field="name"]');
  const verEl = dom.document.querySelector('input[data-kind="info"][data-field="version"]');
  if (!nameEl || !verEl) throw new Error('找不到 策略名称 / 版本 输入框');
  const drafts = () => JSON.parse(dom.localStorage.getItem('bgi_strategy_editor_drafts_v1') || '{}');
  const focusOther = () => {
    const ta = dom.document.querySelector('textarea[data-kind="info"][data-field="description"]');
    if (!ta) throw new Error('找不到描述输入框');
    ta.dispatch('focusin', { target: ta });
  };

  // 只改名称：不落盘（不出现改到一半的草稿）
  nameEl.value = '半截名';
  g('onFieldChange')(nameEl, true);
  if (g('hasPendingInfoEdit')() !== true) throw new Error('应标记为待保存');
  if (Object.keys(drafts()).length) throw new Error('还没改完就不该写草稿：' + Object.keys(drafts()).join(','));
  // 继续改版本：仍然是待保存
  verEl.value = 'v1';
  g('onFieldChange')(verEl, true);
  if (Object.keys(drafts()).length) throw new Error('连续修改期间不该写草稿');
  // 光标进入别的输入框（描述）
  focusOther();
  const k1 = g('draftKey')();
  if (!drafts()[k1]) throw new Error('光标进入别的输入框后应写入草稿，实际：' + Object.keys(drafts()).join(','));
  if (!k1.includes('半截名')) throw new Error('草稿键应含策略名称：' + k1);
  if (g('hasPendingInfoEdit')() !== false) throw new Error('落盘后应清除待保存标记');
  const count1 = Object.keys(drafts()).length;
  // 改别的内容（动作名）→ 立刻保存，且不会留下旧的半截草稿
  a.name = '草稿测试b';
  g('markDirty')(false);
  g('saveDraftNow')();
  if (Object.keys(drafts()).length !== count1) throw new Error('同名同版本不应重复归档：' + Object.keys(drafts()).join(','));
  // 只改名称、不改版本 → 又是另一份草稿（这次靠「点击别的按钮」判定改完）
  nameEl.value = '另一份';
  g('onFieldChange')(nameEl, true);
  g('onFieldChange')(nameEl, false);   // change 事件（组字结束的补发也会走这条）同样不能落盘
  if (Object.keys(drafts()).length !== count1) throw new Error('change 事件不该让半截名称落盘：' + Object.keys(drafts()).join(','));
  const btn = dom.document.querySelector('button[data-act="desc-clear"]');
  if (!btn) throw new Error('找不到「清空描述」按钮');
  dom.document.dispatch('click', { target: btn, preventDefault() { }, stopPropagation() { } });
  if (Object.keys(drafts()).length !== count1 + 1) throw new Error('点击别的按钮后应归档成新草稿：' + Object.keys(drafts()).join(','));
  // 切页也算“改完了”（兜底路径）
  nameEl.value = '第三份';
  g('onFieldChange')(nameEl, true);
  g('setTab')('preview');
  if (!drafts()[g('draftKey')()]) throw new Error('切页后应把「策略名称 / 版本」落盘：' + Object.keys(drafts()).join(','));
  g('setTab')('info');
  dom.localStorage.clear();
  g('state').strategy.info = { name: '', author: '', version: '', description: '', config: {}, preActions: [] };
  return `${k1}；再改名称 / 点按钮 / 切页 → 均可落盘（已清空）`;
});

check('本次③b：中文输入法组字期间（含组字结束）不会把没输完的名称写进草稿', () => {
  dom.localStorage.clear();
  g('state').strategy.actions = [];
  makeAction('', 9, { name: '人名法测试', action: 'wait(0.2)' });
  g('state').strategy.info = { name: '', author: '', version: '', description: '', config: {}, preActions: [] };
  g('state').ui.tab = 'info';
  g('renderInfoPanel')();
  const nameEl = dom.document.querySelector('input[data-kind="info"][data-field="name"]');
  const drafts = () => JSON.parse(dom.localStorage.getItem('bgi_strategy_editor_drafts_v1') || '{}');
  nameEl.focus();
  const ev = (type, extra) => nameEl.dispatch(type, Object.assign({ target: nameEl, preventDefault() { }, stopPropagation() { } }, extra || {}));
  // 组字开始 → 候选字变化（input）→ 选中第一个字，组字结束
  ev('compositionstart');
  nameEl.value = '策略';
  ev('input');
  ev('compositionend');
  if (Object.keys(drafts()).length) throw new Error('组字结束（只是输完一个字）不该写草稿：' + Object.keys(drafts()).join(','));
  if (g('hasPendingInfoEdit')() !== true) throw new Error('组字结束后应仍处于「待保存」状态');
  // 继续输下一个字，中间隔了很久（真实的 600ms 定时器早已到期）
  ev('compositionstart');
  nameEl.value = '策略名';
  ev('input');
  ev('compositionend');
  if (Object.keys(drafts()).length) throw new Error('继续组字期间不该写草稿：' + Object.keys(drafts()).join(','));
  // 真正的“改完了”：把光标移到别的输入框
  const ta = dom.document.querySelector('textarea[data-kind="info"][data-field="description"]');
  ta.dispatch('focusin', { target: ta });
  const k = g('draftKey')();
  if (!drafts()[k]) throw new Error('光标进入别的输入框后应落盘：' + Object.keys(drafts()).join(','));
  if (!k.includes('策略名')) throw new Error('落盘的应是输完的名称：' + k);
  dom.localStorage.clear();
  g('state').strategy.info = { name: '', author: '', version: '', description: '', config: {}, preActions: [] };
  return '组字期间与组字结束都不落盘，只有移到别的输入框才落盘';
});

check('本次⑤：预览页「动作触发条件」列保留原文，动作入参带 index + 动作名悬停提示', () => {
  g('state').strategy.actions = [];
  const a1 = makeAction('', 9, { name: '等待', action: 'wait(0.2)' });
  const a2 = makeAction('', 8, { name: '普攻', action: 'attack' });
  a2.conditionText = `(low-hp || since(${a1.index})<3) && count(等待,0,t())>1 && last-exec(5,true,普攻) && q-ready`;
  g('renderPreviewPanel')();
  const html = $('panePreview').innerHTML;
  const titles = (html.match(/<span class="aref" title="[^"]*"/g) || []).map(x => x.match(/title="([^"]*)"/)[1]);
  if (titles.length !== 3) throw new Error('应只给 3 个动作入参加提示，实际 ' + titles.length + '：' + JSON.stringify(titles));
  if (!titles[0].includes('index=' + a1.index) || !titles[0].includes('动作名：等待')) throw new Error('since 的提示不对：' + titles[0]);
  if (!titles.some(x => x.includes('动作名：普攻'))) throw new Error('last-exec 的提示不对：' + JSON.stringify(titles));
  // 正文仍是原始 expression
  const plain = html.replace(/<span class="aref" title="[^"]*">/g, '').replace(/<\/span>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  if (!plain.includes(`since(${a1.index})<3`)) throw new Error('原文被改动：' + plain.slice(plain.indexOf('since'), plain.indexOf('since') + 30));
  if (!plain.includes('count(等待,0,t())')) throw new Error('count 原文被改动');
  return titles.join('；');
});

/* ---------------- 本次 3~5：展开项预览 / 引用注释 / 预览悬停提示 ---------------- */

check('本次③新：动作卡片的「动作指令」「队友条件」展开项旁也有语句预览（与「触发条件」一致）', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '芙宁娜';
  const a = makeAction('芙宁娜', 4, { name: '芙芙e', action: 'e,wait(0.3)' });
  a.conditionText = 'e-ready && low-hp';
  a.teammates.include = ['枫原万叶'];
  g('state').ui.collapsed[a.id] = false;
  g('renderActionsPanel')();
  const sum = (sec) => {
    const d = dom.document.querySelectorAll('details[data-details="' + a.id + ':' + sec + '"]')[0];
    if (!d) throw new Error('缺少 ' + sec + ' 区块');
    const s = d.querySelector('summary');
    return s.querySelector('.hint') ? s.querySelector('.hint').textContent : null;
  };
  const cmd = sum('cmd');
  const cond = sum('cond');
  const team = sum('team');
  if (cmd !== 'e,wait(0.3)') throw new Error('「动作指令」旁应显示指令串预览，实际 ' + JSON.stringify(cmd));
  if (cond !== 'e-ready && low-hp') throw new Error('「触发条件」预览变了：' + JSON.stringify(cond));
  const wantTeam = g('teammateExpr')(a, g('state').strategy.actions);
  if (team !== wantTeam) throw new Error('「队友条件」旁应显示队友条件片段预览，实际 ' + JSON.stringify(team) + '，期望 ' + JSON.stringify(wantTeam));
  // 空值时的占位
  a.action = '';
  a.teammates.include = [];
  g('renderActionsPanel')();
  if (sum('cmd') !== '（空）') throw new Error('空指令应提示「（空）」，实际 ' + JSON.stringify(sum('cmd')));
  if (sum('team') !== '（无）') throw new Error('无队友条件应提示「（无）」，实际 ' + JSON.stringify(sum('team')));
  return `动作指令「${cmd}」/ 队友条件「${team}」`;
});

check('本次④：「编号（自动）」下面注明有哪些动作引用了本动作（index / 动作名都算，悬停提示 index 与指令）', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '';
  const target = makeAction('', 9, { name: '等待', action: 'wait(0.2)' });
  const ref1 = makeAction('', 8, { name: '普攻', action: 'attack' });
  ref1.conditionText = `since(${target.index}) < 3`;
  const ref2 = makeAction('', 5, { name: '爆发', action: 'q,wait(0.1),ready' });
  ref2.morePriorities.push({ id: 'mp1', text: 'count(等待,0,t()) > 1', priority: 100000, cmp: 'after', scope: { type: 9, element: '', character: '' } });
  makeAction('', 4, { name: '辅助', action: 'e' });   // 没有引用本动作
  g('state').ui.collapsed[target.id] = false;
  g('renderActionsPanel')();
  const note = dom.document.querySelector('[data-refnote="' + target.id + '"]');
  if (!note) throw new Error('「编号（自动）」下面缺少引用注释');
  const txt = note.textContent;
  if (!txt.includes('2 条动作的条件引用了本动作')) throw new Error('引用条数不对：' + txt);
  const spans = note.querySelectorAll('.aref');
  const titles = spans.map(s => s.getAttribute('title'));
  if (spans.map(s => s.textContent).join(',') !== '普攻,爆发') throw new Error('应以动作名称展示：' + spans.map(s => s.textContent).join(','));
  if (titles[0] !== `index=${ref1.index}　动作指令：attack`) throw new Error('普攻的悬停提示不对：' + titles[0]);
  if (titles[1] !== `index=${ref2.index}　动作指令：q,wait(0.1),ready`) throw new Error('爆发的悬停提示不对：' + titles[1]);
  if (txt.includes('辅助')) throw new Error('没引用本动作的动作不应出现在注释里');
  // 位置：在「编号（自动）」那一行下面
  const html = $('paneActions').innerHTML;
  if (!(html.indexOf('编号（自动）') < html.indexOf('data-refnote="' + target.id + '"'))) throw new Error('注释应在「编号（自动）」下面');
  // 没有被引用时给出说明
  g('state').ui.collapsed[ref1.id] = false;
  ref1.conditionText = '';
  ref2.morePriorities = [];
  g('renderActionsPanel')();
  const empty = dom.document.querySelector('[data-refnote="' + target.id + '"]').textContent;
  if (!empty.includes('没有被其他动作的条件引用')) throw new Error('没有被引用时应给出说明：' + empty);
  return `${txt}；未被引用时显示「没有被其他动作的条件引用」`;
});

check('本次⑤：优先级预览「动作名」列悬停只提示动作指令内容', () => {
  g('state').strategy.actions = [];
  const a1 = makeAction('', 9, { name: '等待', action: 'wait(0.2)' });
  const a2 = makeAction('', 8, { name: '普攻', action: 'attack(1.2)' });
  a2.morePriorities.push({ id: 'mp2', text: 'low-hp', priority: 100000, cmp: 'after', scope: { type: 9, element: '', character: '' } });
  g('renderPreviewPanel')();
  const html = $('panePreview').innerHTML;
  if (!html.includes('<span title="wait(0.2)">等待</span>')) throw new Error('「动作名」列缺少指令悬停提示：' + html.slice(html.indexOf('优先级排序预览'), html.indexOf('优先级排序预览') + 600));
  if (!html.includes('<span title="attack(1.2)">普攻</span>')) throw new Error('其他触发条件行的动作名也应带提示');
  const titles = (html.match(/<span title="([^"]*)">(等待|普攻)<\/span>/g) || []);
  if (titles.length !== 3) throw new Error('每个条目（主条目 + 其他触发条件）都应有提示，实际 ' + titles.length + '：' + JSON.stringify(titles));
  return `3 个条目都带上动作指令提示（${a1.index} / ${a2.index}）`;
});

/* ---------------- 合并 JSON 策略：界面流程 ---------------- */

check('合并界面：信息页有「合并 JSON 策略…」按钮，当前策略有错误时拒绝合并', () => {
  g('state').strategy.actions = [];
  g('state').strategy.info = { name: '合并界面', author: '', version: '', description: '', config: {}, preActions: [] };
  g('state').ui.tab = 'info';
  g('renderInfoPanel')();
  const btn = dom.document.querySelector('button[data-act="merge"]');
  if (!btn) throw new Error('信息页缺少「合并 JSON 策略…」按钮');
  if (!dom.document.querySelector('button[data-act="import"]') || !dom.document.querySelector('button[data-act="export"]')) throw new Error('导入 / 导出按钮不见了');
  return '按钮已就位';
});

check('合并界面：正常策略点「合并」→ 出现选择文件 / 粘贴 JSON 的弹窗', () => {
  g('state').strategy.actions = [];
  makeAction('', 9, { name: '等待', action: 'wait(0.2)' });
  g('doMerge')();
  if (!$('modalTitle').innerHTML.includes('合并 JSON 策略')) throw new Error('未弹出合并弹窗：' + $('modalTitle').innerHTML);
  if (!$('mrgFile') || !$('mrgPasteBtn') || !$('mrgPasteGo')) throw new Error('缺少选择文件 / 粘贴 JSON 的入口');
  g('closeModal')(null);
  return '选择文件 + 粘贴 JSON 两种入口都在';
});

check('合并界面：需要先单独导入编辑的策略 → 明确提示，且不改动当前策略', () => {
  g('state').strategy.actions = [];
  makeAction('', 9, { name: '等待', action: 'wait(0.2)' });
  const before = JSON.stringify(g('buildJson')());
  g('doMergeFromText')(JSON.stringify({
    info: { name: '旧编号' },
    actions: [{ name: '芙芙e', character: '芙宁娜', action: 'e', index: 30, condition: { expression: 'e-ready' } }],
  }), '旧编号.json');
  const title = $('modalTitle').innerHTML;
  if (!title.includes('该策略应先单独导入并编辑后，才可以与其他策略合并')) throw new Error('提示文案不对：' + title);
  if (!$('modalBody').innerHTML.includes('index')) throw new Error('未列出需要调整的原因');
  g('closeModal')(null);
  if (JSON.stringify(g('buildJson')()) !== before) throw new Error('拒绝合并时不应改动当前策略');
  return title;
});

/* ================= 回归：本次修复的 3 个问题 ================= */

check('回归A：快捷插入指令后光标停在被插入的指令后面（不再回到开头）', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '枫原万叶';
  const a = makeAction('枫原万叶', 4, { name: '万叶e', action: 'e,wait(0.2)' });
  g('state').ui.collapsed[a.id] = false;
  g('state').ui.detailsOpen[a.id + ':cmd'] = true;
  g('state').qc['act:' + a.id] = { sel: null, vals: {}, pick: null };
  // 插入后面板重建走的是 refresh([state.ui.tab])，所以要先切到「动作编辑」页
  g('setTab')('actions');
  g('renderActionsPanel')();
  const taSel = () => dom.document.querySelector('textarea[data-ref="act:' + a.id + '"]');

  // ① 光标在开头插入：插入片段前面还要补一个逗号
  let ta = taSel();
  ta.focus();
  ta.setSelectionRange(0, 0);
  let panel = dom.document.querySelector('[data-qk="act:' + a.id + '"]');
  panel.querySelectorAll('[data-cq]').find(x => x.textContent.trim() === '点按q技能').click();
  dom.document.querySelector('[data-qk="act:' + a.id + '"]').querySelector('[data-cqins="cursor"]').click();
  if (a.action !== 'q,wait(0.1),ready,e,wait(0.2)') throw new Error('插入结果不对：' + JSON.stringify(a.action));
  ta = taSel();
  if (!ta) throw new Error('插入后找不到指令输入框');
  if (ta.value !== a.action) throw new Error('输入框显示的内容与模型不一致：' + JSON.stringify(ta.value));
  // 光标应停在 'q,wait(0.1),ready' 之后（第 18 个字符处），而不是 0
  if (ta.selectionStart !== 18 || ta.selectionEnd !== 18) throw new Error('光标没有停在被插入指令后面：' + ta.selectionStart);
  if (dom.document.activeElement !== ta) throw new Error('插入后焦点不在指令输入框上');

  // ② 光标在中间插入（光标正好停在逗号前面，右侧已有逗号，不补也不重复）
  g('state').qc['act:' + a.id] = { sel: null, vals: {}, pick: null };
  g('renderActionsPanel')();
  ta = taSel();
  ta.focus();
  ta.setSelectionRange(2, 2);
  panel = dom.document.querySelector('[data-qk="act:' + a.id + '"]');
  panel.querySelectorAll('[data-cq]').find(x => x.textContent.trim() === '点按e技能').click();
  dom.document.querySelector('[data-qk="act:' + a.id + '"]').querySelector('[data-cqins="cursor"]').click();
  if (a.action !== 'q,e,wait(0.1),ready,e,wait(0.2)') throw new Error('中间插入结果不对：' + JSON.stringify(a.action));
  ta = taSel();
  // 插入的是「e,」（补了逗号），所以光标停在 4
  if (ta.selectionStart !== 4 || ta.selectionEnd !== 4) throw new Error('中间插入后光标位置不对：' + ta.selectionStart);

  // ③ 空指令串插入：光标在插入内容末尾
  a.action = '';
  g('state').qc['act:' + a.id] = { sel: null, vals: {}, pick: null };
  g('renderActionsPanel')();
  panel = dom.document.querySelector('[data-qk="act:' + a.id + '"]');
  panel.querySelectorAll('[data-cq]').find(x => x.textContent.trim() === '连续普攻').click();
  dom.document.querySelector('[data-qk="act:' + a.id + '"]').querySelector('[data-cqins="cursor"]').click();
  ta = taSel();
  if (ta.selectionStart !== ta.value.length) throw new Error('空指令串插入后光标应在末尾：' + ta.selectionStart + '/' + ta.value.length);

  // ④ 插入到末尾：光标同样落在最后
  g('state').qc['act:' + a.id] = { sel: null, vals: {}, pick: null };
  g('renderActionsPanel')();
  const before = a.action;
  panel = dom.document.querySelector('[data-qk="act:' + a.id + '"]');
  panel.querySelectorAll('[data-cq]').find(x => x.textContent.trim() === '点按e技能').click();
  dom.document.querySelector('[data-qk="act:' + a.id + '"]').querySelector('[data-cqins="append"]').click();
  ta = taSel();
  if (a.action !== before + ',e') throw new Error('末尾插入结果不对：' + JSON.stringify(a.action));
  if (ta.selectionStart !== a.action.length) throw new Error('末尾插入后光标应在最后：' + ta.selectionStart);
  return `开头插入→18，中间插入→3，末尾插入→${a.action.length}`;
});

check('回归B：动作参数的角色筛选能选中「当前角色」，且筛选真的生效', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '';
  const cur = makeAction('', 9, { name: '当前角色等待', action: 'wait(0.2)' });
  const other = makeAction('芙宁娜', 4, { name: '芙宁娜-辅助', action: 'e' });
  cur.conditionText = '';
  g('state').ui.collapsed[cur.id] = false;
  g('state').ui.detailsOpen[cur.id + ':cond'] = true;
  g('renderActionsPanel')();
  const cfbox = () => dom.document.querySelector('[data-cfbox="cond:' + cur.id + '"]');
  const pickFn = (v) => { const el = cfbox().querySelector('[data-cfp="fn"]'); el.value = v; el.dispatch('change'); };
  const setChar = (v) => { const el = cfbox().querySelector('[data-cfchar="a"]'); el.value = v; el.dispatch('change'); };
  const actValues = () => cfbox().querySelector('[data-cfp="a"]').children.map(o => o.value).filter(Boolean);

  pickFn('since');
  const charSel = cfbox().querySelector('[data-cfchar="a"]');
  const curOpt = charSel.children.find(o => o.textContent.includes('当前角色'));
  if (!curOpt) throw new Error('角色筛选下拉里没有「当前角色」选项');
  if (!curOpt.value) throw new Error('「当前角色」选项的值不能和「（全部角色）」一样是空值');
  const allOpt = charSel.children.find(o => o.textContent.includes('全部角色'));
  if (!allOpt || allOpt.value !== '') throw new Error('必须保留「（全部角色）」选项');
  // 未筛选：两个角色的动作都在
  if (actValues().length !== 2) throw new Error('未筛选时应列出全部动作：' + JSON.stringify(actValues()));
  // 选「当前角色」：只剩 character 为空的动作
  setChar(curOpt.value);
  if (cfbox().querySelector('[data-cfchar="a"]').value !== curOpt.value) throw new Error('选了「当前角色」后下拉又跳回别的选项');
  const curOnly = actValues();
  if (curOnly.length !== 1 || String(curOnly[0]) !== String(cur.index)) throw new Error('「当前角色」筛选没生效：' + JSON.stringify(curOnly));
  // 选具体角色：只剩该角色的动作
  setChar('芙宁娜');
  const fuOnly = actValues();
  if (fuOnly.length !== 1 || String(fuOnly[0]) !== String(other.index)) throw new Error('按角色筛选没生效：' + JSON.stringify(fuOnly));
  // 回到「（全部角色）」：筛选取消
  setChar('');
  if (actValues().length !== 2) throw new Error('「（全部角色）」应取消筛选：' + JSON.stringify(actValues()));
  // 选择要保留：重建面板后仍然是「当前角色」
  setChar(curOpt.value);
  g('renderActionsPanel')();
  if (cfbox().querySelector('[data-cfchar="a"]').value !== curOpt.value) throw new Error('重建面板后「当前角色」的选择丢失了');
  // 选中动作后插入，插入的是当前角色的动作 index
  const actSel = cfbox().querySelector('[data-cfp="a"]');
  actSel.value = String(cur.index);
  actSel.dispatch('change');
  cfbox().querySelector('[data-cf="insend"]').dispatch('click');
  if (cur.conditionText !== `since(${cur.index})`) throw new Error('插入结果不对：' + JSON.stringify(cur.conditionText));
  return `「当前角色」筛出 ${cur.index}，芙宁娜筛出 ${other.index}，全部角色 2 条`;
});

check('回归C：在空的注释输入框里输入时，标记与标签立刻出现（不必收起再展开）', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '枫原万叶';
  const a = makeAction('枫原万叶', 4, { name: '万叶e', action: 'e' });
  a.tags = '';
  g('state').ui.collapsed[a.id] = false;
  g('state').ui.detailsOpen[a.id + ':tags'] = true;
  g('renderActionsPanel')();
  const pillSel = `[data-tagspill="${a.id}"]`;
  const sumSel = `[data-tagssum="${a.id}"]`;
  const cntSel = `[data-tagscount="${a.id}"]`;
  if (dom.document.querySelector(pillSel).textContent.includes('注释')) throw new Error('空注释时不该出现「注释」标签');
  if (dom.document.querySelector(sumSel).textContent.includes('已填写')) throw new Error('空注释时不该出现「已填写」');
  // 模拟在空输入框里打字（input 事件 → 字段处理器）
  const ta = dom.document.querySelector(`textarea[data-id="${a.id}"][data-field="tags"]`);
  if (!ta) throw new Error('找不到注释输入框');
  ta.value = '开场先手';
  ta.dispatch('input');
  if (a.tags !== '开场先手') throw new Error('注释没有写进模型：' + JSON.stringify(a.tags));
  if (!dom.document.querySelector(pillSel).textContent.includes('注释')) throw new Error('输入后卡片标题栏没有出现「注释」标签');
  if (!dom.document.querySelector(sumSel).textContent.includes('已填写')) throw new Error('输入后「注释」区块标题没有出现「已填写」');
  if (!dom.document.querySelector(cntSel).textContent.includes('4 个字符')) throw new Error('字符数没有更新：' + dom.document.querySelector(cntSel).textContent);
  // 清空后标记要跟着消失
  ta.value = '';
  ta.dispatch('input');
  if (dom.document.querySelector(pillSel).textContent.includes('注释')) throw new Error('清空注释后「注释」标签应消失');
  if (dom.document.querySelector(sumSel).textContent.includes('已填写')) throw new Error('清空注释后「已填写」应消失');
  g('setTab')('info');
  return '输入即出现、清空即消失';
});

/* 需要等 Promise 的检查（角色选择弹窗是异步返回的） */
const asyncChecks = [];
const tick = () => new Promise(r => setTimeout(r, 0));
const checkAsync = (name, fn) => asyncChecks.push([name, fn]);
checkAsync('回归⑤b：角色选择弹窗允许同一个角色重复添加', async () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '枫原万叶';
  const a = makeAction('枫原万叶', 4, { name: '万叶e', action: 'e' });
  a.teammates.include = ['钟离'];
  g('renderActionsPanel')();
  let picked = null;
  g('pickAvatarsLive')({ title: '选择必要队友', selected: a.teammates.include.slice(), allowDuplicates: true, withMode: false })
    .then(r => { picked = r; });
  const pkList = $('pkList');
  if (!pkList.querySelector('[data-pkadd]')) throw new Error('重复模式下应提供「+ 添加」按钮');
  if (pkList.querySelector('[data-pk]')) throw new Error('重复模式下不应再是单选复选框');
  const addBtn = pkList.querySelectorAll('[data-pkadd]').find(b => b.getAttribute('data-pkadd') === '钟离');
  addBtn.click();
  addBtn.click();
  const sel = $('pkSel');
  if (sel.querySelectorAll('[data-pkrm]').length !== 3) throw new Error('同一个角色应能重复添加，实际标签数 ' + sel.querySelectorAll('[data-pkrm]').length);
  sel.querySelectorAll('[data-pkrm]')[0].click();
  if ($('pkCount').textContent !== '已选 2 个') throw new Error('删除一个后计数不对：' + $('pkCount').textContent);
  $('modalFoot').children.find(b => b.textContent.includes('确定')).click();
  await new Promise(r => setTimeout(r, 0));
  if (!picked || picked.names.join(',') !== '钟离,钟离') throw new Error('重复角色没有返回：' + JSON.stringify(picked));
  return '已选 ' + picked.names.join('、');
});

checkAsync('合并界面②：逐个字段 / 逐个动作询问后完成合并（含「全部使用当前版本」与汇总弹窗）', async () => {
  // 前面「导入示例策略走弹窗流程」那次点击留下的 Promise 链可能还停在 priority 确认弹窗上，先收拾干净
  g('closeModal')(null);
  await tick(); await tick();
  g('closeModal')(null);
  // 当前策略：info 的 name 与 description 都与导入版本不同；同名动作「芙芙e」内容不同；另一条是新动作
  const obj = {
    info: { name: '当前名', author: '当前作者', version: 'v1', description: '当前描述', config: {}, preActions: [] },
    actions: [
      { name: '芙芙e', character: '芙宁娜', action: 'e', index: g('makeIndex')(4, 3, 11, 1), condition: { expression: 'e-ready' } },
      { name: '检查战斗结束', character: '', action: 'check', index: 1, condition: { expression: 't>1.5' } },
    ],
  };
  const res = g('analyzeImport')(obj);
  if (res.fatal.length) throw new Error(res.fatal.join('；'));
  g('applyImport')(res);
  const imported = {
    info: { name: '导入名', author: '', version: 'v1', description: '导入描述', config: {}, preActions: [] },
    actions: [
      { name: '芙芙e', character: '芙宁娜', action: 'e,wait(0.3)', index: g('makeIndex')(4, 3, 11, 1), condition: { expression: 'e-ready && low-hp' } },
      { name: '芙芙q', character: '芙宁娜', action: 'q,wait(0.1),ready', index: g('makeIndex')(5, 3, 11, 1), condition: { expression: `since(${g('makeIndex')(4, 3, 11, 1)}) > 5` } },
    ],
  };
  g('doMergeFromText')(JSON.stringify(imported), '导入测试.json');
  await tick();   // 冲突弹窗在 Promise 链里打开，等一个 tick

  // ① info：策略名称不同
  if (!$('modalTitle').innerHTML.includes('info 内容不同：策略名称')) throw new Error('第一个弹窗应是策略名称冲突：' + $('modalTitle').innerHTML);
  if (!$('modalBody').innerHTML.includes('导入名') || !$('modalBody').innerHTML.includes('当前名')) throw new Error('弹窗里应展示两个版本的内容');
  $('modalFoot').children.find(b => b.textContent.includes('使用导入版本')).click();
  await tick();
  // ② info：描述不同 → 选「全部使用当前版本」
  if (!$('modalTitle').innerHTML.includes('info 内容不同：描述')) throw new Error('第二个弹窗应是描述冲突：' + $('modalTitle').innerHTML);
  const allCur = $('modalFoot').children.find(b => b.textContent.includes('全部使用当前版本'));
  if (!allCur) throw new Error('缺少「全部使用当前版本（后续不再询问）」');
  allCur.click();
  await tick();
  // ③ 动作「芙芙e」内容不同 → 使用导入版本替换
  if (!$('modalTitle').innerHTML.includes('动作「芙芙e」')) throw new Error('第三个弹窗应是动作冲突：' + $('modalTitle').innerHTML);
  const body = $('modalBody').innerHTML;
  if (!body.includes('动作指令') || !body.includes('e,wait(0.3)')) throw new Error('动作冲突弹窗应展示不同之处：' + body.slice(0, 300));
  if ($('modalFoot').children.some(b => b.textContent.includes('全部使用导入版本'))) throw new Error('不应提供「全部替换」的一键选择');
  $('modalFoot').children.find(b => b.textContent.includes('使用导入版本替换')).click();
  await tick();
  // ④ 汇总
  if (!$('modalTitle').innerHTML.includes('合并完成')) throw new Error('应弹出合并汇总：' + $('modalTitle').innerHTML);
  const sum = $('modalBody').innerHTML;
  if (!sum.includes('新增 1 条动作') || !sum.includes('用导入版本替换 1 条动作')) throw new Error('汇总内容不对：' + sum.slice(0, 300));
  g('closeModal')(null);

  const info = g('state').strategy.info;
  if (info.name !== '导入名') throw new Error('策略名称应改用导入版本：' + info.name);
  if (info.description !== '当前描述') throw new Error('描述应保留当前版本：' + info.description);
  if (info.author !== '当前作者') throw new Error('作者两边都有且相同（都是当前作者？）—— 未采用导入版本空值：' + info.author);
  const acts = g('state').strategy.actions;
  const e = acts.find(a => a.name === '芙芙e');
  if (e.action !== 'e,wait(0.3)' || e.conditionText !== 'e-ready && low-hp') throw new Error('替换结果不对：' + e.action + ' / ' + e.conditionText);
  const q = acts.find(a => a.name === '芙芙q');
  if (!q) throw new Error('新动作「芙芙q」没有导入');
  if (q.conditionText !== `since(${e.index}) > 5`) throw new Error('新动作里对芙芙e的引用应换算成本策略的 index：' + q.conditionText);
  const v = g('validateStrategy')();
  if (v.errors.length) throw new Error('合并后不应有错误：' + v.errors.map(x => x.text).join('；'));
  g('state').strategy.info = { name: '', author: '', version: '', description: '', config: {}, preActions: [] };
  g('state').strategy.actions = [];
  return `info：名称→导入 / 描述→当前；动作：芙芙e 已替换（index=${e.index}），芙芙q 新增（index=${q.index}）`;
});

checkAsync('合并界面③：点「导入的版本改名后保留」→ 新名称后加数字、重新分配 index', async () => {
  g('closeModal')(null);
  await tick();
  const obj = {
    info: { name: 'S', author: '', version: '', description: '', config: {}, preActions: [] },
    actions: [
      { name: '芙芙e', character: '芙宁娜', action: 'e', index: g('makeIndex')(4, 3, 11, 1), condition: { expression: 'e-ready' } },
      { name: '检查战斗结束', character: '', action: 'check', index: 1, condition: { expression: 't>1.5' } },
    ],
  };
  g('applyImport')(g('analyzeImport')(obj));
  const imported = {
    info: { name: 'S', author: '', version: '', description: '', config: {}, preActions: [] },
    actions: [{ name: '芙芙e', character: '芙宁娜', action: 'e,wait(0.3)', index: g('makeIndex')(4, 3, 11, 1), condition: { expression: 'e-ready && low-hp' } }],
  };
  g('doMergeFromText')(JSON.stringify(imported), '改名测试.json');
  await tick();
  if (!$('modalTitle').innerHTML.includes('动作「芙芙e」')) throw new Error('应直接进入动作冲突弹窗：' + $('modalTitle').innerHTML);
  $('modalFoot').children.find(b => b.textContent.includes('改名后保留')).click();
  await tick();
  if (!$('modalTitle').innerHTML.includes('合并完成')) throw new Error('应弹出合并汇总：' + $('modalTitle').innerHTML);
  g('closeModal')(null);
  const old = g('state').strategy.actions.find(a => a.name === '芙芙e');
  const fresh = g('state').strategy.actions.find(a => a.name === '芙芙e2');
  if (!old || old.action !== 'e') throw new Error('当前版本不应被改动');
  if (!fresh) throw new Error('应新增「芙芙e2」：' + g('state').strategy.actions.map(a => a.name).join(','));
  if (fresh.index !== g('makeIndex')(4, 3, 11, 2)) throw new Error('新动作应重新分配 index（尾数 2）：' + fresh.index);
  const v = g('validateStrategy')();
  if (v.errors.length) throw new Error('合并后不应有错误：' + v.errors.map(x => x.text).join('；'));
  g('state').strategy.actions = [];
  return `芙芙e 保留（${old.index}），芙芙e2 新增（${fresh.index}）`;
});

for (const [name, fn] of asyncChecks) {
  try {
    const r = await fn();
    console.log(`✔ ${name}${r ? ' — ' + r : ''}`);
  } catch (e) {
    failures++;
    console.log(`✘ ${name}\n   ${e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n   ') : e}`);
  }
}

console.log(failures ? `\n共 ${failures} 项失败` : '\n全部通过');
process.exit(failures ? 1 : 0);
