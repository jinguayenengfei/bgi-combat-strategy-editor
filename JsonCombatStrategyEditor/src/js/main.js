/* 主控制器：页签、渲染调度、事件委托、持久化、模态对话框 */

const app = {
  panels: {},
  handlers: {},
  fieldHandlers: {},
  _saveTimer: null,
  _infoPending: false,   // 「策略名称 / 版本」有修改还没写进本地草稿（等用户改完再落盘）
  _lastJson: '',
  _saving: false,        // 正在落盘（saveDraftNow）：期间不再排新的保存
  _flushing: false,      // 正在把界面内容写回模型（flushDomToModel）
  _flushDirty: false,    // 写回过程中确实改动了模型 → 写回结束后补排一次保存
  _flushPanels: null,    // 写回过程中被挡下来的面板重建 → 写回结束后统一重建一次
  lastCondField: null,   // 最后一次聚焦的条件输入框（含光标位置）
  lastQcField: null,     // 最后一次聚焦的指令输入框（含光标位置）
  ime: false,            // 输入法是否正在组字
  imePending: false,     // 组字期间有输入被挂起，组字结束后补一次
};
const sideEl = () => $('side');

/* ---------------- 持久化 ---------------- */

function loadRarity() {
  try { state.rarity = JSON.parse(localStorage.getItem(LS_RARITY) || '{}') || {}; } catch (e) { state.rarity = {}; }
}
function saveRarity() { localStorage.setItem(LS_RARITY, JSON.stringify(state.rarity)); }

function loadUi() {
  try {
    const u = JSON.parse(localStorage.getItem(LS_UI) || 'null');
    if (u) Object.assign(state.ui, u);
  } catch (e) { /* 忽略 */ }
}
function saveUi() {
  try {
    const u = { ...state.ui };
    delete u.collapsed;
    delete u.detailsOpen;
    delete u.condSnippet;
    delete u.teamOps;
    delete u.teamFilterOps;
    delete u.moreAddForm;
    delete u.pendingCond;
    delete u.preAvatarSearch;
    delete u.newMoreText;
    localStorage.setItem(LS_UI, JSON.stringify(u));
  } catch (e) { /* 忽略 */ }
}

/** 策略名称（未填时用「未命名策略」） */
function draftName() {
  const n = (state.strategy.info.name || '').trim();
  return n || '未命名策略';
}
function draftVersion() {
  return String(state.strategy.info.version || '').trim();
}
/** 草稿键里的分隔符：用控制字符，正常输入打不出来，不会和「策略名称 / 版本」里的内容冲突 */
const DRAFT_SEP = '\u0001';
/** 本地草稿按「策略名称 + 版本」两个条件归档：二者有其一不同就是不同的草稿 */
function makeDraftKey(name, version) {
  const n = name === undefined || name === null || String(name).trim() === '' ? '未命名策略' : String(name).trim();
  const v = String(version === undefined || version === null ? '' : version).trim();
  return v ? n + DRAFT_SEP + v : n;
}
function draftKey() { return makeDraftKey(state.strategy.info.name, state.strategy.info.version); }
/** 草稿键 → { name, version }（兼容只有一个「策略名称」的旧草稿） */
function parseDraftKey(key) {
  const k = String(key === undefined || key === null ? '' : key);
  const i = k.indexOf(DRAFT_SEP);
  if (i < 0) return { name: k || '未命名策略', version: '' };
  return { name: k.slice(0, i) || '未命名策略', version: k.slice(i + 1) };
}
/** 取最近保存的草稿键（用于启动时恢复） */
function latestDraftKey() {
  const drafts = loadDrafts();
  const keys = Object.keys(drafts);
  if (!keys.length) return '';
  keys.sort((a, b) => (drafts[b].time || 0) - (drafts[a].time || 0));
  return keys[0];
}

/**
 * 载入草稿/导入后，把「触发条件 / 队友条件拆分」与「无法识别的字段」的提示弹窗提醒一次。
 * 这些提示只在 expression 的队友条件结构不常规、或原文件里有本编辑器不认识的字段时出现
 * （内容不会丢，但来源需要确认）。
 */
function notifySplitNotes(problems, title) {
  const list = (problems || []).filter(p => p.kind === 'teammate-split');
  const unknown = (problems || []).filter(p => p.kind === 'unknown-field');
  if (!list.length && !unknown.length) return;
  openModal({
    title: title || '触发条件 / 队友条件的拆分提示',
    body: `${list.length ? `<div class="warnbox mb">载入时发现 ${list.length} 处队友条件结构不常规，已按最保守的方式处理（不会丢内容）：</div>
      <div class="scroll" style="max-height:320px">${list.map(p => `<div style="margin:4px 0">· ${esc(p.text)}</div>`).join('')}</div>` : ''}
      ${unknown.length ? `<div class="warnbox mb" style="margin-top:8px">原文件里有 ${unknown.length} 处既不能识别、也不支持编辑的字段（BetterGI 会静默忽略它们，本编辑器同样忽略，但在这里提醒你）：</div>
      <div class="scroll" style="max-height:320px">${unknown.map(p => `<div style="margin:4px 0">· ${esc(p.text)}</div>`).join('')}</div>` : ''}
      <div class="hint" style="margin-top:8px">正常情况下，本编辑器导出的策略里，同一个动作的各条 expression 会带同一段队友条件，也不会有多余字段，载入时不会出现这些提示。</div>`,
    actions: [{ label: '知道了', primary: true, value: null }],
  });
}

function loadDrafts() {
  try { return JSON.parse(localStorage.getItem(LS_DRAFT) || '{}') || {}; } catch (e) { return {}; }
}
/** 同一「策略名称 + 版本」只保留最新的一份（旧键可能是改名/改版本之前留下的） */
function pruneDraftDuplicates(drafts, key) {
  const want = parseDraftKey(key);
  for (const k of Object.keys(drafts)) {
    if (k === key) continue;
    const d = parseDraftKey(k);
    if (d.name === want.name && d.version === want.version) delete drafts[k];
  }
}
function saveDraftNow() {
  // 落盘前把界面上还没进入模型的编辑（尤其是最后一次编辑：可能还卡在中文输入法组字里）
  // 先写回模型，再序列化 —— 草稿里不会再有“最后一次编辑的内容”。
  // _saving 期间 markDirty 排不出新的保存：这次落盘写的就是写回之后的模型，不需要再来一次
  // （否则会形成「保存 → 写回 → 再排一次保存 → …」的死循环）。
  const prevSaving = app._saving;
  app._saving = true;
  try {
    flushDomToModel();
    syncCondTextareasFromModel();
    const drafts = loadDrafts();
    const key = draftKey();
    drafts[key] = { time: Date.now(), json: buildJson() };
    pruneDraftDuplicates(drafts, key);
    // 只保留最近 30 份，避免 localStorage 溢出
    const keys = Object.keys(drafts);
    if (keys.length > 30) {
      keys.sort((a, b) => (drafts[a].time || 0) - (drafts[b].time || 0));
      for (const k of keys.slice(0, keys.length - 30)) delete drafts[k];
    }
    try { localStorage.setItem(LS_DRAFT, JSON.stringify(drafts)); } catch (e) { /* 忽略 */ }
    state.ui.lastDraft = key;
    app._infoPending = false;
    saveUi();
  } finally {
    app._saving = prevSaving;
  }
}
/** 有「策略名称 / 版本」的修改还没落盘 */
function hasPendingInfoEdit() { return !!app._infoPending; }
/**
 * 用户在「策略名称 / 版本」里改过内容之后，在他改完（把光标移到别的输入框、点击别的按钮或切页）时落盘。
 * 不直接把「半截名字」写进草稿：避免了本地草稿里出现一堆只改到一半的条目。
 */
function flushPendingInfoEdit() {
  if (!app._infoPending) return;
  clearTimeout(app._saveTimer);
  app._saveTimer = null;
  saveDraftNow();
  renderFooter();
}
function markDirty(defer) {
  // 写回（flushDomToModel）过程中产生的「改脏」不在当场排保存，记一笔、等写回结束后统一排一次：
  // 否则「保存 → 写回 → 又排一次保存 → …」会变成一个永不停歇的保存循环（界面会被反复重建，
  // 输入框的选中与光标每次都被清掉）。写回结束后模型已经是最新的，排一次就够。
  if (app._flushing) { app._flushDirty = true; return; }
  // 落盘（saveDraftNow）内部触发的改脏同理：这次落盘序列化的是写回之后的模型，已经包含这次改动，
  // 不必也不能再排一次保存。
  if (app._saving) return;
  if (defer) {
    app._infoPending = true;
    // 草稿键依赖「策略名称 + 版本」，所以在用户改完之前不能留下任何排队的保存：
    // 否则「先改描述（排队 600ms）→ 再改名称」时，那次排队会在半截名称上落盘。
    clearTimeout(app._saveTimer);
    app._saveTimer = null;
    return;
  }
  flushPendingInfoEdit();     // 改别的内容：先把没落盘的「策略名称 / 版本」补上（新键会接管草稿）
  app._infoPending = false;
  clearTimeout(app._saveTimer);
  app._saveTimer = setTimeout(() => { saveDraftNow(); renderFooter(); }, 600);
}

/* ---------------- 渲染调度 ---------------- */

