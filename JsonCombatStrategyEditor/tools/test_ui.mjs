// UI 冒烟测试：node tools/test_ui.mjs
// 用极简 DOM 模拟跑一遍 boot + 主要交互，检查有没有运行时异常
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { readSources, findSampleJson, root } from './build.mjs';
import { createDom } from './dom.mjs';

const dom = createDom();
/**
 * 全局的 alert 收集器：编辑器里的 alert 一律进这里。
 * 以前各个用例会临时把 ctx.alert 换成自己的数组、跑完再换回去；
 * 只要有一处忘了还原（或者嵌套两层），后面的用例就收不到自己那次的提示，
 * 断言就会莫名其妙地失败。所以改成「所有提示都进同一个数组」，用例自己记下开跑前的长度来分段。
 */
const alertLog = [];
const ctx = {
  console,
  window: dom.window,
  document: dom.document,
  localStorage: dom.localStorage,
  Blob: class { constructor() { } },
  FileReader: class { readAsText() { } },
  alert: (m) => { alertLog.push(String(m)); console.log('  [alert] ' + String(m).slice(0, 200)); },
  confirm: () => true,
  setTimeout, clearTimeout, setInterval, clearInterval,
  URL: dom.window.URL,
};
/** 从 alertLog 的 from 位置开始，本次新出现的提示 */
const alertsSince = (from) => alertLog.slice(from);
ctx.globalThis = ctx;
vm.createContext(ctx);

const src = readSources({ skipMissing: true }).map(s => s.code).join('\n');
if (!src.includes('通用 UI 工具')) throw new Error('ui_common.js 未进入打包顺序');
vm.runInContext(src, ctx);
const g = (c) => vm.runInContext(c, ctx);

