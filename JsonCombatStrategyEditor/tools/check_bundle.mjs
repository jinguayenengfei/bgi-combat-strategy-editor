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

console.log(`✔ 单文件 HTML 可用（${(html.length / 1024).toFixed(1)} KB）：${expr}`);