function setTab(tab) {
  flushPendingInfoEdit();   // 切页也算“策略名称 / 版本改完了”（浏览器里失焦已经先触发过一次，这里是兜底）
  flushPendingEdits();      // 切页会重建面板：把还在输入框里的条件内容先写回模型
  state.ui.tab = tab;
  saveUi();
  renderChrome();
  renderActivePanel();
}
function renderActivePanel() {
  const p = app.panels[state.ui.tab];
  if (p && p.render) p.render();
  stampRenderedPanels();
}
function renderAll() {
  state.lastIssues = validateStrategy();
  rebuildIndexes();
  syncDetailsState();
  renderChrome();
  renderActivePanel();
  stampRenderedPanels();
  renderSide();
}
function rebuildIndexes() {
  recomputeIndexes(state.strategy.actions);
  state.strategy.actions.sort((a, b) => a.index - b.index);
}
function refresh(panels) {
  // 写回（flushDomToModel）过程中不允许重建面板：写回是「保存 / 切页 / 点别的控件」顺带做的事，
  // 在用户还可能正在输入的时候把面板整个换掉，就会把光标、选区、滚动位置一起清掉。
  // 这里只记下「哪几个面板需要重建」，等写回结束后统一重建一次。
  if (app._flushing) {
    if (!app._flushPanels) app._flushPanels = new Set();
    for (const t of (panels || [state.ui.tab])) app._flushPanels.add(t);
    return;
  }
  state.lastIssues = validateStrategy();
  rebuildIndexes();
  syncDetailsState();
  const scroll = captureScroll();
  renderChrome();
  const list = panels || [state.ui.tab];
  for (const t of list) if (app.panels[t] && app.panels[t].render) app.panels[t].render();
  stampRenderedPanels();
  restoreScroll(scroll);
  renderSide();
  markDirty();
}
/** 拿一个表单元素的当前值（checkbox 取勾选状态），与 ctrlValue 一致 */
function domFieldValue(el) {
  return el.type === 'checkbox' ? !!el.checked : el.value;
}

/* ---------------- 「上次渲染进 DOM 的值」 ----------------
 * 面板重建（innerHTML）之后，新节点上的 value 是渲染那一刻的模型值。
 * 把它记在 data-rendered 上，写回模型时就有了“上次显示的是什么”这个基线：
 * 于是可以把「用户真的改了这个下拉」与「重建 / 浏览器把下拉的值挪了位置」区分开
 * —— 前者才该写回模型（并触发像「尾数冲突」这样的用户级提示）。
 */
const RENDERED_ATTR = 'data-rendered';

/** 读某个控件上次渲染进 DOM 的值（没有记录时返回 undefined） */
function renderedValueOf(el) {
  if (!el || !el.getAttribute || !el.hasAttribute) return undefined;
  return el.hasAttribute(RENDERED_ATTR) ? el.getAttribute(RENDERED_ATTR) : undefined;
}

/** 现在 DOM 里新渲染出来的控件都补上「上次渲染值」基线 */
function stampRenderedValues(root) {
  if (!root || !root.querySelectorAll) return;
  const list = root.querySelectorAll('[data-kind]');
  if (list && list.forEach) list.forEach(stampRenderedValue);
}
/** 渲染（或重建）之后：控件上「用户改过」的痕迹要重新计，之前那批控件的痕迹不再作数 */
function stampRenderedValue(el) {
  if (!el || !el.setAttribute) return;
  // 基线必须与 fieldValueOf / modelFieldValue 用同一套取值口径：
  // 勾选框要比的是 checked（不是 value —— 浏览器里勾选框的 value 恒为 "on"），
  // 否则每次写回都会把「勾选框」判成「用户改过」，进而反复触发重建与保存。
  let v;
  try { v = domFieldValue(el); } catch (e) { v = el.value; }
  try {
    el.setAttribute(RENDERED_ATTR, String(v === null || v === undefined ? '' : v));
    el.setAttribute(EDIT_ATTR, String(editEventSeq));
  } catch (e) { /* 忽略 */ }
}

/* ---------------- 「这个控件上是用户改的」 ----------------
 * 只有真的在控件上派发过 input / change（或输入法组字）事件，才认为这次变化来自用户。
 * 用处：写回模型前，如果发现「下拉的值与模型 / 上次渲染值都不一样、但这个控件从来没收到过任何事件」，
 * 那它就不是用户在改，而是重建面板 / 浏览器顺手把下拉的值挪了位置 —— 这时**恢复成模型里的值**，
 * 而不是把这次意外变化当成用户操作写进模型（那会误报「尾数已被占用」甚至改动编号）。
 * 文本输入框不参与这个判断：中文输入法组字期间 input 事件可能迟到，不能因此丢掉用户的输入。
 */
let editEventSeq = 0;
const lastEditEvent = new WeakMap();
const EDIT_ATTR = 'data-edited-at';

/** 记录「这个控件刚收到了用户事件」 */
function markUserEdit(el) {
  if (!el || typeof el !== 'object') return;
  try { lastEditEvent.set(el, ++editEventSeq); } catch (e) { /* 不可作为键时忽略 */ }
}
/** 这个控件自「上次渲染 / 上次写回」以来有没有收到过用户事件 */
function hasUserEditSince(el) {
  if (!el || typeof el !== 'object') return false;
  const t = Number(el.getAttribute ? el.getAttribute(EDIT_ATTR) : NaN);
  const ev = lastEditEvent.get(el);
  if (!ev) return false;
  return !Number.isFinite(t) || ev > t;
}
/** 渲染 / 写回之后，把「用户事件」的基准时间同步到当前 */
function restampEditBaseline(el) {
  if (!el || !el.setAttribute) return;
  try { el.setAttribute(EDIT_ATTR, String(editEventSeq)); } catch (e) { /* 忽略 */ }
}

/** 模型里这个字段现在的值 */
function modelFieldValue(kind, id, field, idx, sub) {
  if (kind === 'act') {
    const a = state.strategy.actions.find(x => x.id === id);
    if (!a) return undefined;
    if (field === 'tags') return a.tags || '';
    if (field === 'type' || field === 'slot' || field === 'ensureCast') return a[field];
    return a[field];
  }
  if (kind === 'cons') {
    // 命座要求的三个控件（模式 / 目标命座数 / 启用-停用勾选框）。
    // 没有这个分支时 modelFieldValue 恒为 undefined，勾选框会被判成「永远和模型不一样」，
    // 于是每次写回都要重建面板并再排一次保存 —— 就是那个不停歇的保存循环的源头。
    const a = state.strategy.actions.find(x => x.id === id);
    if (!a) return undefined;
    const has = consHasRequirement(a);
    if (field === 'mode') return has ? a.consMode : 'none';
    if (field === 'target') return has ? String(Number(a.consTarget)) : '';
    if (field === 'enabled') return consActiveState(a);
    return undefined;
  }
  if (kind === 'pre') {
    const pa = (state.strategy.info.preActions || [])[Number(idx)];
    return pa ? (pa[field] || '') : undefined;
  }
  if (kind === 'condtext') {
    const a = state.strategy.actions.find(x => x.id === id);
    return a ? (a.conditionText || '') : undefined;
  }
  if (kind === 'moretext') {
    const a = state.strategy.actions.find(x => x.id === id);
    const mp = a && a.morePriorities[Number(idx)];
    return mp ? (mp.text || '') : undefined;
  }
  if (kind === 'morenewtext') return (state.ui.newMoreText || {})[id];
  if (kind === 'more') {
    const a = state.strategy.actions.find(x => x.id === id);
    const mp = a && a.morePriorities[Number(idx)];
    if (!mp) return undefined;
    if (field === 'cmp') return mp.cmp;
    if (field === 'stype') return mp.scope ? mp.scope.type : null;
    if (field === 'selement') return mp.scope ? mp.scope.element : null;
    if (field === 'scharacter') return mp.scope ? mp.scope.character : null;
    return undefined;
  }
  if (kind === 'team') {
    const a = state.strategy.actions.find(x => x.id === id);
    if (!a) return undefined;
    // 「新增角色前用：」的运算符：值存在 state.ui.teamFilterOps 里（键是 动作id:字段名）
    if (field === 'newOp') return ((state.ui.teamFilterOps || {})[`${id}:${sub}`]) === 'and' ? 'and' : 'or';
    // 「自动排除」勾选框：界面上是按「是否勾了这条其他动作」算出来的（见 renderCardTeamTab），
    // 模型里存的却是一个 id 数组 —— 直接拿数组去比会永远「不一致」，于是每次写回都要重写一遍模型，
    // 连带在「只是切个页 / 选个角色」的时候也排一次草稿保存。这里按界面那套算法给出真正的勾选状态。
    if (field === 'autoExclude') {
      const o = state.strategy.actions.find(x => x.id === sub && x.id !== a.id);
      if (!o || (o.character || '') !== (a.character || '')) return false;
      const listed = (a.teammates.autoExclude || []).includes(o.id);
      const bySameType = !!a.teammates.autoExcludeSameType && o.type === a.type && (o.teammates.include || []).length > 0;
      return listed || bySameType;
    }
    return a.teammates[field];
  }
  if (kind === 'charlist') return state.ui[field];
  return undefined;
}

/** 界面上这个控件的值换算成「与模型同类型」的值（下拉里的数字要与模型里的数字比，不能按字符串比） */
function fieldValueOf(kind, field, el) {
  const v = domFieldValue(el);
  if (typeof v !== 'string') return v;
  if (kind === 'act' && (field === 'type' || field === 'slot')) return Number(v);
  if (kind === 'more' && field === 'stype') return v === '' ? null : Number(v);
  if (kind === 'more' && field === 'selement') return v === '' ? null : Number(v);
  return v;
}

/** 两个「控件值 / 模型值」是否算同一个值（null / undefined / 空串一律视为「空」，其余按字符串比） */
function sameFieldValue(a, b) {
  const na = (a === undefined || a === null) ? '' : String(a);
  const nb = (b === undefined || b === null) ? '' : String(b);
  return na === nb;
}

/**
 * 这个控件的内容与模型不一致吗（一致就不必写回，避免无谓的重算与排序）。
 *
 * 基线优先取「上次渲染进这个 DOM 节点的值」（见 RENDERED_ATTR）：与模型比本来也等价，
 * 但控件被重建过之后，模型可能已经变了而新节点上还挂着旧值 —— 用「上次显示的是什么」当基线，
 * 才能分辨出「用户真的改了下拉」和「重建 / 浏览器把下拉的值挪了位置」，
 * 免得后者被当成用户操作（例如把「尾数」下拉的意外变化当成“用户要改尾数”而弹出冲突提示）。
 */
function fieldDiffers(kind, id, field, idx, el) {
  const rendered = renderedValueOf(el);
  const next = fieldValueOf(kind, field, el);
  const sub = (el && el.getAttribute) ? (el.getAttribute('data-sub') || '') : '';
  const cur = rendered === undefined ? modelFieldValue(kind, id, field, idx, sub) : rendered;
  return !sameFieldValue(cur, next);
}