let failures = 0;
const T0 = Date.now();
function check(name, fn) {
  try {
    const r = fn();
    console.log(`✔ [${Date.now() - T0}ms] ${name}${r ? ' — ' + r : ''}`);
  } catch (e) {
    failures++;
    console.log(`✘ [${Date.now() - T0}ms] ${name}\n   ${e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n   ') : e}`);
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

check('预置兜底动作（3 条：兜底战斗检查 → 角色红血标记 → 等待）', () => {
  const acts = g('state').strategy.actions;
  if (acts.length !== 3) throw new Error('预设应包含 3 条动作，实际 ' + acts.length + '：' + acts.map(a => a.name).join('，'));
  const a = acts[acts.length - 1];
  if (a.type !== 9) throw new Error('兜底等待动作类型应为 9，实际 ' + a.type);
  if (a.index !== 90001) throw new Error('兜底等待动作 index 应为 90001，实际 ' + a.index);
  if (a.conditionText !== 'false') throw new Error('预置主条件应为 false');
  const mp = a.morePriorities[0];
  if (!mp || mp.priority !== 100000) throw new Error('预置额外条件 priority 应为 100000');
  if (acts[0].name !== '兜底战斗检查' || acts[1].name !== '角色红血标记') throw new Error('前两条预设动作不对：' + acts.map(x => x.name).join('，'));
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

check('界面：快捷插入指令（无参数 / 带参数 / 空参数自动省略括号与逗号 / 词条默认值）', () => {
  const a = g('state').strategy.actions.find(x => x.name === '芙宁娜-q');
  /** 重新渲染这一条动作的指令编辑区，并选中一个词条（先清掉上一次的选择：再点同一个词条会变成取消选择） */
  const open = (word) => {
    a.action = '';
    delete g('state').qc[a.id];
    $('paneActions').innerHTML = qcRender(a.id);
    g('bindQuickCommandPanels')();
    qcPick(a.id, word);
  };
  // ① 无参数词条：直接插进完整指令
  open('点按q技能');
  qcInsert(a.id, 'replace');
  if (a.action !== 'q,wait(0.1),ready') throw new Error('无参数词条插入结果不对：' + JSON.stringify(a.action));
  // ② 带参数词条：填了参数就带上括号
  open('连续普攻');
  const p0 = qcPanel(a.id).querySelector('[data-cqp="0"]');
  if (!p0) throw new Error('缺少参数输入框');
  p0.value = '1.2';
  qcDisp(p0, 'input');
  qcInsert(a.id, 'append');
  if (a.action !== 'attack(1.2)') throw new Error('带参数插入结果不对：' + a.action);
  // ③ 参数留空：省略括号与逗号
  open('连续普攻');
  const p1 = qcPanel(a.id).querySelector('[data-cqp="0"]');
  p1.value = '';
  qcDisp(p1, 'input');
  qcInsert(a.id, 'replace');
  if (a.action !== 'attack') throw new Error('空参数应省略括号：' + JSON.stringify(a.action));
  // ④ 有默认值的参数（「移动」默认朝前 w）
  open('移动');
  const dir = qcPanel(a.id).querySelector('[data-cqp="0"]');
  if (!dir || dir.value !== 'w') throw new Error('「移动」的默认方向应为前 w，实际 ' + (dir && dir.value));
  qcInsert(a.id, 'replace');
  if (a.action !== 'walk(w,0.2)') throw new Error('移动插入结果不对：' + a.action);
  return 'q,wait(0.1),ready / attack(1.2) / attack / walk(w,0.2)';
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
  // 角色搜索词只筛选角色下拉（先把筛选恢复成「全部角色」，否则当前选中项会被保留）
  const cfReset = box3c.querySelector('[data-cfchar="a"]');
  cfReset.value = '';
  cfReset.dispatch('change');
  const cs = cfbox().querySelector('[data-cfcharq="a"]');
  cs.value = '不存在';
  cs.dispatch('input');
  const box3d = cfbox();
  if (box3d.querySelector('[data-cfchar="a"]').children.some(o => o.value === '枫原万叶')) throw new Error('角色搜索框没有过滤角色下拉');
  // 搜索框只筛选角色下拉，不再直接过滤动作下拉
  if (!box3d.querySelector('[data-cfp="a"]').children.some(o => String(o.value) === String(a.index))) {
    throw new Error('角色搜索框不该直接过滤动作下拉（动作下拉只看角色筛选下拉）');
  }
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
  // 组合 2：max(count(…,…,…),…) > 数值（两个时间入参用「时间值 / t-时间值 / t-since(动作)」三种输入方式）
  a.conditionText = '';
  g('renderActionsPanel')();
  pickFn('combo-max-count');
  const box5 = cfbox();
  if (!box5.querySelector('[data-cfp="bMode"]') || !box5.querySelector('[data-cfp="cMode"]')) throw new Error('组合 2 缺少统一应用的时间入参选择');
  box5.querySelector('[data-cfp="bNum"]').value = '0.5';
  box5.querySelector('[data-cfp="bNum"]').dispatch('input');
  cfbox().querySelector('[data-cfp="cNum"]').value = '3';
  cfbox().querySelector('[data-cfp="cNum"]').dispatch('input');
  const num5 = cfbox().querySelector('[data-cfp="num"]');
  num5.value = '2';
  num5.dispatch('input');
  cfbox().querySelector('[data-cf="insend"]').dispatch('click');
  if (a.conditionText !== 'max(count(,0.5,3),count(,0.5,3)) > 2') throw new Error('组合 2 插入结果不对：' + a.conditionText);
  // 组合 2 里每项 count 只选目标动作、两个时间都留空时，同样不应多出两个逗号
  a.conditionText = '';
  g('renderActionsPanel')();
  pickFn('combo-max-count');
  const nKeep = cfbox().querySelector('[data-cfp="n"]');
  nKeep.value = '1';
  nKeep.dispatch('change');
  const argKeep = cfbox().querySelector('[data-cfp="arg1"]');
  argKeep.value = String(a.index);
  argKeep.dispatch('change');
  cfbox().querySelector('[data-cf="insend"]').dispatch('click');
  if (a.conditionText !== `max(count(${a.index}))`) throw new Error('组合 2 里 count 多出了逗号：' + a.conditionText);
  // count 只指定目标动作、两个时间都留空 → count(动作)，不再多出两个空逗号
  a.conditionText = '';
  g('renderActionsPanel')();
  pickFn('count');
  const cntAct = cfbox().querySelector('[data-cfp="a"]');
  cntAct.value = String(a.index);
  cntAct.dispatch('change');
  const cntSnip = () => cfbox().querySelector('[data-cfsnip]').textContent;
  if (cntSnip() !== `count(${a.index})`) throw new Error('只选目标动作时不应多出两个逗号：' + cntSnip());
  // 指定开始或结束时间时，两个逗号必须保留（第二个/第三个参数的位置要靠逗号确认）
  const cntB = cfbox().querySelector('[data-cfp="bNum"]');
  cntB.value = '2';
  cntB.dispatch('input');
  if (cntSnip() !== `count(${a.index},2,)`) throw new Error('只填开始时间时应保留两个逗号：' + cntSnip());
  cntB.value = '';
  cntB.dispatch('input');
  const cntC = cfbox().querySelector('[data-cfp="cNum"]');
  cntC.value = '3';
  cntC.dispatch('input');
  if (cntSnip() !== `count(${a.index},,3)`) throw new Error('只填结束时间时应保留两个逗号：' + cntSnip());
  cntC.value = '';
  cntC.dispatch('input');
  if (cntSnip() !== `count(${a.index})`) throw new Error('清空时间后应恢复成 count(动作)：' + cntSnip());
  cfbox().querySelector('[data-cf="insend"]').dispatch('click');
  if (a.conditionText !== `count(${a.index})`) throw new Error('count(动作) 插入结果不对：' + a.conditionText);
  // 组合 3：max(e-cd(角色1),e-cd(角色2),…) > 数值
  a.conditionText = '';
  g('renderActionsPanel')();
  pickFn('combo-max-ecd');
  const box6 = cfbox();
  const n6 = box6.querySelector('[data-cfp="n"]');
  if (!n6 || n6.children.length !== 9) throw new Error('组合 3 的项数应为 1~9，实际 ' + (n6 && n6.children.length));
  const ecd1 = box6.querySelector('[data-cfp="arg1"]');
  const ecd2 = box6.querySelector('[data-cfp="arg2"]');
  if (!ecd1 || !ecd2) throw new Error('组合 3 缺少逐项角色选择');
  if (!box6.querySelector('[data-cfp="cmp"]') || !box6.querySelector('[data-cfp="num"]')) throw new Error('组合 3 缺少共用的比较项');
  ecd1.value = '枫原万叶';
  ecd1.dispatch('change');
  const ecd2b = cfbox().querySelector('[data-cfp="arg2"]');
  ecd2b.value = '芙宁娜';
  ecd2b.dispatch('change');
  const num6 = cfbox().querySelector('[data-cfp="num"]');
  num6.value = '2';
  num6.dispatch('input');
  cfbox().querySelector('[data-cf="insend"]').dispatch('click');
  if (a.conditionText !== 'max(e-cd(枫原万叶),e-cd(芙宁娜)) > 2') throw new Error('组合 3 插入结果不对：' + a.conditionText);
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

check('本次②：「添加其他触发条件」表单不再有输入框（先添加条目、再在条目里用快捷添加条件拼）', () => {
  const a = freshAction('万叶e', 4, '');
  g('state').ui.detailsOpen[a.id + ':moreadd'] = true;
  g('renderActionsPanel')();
  // 表单里既没有条件输入框，也没有「快捷添加条件」面板
  if (dom.document.querySelector(`textarea[data-cond-ref="morenew:${a.id}"]`)) throw new Error('表单里仍有条件输入框');
  if (dom.document.querySelector(`[data-cfbox="morenew:${a.id}"]`)) throw new Error('表单里仍有快捷添加条件面板');
  // 表单上那两句文案：提示「先点按钮加进列表」+ 按钮自称「先点这里」
  const pane = $('paneActions').innerHTML;
  if (!pane.includes('请先点下面的按钮把这条其他触发条件加进列表')) throw new Error('没有提示用户先点添加按钮再编辑触发条件');
  if (!pane.includes('添加其他触发条件（先点这里）')) throw new Error('添加按钮没有改成提醒先点它的文案');
  // 选范围 → 添加条目
  const form = dom.document.querySelector(`[data-moreaddform="${a.id}"]`);
  const typeSel = form.querySelector('[data-na="type"]');
  typeSel.value = '5';
  form.dispatch('change', { target: typeSel });
  const btn = dom.document.querySelectorAll('[data-act="more-add2"]').find(b => b.getAttribute('data-id') === a.id);
  g('app').handlers['more-add2'](btn, {});
  const mp = a.morePriorities[a.morePriorities.length - 1];
  if (!mp || mp.text !== '') throw new Error('新条目应当是空条件：' + JSON.stringify(a.morePriorities));
  if (mp.priority !== 60000) throw new Error('priority 应为次于爆发的 60000，实际 ' + mp.priority);
  // 判定范围的选择要保留（不能因为重建面板就被重置）
  const form2 = dom.document.querySelector(`[data-moreaddform="${a.id}"]`);
  if (form2.querySelector('[data-na="type"]').value !== '5') throw new Error('添加后判定范围被重置了');
  // 条目里的触发条件：手输 + 快捷添加条件混用，内容不会被清空
  const idx = a.morePriorities.length - 1;
  g('state').ui.detailsOpen[`${a.id}:more:${idx}`] = true;
  g('renderActionsPanel')();
  const sel = `textarea[data-cond-ref="more:${a.id}:${idx}"]`;
  const ta = dom.document.querySelector(sel);
  if (!ta) throw new Error('新条目里找不到触发条件输入框');
  ta.focus();
  ta.value = 'low-hp';
  ta.dispatch('input');                       // 真实浏览器里输入会冒泡到 document 的委托监听
  if (a.morePriorities[idx].text !== 'low-hp') throw new Error('手输内容没有写进模型：' + JSON.stringify(a.morePriorities[idx].text));
  const cfbox = () => dom.document.querySelector(`[data-cfbox="more:${a.id}:${idx}"]`);
  const andBtn = cfbox().querySelectorAll('[data-cfi]').find(x => x.getAttribute('data-cfi') === '&&');
  andBtn.dispatch('click');
  const ta2 = dom.document.querySelector(sel);
  if (!ta2) throw new Error('插入后找不到条件输入框');
  if (ta2.value !== 'low-hp &&') throw new Error('插入后输入框内容不对：' + JSON.stringify(ta2.value));
  if (a.morePriorities[idx].text !== 'low-hp &&') throw new Error('插入后模型内容不对：' + JSON.stringify(a.morePriorities[idx].text));
  // 再用快捷添加插入一个函数片段，手输的部分也要保留
  const box = cfbox();
  const fsel = box.querySelector('[data-cfp="fn"]');
  fsel.value = 'q-ready';
  fsel.dispatch('change');
  cfbox().querySelector('[data-cf="insend"]').dispatch('click');
  const ta3 = dom.document.querySelector(sel);
  if (ta3.value !== 'low-hp && q-ready') throw new Error('插入函数片段后输入框内容不对：' + JSON.stringify(ta3.value));
  if (a.morePriorities[idx].text !== 'low-hp && q-ready') throw new Error('插入函数片段后模型内容不对：' + JSON.stringify(a.morePriorities[idx].text));
  return a.morePriorities[idx].text;
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

check('本次⑤b：预览列可在「原始表达式 / 释义」之间切换，释义含动作名与悬停提示', () => {
  g('state').strategy.actions = [];
  const a1 = makeAction('', 9, { name: '等待', action: 'wait(0.2)' });
  const a2 = makeAction('', 8, { name: '普攻', action: 'attack' });
  a2.conditionText = `since(${a1.index}) > 2`;
  g('renderPreviewPanel')();
  const rawHtml = $('panePreview').innerHTML;
  const stripAref = (h) => String(h).replace(/<span class="aref"[^>]*>/g, '').replace(/<\/span>/g, '').replace(/&gt;/g, '>');
  if (!stripAref(rawHtml).includes(`since(${a1.index})`)) throw new Error('默认应显示原始表达式：' + rawHtml.slice(0, 200));
  const modeBtn = (m) => dom.document.querySelector(`[data-act="preview-cond-mode"][data-mode="${m}"]`);
  if (!modeBtn('raw') || !modeBtn('explain')) throw new Error('缺少原始表达式 / 释义切换按钮');
  modeBtn('explain').dispatch('click');
  const exHtml = $('panePreview').innerHTML;
  if (!exHtml.includes('距上次执行的秒数')) throw new Error('切换释义后没有显示解释文本');
  if (!exHtml.includes('动作「等待」')) throw new Error('释义里没有把引用的动作显示成动作名');
  if (!exHtml.includes(`title="index=${a1.index}`)) throw new Error('释义里的动作名缺少 index 悬停提示');
  if (g('state').ui.previewCondMode !== 'explain') throw new Error('预览列的显示方式没有写进 UI 状态');
  modeBtn('raw').dispatch('click');
  if (!stripAref($('panePreview').innerHTML).includes(`since(${a1.index})`)) throw new Error('切回原始表达式失败');
  return '原始表达式 ↔ 释义；动作名与悬停提示一致';
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

/* ================= 回归：本次 8 项改动 ================= */

/** 另起一个「新页面」：同一个 localStorage 里读草稿（验证草稿往返） */
var bootFresh = function (store) {
  const d2 = createDom();
  for (const id of STATIC_IDS) d2.document.mount(d2.document.getElementById(id));
  if (store) for (const [k, v] of store._m.entries()) d2.localStorage._m.set(k, v);
  const c2 = {
    console, window: d2.window, document: d2.document, localStorage: d2.localStorage,
    Blob: class { }, FileReader: class { readAsText() { } }, alert: () => { }, confirm: () => true,
    setTimeout, clearTimeout, setInterval, clearInterval, URL: d2.window.URL,
  };
  c2.globalThis = c2;
  vm.createContext(c2);
  vm.runInContext(readSources({ skipMissing: true }).map(s => s.code).join('\n'), c2);
  d2.window.dispatch('DOMContentLoaded');
  return { dom: d2, g: (c) => vm.runInContext(c, c2) };
}

const preSelect = (i) => dom.document.querySelectorAll('select[data-kind="pre"][data-field="character"]')[i];
const preSearch = (i) => dom.document.querySelector(`[data-kind="pre"][data-field="avatarSearch"][data-idx="${i}"]`);

check('① 战斗前动作：搜索框只筛选旁边的角色选择框（搜索框下方不再弹任何候选）', () => {
  const s = g('state').strategy;
  s.info.preActions = [{ character: '芙宁娜', cmd: 'e' }, { character: '', cmd: 'wait(0.2)' }];
  g('setTab')('info');
  g('renderInfoPanel')();
  // 上方那个全局搜索框已经移除
  if (dom.document.querySelector('[data-field="preAvatarSearch"]')) throw new Error('上方那个全局角色搜索框应已移除');
  const search0 = preSearch(0);
  if (!search0) throw new Error('第 1 行角色选择旁没有搜索框');
  if (!preSearch(1)) throw new Error('第 2 行角色选择旁没有搜索框');
  // 搜索框自己不能再挂候选列表（输入框下方弹出候选层就是那个 BUG）
  if (search0.hasAttribute('list')) throw new Error('角色搜索框不该再挂 list（会在输入框下方弹出候选层）');
  if (dom.document.querySelector('datalist')) throw new Error('页面里不该再有任何 datalist');
  // 没输入搜索词时，选择框里保留全部角色
  const sel0 = preSelect(0);
  if (sel0.children.length < 100) throw new Error('未搜索时角色选择框应保留全部角色，实际 ' + sel0.children.length);
  if (sel0.value !== '芙宁娜') throw new Error('角色选择框的选中项不对：' + sel0.value);
  // 输入「枫原」→ 旁边的角色选择框只剩「（不指定角色）+ 当前已选 + 枫原万叶」
  search0.value = '枫原';
  search0.dispatch('input');
  const opts = preSelect(0).children.filter(o => o.tagName === 'OPTION');
  const optVals = opts.map(o => o.getAttribute('value'));
  if (optVals[0] !== '') throw new Error('搜索后第一项应仍是「（不指定角色）」：' + optVals.join(','));
  if (!optVals.includes('枫原万叶')) throw new Error('搜索「枫原」后应能选到枫原万叶：' + optVals.join(','));
  if (optVals.some(v => v && v !== '枫原万叶' && v !== '芙宁娜')) throw new Error('搜索「枫原」后混进了不匹配的角色：' + optVals.join(','));
  if (!opts.find(o => o.getAttribute('value') === '枫原万叶').textContent.includes('枫原万叶')) throw new Error('选项名不对');
  if (dom.document.querySelector(`[data-idx="1"][data-field="avatarSearch"]`).value !== '') throw new Error('第 2 行的搜索框不该被影响');
  // 输入不匹配的内容 → 只剩「（不指定角色）」与「当前已选的那个角色」（已选项保留，保证模型不被悄悄清空）
  search0.value = '不存在的角色';
  search0.dispatch('input');
  const opts2 = preSelect(0).children.filter(o => o.tagName === 'OPTION').map(o => o.getAttribute('value'));
  if (opts2.length !== 2 || opts2[0] !== '' || opts2[1] !== '芙宁娜') throw new Error('搜不到时应只剩「（不指定角色）+ 已选的芙宁娜」：' + opts2.join(','));
  if (preSelect(0).value !== '芙宁娜') throw new Error('筛不到角色时原选择不该丢：' + preSelect(0).value);
  // 重新渲染面板后搜索词保留
  search0.value = '枫原';
  search0.dispatch('input');
  g('renderInfoPanel')();
  if (preSearch(0).value !== '枫原') throw new Error('重建面板后角色搜索词丢了');
  // 从筛选后的选择框里选一个角色：选择写进模型，搜索框顺势清空、选择框恢复全部角色
  const selPick = preSelect(0);
  selPick.value = '枫原万叶';
  selPick.dispatch('change', { target: selPick });
  if (s.info.preActions[0].character !== '枫原万叶') throw new Error('选中角色没有写进模型：' + s.info.preActions[0].character);
  if (preSearch(0).value !== '') throw new Error('选中角色后搜索框应清空');
  if (preSelect(0).children.length < 100) throw new Error('选中角色后选择框应恢复全部角色，实际 ' + preSelect(0).children.length);
  return `每行独立搜索框；「枫原」→ 选择框只剩 ${opts.length - 1} 个候选；选完恢复全部角色`;
});

check('② 动作入参：角色搜索框只筛角色下拉，动作下拉只看角色下拉（搜索框下方不弹候选）', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '芙宁娜';
  const a = makeAction('芙宁娜', 4, { name: '芙芙e', action: 'e' });
  const b = makeAction('枫原万叶', 4, { name: '万叶e', action: 'e' });
  a.conditionText = '';
  b.conditionText = '';
  g('state').ui.collapsed[a.id] = false;
  g('state').ui.detailsOpen[a.id + ':cond'] = true;
  g('renderActionsPanel')();
  const cfbox = () => dom.document.querySelector('[data-cfbox="cond:' + a.id + '"]');
  const fnEl = cfbox().querySelector('[data-cfp="fn"]');
  fnEl.value = 'since';
  fnEl.dispatch('change');
  const search = cfbox().querySelector('[data-cfcharq="a"]');
  if (!search) throw new Error('动作参数缺少角色搜索框');
  if (search.hasAttribute('list') || dom.document.querySelector('datalist')) throw new Error('角色搜索框不该再挂候选列表（datalist）');
  // 搜索框输入 → 角色筛选下拉只剩匹配项（动作下拉不受搜索框影响）
  search.value = '芙宁';
  search.dispatch('input');
  const roleSel = cfbox().querySelector('[data-cfchar="a"]');
  const roleTxt = roleSel.children.map(o => o.textContent).join(' / ');
  if (!roleTxt.includes('芙宁娜')) throw new Error('搜索「芙宁」后角色筛选下拉里应只剩芙宁娜：' + roleTxt);
  if (roleTxt.includes('枫原万叶')) throw new Error('搜索「芙宁」后角色筛选下拉里不该还有枫原万叶：' + roleTxt);
  const actSel0 = cfbox().querySelector('[data-cfp="a"]');
  if (!actSel0.children.some(o => String(o.value) === String(a.index)) || !actSel0.children.some(o => String(o.value) === String(b.index))) {
    throw new Error('角色搜索框不该直接过滤动作下拉（动作下拉只看角色筛选下拉）');
  }
  // 选中「芙宁娜」→ 动作下拉只剩芙宁娜的动作
  const fuOpt = roleSel.children.find(o => o.textContent.includes('芙宁娜'));
  roleSel.value = fuOpt.getAttribute('value');
  roleSel.dispatch('change');
  const actSel1 = cfbox().querySelector('[data-cfp="a"]');
  if (!actSel1.children.some(o => String(o.value) === String(a.index))) throw new Error('按角色筛选后动作下拉里应保留本角色动作');
  if (actSel1.children.some(o => String(o.value) === String(b.index))) throw new Error('按角色筛选后动作下拉里不该还有别的角色的动作');
  // 选完角色，搜索框顺势清空、角色下拉恢复全部角色
  if (cfbox().querySelector('[data-cfcharq="a"]').value !== '') throw new Error('选中角色后角色搜索框应清空');
  if (cfbox().querySelector('[data-cfchar="a"]').children.length < 3) throw new Error('选中角色后角色筛选下拉应恢复全部角色');
  // 角色参数的搜索框同样只筛角色下拉
  fnEl.value = 'q-ready';
  fnEl.dispatch('change');
  const cs = cfbox().querySelector('[data-cfcs="a"]');
  if (!cs) throw new Error('角色参数缺少角色搜索框');
  if (cs.hasAttribute('list') || dom.document.querySelector('datalist')) throw new Error('角色参数搜索框不该再挂候选列表');
  cs.value = '钟';
  cs.dispatch('input');
  const charOpts = cfbox().querySelector('[data-cfp="a"]').children.map(o => o.textContent).join(' / ');
  if (!charOpts.includes('钟离')) throw new Error('搜索「钟」后角色下拉里应只剩钟离：' + charOpts);
  if (charOpts.includes('芙宁娜')) throw new Error('搜索「钟」后角色下拉里不该还有芙宁娜：' + charOpts);
  return `角色搜索框只筛角色下拉；选角色后动作下拉按角色筛选；整页无 datalist`;
});

check('③ 条件函数下拉：单函数补上函数写法，组合函数保持算式', () => {
  const sel = dom.document.querySelector('[data-cfp="fn"]');
  if (!sel) throw new Error('找不到条件函数下拉');
  const label = (v) => {
    const o = sel.children.find(x => x.getAttribute('value') === v);
    return o ? o.textContent : '';
  };
  const t = label('t');
  if (t !== '距开战时间 —— t') throw new Error('「距开战时间」的选项名应为「距开战时间 —— t」，实际 ' + t);
  const since = label('since');
  if (since !== '距上次执行动作时间 —— since') throw new Error('since 的选项名不对：' + since);
  const cnt = label('count');
  if (cnt !== '动作执行次数 —— count') throw new Error('count 的选项名不对：' + cnt);
  const lc = label('last-check');
  if (lc !== '距上次战斗结束检查时间 —— last-check') throw new Error('last-check 的选项名不对：' + lc);
  const mn = label('min');
  if (mn !== '取最小值 —— min') throw new Error('min 的选项名不对：' + mn);
  const combo = label('combo-min-since');
  if (!combo.includes('min(since(参数1),since(参数2),…) < 参数a')) throw new Error('组合函数应保留完整算式：' + combo);
  return `${t} / ${since} / ${combo}`;
});

check('④ count 的两个时间入参：时间值 / t-（时间值）/ t-since(动作)', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '芙宁娜';
  const a = makeAction('芙宁娜', 4, { name: '芙芙e', action: 'e' });
  const b = makeAction('枫原万叶', 4, { name: '万叶e', action: 'e' });
  a.conditionText = '';
  g('state').ui.collapsed[a.id] = false;
  g('state').ui.detailsOpen[a.id + ':cond'] = true;
  g('renderActionsPanel')();
  const cfbox = () => dom.document.querySelector('[data-cfbox="cond:' + a.id + '"]');
  const pickFn = (v) => { const el = cfbox().querySelector('[data-cfp="fn"]'); el.value = v; el.dispatch('change'); };
  const setVal = (k, v, type) => { const el = cfbox().querySelector(`[data-cfp="${k}"]`); el.value = v; el.dispatch(type || 'input'); };
  const modeOf = (k) => cfbox().querySelector(`[data-cfp="${k}Mode"]`);
  const snip = () => cfbox().querySelector('[data-cfsnip]').textContent;

  pickFn('count');
  const bm = modeOf('b');
  const cm = modeOf('c');
  if (!bm || !cm) throw new Error('count 缺少两个时间入参的模式下拉');
  const modeTexts = bm.children.map(o => o.textContent);
  if (modeTexts.join('|') !== '（时间值）|t-（时间值）|t-since(动作)') throw new Error('时间入参的选项不对：' + modeTexts.join('|'));
  // ① （时间值）：数值原样填入
  setVal('bNum', '0.4');
  setVal('cNum', '2');
  if (snip() !== 'count(,0.4,2)') throw new Error('（时间值）的片段不对：' + snip());
  // ② t-（时间值）：写成 t-数值；0 或留空只写 t
  bm.value = 'tmi'; bm.dispatch('change');
  cm.value = 'tmi'; cm.dispatch('change');
  if (snip() !== 'count(,t-0.4,t-2)') throw new Error('t-（时间值）的片段不对：' + snip());
  setVal('bNum', '0');
  if (snip() !== 'count(,t,t-2)') throw new Error('数值为 0 时应只写 t：' + snip());
  setVal('bNum', '');
  if (snip() !== 'count(,t,t-2)') throw new Error('数值留空时应只写 t：' + snip());  // 模式切换只切换显示，不重建参数面板（输入框还是同一个节点）
  const numEl = cfbox().querySelector('[data-cfp="bNum"]');
  if (numEl.hidden) throw new Error('切到 t-（时间值）时数值框应可见');
  const targetRow = () => cfbox().querySelector('[data-cftime="b"]');
  if (!targetRow() || !targetRow().hidden) throw new Error('（时间值）/ t-（时间值）时不该显示目标动作选择行');
  // ③ t-since(动作)：目标动作按 index 填进 since
  bm.value = 'tsi'; bm.dispatch('change');
  if (!cfbox().querySelector('[data-cfp="bNum"]').hidden) throw new Error('切到 t-since 时数值框应隐藏');
  if (!targetRow() || targetRow().hidden) throw new Error('切到 t-since 时应显示目标动作选择行');
  const sinceBox = cfbox().querySelector('[data-cfp="bSince"]');
  if (!sinceBox) throw new Error('t-since 缺少目标动作选择器');
  const search = cfbox().querySelector('[data-cfcharq="bSince"]');
  if (!search) throw new Error('t-since 的目标动作选择器缺少角色搜索框');
  if (search.hasAttribute('list') || dom.document.querySelector('datalist')) throw new Error('角色搜索框不该再挂候选列表（datalist）');
  // 先用角色搜索框把角色筛选下拉筛成「万叶」这一项，再选它 → 动作下拉只剩万叶的动作
  // （动作下拉里已选中的动作即使被筛掉也会保留，所以这里先把当前选择清空，才能验证筛选真的生效）
  const actSel0 = cfbox().querySelector('[data-cfp="bSince"]');
  actSel0.value = '';
  actSel0.dispatch('change');
  const charSearch = cfbox().querySelector('[data-cfcharq="bSince"]');
  charSearch.value = '万叶';
  charSearch.dispatch('input');
  const roleSel = cfbox().querySelector('[data-cfchar="bSince"]');
  const wanOpt = roleSel.children.find(o => o.textContent.includes('枫原万叶'));
  if (!wanOpt) throw new Error('按「万叶」搜索后角色筛选下拉里应只剩枫原万叶：' + roleSel.children.map(o => o.textContent).join(' / '));
  if (roleSel.children.some(o => o.textContent.includes('芙宁娜'))) throw new Error('角色搜索框没有把角色筛选下拉筛干净');
  roleSel.value = wanOpt.getAttribute('value');
  roleSel.dispatch('change');
  const filtered = cfbox().querySelector('[data-cfp="bSince"]');
  if (filtered.children.some(o => String(o.value) === String(a.index))) throw new Error('选「枫原万叶」后没有把本角色的动作滤掉');
  if (!filtered.children.some(o => String(o.value) === String(b.index))) throw new Error('角色筛选把万叶的动作滤掉了');
  filtered.value = String(b.index);
  filtered.dispatch('change');
  if (snip() !== `count(,t-since(${b.index}),t-2)`) throw new Error('t-since(动作) 的片段不对：' + snip());
  // 目标动作留空 → since 里也不填
  setVal('bSince', '');
  if (snip() !== 'count(,t-since(),t-2)') throw new Error('目标动作留空时的片段不对：' + snip());
  // 真正插入到条件里，语法要能通过
  const parsed = g('condParse')(`count(${a.index},t-since(${b.index}),t-2) > 1`, []);
  if (parsed.error) throw new Error('生成的 t-since 写法解析失败：' + parsed.error);
  // 组合 2 的时间入参同步更新
  setVal('bSince', String(b.index));
  pickFn('combo-max-count');
  const bm2 = modeOf('b');
  if (!bm2 || bm2.children.length !== 3) throw new Error('组合 2 的时间入参没有同步更新');
  const n2 = cfbox().querySelector('[data-cfp="n"]');
  n2.value = '1';
  n2.dispatch('change');
  bm2.value = 'tmi'; bm2.dispatch('change');
  setVal('bNum', '0.5');
  setVal('cNum', '3');
  const arg1 = cfbox().querySelector('[data-cfp="arg1"]');
  arg1.value = String(b.index);
  arg1.dispatch('change');
  const snip2 = snip();
  // 组合 2 的默认比较是「大于」，默认数值留空 → 片段只到 max(...)
  if (snip2 !== `max(count(${b.index},t-0.5,3))`) throw new Error('组合 2 的片段不对：' + snip2 + '（b.index=' + b.index + '）');
  setVal('num', '0');
  if (snip() !== `max(count(${b.index},t-0.5,3)) > 0`) throw new Error('组合 2 填了数值后应带上比较：' + snip());
  // 组合 2 也能用 t-since(动作)
  const cm2 = modeOf('c');
  cm2.value = 'tsi'; cm2.dispatch('change');
  const sinceC = cfbox().querySelector('[data-cfp="cSince"]');
  sinceC.value = String(a.index);
  sinceC.dispatch('change');
  if (snip() !== `max(count(${b.index},t-0.5,t-since(${a.index}))) > 0`) throw new Error('组合 2 的 t-since 片段不对：' + snip() + '（a.index=' + a.index + '）');
  return '（时间值）/ t-（时间值）/ t-since(动作) 三种写法，组合 2 同步更新';
});

check('⑤ 「添加其他触发条件」上方那条冗余注释已移除', () => {
  g('setTab')('actions');
  g('state').ui.editingCharacter = '芙宁娜';
  g('renderActionsPanel')();
  const html = dom.window.$('paneActions').innerHTML;
  if (html.includes('如果你想临时停用这条动作又不想删掉它')) throw new Error('冗余注释仍在页面上');
  if (html.includes('（恒假）即可')) throw new Error('冗余注释仍在页面上');
  if (!html.includes('添加其他触发条件')) throw new Error('找不到「添加其他触发条件」区块');
  // 条件为空时的「恒真」提示、写成 false 时的「恒假」提示都还在（只删了那条冗余注释）
  const preview = dom.document.querySelector('[id^="condPreview-"]');
  if (preview && !preview.textContent.includes('恒')) throw new Error('空条件的提示不该一起被删掉');
  g('setTab')('info');
  return '已移除';
});

check('⑥ 释义里 min/max 内的动作入参也显示动作名', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '芙宁娜';
  const a = makeAction('芙宁娜', 4, { name: '芙芙e', action: 'e' });
  const b = makeAction('枫原万叶', 4, { name: '万叶e', action: 'e' });
  a.conditionText = '';
  g('state').ui.collapsed[a.id] = false;
  g('state').ui.detailsOpen[a.id + ':cond'] = true;
  g('renderActionsPanel')();
  const cfbox = () => dom.document.querySelector('[data-cfbox="cond:' + a.id + '"]');
  const pickFnIn = (val) => { const el = cfbox().querySelector('[data-cfp="fn"]'); el.value = val; el.dispatch('change'); };
  pickFnIn('min');
  const nSel = cfbox().querySelector('[data-cfp="n"]');
  nSel.value = '3';
  nSel.dispatch('change');
  const arg1 = cfbox().querySelector('[data-cfp="arg1"]');
  arg1.value = `since(${b.index})`;
  arg1.dispatch('input');
  const arg2 = cfbox().querySelector('[data-cfp="arg2"]');
  arg2.value = `since(${a.index})`;
  arg2.dispatch('input');
  const arg3 = cfbox().querySelector('[data-cfp="arg3"]');
  arg3.value = 't-15';
  arg3.dispatch('input');
  cfbox().querySelector('[data-cf="insend"]').dispatch('click');
  if (a.conditionText !== `min(since(${b.index}),since(${a.index}),t-15)`) throw new Error('插入结果不对：' + a.conditionText);
  const preview = dom.document.getElementById('condPreview-cond-' + a.id + '-');
  if (!preview) throw new Error('找不到释义区');
  const txt = preview.textContent;
  if (!txt.includes('万叶e')) throw new Error('min 里的动作入参没有显示动作名：' + txt.slice(0, 200));
  if (!txt.includes('本动作')) throw new Error('min 里引用自己的动作入参应显示「本动作」：' + txt.slice(0, 200));
  const aref = preview.querySelectorAll('.aref');
  if (!aref.length) throw new Error('释义里应渲染出带悬停提示的动作名');
  if (!aref[0].getAttribute('title').includes('万叶e')) throw new Error('悬停提示里没有动作名：' + aref[0].getAttribute('title'));
  // max 同样
  a.conditionText = '';
  g('renderActionsPanel')();
  pickFnIn('max');
  const n2 = cfbox().querySelector('[data-cfp="n"]');
  n2.value = '2';
  n2.dispatch('change');
  const m1 = cfbox().querySelector('[data-cfp="arg1"]');
  m1.value = `count(${b.index},0,3)`;
  m1.dispatch('input');
  const m2 = cfbox().querySelector('[data-cfp="arg2"]');
  m2.value = 'since';
  m2.dispatch('input');
  cfbox().querySelector('[data-cf="insend"]').dispatch('click');
  const pv2 = dom.document.getElementById('condPreview-cond-' + a.id + '-');
  if (!pv2.textContent.includes('万叶e')) throw new Error('max 里的动作入参没有显示动作名：' + pv2.textContent.slice(0, 200));
  return txt.includes('万叶e') ? 'min/max 内的动作引用都能显示动作名' : '';
});

check('⑦ 卡片标题旁显示动作指令串 + 复制给指定角色（弹窗带搜索框）', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '枫原万叶';
  const a = makeAction('枫原万叶', 4, { name: '万叶e', action: 'e' });
  a.conditionText = 'low-hp && since(1) > 2';
  g('state').ui.collapsed[a.id] = false;
  g('renderActionsPanel')();
  const sum = () => dom.document.querySelector(`[data-cardsummary="${a.id}"]`);
  if (sum().textContent !== 'e') throw new Error('卡片标题旁应显示动作指令串，实际 ' + JSON.stringify(sum().textContent));
  if (sum().textContent.includes('low-hp')) throw new Error('卡片标题旁不应再显示触发条件表达式');
  // 手输指令后即时刷新
  const cmdTa = dom.document.querySelector(`textarea[data-kind="act"][data-id="${a.id}"][data-field="action"]`);
  cmdTa.value = 'e,wait(0.3)';
  cmdTa.dispatch('input');
  if (sum().textContent !== 'e,wait(0.3)') throw new Error('指令串预览没有实时刷新：' + sum().textContent);
  // 「」基础触发条件」区块标题旁仍然是条件表达式
  if (!dom.document.getElementById('paneActions').innerHTML.includes('基础触发条件 <span class="hint prev">low-hp')) {
    throw new Error('「基础触发条件」区块标题旁的预览不该被改动');
  }
  // 复制按钮 → 弹窗（真正复制是异步的，放在文件末尾的异步检查里）
  g('app').handlers['card-dup']({ getAttribute: () => a.id }, {});
  if (!g('isModalOpen')()) throw new Error('复制按钮没有弹窗');
  const cpBody = dom.window.$('modalBody').innerHTML;
  if (!dom.window.$('cpList')) throw new Error('弹窗内容不对：' + cpBody.slice(0, 160) + ' ／ 标题=' + dom.window.$('modalTitle').innerHTML);
  if (dom.window.$('modalTitle').innerHTML !== '复制动作到') throw new Error('弹窗标题不对：' + dom.window.$('modalTitle').innerHTML);
  if (cpBody.replace(/\s/g, '').indexOf('复制一份给哪个角色') < 0) throw new Error('弹窗说明不对：' + cpBody.slice(0, 160));
  const cp = dom.window.$('cpSearch');
  if (!cp) throw new Error('复制弹窗缺少角色搜索框');
  cp.value = '芙宁娜';
  cp.dispatch('input');
  const rows = dom.window.$('cpList').children.filter(r => r.classList.contains('roleitem'));
  if (rows.length !== 1) throw new Error('搜索后应只剩一个角色，实际 ' + rows.length);
  if (!rows[0].textContent.includes('芙宁娜')) throw new Error('搜索出来的角色不对：' + rows[0].textContent);
  // 复制给本角色：弹窗里能找到「本角色（再复制一条）」那一项
  const curRow = dom.window.$('cpList').children.filter(r => r.classList.contains('roleitem'))
    .find(r => r.querySelector('[data-cppick]'));
  if (!curRow) throw new Error('复制弹窗里没有可选项');
  cp.value = '';
  cp.dispatch('input');
  const selfRow = dom.window.$('cpList').children.filter(r => r.classList.contains('roleitem'))
    .find(r => r.querySelector('[data-cppick]').getAttribute('data-cppick') === '枫原万叶');
  if (!selfRow) throw new Error('复制弹窗里应有「本角色」这一项');
  if (!selfRow.textContent.includes('本角色（再复制一条）')) throw new Error('本角色的那一项文案不对：' + selfRow.textContent);
  g('closeModal')(null);
  // 昵称不猜：名称里没有源角色标准名时保持原名（只替换标准名）
  makeAction('枫原万叶', 9, { name: '奶奶开盾', action: 'e' });
  if (g('renameForCharacter')('奶奶开盾', '枫原万叶', '芙宁娜') !== '奶奶开盾') throw new Error('名称里没有标准名时不应改动');
  if (g('renameForCharacter')('万叶e', '枫原万叶', '芙宁娜') !== '万叶e') throw new Error('昵称（万叶）不应被当成标准名替换');
  if (g('renameForCharacter')('枫原万叶e', '枫原万叶', '芙宁娜') !== '芙宁娜e') throw new Error('标准名没有替换');
  if (g('renameForCharacter')('枫原万叶-e', '枫原万叶', '芙宁娜') !== '芙宁娜-e') throw new Error('标准名替换（带后缀）不对');
  return `标题旁显示指令串「${sum().textContent}」；复制弹窗可按角色搜索（搜「芙宁娜」只剩 1 项）`;
});

check('⑧ 最后一次编辑的内容（草稿往返）：界面上还没进模型的编辑也会落盘', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '芙宁娜';
  g('state').strategy.info.name = '草稿往返测试';
  g('state').strategy.info.version = 'v1';
  const a = makeAction('芙宁娜', 4, { name: '芙芙e', action: 'e' });
  a.conditionText = 'false';
  a.morePriorities.push({ id: g('newId')(), text: '', priority: 43120, cmp: 'after', scope: { type: 4, element: '', character: '' }, manualPriority: false });
  g('state').ui.collapsed[a.id] = false;
  g('state').ui.detailsOpen[a.id + ':more'] = true;
  g('renderActionsPanel')();
  const ta = dom.document.querySelector(`textarea[data-cond-ref="more:${a.id}:0"]`);
  if (!ta) throw new Error('找不到其他触发条件的触发条件输入框');
  if (ta.value !== '') throw new Error('新建条目的输入框应该是空的：' + JSON.stringify(ta.value));
  // 只改 DOM、不派发 input 事件：模拟「最后一次编辑还卡在输入法组字里 / 事件还没到」
  ta.value = 'count(93111,t-0.4,t) > 1 && since > 1';
  g('saveDraftNow')();
  if (a.morePriorities[0].text !== 'count(93111,t-0.4,t) > 1 && since > 1') throw new Error('落盘时没有把界面上的最后一次编辑写回模型：' + a.morePriorities[0].text);
  if (a.conditionText !== 'false') throw new Error('主条件被其他触发条件的文本覆盖了：' + JSON.stringify(a.conditionText));
  // 只改 DOM、再重建别的面板（DOM 里的内容比模型新）：落盘仍要以界面上的内容为准
  g('renderInfoPanel')();
  const taStale = dom.document.querySelector(`textarea[data-cond-ref="more:${a.id}:0"]`);
  taStale.value = 'count(93111,t-0.4,t) > 1 && since > 1 && low-hp';
  g('saveDraftNow')();
  if (a.morePriorities[0].text !== 'count(93111,t-0.4,t) > 1 && since > 1 && low-hp') throw new Error('重建别的面板后落盘没有以界面内容为准：' + a.morePriorities[0].text);
  if (a.conditionText !== 'false') throw new Error('重建别的面板后主条件被覆盖了：' + JSON.stringify(a.conditionText));
  // 关键的防回退：写回模型之后，界面上那个输入框也必须跟着更新成模型里的内容（就是这次编辑）
  if (taStale.value !== 'count(93111,t-0.4,t) > 1 && since > 1 && low-hp') {
    throw new Error('写回模型后界面上的旧值没有被同步（下一次写回会拿旧值覆盖模型）：' + JSON.stringify(taStale.value));
  }
  // 再落一次盘（这次界面与模型一致，不能再把内容写回去或写丢）
  g('saveDraftNow')();
  if (a.morePriorities[0].text !== 'count(93111,t-0.4,t) > 1 && since > 1 && low-hp') throw new Error('重复落盘后内容变了：' + a.morePriorities[0].text);

  // 从草稿重新启动：内容必须一字不差（主条件也还在）
  const fresh = bootFresh(dom.localStorage);
  const fa = fresh.g('state').strategy.actions.find(x => x.name === '芙芙e');
  if (!fa) throw new Error('草稿重载后找不到动作：' + fresh.g('state').strategy.actions.map(x => x.name).join(','));
  if (fa.morePriorities.length !== 1) throw new Error('草稿重载后其他触发条件数量不对：' + fa.morePriorities.length);
  if (fa.morePriorities[0].text !== 'count(93111,t-0.4,t) > 1 && since > 1 && low-hp') {
    throw new Error('草稿重载后最后一次编辑丢了：' + JSON.stringify(fa.morePriorities[0].text));
  }
  if (fa.conditionText !== 'false') throw new Error('草稿重载后主条件不对：' + JSON.stringify(fa.conditionText));
  const fta = fresh.dom.document.querySelector(`textarea[data-cond-ref="more:${fa.id}:0"]`);
  if (fta && fta.value !== 'count(93111,t-0.4,t) > 1 && since > 1 && low-hp') throw new Error('重载后输入框显示的内容不对：' + JSON.stringify(fta.value));

  // 切页也会先把界面上的编辑写回模型
  const ta2 = dom.document.querySelector(`textarea[data-cond-ref="more:${a.id}:0"]`);
  ta2.value = 'count(93111,t-0.4,t) > 1 && since > 1 && low-hp && q-ready';
  g('setTab')('info');
  if (a.morePriorities[0].text !== 'count(93111,t-0.4,t) > 1 && since > 1 && low-hp && q-ready') throw new Error('切页时没有把界面上的编辑写回模型：' + a.morePriorities[0].text);
  if (a.conditionText !== 'false') throw new Error('切页把主条件弄丢了：' + JSON.stringify(a.conditionText));
  g('setTab')('actions');
  return 'saveDraftNow / 切页都会先取界面内容；草稿重载后主条件与其他触发条件都完整';
});

/* ---------- 本次改动的回归（编号对应本次需求清单） ---------- */

check('本次④：「当前角色 + 动作类型 0」只写触发条件不写指令时，不再警告指令串为空', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '';
  const m = makeAction('', 0, { name: '检查战斗结束', action: '' });
  const other = makeAction('', 1, { name: '当前角色开盾', action: '' });
  m.conditionText = 'battle-time(20)';
  g('state').ui.collapsed[m.id] = false;
  g('state').ui.detailsOpen[m.id + ':cmd'] = true;
  g('renderActionsPanel')();
  const warnsOf = (id) => (g('validateStrategy')().warnings || []).filter(w => w.actionId === id).map(w => w.text);
  // 有触发条件 → 不提示指令串为空
  if (warnsOf(m.id).some(t => t.includes('指令串为空'))) throw new Error('类型 0 只写条件时不该再警告指令串为空：' + warnsOf(m.id).join('；'));
  // 同一张卡片的就地反馈也不能出现这条
  const check0 = dom.document.querySelector(`[data-cmdcheck="act:${m.id}"]`);
  if (!check0) throw new Error('找不到动作指令的就地反馈区');
  if (check0.innerHTML.includes('指令串为空')) throw new Error('就地反馈里不该出现「指令串为空」');
  // 指令串与触发条件同时为空 → 仍然警告
  m.conditionText = '';
  g('renderActionsPanel')();
  if (!warnsOf(m.id).some(t => t.includes('指令串为空'))) throw new Error('指令串与触发条件同时为空时应仍然警告');
  if (!dom.document.querySelector(`[data-cmdcheck="act:${m.id}"]`).innerHTML.includes('指令串为空')) throw new Error('两处都为空时就地反馈应给出警告');
  // 写回条件后，手输一次指令空串 → 警告消失（就地反馈实时刷新）
  m.conditionText = 'battle-time(20)';
  g('renderActionsPanel')();
  const ta = dom.document.querySelector(`textarea[data-kind="act"][data-id="${m.id}"][data-field="action"]`);
  ta.focus();
  ta.value = '';
  ta.dispatch('input', { target: ta });
  if (dom.document.querySelector(`[data-cmdcheck="act:${m.id}"]`).innerHTML.includes('指令串为空')) throw new Error('改回“只写条件”后就地反馈不该再警告');
  // 其他动作（非类型 0）的空指令警告保持不变
  if (!warnsOf(other.id).some(t => t.includes('指令串为空'))) throw new Error('普通动作的空指令警告必须保持');
  return '类型 0 + 当前角色：两处同时为空才警告；其他动作不受影响';
});

check('本次⑤：卡片标题栏的动作指令超长截断（不再顶出第三行）', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '枫原万叶';
  const long = 'attack,' + Array.from({ length: 30 }, (_, i) => 'wait(0.1)').join(',') + ',e';
  const a = makeAction('枫原万叶', 4, { name: '万叶e', action: long });
  g('state').ui.collapsed[a.id] = false;
  g('renderActionsPanel')();
  const sum = dom.document.querySelector(`[data-cardsummary="${a.id}"]`);
  if (!sum) throw new Error('找不到卡片标题栏的指令摘要');
  // 截断靠样式实现：现在有专门的 class，并且悬停提示里能看到完整指令
  if (!sum.classList.contains('cardsummary')) throw new Error('指令摘要缺少 cardsummary 类（截断样式靠它生效）');
  const title = sum.getAttribute('title') || '';
  if (!title.includes(long)) throw new Error('悬停提示里应能看到完整指令串');
  const css = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  const rule = (css.match(/\.actioncard \.hd\{[^}]*\}/) || [''])[0];
  if (!rule.includes('flex-wrap:nowrap')) throw new Error('卡片标题栏应改成不换行（否则长指令会把按钮顶到第三行）：' + rule);
  if (!/\.actioncard \.hd \.cardsummary\{[^}]*text-overflow:ellipsis/.test(css)) throw new Error('指令摘要应带省略号截断');
  if (sum.textContent !== long) throw new Error('摘要文本本身不该被改动（只由 CSS 截断显示）');
  return `${long.length} 字符的指令串：标题栏不换行 + 省略号截断，悬停可看全文`;
});

check('本次⑥：三处文案更新（编号规则 / 触发条件注释 / 其他触发条件空提示）', () => {
  const ui = fs.readFileSync(path.join(root, 'src', 'js', 'ui_actions.js'), 'utf8');
  const info = fs.readFileSync(path.join(root, 'src', 'js', 'ui_info.js'), 'utf8');
  const BASE = '“高血量，所需前置动作未执行，动作可能从未释放过”的基础条件假定';
  // ① 信息页「关于编号规则」的动作类型段落末尾补一句
  if (!info.includes('为以上动作类型分配的数字，是根据' + BASE + '下的动作优先程度决定的。')) throw new Error('「关于编号规则」缺少新增的说明句');
  // ② 触发条件注释：去掉旧括注、补上新句
  //   （基础条件的注释现在是 renderCondEditor 的 o.note 默认值，其他触发条件会传自己的 note；
  //     两段文案各自的命中情况由这一组静态检查 + D 系列的行为检查一起覆盖）
  if (ui.includes('（可直接手输，也可以用下面的「快捷添加条件」拼）')) throw new Error('触发条件注释里的旧括注应已移除');
  if (!ui.includes('const note = o.note ||')) throw new Error('基础条件的注释没有改成可覆盖的默认 note');
  if (!ui.includes("${o.title || '触发条件表达式'}：这里写入的条件应遵守")) throw new Error('基础条件的默认注释文案不对');
  //   「其他触发条件」条目里的说明必须是这一版专用文案，且不能影响基础条件的注释
  if (!ui.includes('这里用于写入不符合基础条件假定的条件，例如用于判断“低血量”或“需要前置动作已执行”的动作，配合上方判定顺序选择可实现优先或延后此条件判定的效果')) {
    throw new Error('「其他触发条件」的说明文案不对');
  }
  {
    const cnt = ui.split('用于对其他状况做判定的条件应该写入').length - 1;
    if (cnt !== 1) throw new Error('「其他触发条件」的说明不应沿用基础条件那句（出现 ' + cnt + ' 次）');
  }
  // ③ 其他触发条件的空提示
  if (ui.includes('还没有其他触发条件。常见用法：低血时把这个动作提到最前面')) throw new Error('其他触发条件的旧空提示应已替换');
  if (!ui.includes('还没有其他触发条件。请将不符合基础条件假定的判定条件，例如“低血量”或“有前置辅助动作执行”的条件添加在这里，这样就能为这些情况设置不同的判定优先级，以实现类似于“低血时该动作优先执行”的效果')) {
    throw new Error('其他触发条件的空提示文案不对');
  }
  // 页面里也要真的渲染出来（信息页 + 动作卡片）
  g('state').ui.editingCharacter = '枫原万叶';
  g('state').strategy.actions = [makeAction('枫原万叶', 4, { name: '万叶e', action: 'e' })];
  g('state').ui.collapsed[g('state').strategy.actions[0].id] = false;
  g('state').ui.detailsOpen[g('state').strategy.actions[0].id + ':more'] = true;
  g('renderActionsPanel')();
  const textOf = (id) => { const p = dom.document.getElementById(id); return p && p.innerHTML ? p.innerHTML : ''; };
  const rawText = (id) => { const p = dom.document.getElementById(id); return p && p.textContent ? p.textContent : ''; };
  const want = '为以上动作类型分配的数字，是根据';
  if (!textOf('paneInfo').includes(want) || !rawText('paneInfo').includes(want)) {
    const t = rawText('paneInfo');
    const h = textOf('paneInfo');
    throw new Error('信息页没有渲染新增的说明句；\n【文本长度】=' + t.length +
      '\n【文本最后 120 字】=' + JSON.stringify(t.slice(-120)) +
      '\n【HTML 长度】=' + h.length + '\n【HTML 最后 200 字】=' + JSON.stringify(h.slice(-200)));
  }
  const pane = dom.document.getElementById('paneActions').innerHTML;
  if (!pane.includes('还没有其他触发条件。请将不符合基础条件假定的判定条件')) throw new Error('动作卡片里没有渲染新的空提示');
  return '新增说明句已渲染；旧括注与旧空提示都已替换';
});

check('本次③：含动作入参的片段插入后，不弹「尾数已被占用」，其他动作的优先于/次于选择也不丢', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '';
  const a = makeAction('', 4, { name: '当前角色e', action: 'e' });
  const b = makeAction('枫原万叶', 4, { name: '万叶e', action: 'e' });
  const c = makeAction('', 4, { name: '当前角色e2', action: 'e' });
  a.conditionText = '';
  b.conditionText = '';
  c.conditionText = '';
  // 其他动作的「其他触发条件」选择（用来观察是否会被插桩流程弄丢）
  b.morePriorities = [{ id: 'mpb', text: 'low-hp', priority: 44000, cmp: 'before', scope: { type: 4, element: 5, character: '枫原万叶' }, manualPriority: false }];
  c.morePriorities = [{ id: 'mpc', text: 'q-ready', priority: 20000, cmp: 'after', scope: { type: 1, element: '', character: '' }, manualPriority: false }];
  const snapshot = () => JSON.stringify({
    b: b.morePriorities.map(m => [m.text, m.priority, m.cmp, m.scope]),
    c: c.morePriorities.map(m => [m.text, m.priority, m.cmp, m.scope]),
    // 按名字排序：刷新时 actions 会按 index 重排，这里只关心「每条动作的尾数/编号有没有被改动」
    slots: g('state').strategy.actions.map(x => [x.name, x.slot, x.index]).sort((p, q) => (p[0] < q[0] ? -1 : 1)),
  });
  const before = snapshot();
  const alertFrom = alertLog.length;
  const alerts = () => alertsSince(alertFrom);
  try {
    g('state').ui.collapsed[a.id] = false;
    g('state').ui.detailsOpen[a.id + ':cond'] = true;
    g('state').ui.detailsOpen[a.id + ':moreadd'] = true;
    g('renderActionsPanel')();
    const cfbox = () => dom.document.querySelector('[data-cfbox="cond:' + a.id + '"]');
    const fnEl = cfbox().querySelector('[data-cfp="fn"]');
    fnEl.value = 'since';
    fnEl.dispatch('change');
    // 用角色搜索框把角色筛选下拉筛成「枫原万叶」，再选它
    const sbox = cfbox().querySelector('[data-cfcharq="a"]');
    sbox.value = '万叶';
    sbox.dispatch('input');
    const roleSel = cfbox().querySelector('[data-cfchar="a"]');
    const wan = roleSel.children.find(o => o.textContent.includes('枫原万叶'));
    roleSel.value = wan.getAttribute('value');
    roleSel.dispatch('change');
    // 选目标动作（万叶的动作）→ 插到末尾
    const actSel = cfbox().querySelector('[data-cfp="a"]');
    actSel.value = String(b.index);
    actSel.dispatch('change');
    cfbox().querySelector('[data-cf="insend"]').dispatch('click');
    if (a.conditionText !== `since(${b.index})`) throw new Error('含动作入参的片段没有正确插入：' + JSON.stringify(a.conditionText));
    // 「添加其他触发条件」表单里再走一遍：先加一条空条目，再在条目里用快捷添加条件插入含动作入参的片段
    const form = dom.document.querySelector(`[data-moreaddform="${a.id}"]`);
    const typeSel = form.querySelector('[data-na="type"]');
    typeSel.value = '4';
    form.dispatch('change', { target: typeSel });
    const addBtn = dom.document.querySelectorAll('[data-act="more-add2"]').find(x => x.getAttribute('data-id') === a.id);
    g('app').handlers['more-add2'](addBtn, {});
    const mpIdx = a.morePriorities.length - 1;
    if (!a.morePriorities[mpIdx] || a.morePriorities[mpIdx].text !== '') throw new Error('新条目应当是空条件');
    g('state').ui.detailsOpen[`${a.id}:more:${mpIdx}`] = true;
    g('renderActionsPanel')();
    const cfbox2 = () => dom.document.querySelector('[data-cfbox="more:' + a.id + ':' + mpIdx + '"]');
    const fn2 = cfbox2().querySelector('[data-cfp="fn"]');
    fn2.value = 'since';
    fn2.dispatch('change');
    const sbox2 = cfbox2().querySelector('[data-cfcharq="a"]');
    sbox2.value = '万叶';
    sbox2.dispatch('input');
    const roleSel2 = cfbox2().querySelector('[data-cfchar="a"]');
    roleSel2.value = roleSel2.children.find(o => o.textContent.includes('枫原万叶')).getAttribute('value');
    roleSel2.dispatch('change');
    const actSel2 = cfbox2().querySelector('[data-cfp="a"]');
    actSel2.value = String(b.index);
    actSel2.dispatch('change');
    cfbox2().querySelector('[data-cf="insend"]').dispatch('click');
  } catch (e) {
    throw e;
  }
  const aAlerts = alerts();
  if (aAlerts.length) throw new Error('插桩流程里弹出了对话框：' + aAlerts.join(' ／ '));
  const after = snapshot();
  if (after !== before) throw new Error('插桩流程改动了其他内容：\n前：' + before + '\n后：' + after);
  const act = g('state').strategy.actions.find(x => x.id === a.id);
  if (act.morePriorities.length !== 1) throw new Error('其他触发条件条数不该变化：' + JSON.stringify(act.morePriorities.map(m => m.text)));
  if (!String(act.morePriorities[0].text).includes(`since(${b.index})`)) throw new Error('没有把含动作入参的片段写进条目：' + JSON.stringify(act.morePriorities));
  return '两次插入都没弹窗；其他动作的 morePriorities 与全部动作的尾数一字未变';
});

check('本次③b：重建面板不会把「尾数」下拉的意外变化当成用户操作（尾数冲突提示的来源）', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '';
  const a = makeAction('', 4, { name: '当前角色e', action: 'e' });
  const b = makeAction('', 4, { name: '当前角色e2', action: 'e' });
  const c = makeAction('', 4, { name: '当前角色e3', action: 'e' });
  const slots = () => g('state').strategy.actions.map(x => x.slot).join(',');
  if (slots() !== '1,2,3') throw new Error('初始尾数不对：' + slots());
  g('state').ui.collapsed[a.id] = false;
  g('state').ui.collapsed[b.id] = false;
  g('state').ui.collapsed[c.id] = false;
  g('renderActionsPanel')();
  // 从卡片内部取下拉：面板重建后文档里可能还留着旧的（已脱离）节点，按 data-id 直接查会拿到它
  const slotSel = (id) => {
    const card = dom.document.querySelector(`[data-card="${id}"]`);
    return card && card.querySelector('select[data-field="slot"]');
  };
  if (!slotSel(a.id) || !slotSel(b.id) || !slotSel(c.id)) throw new Error('找不到尾数下拉');
  const alertFrom = alertLog.length;
  const alerts = () => alertsSince(alertFrom);
  // 模拟「面板重建 / 浏览器把下拉的值挪了位置」：DOM 里变成 1，但这次变化没有事件、也不是用户操作
  const sB = slotSel(b.id);
  sB.value = '1';
  // 紧接着因为别的操作触发一次重建
  g('rerenderCurrent')(true);
  if (alerts().length) throw new Error('重建面板弹出了对话框：' + alerts().join(' ／ '));
  if (slots() !== '1,2,3') throw new Error('重建面板不该改动尾数：' + slots());
  // 重建后下拉要显示回模型里的值
  if (String(slotSel(b.id).value) !== '2') throw new Error('重建后尾数下拉应显示模型里的 2，实际 ' + slotSel(b.id).value);
  // 用户真的改尾数时照常生效（先腾出空位，再逐个挪）
  const pick = (id, v) => {
    const el = slotSel(id);
    if (!el) throw new Error('找不到 ' + id + ' 的尾数下拉');
    el.value = String(v);
    el.dispatch('change', { target: el });
  };
  pick(c.id, 5);
  if (slots() !== '1,2,5') throw new Error('把第 3 条挪到空位 5 应成功：' + slots());
  pick(b.id, 3);
  if (slots() !== '1,3,5') throw new Error('空位 3 应能挪进去：' + slots());
  pick(a.id, 2);
  if (slots() !== '2,3,5') throw new Error('空位 2 应能挪进去：' + slots());
  // 真的撞车时仍然提示，并且界面回退到模型里的值；同一次改动只提示一次
  const clashFrom = alertLog.length;
  pick(b.id, 2);
  if (slots() !== '2,3,5') throw new Error('撞车时不该改动尾数：' + slots());
  const hits = alertsSince(clashFrom).filter(m => m.includes('尾数 2 已被同角色同类型的另一条动作占用'));
  if (hits.length !== 1) throw new Error('撞车应正好提示一次，实际 ' + hits.length + ' 次：' + alertsSince(clashFrom).join(' ／ '));
  if (String(slotSel(b.id).value) !== '3') throw new Error('撞车后下拉应回退成模型里的 3，实际 ' + slotSel(b.id).value);
  return '意外的下拉变化被忽略；用户改尾数照常生效；撞车只提示一次并回退';
});

