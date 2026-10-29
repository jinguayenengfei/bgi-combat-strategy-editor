// 校验交付物（单文件 HTML）里的内联脚本能正常启动：node tools/check_bundle.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { OUT_NAME } from './build.mjs';
import { createDom } from './dom.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, OUT_NAME), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error('单文件 HTML 里找不到内联 <script>');
if (html.includes('<!--__BUNDLE__-->')) throw new Error('单文件 HTML 里的占位注释没有被替换');

const dom = createDom();
const ctx = {
  console, window: dom.window, document: dom.document, localStorage: dom.localStorage,
  Blob: class { }, FileReader: class { readAsText() { } },
  alert: () => { }, confirm: () => true,
  setTimeout, clearTimeout, setInterval, clearInterval, URL: dom.window.URL,
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(m[1], ctx);
const g = (c) => vm.runInContext(c, ctx);
const STATIC_IDS = ['tabs', 'hdrStatus', 'hdrIssues', 'btnIssues', 'paneInfo', 'paneActions', 'panePreview', 'side', 'footInfo', 'modal', 'modalTitle', 'modalBody', 'modalFoot'];
for (const id of STATIC_IDS) dom.document.mount(dom.document.getElementById(id));
dom.window.dispatch('DOMContentLoaded');

const act = g('createAction')({ name: 'x', character: '枫原万叶', type: 4, conditionText: 'e-ready' });
act.slot = 1;
g('recomputeIndexes')([act]);
g('state').strategy.actions = [act];
act.teammates.autoExcludeSameType = false;
act.teammates.include = ['纳西妲', '芙宁娜'];
act.teammates.includeOps = ['or'];
act.teammates.exclude = ['玛薇卡', '茜特菈莉'];
act.teammates.excludeOps = ['and'];
const expr = g('buildExpression')(act, g('state').strategy.actions);
const want = '(e-ready) && ((in-party(纳西妲) || in-party(芙宁娜)) && !(in-party(玛薇卡) && in-party(茜特菈莉)))';
if (expr !== want) throw new Error('单文件 HTML 的队友条件组装不符合预期：\n  ' + expr + '\n  期望 ' + want);
const res = g('analyzeImport')(g('buildJson')());
g('applyImport')(res);
const back = g('state').strategy.actions.find(a => a.name === 'x');
if (back.teammates.include.join(',') !== '纳西妲,芙宁娜') throw new Error('单文件 HTML 导入后必要队友不对：' + JSON.stringify(back.teammates));
if (back.teammates.exclude.join(',') !== '玛薇卡,茜特菈莉' || back.teammates.excludeOps.join(',') !== 'and') throw new Error('单文件 HTML 导入后排除队友不对：' + JSON.stringify(back.teammates));
if (g('buildExpression')(back, g('state').strategy.actions) !== expr) throw new Error('单文件 HTML 往返不一致');
if (!g('condExplain')(g('condParse')('since(12345) > 1', []).ast, g('condExplainCtx')(act.id)).includes('index=12345')) throw new Error('单文件 HTML 释义功能异常');

// 信息页要有「合并 JSON 策略…」入口，并且合并引擎（自己与自己合并 = 全部原样保留）可用
g('state').ui.tab = 'info';
g('renderInfoPanel')();
if (!g('$')('paneInfo').innerHTML.includes('data-act="merge"')) throw new Error('单文件 HTML 信息页缺少「合并 JSON 策略…」按钮');
const src = g('checkMergeSource')(JSON.parse(JSON.stringify(g('buildJson')())));
if (src.mode !== 'ok') throw new Error('单文件 HTML 的合并前校验异常：' + src.reasons.join('；'));
const mres = g('applyMergePlan')(g('planMerge')(src), { info: {}, actions: {} });
if (!mres.ok) throw new Error('单文件 HTML 合并失败：' + mres.error);
if (mres.kept.length !== 1 || mres.added.length || mres.replaced.length) throw new Error('自己与自己合并应全部原样保留：' + JSON.stringify({ kept: mres.kept.length, added: mres.added.length, replaced: mres.replaced.length }));
if (g('buildExpression')(g('state').strategy.actions[0], g('state').strategy.actions) !== expr) throw new Error('单文件 HTML 合并后表达式变了');

/* ---- 本次新增：命座要求（consRequirement）的组装 / 拆分与「新建（含兜底动作）」预设 ---- */
{
  const a = g('createAction')({ name: 'y', character: '枫原万叶', type: 4, conditionText: 'e-ready' });
  a.consMode = 'open'; a.consTarget = 2; a.consEnabled = true;
  const e1 = g('buildExpression')(a, [a]);
  if (e1 !== '(e-ready) && (true)') throw new Error('单文件 HTML 的命座要求组装不对：' + e1);
  a.teammates.autoExcludeSameType = false;
  a.teammates.include = ['纳西妲'];
  a.teammates.includeOps = [];
  const e2 = g('buildExpression')(a, [a]);
  if (e2 !== '((e-ready) && (true)) && (in-party(纳西妲))') throw new Error('单文件 HTML 的「命座要求 + 队友条件」组装不对：' + e2);
  // 达到命座关闭 + 勾选 → false，且 consRequirement = -2
  a.consMode = 'close'; a.consTarget = 2; a.consEnabled = true;
  if (g('consRequirementOf')(a) !== -2) throw new Error('单文件 HTML 的 consRequirement 数值不对：' + g('consRequirementOf')(a));
  if (g('buildExpression')(a, [a]) !== '((e-ready) && (false)) && (in-party(纳西妲))') throw new Error('单文件 HTML 的「达到命座关闭」组装不对：' + g('buildExpression')(a, [a]));
  // 导出 → 回读：consRequirement 与三元组都要还原
  g('state').strategy.actions = [a];
  g('recomputeIndexes')(g('state').strategy.actions);
  const json = g('buildJson')();
  if (json.actions[0].consRequirement !== -2) throw new Error('单文件 HTML 导出应写 consRequirement=-2：' + JSON.stringify(json.actions[0]));
  const res2 = g('analyzeImport')(JSON.parse(JSON.stringify(json)));
  const back2 = res2.actions.find(x => x.name === 'y');
  if (back2.consMode !== 'close' || back2.consTarget !== 2 || back2.consEnabled !== true) throw new Error('单文件 HTML 回读命座要求不对：' + JSON.stringify([back2.consMode, back2.consTarget, back2.consEnabled]));
  if (g('buildExpression')(back2, res2.actions) !== '((e-ready) && (false)) && (in-party(纳西妲))') throw new Error('单文件 HTML 命座要求往返不一致');
  // 无命座要求时不写这个字段
  const plain = g('createAction')({ name: 'z', character: '枫原万叶', type: 4, conditionText: 'e-ready' });
  plain.slot = 1; g('recomputeIndexes')([plain]);
  g('state').strategy.actions = [plain];
  if ('consRequirement' in g('buildJson')().actions[0]) throw new Error('单文件 HTML 无命座要求时不该写 consRequirement');
  // 「新建（含兜底动作）」预设的 3 条动作
  g('newStrategy')('preset');
  const names = g('state').strategy.actions.map(x => x.name);
  if (names.length !== 3 || names[0] !== '兜底战斗检查' || names[1] !== '角色红血标记' || names[2] !== '等待') {
    throw new Error('单文件 HTML 的「新建（含兜底动作）」预设不对：' + JSON.stringify(names));
  }
  const chk = g('state').strategy.actions[0];
  if (chk.action !== 'check,scroll(10)' || chk.conditionText !== 't > 10 && last-check > 4 && (! (last-check = t) || count < 1 )') throw new Error('单文件 HTML 的兜底战斗检查内容不对');
  const mk = g('state').strategy.actions[1];
  if (mk.action !== '' || mk.conditionText !== 'low-hp && since > 4') throw new Error('单文件 HTML 的角色红血标记内容不对');
  if (g('validateStrategy')().errors.length) throw new Error('单文件 HTML 的预设策略不该有错误');
}

/* ---- 本轮新增：命座要求四种组合的逐字往返 / 触发条件不多括号 / 命座要求折叠 / 搜索框 ---- */
{
  // ① 四种「模式 + 勾选」组合：consRequirement 的符号表模式、expression 里的布尔值表启用/停用
  const combos = [['open', 3, true], ['open', 3, false], ['close', 3, true], ['close', 3, false]];
  for (const [mode, target, enabled] of combos) {
    const c = g('createAction')({ name: 'c', character: '枫原万叶', type: 4, conditionText: 'e-ready' });
    c.consMode = mode; c.consTarget = target; c.consEnabled = enabled;
    c.slot = 1;
    g('recomputeIndexes')([c]);
    g('state').strategy.actions = [c];
    const wantSign = mode === 'close' ? -target : target;
    const j = g('buildJson')();
    if (j.actions[0].consRequirement !== wantSign) throw new Error(`单文件 HTML：${mode}/${target}/${enabled} 应写 consRequirement=${wantSign}，实际 ${JSON.stringify(j.actions[0].consRequirement)}`);
    const back = g('analyzeImport')(JSON.parse(JSON.stringify(j)));
    if (back.fatal.length) throw new Error('单文件 HTML 回读失败：' + back.fatal.join('；'));
    const b = back.actions[0];
    if (b.consMode !== mode || b.consTarget !== target || !!b.consEnabled !== enabled) {
      throw new Error(`单文件 HTML：命座要求没有原样还原 ${mode}/${target}/${enabled} → ${JSON.stringify([b.consMode, b.consTarget, b.consEnabled])}`);
    }
    g('applyImport')(back);
    const j2 = g('buildJson')();
    if (JSON.stringify(j2) !== JSON.stringify(j)) throw new Error('单文件 HTML：命座要求往返两次的 JSON 不一致');
  }
  // ② 触发条件：导出时会整体包一层括号，拆回来必须去掉（不许多出 `(e-ready)`、空条件也不许变成 `(true)`）
  const cases = [
    { cond: 'e-ready', want: 'e-ready' },
    { cond: 'low-hp || q-ready', want: 'low-hp || q-ready' },
    { cond: '', want: '' },
  ];
  for (const c of cases) {
    const a = g('createAction')({ name: 'p', character: '枫原万叶', type: 4, conditionText: c.cond });
    a.consMode = 'open'; a.consTarget = 2; a.consEnabled = false;
    a.slot = 1;
    g('recomputeIndexes')([a]);
    g('state').strategy.actions = [a];
    const j = g('buildJson')();
    const res = g('analyzeImport')(JSON.parse(JSON.stringify(j)));
    if (res.actions[0].conditionText !== c.want) {
      throw new Error(`单文件 HTML：触发条件没有原样还原 ${JSON.stringify(c.cond)} → ${JSON.stringify(res.actions[0].conditionText)}（表达式 ${JSON.stringify(j.actions[0].condition.expression)}）`);
    }
  }
  // ③ 命座要求是可展开项、默认收起，摘要里带模式与目标命座数
  const a3 = g('createAction')({ name: 'fold', character: '枫原万叶', type: 4, conditionText: 'e-ready' });
  a3.consMode = 'open'; a3.consTarget = 3; a3.consEnabled = true;
  a3.slot = 1;
  g('recomputeIndexes')([a3]);
  g('state').strategy.actions = [a3];
  g('state').ui.editingCharacter = '枫原万叶';
  g('state').ui.collapsed = {};
  g('state').ui.detailsOpen = {};
  g('state').ui.tab = 'actions';
  g('renderActionsPanel')();
  const det = dom.document.querySelector(`details[data-details="${a3.id}:cons"]`);
  if (!det) throw new Error('单文件 HTML：动作卡片里没有「命座要求」可展开项');
  if (det.open) throw new Error('单文件 HTML：「命座要求」默认应当是收起的');
  const sum = det.querySelector('summary').textContent;
  if (!sum.includes('达到命座开启') || !sum.includes('3 命') || !sum.includes('达到目标命座')) {
    throw new Error('单文件 HTML：「命座要求」摘要不对：' + sum);
  }
  // ④ 搜索框支持角色表里的其它写法，且那串写法只出现在搜索框的 value 里
  const ayaka = g('getAvatar')('神里绫华');
  if (!g('avatarHitAll')(ayaka, '白鹭公主')) throw new Error('单文件 HTML：搜索命中判断没有算上角色表里的其它写法');
  if (!g('avatarMatchesQuery')('神里绫华', g('avatarCodeLabel')(ayaka))) throw new Error('单文件 HTML：编号搜索被破坏了');
  g('state').ui.characterSearch = '白鹭公主';
  g('renderActionsPanel')();
  const list = g('filteredAvatars')().map(x => x.key);
  if (!list.includes('神里绫华') || list.length !== 1) throw new Error('单文件 HTML：按其它写法筛选的结果不对：' + JSON.stringify(list));
  const html2 = g('$')('paneActions').innerHTML;
  if ((html2.split('白鹭公主').length - 1) !== 1 || !html2.includes('value="白鹭公主"')) {
    throw new Error('单文件 HTML：搜索用的写法出现在了搜索结果里（只允许作为搜索框里用户输入的内容）');
  }
  g('state').ui.characterSearch = '';
}

console.log(`✔ 单文件 HTML 可用（${(html.length / 1024).toFixed(1)} KB）：${expr}`);