/** 这些字段由 input 事件即时写进模型（且已经带了各自的就地刷新逻辑），兜底时只同步条件文本 */
const FLUSH_SKIP_FIELDS = new Set(['text', 'avatarSearch', 'search']);

/**
 * 输入框 / 下拉里的内容写回模型（模型是唯一事实来源）。
 *
 * 「最后一次编辑的内容」之所以会丢，根因就在这里：以前只有**正在聚焦的那个条件输入框**
 * 会在重建面板前被写回模型（flushPendingEdits），而落盘（saveDraftNow）走的是模型 ——
 * 一旦最近一次编辑没有及时写进模型（中文输入法组字期间 document 级的 input 被挂起、
 * input 事件迟到，或者最后一次改动正好落在“重建面板 / 落盘”的瞬间），那次改动就只留在
 * DOM 里：草稿里没有、界面重建后又按模型刷新回去，看起来就是“最后一次编辑消失了”。
 * 所以这里逐个对齐：**内容与模型不同的才写**（没变就不碰，免得白白触发重算/重建排序），
 * 写的过程不触发任何重绘，输入法与光标都不受影响。
 * 范围限定在三个面板元素里（而不是整份 document）：既不漏掉别的页签上还没写回模型的编辑，
 * 也不会去碰弹窗、指令快捷面板这些自己管理状态的控件。
 */
function flushDomToModel() {
  if (typeof document === 'undefined') return;
  if (app._flushing) return;               // 防重入：写回过程中不再嵌套一次写回
  const panes = ['paneInfo', 'paneActions', 'panePreview']
    .map(id => (typeof $ === 'function' ? $(id) : null))
    .filter(el => el && el.querySelectorAll);
  const roots = panes.length ? panes : [document];
  app._flushing = true;
  app._flushDirty = false;
  app._flushPanels = null;
  try {
    for (const scope of roots) {
      scope.querySelectorAll('[data-kind]').forEach((el) => {
        flushOneField(el);
      });
    }
  } finally {
    app._flushing = false;
  }
  const panels = app._flushPanels;
  const dirty = app._flushDirty;
  app._flushPanels = null;
  app._flushDirty = false;
  // 写回过程中被挡下来的重建：放在写回结束之后统一做一次（不会再被写回打断）
  if (panels && panels.size) refresh([...panels]);
  // 写回确实改动了模型（最后一次编辑还没进模型）→ 补排一次保存。
  // 落盘内部（_saving）不需要补排：这次落盘序列化的就是写回之后的模型。
  if (dirty) markDirty(false);
}

/** 把单个控件的内容按需写回模型 */
function flushOneField(el) {
  if (!el || !el.getAttribute) return;
  if (el.disabled) return;   // 禁用控件用户改不了，写回没有意义（还会把「占位显示值」当成用户选择）
  if (typeof inInfoKeyField === 'function' && inInfoKeyField(el)) return;   // 名称 / 版本按「改完再落盘」的规则走
  const kind = el.getAttribute('data-kind');
  const h = app.fieldHandlers[kind];
  if (!h) return;
  const field = el.getAttribute('data-field') || '';
  const id = el.getAttribute('data-id') || '';
  const idx = el.getAttribute('data-idx') || '';
  if (kind === 'info') return;                                              // 信息页各字段都是即时入模型的
  if (kind === 'pre' && FLUSH_SKIP_FIELDS.has(field)) return;
  if (kind !== 'pre' && FLUSH_SKIP_FIELDS.has(field)) {
    // 条件输入框（condtext / moretext / morenewtext 的 text）：写回模型后顺手就地刷新释义
    if ((kind === 'condtext' || kind === 'moretext' || kind === 'morenewtext') && fieldDiffers(kind, id, field, idx, el)) {
      writeCondText(kind, id, idx, el.value);
      if (typeof updateCondExplanation === 'function') {
        updateCondExplanation({ kind: kind === 'moretext' ? 'more' : (kind === 'morenewtext' ? 'morenew' : 'cond'), id, idx, el });
      }
    }
    return;
  }
  if (!fieldDiffers(kind, id, field, idx, el)) return;
  // 下拉（select）的值与模型 / 上次渲染值都不同，但这个控件从来没收到过 input / change：
  // 这不是用户在改，而是重建面板 / 浏览器把值挪了位置（例如「尾数」下拉被挪成了别的值）。
  // 这时把界面恢复成模型里的值，绝不写回模型 —— 否则会误报「尾数已被占用」，甚至改掉编号。
  const tag = String(el.tagName || '').toUpperCase();
  if (tag === 'SELECT' && !hasUserEditSince(el)) {
    const want = modelFieldValue(kind, id, field, idx, el.getAttribute('data-sub') || '');
    const txt = (want === undefined || want === null) ? '' : String(want);
    if (el.value !== txt) {
      try { el.value = txt; } catch (e) { /* 某些类型不支持 */ }
    }
    return;
  }
  h({ kind, actionId: id, field, idx, sub: el.getAttribute('data-sub') || '', value: domFieldValue(el), el }, false);
  // 这次变化已经处理过了（写进模型，或因为冲突被拒绝、界面上也回退/修正过）：
  // 把基线与当前显示值对齐，免得同一个值在下一次写回时被当成「用户又改了一次」而重复提示
  // （典型的重复提示：改尾数撞车时，「尾数 N 已被占用」会弹两遍）。
  if (el.setAttribute) {
    try { el.setAttribute(RENDERED_ATTR, String(domFieldValue(el))); } catch (e) { /* 忽略 */ }
  }
  restampEditBaseline(el);
}

/** 重建面板前：把正在编辑、但还没写进模型的内容先存下来，避免输入被重建后的 DOM 覆盖掉 */
function flushPendingEdits() {
  flushDomToModel();
  const el = typeof document !== 'undefined' ? document.activeElement : null;
  if (!el || !el.getAttribute) return;
  if (typeof flushCondTextarea === 'function') flushCondTextarea(el);
}

function rerenderCurrent(keepFocus) {
  // 先记下焦点与滚动位置，再写回：写回本身（以及它可能触发的延迟重建）会把旧 DOM 换掉，
  // 事后再取就只能取到「已经归零」的位置（角色列表看起来就“弹回了顶部”）。
  const snap = keepFocus ? captureFocus() : null;
  const scroll = captureScroll();
  flushPendingEdits();
  const p = app.panels[state.ui.tab];
  if (p && p.render) p.render();
  stampRenderedPanels();
  restoreScroll(scroll);
  renderChrome();
  renderSide();
  if (snap) restoreFocus(snap);
}

/** 重建面板之后，把刚渲染出来的控件都打上「上次渲染值」基线（见 RENDERED_ATTR） */
function stampRenderedPanels() {
  if (typeof document === 'undefined') return;
  stampRenderedValues(document.getElementById('paneInfo'));
  stampRenderedValues(document.getElementById('paneActions'));
  stampRenderedValues(document.getElementById('panePreview'));
}

/** 记住可滚动容器（如角色列表）的滚动位置，重建 DOM 后原样恢复，避免列表跳到最顶 */
function captureScroll() {
  const out = {};
  document.querySelectorAll('[data-scroll]').forEach(el => { out[el.getAttribute('data-scroll')] = el.scrollTop || 0; });
  return out;
}
function restoreScroll(saved) {
  if (!saved) return;
  document.querySelectorAll('[data-scroll]').forEach(el => {
    const v = saved[el.getAttribute('data-scroll')];
    if (v) el.scrollTop = v;
  });
}

/** 记录当前展开的 details（重建 DOM 后用于恢复），并处理用户的手动展开/收起 */
function syncDetailsState() {
  document.querySelectorAll('details[data-details]').forEach(d => {
    state.ui.detailsOpen[d.getAttribute('data-details')] = !!d.open;
  });
}

function renderChrome() {
  // 页签
  const tabs = [
    ['info', '策略信息 / 导入导出'],
    ['actions', '动作编辑'],
    ['preview', '优先级预览'],
  ];
  $('tabs').innerHTML = tabs.map(([k, name]) => `<button data-act="tab" data-tab="${k}" class="${state.ui.tab === k ? 'on' : ''}">${name}</button>`).join('');
  for (const [k] of tabs) {
    const el = $('pane' + k[0].toUpperCase() + k.slice(1));
    if (el) el.classList.toggle('hidden', state.ui.tab !== k);
  }
  // 头部状态
  renderHeaderStatus();
  renderHeaderIssues();
  // 侧栏显隐
  sideEl().classList.toggle('hidden', !state.ui.showIssues);
  renderFooter();
}

/** 头部「策略名称 · N 条动作 / M 个角色」（改名称 / 版本时单独刷新，不必重建整个面板） */
function renderHeaderStatus() {
  const s = state.strategy;
  const charCnt = new Set(s.actions.map(a => a.character || '')).size;
  $('hdrStatus').textContent = `${draftName()} · ${s.actions.length} 条动作 / ${charCnt} 个角色`;
}

/** 头部错误/警告徽标（可单独刷新，供输入过程中的实时校验复用） */
function renderHeaderIssues() {
  const iss = state.lastIssues || { errors: [], warnings: [] };
  $('hdrIssues').innerHTML =
    (iss.errors.length ? `<span class="badge err">${iss.errors.length} 个错误</span>` : '<span class="badge ok">校验通过</span>') +
    (iss.warnings.length ? `<span class="badge warn">${iss.warnings.length} 个警告</span>` : '');
}

/**
 * 输入过程中的实时校验：重新跑一遍校验并刷新校验面板、头部徽标与动作卡片里的报错条，
 * 不重建正在编辑的面板（避免打断输入法、光标与选区）。
 */
function refreshLiveIssues() {
  state.lastIssues = validateStrategy();
  renderHeaderIssues();
  renderSide();
  updateCardIssues();
}

/**
 * 只刷新动作卡片里的报错/警告条、角标与条件摘要。
 * 手输内容（动作指令、条件表达式、动作名…）后卡片里的旧报错必须跟着消失，
 * 否则会一直显示上一次的结论，直到手动收起再展开卡片。
 */