/* ================= 本期（ensureCast 实时校验 / 命座要求 / 预设 / 队伍） ================= */

check('D①：勾选 / 取消「确保E技能释放成功」、补上 e 指令后，警告立刻出现与消失', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '';
  const a = makeAction('', 4, { name: '当前角色a', action: 'attack' });
  g('state').ui.collapsed[a.id] = false;
  g('renderActionsPanel')();
  const warnCount = () => g('state').lastIssues.warnings.filter(w => /确保E技能/.test(w.text)).length;
  if (warnCount() !== 0) throw new Error('没勾选时不该有这个警告');
  const box = () => dom.document.querySelector(`input[type="checkbox"][data-id="${a.id}"][data-field="ensureCast"]`);
  const el = box();
  if (!el) throw new Error('找不到「确保E技能释放成功」勾选框');
  el.checked = true;
  el.dispatch('change', {});
  if (!a.ensureCast) throw new Error('勾选没有写进模型');
  if (warnCount() !== 1) throw new Error('勾选后警告应当立刻出现（不必等重建面板）：' + JSON.stringify(g('state').lastIssues.warnings.map(w => w.text)));
  if (!$('side').innerHTML.includes('确保E技能释放成功')) throw new Error('右侧校验面板没有同步出现警告');
  if (!dom.document.querySelector(`[data-cardbadges="${a.id}"]`).innerHTML.includes('badge warn')) throw new Error('卡片角标没有同步');
  // 在动作指令里补一个 e → 警告立刻消失
  const ta = dom.document.querySelector(`textarea[data-kind="act"][data-id="${a.id}"][data-field="action"]`);
  ta.value = 'attack,e';
  ta.dispatch('input');
  if (warnCount() !== 0) throw new Error('补上 e 指令后警告应当立刻消失：' + JSON.stringify(g('state').lastIssues.warnings.map(w => w.text)));
  // 再取消勾选 → 也立刻消失（这次先把 e 去掉，保证警告本身是「该出现」的状态）
  ta.value = 'attack';
  ta.dispatch('input');
  if (warnCount() !== 1) throw new Error('去掉 e 指令后警告应当回来');
  box().checked = false;
  box().dispatch('change', {});
  if (a.ensureCast) throw new Error('取消勾选没有写进模型');
  if (warnCount() !== 0) throw new Error('取消勾选后警告应当立刻消失');
  // 开盾动作自动勾选 ensureCast 时，同样要立刻反映到校验面板
  g('state').strategy.actions = [];
  g('renderActionsPanel')();
  const shield = makeAction('钟离', 1, { name: '钟离开盾', action: 'attack' });
  if (!shield.ensureCast) throw new Error('开盾类型应默认勾选 ensureCast');
  g('refreshLiveIssues')();
  if (g('state').lastIssues.warnings.filter(w => /确保E技能/.test(w.text)).length !== 1) throw new Error('新建开盾动作后应立刻出现该警告');
  return '勾选 / 取消勾选 / 补 e 指令三种操作都即时刷新了警告';
});

check('D②：「新建（含兜底动作）」预置 3 条动作（兜底战斗检查 → 角色红血标记 → 等待）', () => {
  g('newStrategy')('preset');
  const list = g('state').strategy.actions;
  if (list.length !== 3) throw new Error('应当正好 3 条动作，实际 ' + list.length + '：' + list.map(a => a.name).join('，'));
  const byName = (n) => list.find(a => a.name === n);
  const chk = byName('兜底战斗检查');
  const mark = byName('角色红血标记');
  const wait = byName('等待');
  if (!chk || !mark || !wait) throw new Error('动作名不对：' + list.map(a => a.name).join('，'));
  const idxOrder = list.map(a => a.index);
  if (!(idxOrder[0] < idxOrder[1] && idxOrder[1] < idxOrder[2])) throw new Error('动作顺序应为 兜底战斗检查 → 角色红血标记 → 等待：' + idxOrder.join(','));
  if (chk.type !== 0 || chk.character !== '') throw new Error('兜底战斗检查应为「当前角色 + 类型 0」');
  if (chk.action !== 'check') throw new Error('兜底战斗检查的指令不对：' + chk.action);
  if (chk.conditionText !== 't > 10 && last-check > 4 && (! (last-check > t - 9) || count < 1)') throw new Error('兜底战斗检查的条件不对：' + chk.conditionText);
  if ((chk.morePriorities || []).length || chk.tags) throw new Error('兜底战斗检查不该有其他触发条件或注释');
  if (mark.type !== 0 || mark.character !== '') throw new Error('角色红血标记应为「当前角色 + 类型 0」');
  if (mark.action !== '') throw new Error('角色红血标记不该有指令：' + mark.action);
  if (mark.conditionText !== 'low-hp && since > 4') throw new Error('角色红血标记的条件不对：' + mark.conditionText);
  if ((mark.morePriorities || []).length || mark.tags) throw new Error('角色红血标记不该有其他触发条件或注释');
  if (wait.type !== 9 || wait.action !== 'wait(0.2)') throw new Error('等待动作不对：' + wait.type + '/' + wait.action);
  const v = g('validateStrategy')();
  if (v.errors.length) throw new Error('预设策略不该有错误：' + v.errors.map(x => x.text).join('；'));
  // 按钮文案与顺序
  g('setTab')('info');
  const html = $('paneInfo').innerHTML;
  if (!html.includes('新建（含兜底动作）')) throw new Error('按钮没有改名成「新建（含兜底动作）」');
  if (!html.includes('新建空白策略（不建议）')) throw new Error('按钮没有改名成「新建空白策略（不建议）」');
  if (html.indexOf('新建（含兜底动作）') > html.indexOf('新建空白策略（不建议）')) throw new Error('「新建（含兜底动作）」应排在「新建空白策略（不建议）」前面');
  g('newStrategy')('blank');
  if (g('state').strategy.actions.length !== 0) throw new Error('空白策略不该有动作');
  return list.map(a => `${a.name}(${a.index})`).join(' → ');
});