function updateCardIssues() {
  const iss = state.lastIssues || { errors: [], warnings: [] };
  document.querySelectorAll('[data-cardissues]').forEach(el => {
    const id = el.getAttribute('data-cardissues');
    const errs = iss.errors.filter(x => x.actionId === id);
    const warns = iss.warnings.filter(x => x.actionId === id);
    el.innerHTML = cardIssueBoxes(errs, warns);
  });
  document.querySelectorAll('[data-cardbadges]').forEach(el => {
    const id = el.getAttribute('data-cardbadges');
    const errs = iss.errors.filter(x => x.actionId === id);
    const warns = iss.warnings.filter(x => x.actionId === id);
    el.innerHTML = (errs.length ? `<span class="badge err">${errs.length}</span>` : '')
      + (warns.length ? `<span class="badge warn">${warns.length}</span>` : '');
  });
  document.querySelectorAll('[data-cardsummary]').forEach(el => {
    const a = state.strategy.actions.find(x => x.id === el.getAttribute('data-cardsummary'));
    if (!a) return;
    // 卡片标题旁显示的是这条动作的**动作指令串**（触发条件表达式在「触发条件」区块标题旁）
    const cmd = String(a.action || '').trim();
    el.textContent = cmd || '（空指令）';
  });
  // 「编号（自动）」下面的引用注释也可能因为别处的条件改动而变化，跟着一起刷新
  document.querySelectorAll('[data-refnote]').forEach(el => {
    const a = state.strategy.actions.find(x => x.id === el.getAttribute('data-refnote'));
    if (a) el.innerHTML = actionReferrerNote(a);
  });
  // 卡片外框的配色也跟着错误/警告变化
  document.querySelectorAll('[data-card]').forEach(el => {
    const id = el.getAttribute('data-card');
    const errs = iss.errors.filter(x => x.actionId === id).length;
    const warns = iss.warnings.filter(x => x.actionId === id).length;
    el.classList.toggle('err', errs > 0);
    el.classList.toggle('warn', errs === 0 && warns > 0);
  });
}

function renderFooter() {
  const drafts = loadDrafts();
  const keys = Object.keys(drafts);
  const cur = draftKey();
  const name = draftName();
  const ver = draftVersion();
  $('footInfo').innerHTML = `当前草稿：<b>${esc(name)}</b>${ver ? `（版本 <b>${esc(ver)}</b>）` : ''} · 本地已保存 ${keys.length} 份草稿`
    + (keys.includes(cur)
      ? ` · 最近保存 ${new Date(drafts[cur].time).toLocaleString()}`
      : (app._infoPending ? ' · <span style="color:var(--warn)">策略名称 / 版本改动待保存（把光标移到别的输入框、点别的按钮或切页后自动保存）</span>' : ''));
}

/* 侧栏：校验面板 */
function renderSide() {
  if (!state.ui.showIssues) return;
  const iss = state.lastIssues || { errors: [], warnings: [] };
  const conv = iss.conversions || [];
  const convOpen = !!state.ui.convOpen;
  const item = (x, cls) => {
    const a = x.actionId ? state.strategy.actions.find(z => z.id === x.actionId) : null;
    const jump = a ? ` data-act="jump" data-id="${attr(a.id)}"` : '';
    return `<div class="roleitem" style="align-items:flex-start;padding:4px 6px"${jump}>
      <span class="${cls === 'err' ? 'badge err' : 'badge warn'}" style="margin:0">${cls === 'err' ? '错误' : '警告'}</span>
      <span class="nm" style="white-space:normal;line-height:1.45">${esc(x.text)}</span></div>`;
  };
  sideEl().innerHTML = `
    <div class="card">
      <h3>校验结果 <span class="hint">编辑过程中持续检查</span></h3>
      ${iss.errors.length || iss.warnings.length ? '' : '<div class="okbox">全部通过，可以导出。</div>'}
      ${iss.errors.length ? `<div class="hint" style="margin:6px 0 4px">错误（会阻止导出）</div>${iss.errors.map(x => item(x, 'err')).join('')}` : ''}
      ${iss.warnings.length ? `<div class="hint" style="margin:10px 0 4px">警告（不阻止导出）</div>${iss.warnings.map(x => item(x, 'warn')).join('')}` : ''}
    </div>
    <div class="card">
      <h3 data-act="toggle-conv" style="cursor:pointer;user-select:none">
        <span class="dim">${convOpen ? '▾' : '▸'}</span> 隐式转换检查（数值 ↔ 布尔）
        ${conv.length ? `<span class="badge warn">${conv.length} 处</span>` : '<span class="badge ok">未发现</span>'}
        <span class="hint">点击${convOpen ? '收起' : '展开'}；正常校验不提示这类问题</span>
      </h3>
      ${convOpen ? `<div class="hint" style="line-height:1.7;margin-bottom:6px">条件运算里的布尔值和数值之间会发生隐式转换（true↔1、false↔0），写错参数类型不会报错、只会算出与预期不符的结果；有时候这种转换正是你想要的，所以这里只在“按位置推断出的类型与期望不符”时列出来，供你确认。</div>
      ${conv.length
        ? conv.map(c => `<div class="warnbox mb"><div><b>${esc(c.where)}</b></div><div class="mono" style="margin-top:3px;word-break:break-all">${esc(c.text)}</div><div class="hint" style="margin-top:3px">${esc(c.reason)}</div></div>`).join('')
        : '<div class="okbox">没有发现数值与布尔互转的位置。</div>'}` : ''}
    </div>
    <div class="card">
      <h3>编辑时的检查要点</h3>
      <div class="hint" style="line-height:1.7">
        · 动作名会写进动作节点的 name，用于日志与 since/count 按名引用，不能重复、不能是 true/false、纯数字或 14 个内置函数名，也不能含空格、标点符号（注：小数点也是标点）或运算符（用作多段字符中间的连字符的-除外）<br>
        · 指定了角色的动作，第一条指令要能保证触发切人，否则轮到他（她）时可能不会切人。万一遇到不能保证触发切人的提醒，在前面加个时间很短的行走动作是最简单的解决方案<br>
        · q 后面建议带 ready，否则大招动画期间容易被吞后续动作（虽然四星角色通常没有大招动画）。靠固定时间 wait 或 attack 硬耗时间的方案不可取——万一大招没放出来，不切走还愣着干嘛？<br>
        · 勾了「确保E技能释放成功」的动作里必须有 e / keydown(e) 之类指令，没有的话会导致整个动作指令串被重跑 5 次<br>
        · 请注意条件运算的入参和出参是布尔值还是数值——因为条件运算中的布尔值和数值之间会发生隐式转换，即便你搞错参数类型也不会报错，只会算出与你预期不符的结果
      </div>
    </div>`;
}

/* ---------------- 表单绑定助手 ---------------- */

/** 生成一个绑定到动作字段的输入控件 */
function ctrl(opts) {
  const o = Object.assign({ tag: 'input', kind: '', actionId: '', field: '', idx: '', sub: '', value: '', placeholder: '', cls: '', style: '', type: 'text', min: null, max: null, step: null, options: null, extra: '' }, opts);
  const focusKey = `${o.kind}:${o.actionId}:${o.field}:${o.idx}:${o.sub}`;
  const common = `data-kind="${attr(o.kind)}" data-id="${attr(o.actionId)}" data-field="${attr(o.field)}" data-idx="${attr(o.idx)}" data-sub="${attr(o.sub)}" data-focus="${attr(focusKey)}"`;
  if (o.tag === 'select') {
    return `<select ${common} class="${o.cls}" style="${o.style}">` +
      (o.options || []).map(([v, t]) => `<option value="${attr(v)}" ${String(v) === String(o.value) ? 'selected' : ''}>${esc(t)}</option>`).join('') +
      '</select>';
  }
  if (o.tag === 'textarea') {
    return `<textarea ${common} rows="${o.rows || 3}"${o.extra || ''} class="${o.cls}" style="${o.style}" placeholder="${attr(o.placeholder)}">${esc(o.value)}</textarea>`;
  }
  const numAttr = (o.type === 'number' ? ` type="number"${o.min !== null ? ` min="${o.min}"` : ''}${o.max !== null ? ` max="${o.max}"` : ''}${o.step !== null ? ` step="${o.step}"` : ''}` : '');
  return `<input ${common}${numAttr}${o.extra || ''} class="${o.cls}" style="${o.style}" value="${attr(o.value ?? '')}" placeholder="${attr(o.placeholder)}">`;
}

/** 读取表单控件的值 */
function ctrlValue(el) {
  if (el.type === 'checkbox') return el.checked;
  return el.value;
}

/* ---------------- 事件委托 ---------------- */