check('D②b：命座要求移到「队友与命座条件」下，勾选框与说明文字已修正', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '芙宁娜';
  const a = makeAction('芙宁娜', 4, { name: '芙芙e', action: 'e' });
  a.consMode = 'open'; a.consTarget = 3; a.consEnabled = true;
  g('state').ui.collapsed[a.id] = false;
  g('state').ui.detailsOpen[`${a.id}:cond`] = true;
  g('state').ui.detailsOpen[`${a.id}:team`] = true;
  g('state').ui.detailsOpen[`${a.id}:cons`] = true;
  g('renderActionsPanel')();
  const html = $('paneActions').innerHTML;
  if (!html.includes('基础触发条件')) throw new Error('「触发条件」应改名为「基础触发条件」');
  if (!html.includes('队友与命座条件')) throw new Error('「队友条件」应改名为「队友与命座条件」');
  const at = (key) => html.indexOf(`data-details="${a.id}:${key}"`);
  if (!(at('cond') >= 0 && at('team') > at('cond') && at('cons') > at('team'))) {
    throw new Error('命座要求应排在「基础触发条件」之后的「队友与命座条件」区块里');
  }
  if (html.includes('（勾选 = 启用，不勾选 = 停用）')) throw new Error('勾选框后的错误括号说明仍然存在');
  if (html.includes('「达到命座开启 + 勾选」')) throw new Error('错误的四种组合说明仍然存在');
  if (!html.includes('视作角色已达到 x 命')) throw new Error('勾选框的新说明缺失');
  if (!html.includes('按达到3命设置动作启用/停用</label>')) throw new Error('勾选框文字应只保留「按达到x命设置动作启用/停用」');
  return '已移动并改名；错误括号与四种组合说明已删除';
});

check('D②c：米提亚词条（雷元素、瓦列里后面）与动作类型简写', () => {
  const av = g('getAvatar')('米提亚');
  if (!av) throw new Error('角色表里缺少「米提亚」');
  if (av.code !== 4 || av.seq !== 21) throw new Error('米提亚应为雷元素（code=4）、瓦列里后面的编号 21，实际 ' + av.code + '/' + av.seq);
  if (av.id !== '10000136') throw new Error('米提亚的 id 不对：' + av.id);
  if (av.elementName !== '雷元素') throw new Error('米提亚的元素不对：' + av.elementName);
  if (g('avatarCodeLabel')(av) !== '421') throw new Error('米提亚的编辑器编号应为 421，实际 ' + g('avatarCodeLabel')(av));
  const types = g('ACTION_TYPES');
  const t2 = types.find(t => t.code === 2);
  const t7 = types.find(t => t.code === 7);
  const t8 = types.find(t => t.code === 8);
  if (t2.name !== '先手') throw new Error('类型 2 的全称应改为「先手」：' + t2.name);
  if (t7.short !== '低收益') throw new Error('类型 7 的简写应为「低收益」：' + t7.short);
  if (t8.short !== '元素普攻') throw new Error('类型 8 的简写应为「元素普攻」：' + t8.short);
  return `米提亚 ${g('avatarCodeLabel')(av)} / ${t2.name} / ${t7.short} / ${t8.short}`;
});

check('D③：命座要求的三元组与 consRequirement、expression 的组成 / 拆分往返', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '芙宁娜';
  makeAction('芙宁娜', 4, { name: '芙芙e', action: 'e' });
  // 每次都按名字取当前策略里的实例，避免拿到被别处换掉的旧对象
  const live = () => g('state').strategy.actions.find(x => x.name === '芙芙e');
  live().conditionText = 'low-hp';
  // 无命座要求：expression 组成方式维持原样
  if (g('buildExpression')(live(), g('state').strategy.actions) !== 'low-hp') throw new Error('无命座要求时表达式不该变');
  const cons = (mode, target, enabled) => {
    const a = live();
    a.consMode = mode; a.consTarget = target; a.consEnabled = enabled;
    return g('buildExpression')(a, g('state').strategy.actions);
  };
  if (cons('open', 3, true) !== '(low-hp) && (true)') throw new Error('达到命座开启 + 勾选 应为 true：' + cons('open', 3, true));
  if (cons('open', 3, false) !== '(low-hp) && (false)') throw new Error('达到命座开启 + 不勾选 应为 false');
  if (cons('close', 3, true) !== '(low-hp) && (false)') throw new Error('达到命座关闭 + 勾选 应为 false（x 命及以上不执行）');
  if (cons('close', 3, false) !== '(low-hp) && (true)') throw new Error('达到命座关闭 + 不勾选 应为 true');
  // consRequirement 的**符号**表示模式（正 = 达到命座开启、负 = 达到命座关闭），与勾选状态无关；
  // 「启用 / 停用」由 expression 里那个布尔值表达，两者合起来才能唯一确定界面上的三元组。
  if (g('consRequirementOf')(live()) !== -3) throw new Error('关闭 + 不勾选（模式是关闭）应当存成 -3，实际 ' + g('consRequirementOf')(live()));
  live().teammates.include = ['枫原万叶'];
  live().teammates.includeOps = [];
  if (g('buildExpression')(live(), g('state').strategy.actions) !== '((low-hp) && (true)) && (in-party(枫原万叶))') {
    throw new Error('有命座要求 + 有队友条件时的组成方式不对：' + g('buildExpression')(live(), g('state').strategy.actions));
  }
  // 导出 → 回读：四种「模式 + 勾选」组合都要**逐字还原**
  //（「开启 + 不勾选」与「关闭 + 勾选」的语义相同、数值也相同，必须靠 expression 里那个布尔值区分）
  const combos = [['open', 3, true], ['open', 3, false], ['close', 3, true], ['close', 3, false]];
  for (const [mode, target, enabled] of combos) {
    live().consMode = mode; live().consTarget = target; live().consEnabled = enabled;
    const wantSign = mode === 'close' ? -target : target;
    const jsonN = g('buildJson')();
    const nodeN = jsonN.actions.find(x => x.name === '芙芙e');
    if (nodeN.consRequirement !== wantSign) throw new Error(`${mode}/${target}/${enabled} 应写 consRequirement=${wantSign}，实际 ${JSON.stringify(nodeN.consRequirement)}`);
    const resN = g('analyzeImport')(JSON.parse(JSON.stringify(jsonN)));
    if (resN.fatal.length) throw new Error('回读失败：' + resN.fatal.join('；'));
    const backN = resN.actions.find(x => x.name === '芙芙e');
    const got = [backN.consMode, backN.consTarget, !!backN.consEnabled];
    if (got[0] !== mode || got[1] !== target || got[2] !== enabled) {
      throw new Error(`命座要求没有原样还原：${mode}/${target}/${enabled} → ${JSON.stringify(got)}（consRequirement=${wantSign}，expression=${JSON.stringify(nodeN.condition.expression)}）`);
    }
    if (g('buildExpression')(backN, [backN]) !== g('buildExpression')(live(), g('state').strategy.actions)) {
      throw new Error(`命座要求回读后表达式变了：${mode}/${target}/${enabled}`);
    }
  }
  // 回读（并应用）之后，再导出的 JSON 必须与原来逐字一致
  live().consMode = 'close'; live().consTarget = 4; live().consEnabled = true;
  const json2 = g('buildJson')();
  if (json2.actions.find(x => x.name === '芙芙e').consRequirement !== -4) throw new Error('关闭 + 勾选 应写 -4');
  const res2 = g('analyzeImport')(JSON.parse(JSON.stringify(json2)));
  const back2 = res2.actions.find(x => x.name === '芙芙e');
  if (back2.consMode !== 'close' || back2.consTarget !== 4 || back2.consEnabled !== true) throw new Error('关闭 + 勾选 回读不对：' + JSON.stringify([back2.consMode, back2.consTarget, back2.consEnabled]));
  g('applyImport')(res2);
  const json2b = g('buildJson')();
  if (JSON.stringify(json2b) !== JSON.stringify(json2)) throw new Error('命座要求往返两次的 JSON 不一致：\n  ' + JSON.stringify(json2) + '\n  ' + JSON.stringify(json2b));
  // 这条动作还带着队友条件（必要队友 枫原万叶 + 自动排除），expression 应当是
  // 「((触发条件) && (命座要求 false)) && (队友条件…)」——命座要求那一段在队友条件前面。
  const expr2 = g('buildExpression')(back2, g('state').strategy.actions);
  if (!expr2.startsWith('((low-hp) && (false)) && ')) throw new Error('回读后的命座要求段落位置不对：' + expr2);
  if (!expr2.includes('in-party(枫原万叶)')) throw new Error('回读后的队友条件丢了：' + expr2);
  // 无命座要求时不写这个字段
  const a2 = makeAction('芙宁娜', 4, { name: '芙芙q', action: 'q,wait(0.1),ready' });
  a2.conditionText = 'q-ready';
  const node2 = g('buildJson')().actions.find(x => x.name === '芙芙q');
  if ('consRequirement' in node2) throw new Error('无命座要求时不该写 consRequirement：' + JSON.stringify(node2));
  // 导入时 consRequirement 是已知字段、不报 unknown-field
  const unknown = res2.problems.filter(p => p.kind === 'unknown-field' && /consRequirement/i.test(p.text));
  if (unknown.length) throw new Error('consRequirement 是自己的字段，不该被当成未知字段：' + unknown.map(x => x.text).join('；'));
  return '四种模式/勾选组合的表达式、consRequirement 数值与逐字回读都正确';
});

check('D④：命座要求勾选的联动规则（有高命必有低命，没有低命必没有高命）', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '芙宁娜';
  const mk = (name, mode, target, enabled) => {
    makeAction('芙宁娜', 4, { name, action: 'e', conditionText: 'low-hp' });
    const a = g('state').strategy.actions.find(x => x.name === name);
    a.consMode = mode; a.consTarget = target; a.consEnabled = enabled;
    return a;
  };
  // 用户举的例子：A、B 选了「达到命座开启」，C、D 选了「达到命座关闭」；
  // A、C 是三命，B 是一命，D 是六命。
  const A = mk('命案A', 'open', 3, false);
  const B = mk('命案B', 'open', 1, false);
  const C = mk('命案C', 'close', 3, false);
  const D = mk('命案D', 'close', 6, false);
  // 一律按名字从当前策略里取实例（不要留着构造时的引用，避免拿到被换掉的旧对象）
  const get = (n) => g('state').strategy.actions.find(x => x.name === n);
  const st = () => ['命案A', '命案B', '命案C', '命案D'].map(n => (get(n).consEnabled ? '1' : '0')).join('');
  g('syncConsEnabled')(get('命案A'), true);
  if (st() !== '1110') throw new Error('勾选 A 时应当同步勾上 B 与 C、但不勾 D，实际 ' + st());
  g('syncConsEnabled')(get('命案A'), false);
  if (st() !== '0100') throw new Error('取消勾选 A 时应当同步取消 C（目标命座 ≥3）、但不动 B（1 命），实际 ' + st());
  // 再把 A 勾回来，验证「取消勾选高命不会影响低命」
  g('syncConsEnabled')(get('命案A'), true);
  if (st() !== '1110') throw new Error('重新勾选 A 应恢复 1110，实际 ' + st());
  // 单独验证「勾选只影响不高于自己的」
  g('syncConsEnabled')(get('命案B'), true);   // 一命：目标命座 ≤1 的只有 B（已经是勾选状态）
  if (st() !== '1110') throw new Error('勾选一命不该影响其他，实际 ' + st());
  g('syncConsEnabled')(get('命案B'), false);  // 取消一命：目标命座 ≥1 的全部取消
  if (st() !== '0000') throw new Error('取消一命应当取消全部（它们的目标命座都 ≥1），实际 ' + st());
  g('syncConsEnabled')(get('命案D'), true);   // 六命：目标命座 ≤6 的全部勾上
  if (st() !== '1111') throw new Error('勾选六命应当勾上全部，实际 ' + st());
  g('syncConsEnabled')(get('命案D'), false);  // 取消六命：只有目标命座 ≥6 的（D 自己）
  if (st() !== '1110') throw new Error('取消六命只应取消自己，实际 ' + st());
  // 规整函数：把互相矛盾的状态收敛成「向下闭合」
  mk('命案E', 'open', 2, false);
  mk('命案F', 'open', 2, true);      // 同命座有一个选了就都统一勾上
  mk('命案G', 'open', 5, true);      // 低命座没勾选 → 高命座也取消
  get('命案A').consEnabled = false;
  g('normalizeConsChecks')(g('state').strategy.actions, '芙宁娜');
  const names = ['命案A', '命案B', '命案C', '命案D', '命案E', '命案F', '命案G'];
  // 归一化之后的校验**只从模型数组取真值**（不经过任何本地对象引用、也不依赖辅助函数），
  // 免得测试里的引用和模型不是同一批对象时把结论带偏。
  const rows = g('state').strategy.actions
    .filter(a => a.name && a.name.indexOf('命案') === 0)
    .map(a => ({ name: a.name, target: a.consTarget, enabled: !!a.consEnabled }));
  const got = names.map(n => {
    const row = rows.find(r => r.name === n);
    return row && row.enabled ? '1' : '0';
  }).join('');
  // 从模型数组直接算「当前命座」：有某个目标命座被勾选，就说明这个角色按 ≥ 那个命座来设置开关；
  // 规整之后必然满足「≤ 当前命座的一律勾上、> 的一律取消」（向下闭合）。
  const checkedTargets = rows.filter(r => r.enabled).map(r => r.target);
  const wantLevel = checkedTargets.length ? Math.max(...checkedTargets) : 0;
  const bad = rows.filter(r => r.enabled !== (r.target <= wantLevel));
  const dump = JSON.stringify(rows);
  if (bad.length) throw new Error('规整后不满足「向下闭合」：' + bad.map(r => `${r.name}(target=${r.target},enabled=${r.enabled})`).join('，') + `，当前命座=${wantLevel}，模型=${dump}`);
  if (wantLevel !== 5) throw new Error('当前命座应为 5（G 是 5 命且勾选），实际 ' + wantLevel + '，模型=' + dump);
  // 命案A(3)/B(1)/C(3)/E(2)/F(2)/G(5) 都该勾上，只有六命的 D 取消 → 1110 111。
  if (got !== '1110111') throw new Error('规整结果应为 1110111（命案A~G 依次：' + names.join('、') + '），实际 ' + got + '，模型=' + dump);
  return `联动：${st()}；规整：${got}（当前 ${wantLevel} 命）`;
});

check('D⑤：快捷开关高命座手法（弹窗列表、设置命座、导出 consRequirement）', () => {
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '芙宁娜';
  const mk = (name, ch, mode, target, enabled) => {
    makeAction(ch, 4, { name, action: 'e', conditionText: 'low-hp' });
    const a = g('state').strategy.actions.find(x => x.name === name);
    a.consMode = mode; a.consTarget = target; a.consEnabled = enabled;
    return a;
  };
  const A = mk('命座A', '芙宁娜', 'open', 2, false);
  const B = mk('命座B', '芙宁娜', 'open', 4, false);
  const C = mk('命座C', '钟离', 'open', 1, false);
  const N = makeAction('钟离', 4, { name: '无命座要求动作', action: 'e' });
  g('setTab')('info');
  const html = $('paneInfo').innerHTML;
  if (!html.includes('快捷开关高命座手法')) throw new Error('「当前文件状态」里没有快捷开关按钮');
  g('app').handlers['cons-switch']();
  const body = () => $('modalBody').innerHTML;
  if (!$('modalTitle').innerHTML.includes('快捷开关高命座手法')) throw new Error('弹窗没有打开：' + $('modalTitle').innerHTML);
  if (!body().includes('芙宁娜') || !body().includes('钟离')) throw new Error('列表里应当有两个角色：' + body().slice(0, 200));
  if (body().includes('无命座要求动作')) throw new Error('弹窗列表只应列出有命座要求的角色与命座');
  if (!body().includes('当前按 不启用高命手法')) throw new Error('初始应当显示「不启用高命手法」');
  // 点芙宁娜的「4 命」→ 目标命座 ≤4 的动作全部启用
  const btns = $('modalBody').querySelectorAll('[data-cons-set]');
  const fuRows = btns.filter(b => b.getAttribute('data-cons-level') !== null);
  if (!fuRows.length) throw new Error('弹窗里没有可点的命座按钮');
  const setLevel = (char, level) => {
    const row = btns.find(b => {
      const i = Number(b.getAttribute('data-cons-set'));
      const chs = g('consCharacters')(g('state').strategy.actions);
      return chs[i] === char && Number(b.getAttribute('data-cons-level')) === level;
    });
    if (!row) throw new Error(`找不到「${char} ${level} 命」的按钮`);
    row.dispatch('click');
  };
  setLevel('芙宁娜', 4);
  if (!A.consEnabled || !B.consEnabled) throw new Error('设置 4 命后 A、B 都该启用：' + JSON.stringify([A.consEnabled, B.consEnabled]));
  if (C.consEnabled) throw new Error('设置芙宁娜的命座不该影响钟离');
  setLevel('钟离', 1);
  if (!C.consEnabled) throw new Error('钟离设置 1 命后 C 该启用');
  setLevel('芙宁娜', 6);
  if (!A.consEnabled || !B.consEnabled) throw new Error('设置 6 命后 A、B 仍应启用');
  setLevel('芙宁娜', 0);
  if (A.consEnabled || B.consEnabled) throw new Error('设置「不启用高命手法」后 A、B 都该停用');
  const nodeA = g('buildJson')().actions.find(x => x.name === '命座A');
  // A 是「达到命座开启 + 2 命」：停用时它仍然是「开启」（符号为正），
  // 只是 expression 里那个布尔值变成 false —— 这正是「数值相同、语义不同」的那一对。
  if (nodeA.consRequirement !== 2) throw new Error('A 停用后应写 consRequirement=2（模式是开启），实际 ' + JSON.stringify(nodeA.consRequirement) + '：' + JSON.stringify(nodeA));
  if (nodeA.condition.expression !== '(low-hp) && (false)') throw new Error('A 停用后表达式应为 false：' + nodeA.condition.expression);
  if (!nodeA.consRequirement || !('consRequirement' in nodeA)) throw new Error('有命座要求的动作必须写出 consRequirement');
  setLevel('芙宁娜', 2);
  const nodeA2 = g('buildJson')().actions.find(x => x.name === '命座A');
  if (nodeA2.consRequirement !== 2 || nodeA2.condition.expression !== '(low-hp) && (true)') throw new Error('设置 2 命后 A 应启用并写 +2：' + JSON.stringify(nodeA2));
  // 再把 A 的模式改成「达到命座关闭」（勾选状态不变）：语义随之翻面（达到 2 命时停用），
  // 数值的符号也跟着从 +2 变成 -2，expression 里那个布尔值同时变成 false。
  g('state').strategy.actions.find(x => x.name === '命座A').consMode = 'close';
  const nodeA3 = g('buildJson')().actions.find(x => x.name === '命座A');
  if (nodeA3.consRequirement !== -2 || nodeA3.condition.expression !== '(low-hp) && (false)') throw new Error('把模式改成「达到命座关闭」后应写 -2 且表达式为 false：' + JSON.stringify(nodeA3));
  g('closeModal')(null);
  return '弹窗按角色分组、设置命座后 consRequirement 与 expression 同步变化';
});

check('D⑥：模拟队伍过滤的「保存队伍 / 加载队伍」（本地、最多 20 支、可删除）', () => {
  dom.localStorage.removeItem('bgi_strategy_editor_teams_v1');
  g('state').ui.team = ['芙宁娜', '枫原万叶'];
  g('setTab')('preview');
  if (!$('panePreview').innerHTML.includes('保存队伍') || !$('panePreview').innerHTML.includes('加载队伍')) throw new Error('预览页缺少「保存队伍 / 加载队伍」按钮');
  // 没选满 4 人时只提醒、不弹保存框
  g('app').handlers['team-save']();
  if (!$('modalTitle').innerHTML.includes('还不能保存队伍')) throw new Error('未选满时应当提醒继续添加角色：' + $('modalTitle').innerHTML);
  g('closeModal')(null);
  // 选满 4 人 → 保存
  g('state').ui.team = ['芙宁娜', '枫原万叶', '钟离', '纳西妲'];
  g('app').handlers['team-save']();
  if (!$('modalTitle').innerHTML.includes('保存队伍')) throw new Error('选满 4 人后应当弹保存框');
  const input = $('teamNameInput');
  if (!input) throw new Error('保存框里没有队伍名输入框');
  input.value = '锄地队';
  $('modalFoot').children.find(b => b.textContent === '保存').click();
  const saved = g('loadSavedTeams')();
  if (saved.length !== 1 || saved[0].name !== '锄地队' || saved[0].team.join(',') !== '芙宁娜,枫原万叶,钟离,纳西妲') throw new Error('队伍没有正确保存：' + JSON.stringify(saved));
  if (!$('modalTitle').innerHTML.includes('已保存队伍')) throw new Error('保存后应给出确认：' + $('modalTitle').innerHTML);
  g('closeModal')(null);
  // 再存一支，然后清空当前队伍并从弹窗里加载
  g('state').ui.team = ['钟离', '纳西妲', '芙宁娜', '枫原万叶'];
  g('app').handlers['team-save']();
  $('teamNameInput').value = '备用队';
  $('modalFoot').children.find(b => b.textContent === '保存').click();
  g('closeModal')(null);
  if (g('loadSavedTeams')().length !== 2) throw new Error('应保存 2 支队伍');
  g('state').ui.team = [];
  g('app').handlers['team-load']();
  if (!$('modalTitle').innerHTML.includes('加载队伍')) throw new Error('加载队伍弹窗没有打开');
  if (!$('modalBody').innerHTML.includes('锄地队') || !$('modalBody').innerHTML.includes('备用队')) throw new Error('加载弹窗里没有列出已保存的队伍');
  // 加载「备用队」
  const rows = $('modalBody').querySelectorAll('[data-team-load]');
  const idx = g('loadSavedTeams')().findIndex(x => x.name === '备用队');
  const row = rows.find(r => Number(r.getAttribute('data-team-load')) === idx);
  row.dispatch('click');
  if (g('state').ui.team.join(',') !== '钟离,纳西妲,芙宁娜,枫原万叶') throw new Error('加载队伍没有替换当前队伍：' + g('state').ui.team.join(','));
  if (!$('modal').classList.contains('hidden')) throw new Error('加载后弹窗应当关闭');
  // 再打开加载弹窗，删除「锄地队」
  g('app').handlers['team-load']();
  const delRows = $('modalBody').querySelectorAll('[data-team-del]');
  const delIdx = g('loadSavedTeams')().findIndex(x => x.name === '锄地队');
  delRows.find(r => Number(r.getAttribute('data-team-del')) === delIdx).dispatch('click');
  const left = g('loadSavedTeams')();
  if (left.length !== 1 || left[0].name !== '备用队') throw new Error('删除队伍没有生效：' + JSON.stringify(left));
  if (!$('modalBody').innerHTML.includes('备用队')) throw new Error('删除后列表应就地刷新');
  g('closeModal')(null);
  // 上限 20 支
  const many = [];
  for (let i = 0; i < 25; i++) many.push({ name: '队' + i, team: ['芙宁娜', '枫原万叶', '钟离', '纳西妲'] });
  g('saveSavedTeams')(many);
  if (g('loadSavedTeams')().length !== 20) throw new Error('本地最多只应保存 20 支，实际 ' + g('loadSavedTeams')().length);
  dom.localStorage.removeItem('bgi_strategy_editor_teams_v1');
  g('state').ui.team = [];
  return '未选满提醒、保存、加载、删除、20 支上限都正确';
});