function bindEvents() {
  document.addEventListener('click', (e) => {
    // 「策略名称 / 版本」的落盘判定之一：用户点了别的按钮 / 下拉 / 可点区域，就说明这两个输入框改完了。
    // 不用 focusout 判断（中文输入法组字时会误触发失焦，把还没输完的名称当成改完写进草稿）。
    if (app._infoPending && clickLeftInfoKeyField(e.target)) flushPendingInfoEdit();
    const t = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!t) return;
    const act = t.getAttribute('data-act');
    if (act === 'tab') { setTab(t.getAttribute('data-tab')); return; }
    if (act === 'jump') { jumpToAction(t.getAttribute('data-id')); return; }
    if (act === 'toggleIssues') { state.ui.showIssues = !state.ui.showIssues; saveUi(); renderChrome(); renderSide(); return; }
    if (act === 'toggle-conv') { state.ui.convOpen = !state.ui.convOpen; saveUi(); renderSide(); return; }
    if (act === 'closeModal') { closeModal(null); return; }
    const h = app.handlers[act];
    if (h) { e.preventDefault(); h(t, e); return; }
    const h2 = app.handlers['*'];
    if (h2) h2(t, e);
  });

  document.addEventListener('change', (e) => onFieldChange(e.target, false));
  document.addEventListener('input', (e) => {
    // 中文输入法组字期间不要重建界面：重建会打断候选框，导致拼音变成乱码/重复字母
    if (app.ime) { app.imePending = true; return; }
    onFieldChange(e.target, true);
  });
  // 输入法组字状态跟踪（微软拼音等输入法）：组字期间冻结重绘，组字结束后补一次
  document.addEventListener('compositionstart', () => { app.ime = true; app.imePending = false; });
  document.addEventListener('compositionend', (e) => {
    app.ime = false;
    const el = e.target;
    const pending = app.imePending;
    app.imePending = false;
    if (pending && el) onFieldChange(el, false);
  });
  // 记录最后一次获得焦点的条件输入框（快捷添加/运算符按钮要按它的光标位置插入）
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!el || !el.getAttribute) return;
    // 「策略名称 / 版本」的落盘判定之一：光标进入了别的输入框 / 按钮，说明这两个输入框改完了。
    // 这两个输入框自身获得焦点（包括组字时的重复 focusin）不触发落盘。
    if (app._infoPending && !inInfoKeyField(el)) flushPendingInfoEdit();
    const info = condFieldInfo(el);
    if (info) app.lastCondField = { el, ref: el.getAttribute('data-cond-ref') || '', start: el.selectionStart, end: el.selectionEnd };
    const kind = el.getAttribute('data-kind');
    if ((kind === 'act' || kind === 'pre') && el.getAttribute('data-ref')) {
      app.lastQcField = { el, ref: el.getAttribute('data-ref') };
    }
  });
  document.addEventListener('keyup', () => { syncCondSelection(); });
  document.addEventListener('mouseup', () => { syncCondSelection(); });
  // details 的展开/收起：记录到 state，重建界面后保持
  document.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!d || !d.getAttribute || !d.getAttribute('data-details')) return;
    state.ui.detailsOpen[d.getAttribute('data-details')] = !!d.open;
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isModalOpen()) { closeModal(null); }
  });

  // 关页 / 跳转时兜底落盘：这不是「光标离开输入框」的判定（组字过程中不会触发），
  // 只是避免「输完就关掉页面」时那一次改动丢掉 —— 包括还没到 600ms 定时器的编辑，
  // 以及最后一次编辑还停在输入法组字里、没写进模型的情况。
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('beforeunload', () => {
      clearTimeout(app._saveTimer);
      app._saveTimer = null;
      saveDraftNow();
    });
  }
}

/** 记录条件输入框里的光标位置（快捷添加面板用它决定插入点） */
function syncCondSelection() {
  const el = document.activeElement;
  if (!el || !el.getAttribute) return;
  const info = condFieldInfo(el);
  if (info) app.lastCondField = { el, ref: el.getAttribute('data-cond-ref') || '', start: el.selectionStart, end: el.selectionEnd };
}

/** 「策略名称 / 版本」这两个输入框：它们的修改要等用户改完再写进本地草稿（见 markDirty） */
function isInfoKeyField(el) {
  if (!el || !el.getAttribute) return false;
  if (el.getAttribute('data-kind') !== 'info') return false;
  const f = el.getAttribute('data-field');
  return f === 'name' || f === 'version';
}

/** 元素本身是、或位于「策略名称 / 版本」输入框里 */
function inInfoKeyField(el) {
  if (!el || !el.getAttribute) return false;
  if (isInfoKeyField(el)) return true;
  return !!(el.closest && el.closest('[data-kind="info"][data-field="name"], [data-kind="info"][data-field="version"]'));
}

/**
 * 「策略名称 / 版本」的落盘判定（点击）：点到别的按钮 / 下拉 / 可点区域，或者别的内容的输入框时算改完。
 * 组字过程中输入法不会在页面上产生 click，而点击这两个输入框自身（放光标）不算改完。
 */
function clickLeftInfoKeyField(target) {
  if (!target || !target.getAttribute) return false;
  if (inInfoKeyField(target)) return false;
  return !!(target.closest && target.closest('button, select, label, [data-act], [data-kind]'));
}

function onFieldChange(el, isInput) {
  const kind = el.getAttribute && el.getAttribute('data-kind');
  if (!kind) return;
  // 走到这里说明是控件上真的派发了 input / change（含输入法组字结束补的那次），记一笔：
  // flushDomToModel 靠它区分「用户在改」与「重建面板把值挪了位置」（见 hasUserEditSince）。
  markUserEdit(el);
  const info = {
    kind,
    actionId: el.getAttribute('data-id') || '',
    field: el.getAttribute('data-field') || '',
    idx: el.getAttribute('data-idx') || '',
    sub: el.getAttribute('data-sub') || '',
    value: ctrlValue(el),
    el,
  };
  const h = app.fieldHandlers[kind];
  if (!h) return;
  // 「策略名称 / 版本」在用户改完（把光标移到别的输入框 / 点别的按钮 / 切页 / 改别的内容）之前不写草稿，
  // 免得本地草稿里出现一堆只改到一半的名称；其他字段维持原来的“立即保存”。
  // 这里刻意不看 isInput：input / change / 输入法组字结束（compositionend 补的那次）都可能出现在
  // 用户还没输完的时候（微软拼音等输入法尤其明显），一律按「还没改完」处理。
  const defer = isInfoKeyField(el);
  markDirty(defer);
  const r = h(info, isInput);
  if (r === true) rerenderCurrent(true);
  else if (r === 'refresh') refresh(['info', 'actions', 'preview']);
}

function jumpToAction(id) {
  const a = state.strategy.actions.find(x => x.id === id);
  if (!a) return;
  state.ui.editingCharacter = a.character || '';
  state.ui.collapsed[a.id] = false;
  setTab('actions');
  renderActivePanel();
  setTimeout(() => {
    const el = document.querySelector(`[data-card="${id}"]`);
    if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.style.outline = '2px solid var(--acc)'; setTimeout(() => { el.style.outline = ''; }, 1600); }
  }, 60);
}

/* ---------------- 导入 / 导出 ---------------- */