/* ==========================================================================================
 * 本轮（保存循环 / 命座要求与触发条件的往返 / 命座要求折叠 / 搜索框）的回归用例
 * ========================================================================================== */

/** 让一个动作尽量「控件齐全」：条件、队友、其他触发条件、命座要求、注释都填上 */
function richAction(name, ch) {
  const r = g('addAction')(ch || '芙宁娜', 4, { name, action: 'e', conditionText: 'low-hp || q-ready' });
  if (!r.ok) throw new Error(r.error);
  const a = g('state').strategy.actions.find(x => x.id === r.action.id);
  a.teammates.include = ['枫原万叶'];
  a.teammates.includeOps = [];
  a.morePriorities.push({ id: g('newId')(), text: 'q-ready', priority: 40000, cmp: 'after', scope: { type: 4, element: '', character: '' }, manualPriority: false });
  a.consMode = 'open'; a.consTarget = 3; a.consEnabled = true;
  a.consRequirement = g('consRequirementOf')(a);
  a.tags = '说明文字';
  return a;
}

check('本轮①b：写回一次之后，界面上就不该再有「与模型不一致」的控件', () => {
  dom.localStorage.clear();
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '芙宁娜';
  richAction('写回e');
  // 再加两条同角色动作：这样卡片里会出现「自动排除」的一排勾选框（最容易出现假差异的地方）
  const b = richAction('写回q');
  b.type = 5; b.slot = 1;
  const c = richAction('写回a');
  c.type = 8; c.slot = 1;
  c.teammates.autoExcludeSameType = true;
  g('recomputeIndexes')(g('state').strategy.actions);
  g('state').ui.characterSearch = '';
  g('setTab')('actions');
  g('renderAll')();
  // 统计每个字段处理器被调用的次数（写回时才会调用）
  g(`
    if (typeof __hcount === 'undefined') {
      __hcount = 0;
      for (const k of Object.keys(app.fieldHandlers)) {
        const f = app.fieldHandlers[k];
        app.fieldHandlers[k] = function () { __hcount++; return f.apply(null, arguments); };
      }
    }
  `);
  g('flushDomToModel()');           // 第一次写回：允许它把界面上真正没进模型的编辑写回去
  g('__hcount = 0');
  g('flushDomToModel()');           // 第二次：界面上已经全部与模型一致，不该再写回任何东西
  const n = g('__hcount');
  if (n !== 0) throw new Error(`重复写回了 ${n} 个控件 —— 这正是「保存 → 写回 → 再保存」死循环的来源（界面值没和模型对齐）`);
  return '第二次写回 0 次字段写入（含 3 条同角色动作的自动排除勾选框）';
});

check('本轮①b2：真实示例策略（28 条动作）下，写回也不该有任何「假差异」', () => {
  dom.localStorage.clear();
  const sample = JSON.parse(fs.readFileSync(findSampleJson(), 'utf8'));
  const res = g('analyzeImport')(sample);
  if (res.fatal.length) throw new Error(res.fatal.join('；'));
  g('applyImport')(res);
  const plan = g('planRenumber')();
  if (plan.error) throw new Error(plan.error);
  g('applyRenumber')(plan);
  const countDiffs = () => {
    g(`
      __diffs = [];
      if (typeof __diffWrapped === 'undefined') {
        __diffWrapped = true;
        const __f0 = flushOneField;
        flushOneField = function (el) {
          const kind = el.getAttribute && el.getAttribute('data-kind');
          const field = el.getAttribute && el.getAttribute('data-field');
          if (kind && field && fieldDiffers(kind, el.getAttribute('data-id') || '', field, el.getAttribute('data-idx') || '', el)) {
            __diffs.push(kind + '.' + field + '[' + (el.getAttribute('data-idx') || '') + '] value=' + JSON.stringify(el.value) + ' checked=' + el.checked);
          }
          return __f0.apply(null, arguments);
        };
      }
    `);
    g('flushDomToModel()');
    return g('__diffs');
  };
  const out = [];
  for (const ch of ['芙宁娜', '']) {
    g('state').ui.editingCharacter = ch;
    g('setTab')('actions');
    g('renderAll')();
    countDiffs();
    const second = countDiffs();
    if (second.length) throw new Error(`「${ch || '当前角色'}」页面在第二次写回时仍有 ${second.length} 处差异：` + [...new Set(second)].slice(0, 5).join(' / '));
    out.push(`${ch || '当前角色'}=0`);
  }
  return out.join('，');
});

check('本轮③：命座要求是可展开项，默认收起；摘要显示模式 / 目标命座数 / 勾选时才有「达到目标命座」', () => {
  dom.localStorage.clear();
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '芙宁娜';
  const A = richAction('折叠A');                              // 开启 3 命 + 勾选
  A.consMode = 'open'; A.consTarget = 3; A.consEnabled = true;
  const B = richAction('折叠B');                              // 关闭 6 命 + 不勾选
  B.consMode = 'close'; B.consTarget = 6; B.consEnabled = false;
  const C = richAction('折叠C');                              // 无命座要求
  C.consMode = 'none'; C.consTarget = 0; C.consEnabled = false;
  g('state').ui.detailsOpen = {};                             // 不残留上一次会话的展开状态
  g('setTab')('actions');
  g('renderActionsPanel')();
  const sumOf = (id) => {
    const d = dom.document.querySelector(`details[data-details="${id}:cons"]`);
    if (!d) throw new Error('找不到命座要求的可展开项');
    if (d.open) throw new Error('命座要求默认应当是收起的');
    return d.querySelector('summary').textContent;
  };
  const sA = sumOf(A.id), sB = sumOf(B.id), sC = sumOf(C.id);
  if (!sA.includes('命座要求')) throw new Error('摘要里没有「命座要求」：' + sA);
  if (!sA.includes('达到命座开启') || !sA.includes('3 命')) throw new Error('摘要应显示模式与目标命座数：' + sA);
  if (!sA.includes('达到目标命座')) throw new Error('勾选时应显示「达到目标命座」：' + sA);
  if (!sB.includes('达到命座关闭') || !sB.includes('6 命')) throw new Error('摘要应显示模式与目标命座数：' + sB);
  if (sB.includes('达到目标命座')) throw new Error('没勾选时不该显示「达到目标命座」：' + sB);
  if (!sC.includes('无命座要求')) throw new Error('无命座要求时摘要不对：' + sC);
  // 展开之后那三个控件还在（只是被 details 收起来了）
  const d = dom.document.querySelector(`details[data-details="${A.id}:cons"]`);
  if (d.querySelectorAll('select[data-kind="cons"]').length !== 2) throw new Error('命座要求里应有模式与目标命座数两个下拉');
  if (d.querySelectorAll('input[data-kind="cons"][data-field="enabled"]').length !== 1) throw new Error('命座要求里应有启用/停用勾选框');
  return `A:${sA.trim()} / B:${sB.trim()} / C:${sC.trim()}`;
});

check('本轮④：「添加其他触发条件」的提示已缩短为「先添加、再在新增条目里填」', () => {
  dom.localStorage.clear();
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '芙宁娜';
  const a = g('addAction')('芙宁娜', 4, { name: '提示e', action: 'e' });
  g('state').ui.collapsed[a.action.id] = false;
  g('state').ui.detailsOpen[`${a.action.id}:moreadd`] = true;
  g('renderActionsPanel')();
  const html = $('paneActions').innerHTML;
  const want = '请先点下面的按钮把这条其他触发条件加进列表，再在新增条目里的「编辑触发条件与优先级」里填写触发条件。';
  if (!html.includes(want)) throw new Error('提示文案没有更新：' + want);
  if (html.includes('这里不再提供触发条件输入框')) throw new Error('旧的长提示文案还在');
  if (html.includes('还没添加就编辑、结果内容没保存')) throw new Error('旧的长提示文案还在');
  return '提示已缩短';
});

check('本轮⑤：角色搜索支持角色表里的其它写法（只用于筛选，界面只显示标准名）', () => {
  dom.localStorage.clear();
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '枫原万叶';
  g('addAction')('神里绫华', 4, { name: '绫华e', action: 'e' });
  g('addAction')('琴', 4, { name: '琴e', action: 'e' });
  const ayaka = g('getAvatar')('神里绫华');
  const prose = (ayaka.alias || []).find(x => x === '白鹭公主');
  if (!prose) throw new Error('角色表里没有带搜索用写法的测试数据（白鹭公主）');
  // 直接测命中函数
  if (!g('avatarHitAll')(ayaka, '白鹭公主')) throw new Error('命中判断没有算上角色表里的其它写法');
  if (g('avatarHitAll')(ayaka, '钟离')) throw new Error('不该误命中');
  // 标准名 / id / 编号的判断保持不变
  const codeLabel = g('avatarCodeLabel')(ayaka);
  if (!g('avatarHitAll')(ayaka, '神里')) throw new Error('标准名搜索被破坏了');
  if (!g('avatarHitAll')(ayaka, String(ayaka.id))) throw new Error('id 搜索被破坏了');
  if (!g('avatarMatchesQuery')('神里绫华', '绫华')) throw new Error('标准名搜索被破坏了');
  if (!g('avatarMatchesQuery')('神里绫华', codeLabel)) throw new Error('编号搜索被破坏了：' + codeLabel);
  if (!g('avatarMatchesQuery')('神里绫华', String(ayaka.seq).padStart(2, '0'))) throw new Error('角色序号搜索被破坏了');
  if (!g('avatarMatchesQuery')('神里绫华', '白鹭公主')) throw new Error('角色下拉的命中判断没有算上其它写法');
  // 角色列表：按其它写法能筛出标准名，且不同时筛出别的角色
  g('state').ui.characterSearch = '白鹭公主';
  g('setTab')('actions');
  g('renderActionsPanel')();
  const list = g('filteredAvatars')().map(x => x.key);
  if (!list.includes('神里绫华')) throw new Error('按其它写法没有筛出神里绫华：' + JSON.stringify(list));
  if (list.includes('琴')) throw new Error('按其它写法筛出了不该出现的角色：' + JSON.stringify(list));
  // 界面上一律只显示标准名：那串写法只允许出现在搜索框的 value 里（用户自己输进去的）
  const html = $('paneActions').innerHTML;
  const cnt = html.split('白鹭公主').length - 1;
  if (cnt !== 1 || !html.includes(`value="白鹭公主"`)) throw new Error('搜索用的写法出现在了搜索结果里（只允许作为搜索框里用户输入的内容）：' + cnt);
  // 同一个搜索词同时命中「某角色的标准名」与「另一角色的其它写法」时，两个角色要一起显示
  const qin = g('getAvatar')('琴');
  qin.alias = ['神里'];             // 临时给「琴」一个与「神里绫华」标准名重合的写法
  g('state').ui.characterSearch = '神里';
  g('renderActionsPanel')();
  const mixed = g('filteredAvatars')().map(x => x.key);
  if (!mixed.includes('琴')) throw new Error('按其它写法命中的角色没有出现：' + JSON.stringify(mixed));
  if (!mixed.includes('神里绫华')) throw new Error('按标准名命中的角色没有一起出现：' + JSON.stringify(mixed));
  if (mixed.includes('钟离')) throw new Error('既没按标准名也没按其它写法命中的角色不该出现：' + JSON.stringify(mixed));
  // 角色选择弹窗的搜索框同样按其它写法筛选
  g('state').ui.characterSearch = '';
  g('renderActionsPanel')();
  g('pickAvatarsLive')({ title: '选择角色', selected: [], allowCurrent: true });
  $('pkSearch').value = '白鹭公主';
  $('pkSearch').oninput({ target: $('pkSearch') });
  const rows = $('pkList').innerHTML;
  if (!rows.includes('神里绫华')) throw new Error('角色选择弹窗没按其它写法筛出神里绫华');
  if (rows.includes('琴')) throw new Error('角色选择弹窗按其它写法筛出了别的角色');
  g('closeModal')(null);
  return '命中判断 / 角色列表 / 角色选择弹窗都生效，且只显示标准名';
});

check('本轮②：触发条件与命座要求在「导出 → 导入」后逐字不变（含多余的括号）', () => {
  /** 用当前模型导出、回读、再导出，返回两次导出的 JSON 与回读后的模型快照 */
  const roundTrip = () => {
    const before = g('buildJson')();
    const res = g('analyzeImport')(JSON.parse(JSON.stringify(before)));
    if (res.fatal.length) throw new Error('回读失败：' + res.fatal.join('；'));
    g('applyImport')(res);
    const after = g('buildJson')();
    const snap = (j) => JSON.stringify(j.actions.find(x => x.name === '往返e').condition) + '|' +
      JSON.stringify(g('state').strategy.actions.filter(x => x.name === '往返e').map(x => [x.consMode, x.consTarget, x.consEnabled, x.teammates.include, x.teammates.exclude, x.teammates.autoExcludeSameType]));
    return { before, after, snap: snap(after) };
  };
  const cases = [
    { cond: 'low-hp || q-ready', inc: ['枫原万叶'], exc: [], cons: ['open', 3, true] },
    { cond: 'low-hp || q-ready', inc: ['枫原万叶'], exc: [], cons: ['open', 3, false] },
    { cond: 'low-hp || q-ready', inc: ['枫原万叶'], exc: [], cons: ['close', 3, true] },
    { cond: 'low-hp || q-ready', inc: ['枫原万叶'], exc: [], cons: ['close', 3, false] },
    { cond: 'low-hp', inc: [], exc: [], cons: ['open', 2, true] },              // 没有队友条件：以前这里会多出一层括号
    { cond: '', inc: [], exc: [], cons: ['open', 2, false] },                    // 空条件：以前会变成 (true)
    { cond: '', inc: ['枫原万叶'], exc: [], cons: ['open', 2, false] },
    { cond: 'low-hp', inc: ['枫原万叶'], exc: ['钟离'], cons: ['close', 2, true] },
    { cond: 'low-hp', inc: ['枫原万叶'], exc: ['钟离', '纳西妲'], cons: null },
    { cond: 'low-hp', inc: [], exc: [], cons: null, more: ['q-ready', 't > 5'] },
  ];
  const seen = [];
  for (const c of cases) {
    dom.localStorage.clear();
    g('state').strategy.actions = [];
    g('state').strategy.info = { name: '往返', author: '', version: '', description: '', config: {}, preActions: [] };
    g('state').ui.editingCharacter = '芙宁娜';
    const r = g('addAction')('芙宁娜', 4, { name: '往返e', action: 'e', conditionText: c.cond });
    if (!r.ok) throw new Error(r.error);
    const a = g('state').strategy.actions.find(x => x.id === r.action.id);
    a.teammates.include = c.inc.slice();
    a.teammates.includeOps = c.inc.length > 1 ? ['and'] : [];
    a.teammates.exclude = c.exc.slice();
    a.teammates.excludeOps = c.exc.length > 1 ? ['or'] : [];
    a.teammates.autoExcludeSameType = true;
    (c.more || []).forEach((t, i) => a.morePriorities.push({ id: g('newId')(), text: t, priority: 40000 + i * 1000, cmp: 'after', scope: { type: 4, element: '', character: '' }, manualPriority: false }));
    if (c.cons) { a.consMode = c.cons[0]; a.consTarget = c.cons[1]; a.consEnabled = c.cons[2]; }
    else { a.consMode = 'none'; a.consTarget = 0; a.consEnabled = false; }
    a.consRequirement = g('consRequirementOf')(a);
    const wantCond = c.cond;
    const r1 = roundTrip();
    // 1) 回读后的触发条件必须与用户写的一字不差（不许多括号）
    const back = g('state').strategy.actions.find(x => x.name === '往返e');
    if (back.conditionText !== wantCond) {
      throw new Error(`触发条件没有原样还原：${JSON.stringify(wantCond)} → ${JSON.stringify(back.conditionText)}（表达式 ${JSON.stringify(r1.before.actions[0].condition.expression)}）`);
    }
    // 2) 命座要求的三元组必须原样还原
    if (c.cons) {
      const got = [back.consMode, back.consTarget, !!back.consEnabled];
      if (got[0] !== c.cons[0] || got[1] !== c.cons[1] || got[2] !== c.cons[2]) {
        throw new Error(`命座要求没有原样还原：${JSON.stringify(c.cons)} → ${JSON.stringify(got)}`);
      }
    } else if (back.consMode !== 'none') throw new Error('无命座要求被还原成了有理要求');
    // 3) 队友条件的选择原样还原
    if (back.teammates.include.join(',') !== c.inc.join(',') || back.teammates.exclude.join(',') !== c.exc.join(',')) {
      throw new Error(`队友条件没有原样还原：${JSON.stringify(c.inc)}/${JSON.stringify(c.exc)} → ${JSON.stringify(back.teammates.include)}/${JSON.stringify(back.teammates.exclude)}`);
    }
    // 4) 再导出一次必须与第一次逐字一致（多个 morePriorities 也要一致）
    if (JSON.stringify(r1.after) !== JSON.stringify(r1.before)) {
      throw new Error('往返之后导出的 JSON 变了：\n  前 ' + JSON.stringify(r1.before) + '\n  后 ' + JSON.stringify(r1.after));
    }
    seen.push(JSON.stringify(wantCond) + (c.cons ? '/' + c.cons.join('') : '/none'));
  }
  // 草稿（localStorage 里的那份 JSON）走的是同一条回读路径，单独再验一次
  dom.localStorage.clear();
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '芙宁娜';
  makeAction('芙宁娜', 4, { name: '往返e', action: 'e', conditionText: 'low-hp || q-ready' });
  const liveA = g('state').strategy.actions[0];
  liveA.consMode = 'close'; liveA.consTarget = 4; liveA.consEnabled = false;
  liveA.teammates.include = ['枫原万叶'];
  const jsonBefore = g('buildJson')();
  g('saveDraftNow')();
  const drafts = JSON.parse(dom.localStorage.getItem(g('LS_DRAFT')) || '{}');
  const key = Object.keys(drafts)[0];
  if (!key) throw new Error('草稿没有写进 localStorage');
  g('applyImport')(g('analyzeImport')(drafts[key].json));
  if (JSON.stringify(g('buildJson')()) !== JSON.stringify(jsonBefore)) throw new Error('载入草稿后导出的 JSON 与原文件不一致');
  return `${cases.length} 组往返 + 草稿往返都逐字一致`;
});

const asyncChecks = [];
const tick = () => new Promise(r => setTimeout(r, 0));
const checkAsync = (name, fn) => asyncChecks.push([name, fn]);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

checkAsync('本轮①a：编辑任意一处内容只落一次盘，之后不再反复保存 / 重建面板，输入框也不会被取消选中', async () => {
  dom.localStorage.clear();
  g('state').strategy.actions = [];
  g('state').strategy.info = { name: '循环', author: '', version: '', description: '', config: {}, preActions: [] };
  g('state').ui.editingCharacter = '芙宁娜';
  const a = richAction('循环e');
  const sibling = richAction('循环q');       // 同角色的第二条动作：卡片里会有「自动排除」勾选框
  sibling.type = 5; sibling.slot = 1;
  g('recomputeIndexes')(g('state').strategy.actions);
  const mp = a.morePriorities[0];
  g('state').ui.collapsed[a.id] = false;
  g('state').ui.detailsOpen = { [`${a.id}:more:0`]: true, [`${a.id}:moreadd`]: true };
  g('setTab')('actions');
  g('renderActionsPanel')();
  // 计数器：落盘次数 / 面板重建次数 / 条件文本写回次数
  g(`
    __saves = 0; __rebuilds = 0;
    const __sd0 = saveDraftNow; saveDraftNow = function () { __saves++; return __sd0.apply(null, arguments); };
    const __rf0 = refresh; refresh = function () { __rebuilds++; return __rf0.apply(null, arguments); };
    const __rc0 = rerenderCurrent; rerenderCurrent = function () { __rebuilds++; return __rc0.apply(null, arguments); };
  `);
  const q = (sel) => dom.document.querySelector(sel);
  const edits = [
    { name: '动作名称', el: () => q(`#paneActions input[data-kind="act"][data-field="name"]`), ev: 'input', value: '循环e2' },
    { name: '动作指令', el: () => q(`#paneActions textarea[data-kind="act"][data-field="action"]`), ev: 'input', value: 'e,wait(0.2)' },
    { name: '触发条件', el: () => q(`#paneActions textarea[data-kind="condtext"][data-field="text"]`), ev: 'input', value: 'low-hp && q-ready' },
    { name: '注释', el: () => q(`#paneActions textarea[data-kind="act"][data-field="tags"]`), ev: 'input', value: '改过的注释' },
    { name: '其他触发条件的触发条件', el: () => q(`#paneActions textarea[data-kind="moretext"][data-field="text"]`), ev: 'input', value: 't > 3' },
    { name: '命座要求的模式', el: () => q(`#paneActions select[data-kind="cons"][data-field="mode"]`), ev: 'change', value: 'close' },
    { name: '命座要求的勾选', el: () => q(`#paneActions input[data-kind="cons"][data-field="enabled"]`), ev: 'change', value: null },
    { name: '自动排除的勾选', el: () => q(`#paneActions input[data-kind="team"][data-field="autoExclude"]`), ev: 'change', value: null },
    { name: '尾数', el: () => q(`#paneActions select[data-kind="act"][data-field="slot"]`), ev: 'change', value: '2' },
  ];
  const notes = [];
  for (const e of edits) {
    const el = e.el();
    if (!el) throw new Error('找不到控件：' + e.name);
    g('__saves = 0; __rebuilds = 0;');
    el.focus();
    if (typeof el.setSelectionRange === 'function' && el.type !== 'checkbox') el.setSelectionRange(0, 0);
    if (e.ev === 'change' && el.type === 'checkbox') el.checked = !el.checked;
    else el.value = e.value;
    el.dispatch(e.ev);
    const immediate = g('__rebuilds');     // 有些改动本来就要重建一次面板（例如改动作类型）
    await sleep(900);                      // 跨过 600ms 的自动保存定时器
    const saves = g('__saves');
    const extra = g('__rebuilds') - immediate;
    if (saves !== 1) throw new Error(`编辑「${e.name}」之后应当只落一次盘，实际 ${saves} 次（说明保存/写回在自激）`);
    if (extra !== 0) throw new Error(`编辑「${e.name}」之后又重建了 ${extra} 次面板（选区与光标就是这样被清掉的）`);
    if (dom.document.activeElement !== el) throw new Error(`编辑「${e.name}」之后输入框被取消选中了`);
    notes.push(`${e.name}:1 次落盘`);
    await sleep(700);                      // 再等一个定时器周期：确认没有第二次保存
    if (g('__saves') !== 1) throw new Error(`编辑「${e.name}」之后仍在反复落盘（第二个周期又存了一次）`);
    // 面板可能在别的用例里被重建：重新渲染后再测下一个控件
    g('renderActionsPanel')();
  }
  return notes.join('；');
});

checkAsync('本轮①c：点角色（不改任何内容）不该触发草稿保存，也不该把角色列表滚回顶部', async () => {
  dom.localStorage.clear();
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '芙宁娜';
  richAction('选人e');           // 带命座要求等全套控件
  richAction('选人q');           // 再来一条同角色动作：卡片里会有「自动排除」勾选框
  g('setTab')('actions');
  g('renderActionsPanel')();
  g(`
    __saves = 0; __rebuilds = 0;
    const __sd1 = saveDraftNow; saveDraftNow = function () { __saves++; return __sd1.apply(null, arguments); };
    const __rf1 = refresh; refresh = function () { __rebuilds++; return __rf1.apply(null, arguments); };
  `);
  const list = q => dom.document.querySelector(q);
  const scroller = list('#paneActions [data-scroll="charlist"]');
  if (!scroller) throw new Error('找不到角色列表的滚动容器');
  scroller.scrollTop = 120;
  // 点「琴」这一行（角色列表里的条目）
  const row = dom.document.querySelectorAll('[data-act="pick-char"]').find(x => x.getAttribute('data-char') === '琴');
  if (!row) throw new Error('角色列表里找不到琴');
  row.dispatch('click');
  // 选角色本身会重建一次面板（这是设计如此：右边要换成那个角色的动作），
  // 但**只能有这一次** —— 以前写回时的假差异会再触发 refresh，把列表顶回顶部并连带落盘。
  const afterClick = g('__rebuilds');
  if (afterClick !== 1) throw new Error(`选角色应当只重建 1 次面板，实际 ${afterClick} 次`);
  await sleep(900);
  if (g('__saves') !== 0) throw new Error(`只是选了个角色，却落盘了 ${g('__saves')} 次（内容并没有被编辑）`);
  if (g('__rebuilds') !== 1) throw new Error(`选角色之后又额外重建了 ${g('__rebuilds') - 1} 次面板（重建会让列表弹回顶部）`);
  const after = dom.document.querySelector('#paneActions [data-scroll="charlist"]');
  if (!after) throw new Error('选角色之后角色列表不见了');
  if (after.scrollTop !== 120) throw new Error(`角色列表的滚动位置被重置了：${after.scrollTop}（应当恢复成 120）`);
  if (g('state').ui.editingCharacter !== '琴') throw new Error('选中的角色没有生效');
  return '未落盘、未重建、滚动位置保留';
});

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

checkAsync('⑦ 复制动作给指定角色（异步确认）：改名 + 按目标角色重新分配 index', async () => {
  g('closeModal')(null);
  await tick();
  g('state').strategy.actions = [];
  g('state').ui.editingCharacter = '枫原万叶';
  const a = makeAction('枫原万叶', 4, { name: '枫原万叶e', action: 'e,wait(0.3)' });
  if (g('state').strategy.actions.length !== 1) throw new Error('前置清理不干净：' + g('state').strategy.actions.map(x => x.name).join(','));
  a.conditionText = 'low-hp && since(1) > 2';
  a.morePriorities.push({ id: g('newId')(), text: 'low-hp', priority: 10000, cmp: 'after', scope: { type: 4, element: '', character: '' }, manualPriority: false });
  g('state').ui.collapsed[a.id] = false;
  g('renderActionsPanel')();
  // 复制给钟离（钟离还没有同名动作）：标准名换成目标角色
  g('app').handlers['card-dup']({ getAttribute: () => a.id }, {});
  await tick();
  const row0 = dom.window.$('cpList').children.filter(r => r.classList.contains('roleitem'))
    .find(r => r.querySelector('[data-cppick]').getAttribute('data-cppick') === '钟离');
  if (!row0) throw new Error('复制弹窗里找不到钟离');
  row0.querySelector('[data-cppick]').click();
  await tick();
  const toZhong = g('state').strategy.actions.find(x => x.character === '钟离');
  if (!toZhong) throw new Error('没有复制给钟离：' + g('state').strategy.actions.map(x => x.name + '/' + x.character).join(','));
  if (toZhong.name !== '钟离e') throw new Error('动作名里的标准名应换成目标角色：' + toZhong.name + '（当前动作：' + g('state').strategy.actions.map(x => x.name).join(',') + '）');
  if (toZhong.index !== g('makeIndex')(4, 6, 2, 1)) throw new Error('复制给钟离的 index 不对：' + toZhong.index + '（钟离 = 岩元素号 6 · 编号 02 · 类型 4 · 尾数 1）');
  if (toZhong.action !== 'e,wait(0.3)' || toZhong.conditionText !== 'low-hp && since(1) > 2') throw new Error('复制给钟离的内容不对');
  // 复制给芙宁娜（芙宁娜还没有动作）：同样是标准名替换
  g('app').handlers['card-dup']({ getAttribute: () => a.id }, {});
  await tick();
  const cp = dom.window.$('cpSearch');
  cp.value = '芙宁娜';
  cp.dispatch('input');
  const row = dom.window.$('cpList').children.filter(r => r.classList.contains('roleitem'))
    .find(r => r.querySelector('[data-cppick]').getAttribute('data-cppick') === '芙宁娜');
  if (!row) throw new Error('搜索后找不到芙宁娜');
  row.querySelector('[data-cppick]').click();
  await tick();
  const copied = g('state').strategy.actions.find(x => x.character === '芙宁娜');
  if (!copied) throw new Error('没有复制出动作：' + g('state').strategy.actions.map(x => x.name).join(','));
  if (copied.name !== '芙宁娜e') throw new Error('动作名里的标准名应换成目标角色：' + copied.name);
  if (copied.index !== g('makeIndex')(4, 3, 11, 1)) throw new Error('复制出来的动作 index 不对：' + copied.index);
  if (copied.action !== 'e,wait(0.3)') throw new Error('复制出来的指令不对：' + copied.action);
  if (copied.conditionText !== 'low-hp && since(1) > 2') throw new Error('复制出来的条件不对：' + copied.conditionText);
  if ((copied.morePriorities || []).length !== 1) throw new Error('复制出来的其他触发条件数量不对：' + (copied.morePriorities || []).length);
  if (copied.morePriorities[0].id === a.morePriorities[0].id) throw new Error('复制出来的其他触发条件应使用新的内部 id');
  // 再复制给本角色 → 名称后加数字、尾数顺延
  g('state').ui.editingCharacter = '枫原万叶';
  g('renderActionsPanel')();
  g('app').handlers['card-dup']({ getAttribute: () => a.id }, {});
  await tick();
  const selfRow = dom.window.$('cpList').children.filter(r => r.classList.contains('roleitem'))
    .find(r => r.querySelector('[data-cppick]').getAttribute('data-cppick') === '枫原万叶');
  if (!selfRow) throw new Error('复制弹窗里应有「本角色」这一项');
  selfRow.querySelector('[data-cppick]').click();
  await tick();
  const same = g('state').strategy.actions.find(x => x.name === '枫原万叶e2');
  if (!same) throw new Error('复制给本角色时应生成「枫原万叶e2」：' + g('state').strategy.actions.map(x => x.name).join(','));
  if (same.character !== '枫原万叶') throw new Error('本角色复制的 character 不对：' + same.character);
  if (same.index !== g('makeIndex')(4, 5, 5, 2)) throw new Error('本角色复制的 index 不对：' + same.index + '（应为 45052：类型 4 · 风元素 5 · 枫原万叶 05 · 尾数 2）');
  const v = g('validateStrategy')();
  if (v.errors.length) throw new Error('复制后不应有错误：' + v.errors.map(x => x.text).join('；'));
  g('state').strategy.actions = [];
  return `复制到钟离 → ${toZhong.name}(${toZhong.index})；芙宁娜 → ${copied.name}(${copied.index})；本角色 → ${same.name}(${same.index})`;
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