function doExport() {
  // 导出等于“编辑告一段落”：先把还没落盘的「策略名称 / 版本」写进草稿，再走校验
  flushPendingInfoEdit();
  const v = validateStrategy();
  if (v.errors.length) {
    state.lastIssues = v;
    state.ui.showIssues = true;
    renderChrome(); renderSide();
    openModal({
      title: '导出被拒绝：还有 ' + v.errors.length + ' 个错误',
      body: `<div class="errbox" style="margin-bottom:8px">导出的 JSON 必须能被 BetterGI 正常加载，请先修正以下问题（右侧校验面板可点击定位）：</div>
        ${v.errors.slice(0, 40).map(x => `<div style="margin:4px 0">· ${esc(x.text)}</div>`).join('')}
        ${v.errors.length > 40 ? `<div class="hint">…其余 ${v.errors.length - 40} 条见右侧面板</div>` : ''}`,
      actions: [{ label: '知道了', primary: true, value: null }],
    });
    return;
  }
  const text = buildJsonText();
  const fname = (state.strategy.info.name || '战斗策略').replace(/[\\/:*?"<>|]/g, '_') + '.json';
  downloadText(fname, text);
  if (v.warnings.length) {
    openModal({
      title: '已导出（有 ' + v.warnings.length + ' 个警告）',
      body: `<div class="okbox" style="margin-bottom:8px">文件已开始下载：<b>${esc(fname)}</b></div>
        <div class="hint">以下是不会阻止运行、但值得确认的警告：</div>
        ${v.warnings.slice(0, 30).map(x => `<div style="margin:4px 0">· ${esc(x.text)}</div>`).join('')}`,
      actions: [{ label: '知道了', primary: true, value: null }],
    });
  }
}

function doImportFromText(text, fname) {
  let obj;
  try { obj = JSON.parse(text); }
  catch (err) {
    openModal({
      title: '导入失败：JSON 语法错误',
      body: `<div class="errbox">${esc(err.message)}</div><div class="hint" style="margin-top:8px">BetterGI 加载时会抛出「JSON 战斗策略格式错误」。注意 JSON 不支持注释和尾随逗号。</div>`,
      actions: [{ label: '知道了', primary: true, value: null }],
    });
    return;
  }
  const res = analyzeImport(obj);
  if (res.fatal.length) {
    openModal({
      title: '导入被拒绝：策略无法被 BetterGI 正常加载',
      body: `<div class="errbox" style="margin-bottom:8px">这些是 BetterGI 解析期就会抛异常的情况，导入后也无法运行：</div>
        ${res.fatal.map(x => `<div style="margin:4px 0">· ${esc(x)}</div>`).join('')}`,
      actions: [{ label: '取消导入', primary: true, value: null }],
    });
    return;
  }

  const needs = importNeeds(res.problems);
  const capacityProblems = res.problems.filter(p => p.kind === 'capacity' && !/顺延 8 次/.test(p.text));
  const dropProblems = res.problems.filter(p => p.kind === 'capacity' && /顺延 8 次/.test(p.text));
  const tailProblems = res.problems.filter(p => p.kind === 'priority-tail');
  const shiftProblems = res.problems.filter(p => p.kind === 'type-shift');
  const dupProblems = res.problems.filter(p => p.kind === 'dup');
  const indexProblems = res.problems.filter(p => p.kind === 'index');
  const condProblems = res.problems.filter(p => p.kind === 'cond-string' || p.kind === 'cond-bad');
  const elementProblems = res.problems.filter(p => p.kind === 'element-fix');
  const charProblems = res.problems.filter(p => p.kind === 'character');
  const splitProblems = res.problems.filter(p => p.kind === 'teammate-split');
  const unknownProblems = res.problems.filter(p => p.kind === 'unknown-field');
  const known = new Set(['index', 'cond-string', 'cond-bad', 'capacity', 'priority-tail', 'type-shift', 'dup', 'element-fix', 'teammate-split', 'unknown-field']);
  const otherProblems = res.problems.filter(p => !known.has(p.kind));

  const listOf = (arr, n) => arr.slice(0, n || 12).map(p => `<div style="margin:3px 0">· ${esc(p.text)}</div>`).join('')
    + (arr.length > (n || 12) ? `<div class="hint">…其余 ${arr.length - (n || 12)} 处同样处理</div>` : '');

  const body = `
    <div class="hint mb">文件：<b>${esc(fname || '(粘贴内容)')}</b> · 共 ${res.actions.length} 条动作${res.info && res.info.version ? ` · 版本 ${esc(res.info.version)}` : ''}</div>
    ${res.problems.length
      ? `<div class="warnbox mb">导入前发现 ${res.problems.length} 处需要处理的问题：</div>` : '<div class="okbox mb">编号与条件格式全部符合规则，可以直接导入。</div>'}
    ${condProblems.length ? `<div style="margin:8px 0 4px"><b>① condition 写法需要修复（${condProblems.length} 处）</b></div>
      <div class="hint">这些策略虽然能被 BetterGI 读到，但 condition 若写成裸字符串会让 <b>全部动作失效</b>。修复后会自动补成 <span class="pill">{"expression": "..."}</span>。</div>
      ${listOf(condProblems)}` : ''}
    ${indexProblems.length || dupProblems.length ? `<div style="margin:10px 0 4px"><b>② index 编号不符合本编辑器的编号规则（${indexProblems.length + dupProblems.length} 处）</b></div>
      <div class="hint">本编辑器的编号规则：<span class="pill">[动作类型][元素类型][角色编号2位][尾数]</span>，元素号 1 冰、2 火、3 水、4 雷、5 风、6 岩、7 草，例如 <b>33011</b> = 后台输出·水元素·芭芭拉·第1条；动作类型 0 只用 1 位（1~9）。旧策略里的 10/20/41 这类数字其实是“优先级”，推不出动作类型，因此会先按<b>指令内容与 ensureCast</b> 推一个类型作为初值：有 e 类指令且勾了 ensureCast → 开盾；没勾 ensureCast → 辅助；只有 q → 爆发；只有普攻/重击 → 纯挂元素普攻；都没有 → 兜底普攻/等待；类型满了会顺延到编号更大的类型（9 之后回到 1，顺延 8 次都满则删除该动作）。</div>
      ${listOf(indexProblems)}
      ${listOf(dupProblems)}
      <div class="hint" style="margin-top:6px">选择「调整编号后导入」会重新分配 index，并同步改写条件里 <span class="pill">since(N)</span> / <span class="pill">count(N,...)</span> 的数字引用。</div>` : ''}
    ${elementProblems.length ? `<div style="margin:10px 0 4px"><b>③ index 元素位已按角色所属元素自动修正（${elementProblems.length} 处）</b></div>
      <div class="hint">只有元素位与角色所属元素不符、其余各位都能对上的编号会走这条修正（<b>尾数顺序保持不变</b>，条件里对应的 <span class="pill">since(N)</span> 引用也会同步改写）；元素号 1 冰、2 火、3 水、4 雷、5 风、6 岩、7 草。</div>
      ${listOf(elementProblems)}` : ''}
    ${splitProblems.length ? `<div style="margin:10px 0 4px"><b>③.5 触发条件 / 队友条件的拆分提示（${splitProblems.length} 处）</b></div>
      <div class="hint">expression 会按「(触发条件) && (队友条件)」拆分回编辑器：含 <span class="pill">in-party</span> 的部分进「队友条件」，其余进「触发条件」。下面这些动作的队友条件结构不常规，导入时的处理方式会略有不同（内容不会丢，但结构的来源可能需要你确认一下）：</div>
      ${listOf(splitProblems, 20)}` : ''}
    ${tailProblems.length ? `<div style="margin:10px 0 4px"><b>④ 其他触发条件的 priority 尾数不为 0（${tailProblems.length} 处）</b></div>
      <div class="hint">尾数 0 已预留给其他触发条件的优先级数值插入，正常值应形如 <span class="pill">10000</span>。选择「修正后导入」会把这些 priority 改成所在段的边界值（判定顺序按“次于”处理）；选择「放弃导入」则放弃导入整份策略。</div>
      ${listOf(tailProblems)}` : ''}
    ${shiftProblems.length ? `<div style="margin:10px 0 4px"><b>⑤ 动作类型已满、已顺延（${shiftProblems.length} 处）</b></div>${listOf(shiftProblems)}` : ''}
    ${capacityProblems.length ? `<div style="margin:10px 0 4px"><b>⑥ 同一角色同一类型超过 9 条（${capacityProblems.length} 组）</b></div>
      <div class="errbox">存在超过上限的动作分组，无法自动编号。请先选择「拒绝导入」，手工删减后再试。</div>
      ${listOf(capacityProblems)}` : ''}
    ${dropProblems.length ? `<div style="margin:10px 0 4px"><b>⑦ 无法顺延、导入时会被删除的动作（${dropProblems.length} 条）</b></div>${listOf(dropProblems)}` : ''}
    ${charProblems.length ? `<div style="margin:10px 0 4px"><b>⑧ 角色不在角色表中（${charProblems.length} 处）</b></div>${listOf(charProblems)}` : ''}
    ${unknownProblems.length ? `<div style="margin:10px 0 4px"><b>⑨ 既不能识别、也不支持编辑的字段（${unknownProblems.length} 处，导入时忽略）</b></div>
      <div class="hint">BetterGI 对动作节点里的多余字段是<b>静默忽略</b>的（例如早期版本才有的 <span class="pill">redArrowAim</span>），本编辑器同样忽略这些字段 —— 但不会静默：列在这里提醒你。这些字段不会写进本编辑器保存的草稿与导出的 JSON，需要保留请自行备份原文件。</div>
      ${listOf(unknownProblems, 20)}` : ''}
    ${otherProblems.length ? `<div style="margin:10px 0 4px"><b>⑩ 其他提示（${otherProblems.length} 处）</b></div>${listOf(otherProblems)}` : ''}`;

  openModal({
    title: '导入前检查',
    body,
    actions: [
      { label: '拒绝导入', value: 'reject' },
      {
        label: indexProblems.length ? '调整编号后导入' : '导入', primary: true, value: 'import',
        onClick: () => (capacityProblems.length ? 'keep' : undefined),
      },
    ],
  }).then((choice) => {
    if (choice !== 'import' || capacityProblems.length) return;
    // 第二步：其他触发条件的 priority 尾数不为 0 时，先让用户选择修正后导入 / 放弃导入
    const step = tailProblems.length
      ? openModal({
        title: '其他触发条件的 priority 需要修正',
        body: `<div class="warnbox mb">有 ${tailProblems.length} 条其他触发条件的 priority 尾数不为 0。尾数 0 已预留给“额外触发条件的优先级数值插入”，所以这些值需要修正。</div>
          <div class="hint mb">选择「修正后导入」会把这些 priority 改成所在段的边界值（判定顺序按“次于”，取该段最大值 + 1，例如 41005 → 42000）；选择「放弃导入」则不导入任何内容。</div>
          <div class="scroll" style="max-height:240px">${listOf(tailProblems, 40)}</div>`,
        actions: [
          { label: '放弃导入', value: 'abort' },
          { label: '修正后导入', primary: true, value: 'fix' },
        ],
      })
      : Promise.resolve('fix');

    return step.then((s2) => {
      if (s2 !== 'fix') return;
      const dropped = (res.actions || []).filter(a => a.__drop).length;
      applyImport(res, { fixPriorityTail: tailProblems.length > 0 });
      let plan = null;
      let notes = [];
      if (indexProblems.length || dupProblems.length) {
        plan = planRenumber();
        if (plan.error) { alert(plan.error); return; }
        notes = applyRenumber(plan);
      }
      refresh(['info', 'actions', 'preview']);
      const parts = [];
      if (condProblems.length) parts.push(`<div class="okbox mb">${condProblems.length} 处裸字符串 condition 已自动补成 <span class="pill">{"expression": "..."}</span>。</div>`);
      if (tailProblems.length) parts.push(`<div class="okbox mb">${tailProblems.length} 处其他触发条件的 priority 已按段边界修正（判定顺序按“次于”处理）。</div>`);
      if (splitProblems.length) parts.push(`<div class="warnbox mb">有 ${splitProblems.length} 处队友条件的拆分提示，详见下方说明（内容不会丢失）。</div>`);
      if (dropped) parts.push(`<div class="warnbox mb">有 ${dropped} 条动作因为顺延 8 次后仍没有空位而被删除。</div>`);
      const changes = plan ? plan.changes : [];
      openModal({
        title: '导入完成',
        body: `${parts.join('') || `<div class="okbox mb">已导入 ${state.strategy.actions.length} 条动作。</div>`}
          <div class="hint">共导入 ${state.strategy.actions.length} 条动作${changes.length ? '，编号已按规则重新分配（明细最多 40 条）' : ''}：</div>
          <div class="scroll" style="max-height:280px;margin-top:6px">
          ${changes.slice(0, 40).map(c => `<div class="mono" style="font-size:12px">${esc(c.character || '当前角色')} · ${esc(c.name || '(未命名)')}：${c.from} → <b>${c.to}</b></div>`).join('') || '<div class="hint">编号无需变化</div>'}
          </div>
          ${splitProblems.length ? `<hr><div class="hint" style="margin-top:8px">触发条件 / 队友条件的拆分提示：</div>
            <div class="scroll" style="max-height:200px">${splitProblems.map(p => `<div style="margin:3px 0">· ${esc(p.text)}</div>`).join('')}</div>` : ''}
          ${notes.length ? `<div class="hint" style="margin-top:8px">${notes.map(esc).join('<br>')}</div>` : ''}`,
        actions: [{ label: '开始编辑', primary: true, value: null }],
      });
    });
  });
}

function doImport() {
  openModal({
    title: '导入 JSON 战斗策略',
    body: `<div class="hint mb">支持 BetterGI 的 JSON 战斗策略文件（User\\AutoFight 目录下的 .json）。导入前会先做一次与 BetterGI 一致的解析期校验。</div>
      <div class="row mb"><button class="primary" id="impFile">选择文件…</button><button id="impPasteBtn">粘贴 JSON 文本</button></div>
      <div id="impPasteBox" style="display:none">
        <textarea id="impPaste" rows="10" placeholder="在此粘贴 JSON 内容"></textarea>
        <div class="row" style="margin-top:6px"><button class="primary" id="impPasteGo">解析这段 JSON</button></div>
      </div>`,
    actions: [{ label: '关闭', value: null }],
  });
  $('impFile').onclick = () => { closeModal(null); pickTextFile((text, name) => doImportFromText(text, name)); };
  $('impPasteBtn').onclick = () => { $('impPasteBox').style.display = ''; $('impPaste').focus(); };
  $('impPasteGo').onclick = () => { const t = $('impPaste').value; closeModal(null); doImportFromText(t, '(粘贴内容)'); };
}

/* ---------------- 合并 JSON 策略 ---------------- */

function doMerge() {
  // 合并以当前策略为基础：它有阻止导出的报错时同样拒绝合并
  flushPendingInfoEdit();
  const v = validateStrategy();
  if (v.errors.length) {
    state.lastIssues = v;
    state.ui.showIssues = true;
    renderChrome(); renderSide();
    openModal({
      title: `合并被拒绝：当前编辑中的策略还有 ${v.errors.length} 个错误`,
      body: `<div class="errbox" style="margin-bottom:8px">合并是在「当前正在编辑的策略」上做加法，所以它也必须先能正常导出。请先修正以下问题（右侧校验面板可点击定位）：</div>
        ${v.errors.slice(0, 40).map(x => `<div style="margin:4px 0">· ${esc(x.text)}</div>`).join('')}
        ${v.errors.length > 40 ? `<div class="hint">…其余 ${v.errors.length - 40} 条见右侧面板</div>` : ''}`,
      actions: [{ label: '知道了', primary: true, value: null }],
    });
    return;
  }
  openModal({
    title: '合并 JSON 策略',
    body: `<div class="hint mb">把另一份 JSON 战斗策略<b>有选择地</b>并进当前正在编辑的策略：以当前策略为基础，只在两份策略有差异的地方询问你怎么取舍。</div>
      <div class="warnbox mb">被导入的策略会先做一次校验：无法被 BetterGI 正常加载的策略会按错误原因拒绝；编号 / priority 等方面需要先调整才能被本编辑器导入的策略，会提示「该策略应先单独导入并编辑后，才可以与其他策略合并」。</div>
      <div class="row mb"><button class="primary" id="mrgFile">选择文件…</button><button id="mrgPasteBtn">粘贴 JSON 文本</button></div>
      <div id="mrgPasteBox" style="display:none">
        <textarea id="mrgPaste" rows="10" placeholder="在此粘贴 JSON 内容"></textarea>
        <div class="row" style="margin-top:6px"><button class="primary" id="mrgPasteGo">用这段 JSON 合并</button></div>
      </div>`,
    actions: [{ label: '关闭', value: null }],
  });
  $('mrgFile').onclick = () => { closeModal(null); pickTextFile((text, name) => doMergeFromText(text, name)); };
  $('mrgPasteBtn').onclick = () => { $('mrgPasteBox').style.display = ''; $('mrgPaste').focus(); };
  $('mrgPasteGo').onclick = () => { const t = $('mrgPaste').value; closeModal(null); doMergeFromText(t, '(粘贴内容)'); };
}

function doMergeFromText(text, fname) {
  let obj;
  try { obj = JSON.parse(text); }
  catch (err) {
    openModal({
      title: '合并失败：JSON 语法错误',
      body: `<div class="errbox">${esc(err.message)}</div><div class="hint" style="margin-top:8px">注意 JSON 不支持注释和尾随逗号。</div>`,
      actions: [{ label: '知道了', primary: true, value: null }],
    });
    return;
  }
  const src = checkMergeSource(obj);
  if (src.mode === 'fatal') {
    openModal({
      title: '合并被拒绝：策略无法被 BetterGI 正常加载',
      body: `<div class="errbox" style="margin-bottom:8px">文件：<b>${esc(fname || '(粘贴内容)')}</b>。这些是 BetterGI 解析期就会抛异常的情况，导入后也无法运行：</div>
        ${src.reasons.map(x => `<div style="margin:4px 0">· ${esc(x)}</div>`).join('')}`,
      actions: [{ label: '知道了', primary: true, value: null }],
    });
    return;
  }
  if (src.mode === 'needs-edit') {
    openModal({
      title: '该策略应先单独导入并编辑后，才可以与其他策略合并',
      body: `<div class="warnbox mb">文件：<b>${esc(fname || '(粘贴内容)')}</b> 的编号 / priority 等方面需要先调整才能被本编辑器导入，因此不能直接参与合并（合并只在「已经能正常导入 / 导出的内容」之间做选择）。</div>
        <div class="hint mb">请先用「导入 JSON 策略…」把它单独导入、按提示调整好（重新编号 / 修正 priority / 修正角色名等），确认校验面板没有错误之后，再回来合并。</div>
        <div class="scroll" style="max-height:320px">${src.reasons.slice(0, 40).map(x => `<div style="margin:3px 0">· ${esc(x)}</div>`).join('')}${src.reasons.length > 40 ? `<div class="hint">…其余 ${src.reasons.length - 40} 处同理</div>` : ''}</div>`,
      actions: [{ label: '知道了', primary: true, value: null }],
    });
    return;
  }

  const plan = planMerge(src);
  const decisions = { info: {}, actions: {} };
  askMergeInfoConflicts(plan.infoDiffs, decisions)
    .then(() => askMergeActionConflicts(plan, decisions))
    .then(() => {
      const r = applyMergePlan(plan, decisions);
      if (!r.ok) {
        openModal({ title: '合并被拒绝', body: `<div class="errbox">${esc(r.error)}</div>`, actions: [{ label: '知道了', primary: true, value: null }] });
        return;
      }
      app._infoPending = false;
      refresh(['info', 'actions', 'preview']);
      openModal({
        title: '合并完成',
        body: mergeSummaryHtml(r, plan, src, fname),
        actions: [{ label: '开始编辑', primary: true, value: null }],
      });
    });
}

/** info 差异：逐个字段弹窗询问（规则 2） */
function askMergeInfoConflicts(diffs, decisions) {
  let allCurrent = false;
  let chain = Promise.resolve();
  for (const d of diffs) {
    chain = chain.then(() => {
      if (allCurrent) { decisions.info[d.field] = 'current'; return; }
      return openModal({
        title: `info 内容不同：${d.label}`,
        body: `<div class="hint mb">这一个字段在两份策略里都有内容、而且不相同，请选择采用哪一个版本。</div>
          <div class="split">
            <div class="col"><div class="hint">当前编辑中的策略</div><div class="mono" style="white-space:pre-wrap;word-break:break-all;background:var(--bg);border:1px solid var(--line2);border-radius:6px;padding:6px 8px;max-height:280px;overflow:auto">${esc(d.curText || '（空）')}</div></div>
            <div class="col"><div class="hint">被导入的策略</div><div class="mono" style="white-space:pre-wrap;word-break:break-all;background:var(--bg);border:1px solid var(--line2);border-radius:6px;padding:6px 8px;max-height:280px;overflow:auto">${esc(d.impText || '（空）')}</div></div>
          </div>`,
        actions: [
          { label: '使用当前版本', primary: true, value: 'current' },
          { label: '使用导入版本', value: 'imported' },
          { label: '全部使用当前版本（后续不再询问）', value: 'current-all' },
        ],
      }).then(v => {
        if (v === 'current-all') { allCurrent = true; decisions.info[d.field] = 'current'; return; }
        decisions.info[d.field] = v === 'imported' ? 'imported' : 'current';
      });
    });
  }
  return chain;
}

/** 同名动作内容不同：逐个动作弹窗询问（规则 4） */
function askMergeActionConflicts(plan, decisions) {
  const conflicts = plan.items.filter(it => it.cur && it.diffs.length);
  let allKeep = false;
  let allRename = false;
  let chain = Promise.resolve();
  for (const it of conflicts) {
    chain = chain.then(() => {
      if (allKeep) { decisions.actions[it.order] = 'keep'; return; }
      if (allRename) { decisions.actions[it.order] = 'rename'; return; }
      const canRename = !!String(it.src.name || '').trim();
      const actions = [
        { label: '保留当前版本', primary: true, value: 'keep' },
        { label: '使用导入版本替换', value: 'replace' },
      ];
      if (canRename) actions.push({ label: '导入的版本改名后保留', value: 'rename' });
      actions.push({ label: '全部保留当前版本（后续不再询问）', value: 'keep-all' });
      if (canRename) actions.push({ label: '全部改名后保留（后续不再询问）', value: 'rename-all' });
      const rows = it.diffs.map(d => `
        <div style="margin-bottom:10px">
          <div><b>${esc(d.label)}</b></div>
          <div class="split">
            <div class="col"><div class="hint">当前版本</div><div class="mono" style="white-space:pre-wrap;word-break:break-all">${esc(d.cur)}</div></div>
            <div class="col"><div class="hint">导入版本</div><div class="mono" style="white-space:pre-wrap;word-break:break-all">${esc(d.imp)}</div></div>
          </div>
        </div>`).join('');
      return openModal({
        title: `动作「${it.src.name || '(未命名)'}」两边都有、内容不同`,
        body: `<div class="warnbox mb">除了 index 以外的字段里有 <b>${it.diffs.length}</b> 处不同（比对时已把条件里「入参为动作」的 index 数值换算成动作名）：</div>
          <div class="scroll" style="max-height:320px">${rows}</div>
          <div class="hint" style="margin-top:8px;line-height:1.8">
            三种处理方式：<br>
            · <b>保留当前版本</b>：当前的动作节点完全不动（导入版本里不同的部分被丢弃）。<br>
            · <b>使用导入版本替换</b>：除 index 以外全部换成导入版本（index 仍用当前数值；若角色不同，index 的元素 / 角色位会跟着角色改写，别的条件里指向它的引用同步改写）。<b>当前版本的内容会被覆盖，不可撤销。</b><br>
            · <b>导入的版本改名后保留</b>：当前节点不动，导入的这条另起一个名字（原名后加数字）作为新动作导入，并按导入的动作种类重新分配 index。<br>
            后面两个「全部…」按钮会让剩下的同名动作都按同一种方式处理，弹窗里不再逐个询问（「使用导入版本替换」不提供一键选择，因为它会不可逆地覆盖当前内容）。</div>`,
        actions,
      }).then(v => {
        if (v === 'keep-all') { allKeep = true; decisions.actions[it.order] = 'keep'; return; }
        if (v === 'rename-all') { allRename = true; decisions.actions[it.order] = 'rename'; return; }
        decisions.actions[it.order] = (v === 'replace' || v === 'rename') ? v : 'keep';
      });
    });
  }
  return chain;
}

function mergeSummaryHtml(r, plan, src, fname) {
  const list = (arr, fmt) => arr.map(fmt).join('');
  const nameIdx = (n, idx) => `<div class="mono" style="font-size:12px">${esc(n || '(未命名)')} · index=${idx}</div>`;
  const blocks = [];
  blocks.push(`<div class="hint mb">文件：<b>${esc(fname || '(粘贴内容)')}</b> · 被导入策略共 ${plan.items.length} 条动作</div>`);
  if (r.infoNotes.length) {
    blocks.push(`<div style="margin:8px 0 4px"><b>info 的取舍</b></div>
      <div class="scroll" style="max-height:140px">${list(r.infoNotes, n => `<div style="margin:2px 0">· ${esc(n)}</div>`)}</div>`);
  }
  if (r.added.length) {
    blocks.push(`<div style="margin:8px 0 4px"><b>新增 ${r.added.length} 条动作</b>（当前策略里没有同名动作，按原动作类型重新分配编号）</div>
      <div class="scroll" style="max-height:160px">${list(r.added, x => nameIdx(x.action.name, x.action.index))}</div>`);
  }
  if (r.renamed.length) {
    blocks.push(`<div style="margin:8px 0 4px"><b>改名后新增 ${r.renamed.length} 条动作</b></div>
      <div class="scroll" style="max-height:160px">${list(r.renamed, x => nameIdx(x.action.name, x.action.index))}</div>`);
  }
  if (r.replaced.length) {
    blocks.push(`<div style="margin:8px 0 4px"><b>用导入版本替换 ${r.replaced.length} 条动作</b>（保留原 index）</div>
      <div class="scroll" style="max-height:160px">${list(r.replaced, x => nameIdx(x.action.name, x.action.index))}</div>`);
  }
  if (r.kept.length) {
    blocks.push(`<div style="margin:8px 0 4px"><b>保留当前版本 ${r.kept.length} 条动作</b>（内容相同或按你的选择保留）</div>
      ${list(r.kept.slice(0, 20), x => `<div class="mono" style="font-size:12px">${esc(x.src.name || '(未命名)')}</div>`)}${r.kept.length > 20 ? `<div class="hint">…其余 ${r.kept.length - 20} 条同理</div>` : ''}`);
  }
  const curOnly = plan.curOnlyCount || 0;
  blocks.push(`<div class="hint" style="margin-top:8px">当前策略里没有被同名动作匹配到的 ${curOnly} 条动作按原样保留。</div>`);
  if (r.warnings.length) {
    blocks.push(`<div class="warnbox" style="margin-top:8px">有 ${r.warnings.length} 处引用无法自动换算，已原样保留（请在条件里核对）：</div>
      <div class="scroll" style="max-height:140px">${list(r.warnings, w => `<div style="margin:2px 0">· ${esc(w)}</div>`)}</div>`);
  }
  if (src.warnings && src.warnings.length) {
    blocks.push(`<div class="hint" style="margin-top:8px">被导入策略的其它提示（不影响合并）：</div>
      <div class="scroll" style="max-height:120px">${list(src.warnings.slice(0, 20), w => `<div style="margin:2px 0">· ${esc(w)}</div>`)}</div>`);
  }
  blocks.push(`<div class="okbox" style="margin-top:8px">合并结果已写入当前编辑内容，并在导出前照常校验；请核对「动作编辑」与「优先级预览」后导出。</div>`);
  return blocks.join('');
}

/* ---------------- 新建 / 草稿 ---------------- */

/**
 * 新建策略。
 *   'blank'  —— 空白策略（只有 info，没有任何动作；导出前必须自己加动作）；
 *   其它值   —— 「新建（含兜底动作）」：一次性建好 3 条动作（都在「当前角色」下），
 *               顺序固定为「兜底战斗检查 → 角色红血标记 → 等待」：
 *               ① 兜底战斗检查：类型 0，指令 check，条件 t>10 && last-check>4 && (!(last-check>t-9) || count<1)；
 *               ② 角色红血标记：类型 0，不写指令（只做判定 / 标记），条件 low-hp && since>4；
 *               ③ 等待：类型 9，指令 wait(0.2)，主条件恒假 + 一条 priority=100000 的恒真其他触发条件（兜底空转）。
 *               两条类型 0 的动作都依赖「当前角色 + 类型 0 允许只写条件不写指令」这条规则。
 */
function newStrategy(preset) {
  const s = { info: { name: '', author: '', version: '', description: '', config: {}, preActions: [] }, actions: [] };
  state.strategy = s;
  if (preset !== 'blank') {
    // ① 兜底战斗检查
    const check = addAction('', 0, { name: '兜底战斗检查', action: 'check' });
    if (check.ok) check.action.conditionText = 't > 10 && last-check > 4 && (! (last-check > t - 9) || count < 1)';
    // ② 角色红血标记（只做判定 / 标记，不写指令）
    const mark = addAction('', 0, { name: '角色红血标记', action: '' });
    if (mark.ok) mark.action.conditionText = 'low-hp && since > 4';
    // ③ 兜底等待：主条件恒假，morePriorities 里留一条恒真、次于整个类型 9（priority=100000）
    const r = addAction('', 9, { name: '等待', action: 'wait(0.2)' });
    if (r.ok) {
      r.action.conditionText = 'false';
      r.action.morePriorities.push({
        id: newId(), text: '', priority: 100000, cmp: 'after',
        scope: { type: 9, element: '', character: '' }, manualPriority: false,
      });
    }
  }
  state.ui.editingCharacter = '';
  state.lastIssues = validateStrategy();
  rebuildIndexes();
  renderAll();
}

function openDraftManager() {
  const drafts = loadDrafts();
  const keys = Object.keys(drafts);
  const rows = keys.length
    ? keys.sort((a, b) => drafts[b].time - drafts[a].time).map(k => {
      const d = parseDraftKey(k);
      return `<div class="roleitem">
        <span class="nm">${esc(d.name)}${d.version ? ` <span class="pill">版本 ${esc(d.version)}</span>` : ' <span class="dim">（无版本）</span>'} <span class="dim">· ${new Date(drafts[k].time).toLocaleString()} · ${(drafts[k].json.actions || []).length} 条动作</span></span>
        <button class="mini primary" data-draft-load="${attr(k)}">载入</button>
        <button class="mini danger" data-draft-del="${attr(k)}">删除</button></div>`;
    }).join('')
    : '<div class="empty">还没有保存的草稿</div>';
  const p = openModal({
    title: '本地草稿（保存在浏览器里）',
    body: `<div class="hint mb">草稿按「策略名称 + 版本」两个条件归档：二者有其一不同就是两份不同的草稿（方便用「版本」做版本管理）。编辑时会自动保存；载入草稿会覆盖当前编辑内容。</div><div class="scroll">${rows}</div>`,
    actions: [{ label: '新建空白策略', onClick: () => { closeModal(null); confirmDiscard(() => newStrategy('blank')); return 'keep'; } },
      { label: '关闭', primary: true, value: null }],
  });
  $('modalBody').onclick = (e) => {
    const l = e.target.closest('[data-draft-load]');
    const d = e.target.closest('[data-draft-del]');
    if (l) {
      const k = l.getAttribute('data-draft-load');
      const obj = drafts[k].json;
      closeModal(null);
      confirmDiscard(() => {
        const res = analyzeImport(obj);
        if (res.fatal.length) { alert('草稿无法载入：' + res.fatal.join('；')); return; }
        applyImport(res);
        refresh(['info', 'actions', 'preview']);
        notifySplitNotes(res.problems, '载入草稿：触发条件 / 队友条件的拆分提示');
      });
    } else if (d) {
      const k = d.getAttribute('data-draft-del');
      const all = loadDrafts();
      delete all[k];
      localStorage.setItem(LS_DRAFT, JSON.stringify(all));
      closeModal(null);
      openDraftManager();
    }
  };
  return p;
}

function confirmDiscard(fn) {
  if (!state.strategy.actions.length && !state.strategy.info.name) { fn(); return; }
  openModal({
    title: '确认',
    body: '<div class="warnbox">当前编辑内容将被替换（会先保存为本地草稿）。确定继续吗？</div>',
    actions: [{ label: '取消', value: null }, { label: '确定', primary: true, value: 'ok' }],
  }).then(v => { if (v === 'ok') { saveDraftNow(); fn(); } });
}

/* ---------------- 启动 ---------------- */

function boot() {
  loadRarity();
  loadUi();
  bindEvents();
  app.panels.info = { render: renderInfoPanel };
  app.panels.actions = { render: renderActionsPanel };
  app.panels.preview = { render: renderPreviewPanel };
  Object.assign(app.handlers, infoHandlers, actionsHandlers, previewHandlers, {
    toggleIssues: () => { state.ui.showIssues = !state.ui.showIssues; saveUi(); renderChrome(); renderSide(); },
  });
  Object.assign(app.fieldHandlers, infoFieldHandlers, actionsFieldHandlers, previewFieldHandlers);

  $('btnIssues').onclick = () => { state.ui.showIssues = !state.ui.showIssues; saveUi(); renderChrome(); renderSide(); };

  // 启动时尝试恢复上次草稿，否则给一份带兜底等待的新策略
  const drafts = loadDrafts();
  // 兼容旧版本：以前草稿是按「策略名称」归档的，这里统一取最近保存的一份
  const lastKey = (state.ui.lastDraft && drafts[state.ui.lastDraft]) ? state.ui.lastDraft : latestDraftKey();
  const last = lastKey ? drafts[lastKey] : null;
  let bootSplitNotes = null;
  if (last) {
    const res = analyzeImport(last.json);
    if (!res.fatal.length) { applyImport(res); bootSplitNotes = res.problems; }
    else newStrategy('preset');
  } else {
    newStrategy('preset');
  }
  state.ui.lastDraft = draftKey();
  saveUi();
  renderAll();
  if (!state.strategy.info.name) {
    state.ui.showIssues = true;
    renderChrome(); renderSide();
  }
  if (bootSplitNotes) notifySplitNotes(bootSplitNotes, '载入上次草稿：触发条件 / 队友条件的拆分提示');
}

if (typeof window !== 'undefined') window.addEventListener('DOMContentLoaded', boot);
