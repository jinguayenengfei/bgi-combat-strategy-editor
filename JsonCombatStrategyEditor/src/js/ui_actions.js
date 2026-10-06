/* 动作编辑页：角色栏 + 动作卡片（指令 / 条件 / 队友 / 额外触发条件） */

/* ---------------- 角色栏 ---------------- */

function filteredAvatars() {
  const ui = state.ui;
  const q = (ui.characterSearch || '').trim().toLowerCase();
  const team = ui.team || [];
  const list = [];
  for (const av of AVATARS) {
    const key = av.virtual ? '' : av.name;
    const cnt = actionsOf(state.strategy.actions, key).length;
    if (ui.filterElement !== 'all' && String(av.code) !== String(ui.filterElement)) continue;
    if (ui.filterHasAction === 'yes' && cnt === 0) continue;
    if (ui.filterHasAction === 'no' && cnt > 0) continue;
    if (ui.filterRarity !== 'all') {
      const r = rarityOf(av.name);
      if (ui.filterRarity === 'none') { if (r) continue; }
      else if (r !== ui.filterRarity) continue;
    }
    if (ui.onlyTeam && team.length === 4 && !av.virtual && !team.includes(av.name)) continue;
    if (q && !(av.name.toLowerCase().includes(q) || String(av.id || '').includes(q))) continue;
    list.push({ av, key, cnt });
  }
  return list;
}

function renderCharacterColumn() {
  const ui = state.ui;
  const list = filteredAvatars();
  let lastCode = null;
  const rows = [];
  for (const it of list) {
    const av = it.av;
    if (av.code !== lastCode) {
      rows.push(`<div class="secgroup">${elementLabel(av.code)}<span class="dim"> · 元素号 ${av.code}</span></div>`);
      lastCode = av.code;
    }
    const on = ui.editingCharacter === it.key;
    rows.push(`<div class="roleitem" data-act="pick-char" data-char="${attr(it.key)}" data-focus="charlist:${attr(it.key)}" style="${on ? 'background:#20364f' : ''}">
      ${elementDot(av.code)}
      <span class="nm">${esc(av.name)}${av.virtual ? ' <span class="dim">(character 留空)</span>' : ''}
        ${rarityStars(av.name)}
        <div class="dim" style="font-size:11px">${av.virtual ? '编号 00（特殊）' : '编号 ' + avatarCodeLabel(av)}</div>
      </span>
      <span class="cnt">${it.cnt ? `<span style="color:var(--fg)">${it.cnt} 条</span>` : '<span class="dim">无</span>'}</span></div>`);
  }
  return `
    <div class="card" style="margin-bottom:10px">
      <h3>角色列表 <span class="hint">按「元素号 + 角色编号」排序，与动作检索次序一致</span></h3>
      <div class="row mb">
        <input data-kind="charlist" data-field="search" data-focus="charlist:search" value="${attr(ui.characterSearch)}" placeholder="搜索角色名 / 编号" style="width:130px">
        <button class="mini" data-act="rarity-edit">星级补录</button>
      </div>
      <div class="row mb">
        <select data-kind="charlist" data-field="filterElement">
          <option value="all" ${ui.filterElement === 'all' ? 'selected' : ''}>全部元素</option>
          ${ELEMENTS.map(e => `<option value="${e.code}" ${String(ui.filterElement) === String(e.code) ? 'selected' : ''}>${e.code === 0 ? '元素未定/当前角色' : e.name + '元素'}</option>`).join('')}
        </select>
        <select data-kind="charlist" data-field="filterRarity">
          <option value="all" ${ui.filterRarity === 'all' ? 'selected' : ''}>全部星级</option>
          <option value="5" ${ui.filterRarity === '5' ? 'selected' : ''}>五星</option>
          <option value="4" ${ui.filterRarity === '4' ? 'selected' : ''}>四星</option>
          <option value="none" ${ui.filterRarity === 'none' ? 'selected' : ''}>未标注星级</option>
        </select>
        <select data-kind="charlist" data-field="filterHasAction">
          <option value="all" ${ui.filterHasAction === 'all' ? 'selected' : ''}>动作有无均看</option>
          <option value="yes" ${ui.filterHasAction === 'yes' ? 'selected' : ''}>只看已设动作</option>
          <option value="no" ${ui.filterHasAction === 'no' ? 'selected' : ''}>只看没设动作</option>
        </select>
        <label class="f"><input type="checkbox" data-kind="charlist" data-field="onlyTeam" ${ui.onlyTeam ? 'checked' : ''} ${state.ui.team.length === 4 ? '' : 'disabled'}> 只看当前队伍</label>
      </div>
      <div class="hint">共 ${list.length} 个角色；未标注星级的角色在按星级筛选时会被隐藏。${state.ui.team.length === 4 ? '' : '（在优先级预览页设置 4 人队伍后可用“只看当前队伍”）'}</div>
    </div>
    <div class="card" style="padding:6px">
      <div class="scroll" data-scroll="charlist" style="max-height:calc(100vh - 380px)">${rows.join('') || '<div class="empty">没有匹配的角色</div>'}</div>
    </div>`;
}

/* ---------------- 动作卡片 ---------------- */

function actionNameQuickList(act) {
  const who = act.character || '当前角色';
  const words = ['普攻', '重击', 'e', '短e', '长e', 'q', '开盾', '治疗'];
  const base = `${who}-`;
  const others = new Set(state.strategy.actions.filter(a => a.id !== act.id).map(a => a.name));
  return words.map(w => {
    let n = base + w;
    let k = 2;
    while (others.has(n)) { n = base + w + k; k++; }
    return n;
  });
}

/** 动作卡片内可展开区块的展开状态 */
function detailOpen(key, def) {
  const v = state.ui.detailsOpen[key];
  return v === undefined ? !!def : !!v;
}

/** 动作卡片里的报错/警告条（手输内容后可以就地刷新，不必重建整块面板） */
function cardIssueBoxes(errs, warns) {
  return (errs || []).map(x => `<div class="errbox mb">${esc(x.text)}</div>`).join('')
    + (warns || []).map(x => `<div class="warnbox mb">${esc(x.text)}</div>`).join('');
}

function renderActionCard(act) {
  const v = state.lastIssues || { errors: [], warnings: [] };
  const errs = v.errors.filter(x => x.actionId === act.id);
  const warns = v.warnings.filter(x => x.actionId === act.id);
  const collapsed = state.ui.collapsed[act.id];
  const pi = parseIndex(act.index);
  const typeName = actionTypeName(act.type);
  const slotCnt = countOfType(state.strategy.actions, act.character, act.type);
  const cls = errs.length ? 'err' : (warns.length ? 'warn' : '');
  const mpCount = (act.morePriorities || []).length;
  const cond = (act.conditionText || '').trim();
  const cmd = String(act.action || '').trim();
  const teamExpr = teammateExpr(act, state.strategy.actions);
  const tags = String(act.tags || '');
  const key = (sec) => `${act.id}:${sec}`;

  const head = `
    <div class="hd" data-act="card-toggle" data-id="${attr(act.id)}">
      <span style="color:var(--fg3)">▸</span>
      <span class="pill" title="index 结构：${esc(indexDisplay(act.index))}">${act.index}</span>
      <span class="nm">${esc(act.name || '(未命名动作)')}</span>
      <span class="pill" title="动作类型">${act.type}·${esc(actionTypeShort(act.type))}</span>
      ${act.ensureCast ? '<span class="pill" title="确保E技能释放成功">ensureCast</span>' : ''}
      ${mpCount ? `<span class="pill">其他 ×${mpCount}</span>` : ''}
      <span data-tagspill="${attr(act.id)}">${tagsPillHtml(tags)}</span>
      <span class="dim" style="font-size:12px" data-cardsummary="${attr(act.id)}">${esc(cond || '（无条件=恒真）')}</span>
      <span style="flex:1"></span>
      <span data-cardbadges="${attr(act.id)}">${errs.length ? `<span class="badge err">${errs.length}</span>` : ''}${warns.length ? `<span class="badge warn">${warns.length}</span>` : ''}</span>
      <button class="mini" data-act="card-up" data-id="${attr(act.id)}">↑</button>
      <button class="mini" data-act="card-down" data-id="${attr(act.id)}">↓</button>
      <button class="mini" data-act="card-dup" data-id="${attr(act.id)}">复制</button>
      <button class="mini danger" data-act="card-del" data-id="${attr(act.id)}">删除</button>
    </div>`;

  if (collapsed) return `<div class="actioncard ${cls}" data-card="${attr(act.id)}">${head}</div>`;

  const body = `
    <div class="bd">
      <div data-cardissues="${attr(act.id)}">${cardIssueBoxes(errs, warns)}</div>
      <details class="det" data-details="${attr(key('cmd'))}" ${detailOpen(key('cmd'), true) ? 'open' : ''}>
        <summary>动作指令 <span class="hint prev">${esc(cmd || '（空）')}</span></summary>
        ${renderCardCmdTab(act, pi, typeName, slotCnt)}
      </details>
      <details class="det" data-details="${attr(key('cond'))}" ${detailOpen(key('cond'), true) ? 'open' : ''}>
        <summary>触发条件 <span class="hint prev">${esc(cond || '（空 = 恒真）')}</span></summary>
        ${renderCardCondTab(act)}
      </details>
      <details class="det" data-details="${attr(key('team'))}" ${detailOpen(key('team'), false) ? 'open' : ''}>
        <summary>队友条件 <span class="hint prev">${esc(teamExpr || '（无）')}</span></summary>
        ${renderCardTeamTab(act)}
      </details>
      <details class="det" data-details="${attr(key('more'))}" ${detailOpen(key('more'), false) ? 'open' : ''}>
        <summary>其他触发条件${mpCount ? `（${mpCount}）` : ''}</summary>
        ${renderCardMoreTab(act)}
      </details>
      <details class="det" data-details="${attr(key('tags'))}" ${detailOpen(key('tags'), false) ? 'open' : ''}>
        <summary>注释<span data-tagssum="${attr(act.id)}">${tagsFilledHintHtml(tags)}</span></summary>
        ${renderCardTagsTab(act)}
      </details>
    </div>`;
  return `<div class="actioncard ${cls}" data-card="${attr(act.id)}">${head}${body}</div>`;
}

/**
 * 「编号（自动）」下面那行注释：有哪些动作的条件表达式引用了本动作。
 * 引用方式（index 数值 / 动作名）都算；鼠标悬停在动作名上提示该动作的 index 与动作指令。
 */
function actionReferrerNote(act) {
  const refs = findActionReferrers(state.strategy.actions, act);
  if (!refs.length) return '<span class="dim">没有被其他动作的条件引用（since / count / last-exec 的入参）</span>';
  return `${refs.length} 条动作的条件引用了本动作（入参写 index 或动作名都算）：`
    + refs.map(r => {
      const cmd = String(r.action.action || '').trim();
      const title = `index=${r.action.index}　动作指令：${cmd || '（空）'}`;
      return `<span class="aref" title="${attr(title)}">${esc(r.action.name || '(未命名)')}</span>`;
    }).join('、');
}

function renderCardCmdTab(act, pi, typeName, slotCnt) {
  const quick = actionNameQuickList(act);
  const exprs = buildExpression(act, state.strategy.actions);
  return `
    <div class="grid2" style="margin-top:8px">
      <label class="f">动作名称</label>
      <div>${ctrl({ kind: 'act', actionId: act.id, field: 'name', value: act.name, placeholder: '例如：芙宁娜-e', style: 'width:280px' })}
        <div class="row" style="margin-top:4px"><span class="hint">快捷填入：</span>
          ${quick.map(n => `<button class="mini" data-act="name-quick" data-id="${attr(act.id)}" data-name="${attr(n)}">${esc(n)}</button>`).join('')}</div>
        <div class="hint">写入 name 字段；用于日志与 since/count 按名引用。不能重复，不能是 true/false、纯数字或内置函数名。</div>
      </div>

      <label class="f">动作类型</label>
      <div class="row">
        <select data-kind="act" data-id="${attr(act.id)}" data-field="type" style="width:190px">
          ${ACTION_TYPES.map(t => `<option value="${t.code}" ${act.type === t.code ? 'selected' : ''}>${t.code} · ${esc(t.name)}</option>`).join('')}
        </select>
        <span class="hint">${typeName}；同角色同类型最多 9 条（当前 ${slotCnt} 条）</span>
      </div>

      <label class="f">编号（自动）</label>
      <div class="row">
        <span class="pill" style="font-size:13px">${act.index}</span>
        <span class="hint">${esc(indexDisplay(act.index))}${pi.ok ? '' : ' —— <span style="color:var(--err)">' + esc(pi.reason) + '</span>'}</span>
        <span class="hint">尾数</span>
        <select data-kind="act" data-id="${attr(act.id)}" data-field="slot" style="width:70px">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(s => `<option value="${s}" ${act.slot === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <span class="hint">尾数 0 已预留给其他触发条件的优先级数值插入，因此不可选择</span>
      </div>

      <label class="f"></label>
      <div class="hint" data-refnote="${attr(act.id)}">${actionReferrerNote(act)}</div>

      <label class="f">确保E技能</label>
      <div class="row">
        <label class="f"><input type="checkbox" data-kind="act" data-id="${attr(act.id)}" data-field="ensureCast" ${act.ensureCast ? 'checked' : ''}> 确保E技能释放成功（ensureCast）</label>
        <span class="hint">执行后校验 E 是否真的进入冷却，否则最多重试 5 次（会重跑整个动作，长连段慎用）</span>
      </div>
    </div>
    <hr>
    ${commandEditorHtml(act.action, 'act', act.id, { rows: 3, label: '动作指令（action）', qid: `act:${act.id}` })}
    <div class="hint" style="margin-top:6px">最终写入的 condition.expression：<span class="pill mono">${esc(exprs || '（空 = 恒真）')}</span></div>`;
}

/* ---------------- 触发条件（直接输入 + 内联快捷添加） ---------------- */

/** 条件输入框的 id（用于把快捷添加生成的片段插到光标位置） */
const condRefId = (kind, id, idx) => (kind === 'morenew' ? `morenew:${id}` : kind === 'more' ? `more:${id}:${idx}` : kind === 'cond' ? `cond:${id}` : `${kind}:${id}:${idx}`);

/** 读取条件目标当前文本 */
function getCondText(kind, id, idx) {
  if (kind === 'morenew') return (state.ui.newMoreText || {})[id] || '';
  if (kind === 'more') {
    const a = state.strategy.actions.find(x => x.id === id);
    const mp = a && a.morePriorities[Number(idx)];
    return mp ? (mp.text || '') : '';
  }
  const a = state.strategy.actions.find(x => x.id === id);
  return a ? (a.conditionText || '') : '';
}

/** 写入条件目标文本 */
function writeCondText(kind, id, idx, text) {
  if (kind === 'morenew') {
    if (!state.ui.newMoreText) state.ui.newMoreText = {};
    state.ui.newMoreText[id] = text;
    return;
  }
  if (kind === 'more') {
    const a = state.strategy.actions.find(x => x.id === id);
    const mp = a && a.morePriorities[Number(idx)];
    if (mp) mp.text = text;
    return;
  }
  const a = state.strategy.actions.find(x => x.id === id);
  if (a) a.conditionText = text;
}

function condTargetTextarea(kind, id, idx, cur) {
  const wanted = condRefId(kind, id, idx);
  const lf = app.lastCondField;
  if (lf && lf.ref === wanted && lf.el && lf.el.isConnected) return lf.el;
  const curEl = document.querySelector(`textarea[data-cond-ref="${cssEsc(wanted)}"]`);
  if (curEl) return curEl;
  return null;
}

/** 只有当“最后聚焦的条件输入框”确实是这一个时，才认为光标位置可用 */
function condCaretTextarea(kind, id, idx) {
  const wanted = condRefId(kind, id, idx);
  const lf = app.lastCondField;
  if (lf && lf.ref === wanted && lf.el && lf.el.isConnected) return lf.el;
  return null;
}

/**
 * 条件输入框的「模型 → 输入框」同步。
 * 快捷添加条件插入片段后会重建整块面板，重建出来的输入框必须显示模型里的内容；
 * 这里再兜一次底：只要输入框还挂在文档里、内容与模型不一致，就以模型为准写回去，
 * 避免出现“模型里已经有内容（点“添加其他触发条件”能带进新条目），但输入框看起来被清空了”的情况。
 */
function syncCondTextareasFromModel() {
  document.querySelectorAll('textarea[data-cond-ref]').forEach(el => {
    const info = condFieldInfo(el);
    if (!info) return;
    const want = getCondText(info.kind, info.id, info.idx);
    if (el.value !== want) el.value = want;
  });
}

/** 把正在编辑的条件输入框里的内容先写回模型（重建面板前调用，避免丢掉还没触发 input 的输入） */
function flushCondTextarea(el) {
  const info = condFieldInfo(el);
  if (!info) return;
  writeCondText(info.kind, info.id, info.idx, el.value);
  updateCondExplanation(info);
}

function applyCondInsert(kind, id, idx, text, mode) {
  // 兜底：把当前真正显示在输入框里的内容先写回模型，避免手输的内容还没来得及进入模型就被插入覆盖
  const shown = condTargetTextarea(kind, id, idx);
  if (shown && typeof shown.value === 'string') writeCondText(kind, id, idx, shown.value);
  const cur = getCondText(kind, id, idx);
  const caretEl = mode === 'append' ? null : condCaretTextarea(kind, id, idx);
  let next;
  let caret = null;
  // 插入「()」这类空括号片段时，把光标放进括号里面
  const insideBy = (ins) => (/\(\)$/.test(ins) ? 1 : 0);
  if (caretEl && typeof caretEl.selectionStart === 'number') {
    const s = caretEl.selectionStart;
    const e2 = caretEl.selectionEnd;
    const before = cur.slice(0, s);
    const after = cur.slice(e2);
    let ins = text;
    // 自动微调空格：前面不是空格/左括号就补一个空格；后面不是空格/右括号就补一个空格
    if (before && !/[\s(]$/.test(before)) ins = ' ' + ins;
    if (after && !/^[\s)]/.test(after) && !/\s$/.test(ins)) ins += ' ';
    next = normalizeExpr(before + ins + after);
    caret = before.length + ins.length - insideBy(ins.trim());
  } else {
    // 没有可用的光标位置（没在条件输入框里点过）：按“插入到末尾”处理
    const sep = cur && !/[\s(]$/.test(cur) ? ' ' : '';
    next = normalizeExpr(cur + sep + text);
    caret = next.length - insideBy(text.trim());
  }
  writeCondText(kind, id, idx, next);
  // 把光标放回条件输入框的插入位置，再重建面板（重建时会按 data-focus 还原焦点与光标）
  const ta = caretEl || condTargetTextarea(kind, id, idx);
  if (ta) {
    ta.value = next;
    try { if (caret !== null) ta.setSelectionRange(caret, caret); } catch (err) { /* 忽略 */ }
    try { ta.focus(); } catch (err) { /* 忽略 */ }
  }
  // 条件内容变了，校验面板（含隐式转换检查）必须立刻跟着刷新，否则会显示上一次的结论
  refreshLiveIssues();
  rerenderCurrent(true);
  // 重建之后按模型再同步一次：模型是唯一事实来源，显示出来的内容必须与它一致
  syncCondTextareasFromModel();
  // 重建出来的输入框是全新节点：显式把光标放到插入片段后面，方便接着输入
  if (caret !== null) {
    const fresh = condTextareaByRef(refIdOf(kind, id, idx));
    if (fresh && typeof fresh.setSelectionRange === 'function') {
      try { fresh.setSelectionRange(caret, caret); } catch (err) { /* 忽略 */ }
    }
  }
}

function refIdOf(kind, id, idx) { return condRefId(kind, id, idx); }

/** 表达式轻量规整化：压缩多余空格、去掉逗号/括号内的空格、把 ( 前的空格删掉 */
function normalizeExpr(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ',')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s+\./g, '.')
    .replace(/^\s+|\s+$/g, '');
}

/** 快捷添加条件的“片段状态”（每个编辑器独立）；pos = 'cursor'（光标位置）| 'append'（末尾） */
function condSnippetState(ref) {
  const st = state.ui.condSnippet[ref];
  if (!st) { state.ui.condSnippet[ref] = { fn: '', vals: {}, pos: 'cursor' }; return state.ui.condSnippet[ref]; }
  if (!st.vals) st.vals = {};
  if (st.pos !== 'append') st.pos = 'cursor';
  return st;
}

/** 出参为数字的条件函数的比较运算选项（与 BetterGI 的运算符一一对应） */
const COND_CMP_OPTIONS = [
  ['', '（空选）'],
  ['>', '大于 >'],
  ['<', '小于 <'],
  ['=', '等于 ='],
  ['!>', '不大于 !(a > b)'],
  ['!<', '不小于 !(a < b)'],
  ['!=', '不等于 !(a = b)'],
];

/** 给数值型条件函数片段套上比较运算；空选或没填数值时只返回函数本身 */
function condCmpExpr(call, op, num) {
  const o = String(op === undefined || op === null ? '' : op).trim();
  const n = String(num === undefined || num === null ? '' : num).trim();
  if (!o || n === '') return call;
  switch (o) {
    case '>': return `${call} > ${n}`;
    case '<': return `${call} < ${n}`;
    case '=': return `${call} = ${n}`;
    case '!>': return `! (${call} > ${n})`;
    case '!<': return `! (${call} < ${n})`;
    case '!=': return `! (${call} = ${n})`;
    default: return call;
  }
}

/** 动作参数选择器的筛选状态（按参数名分别记录角色筛选与角色搜索词） */
function cfActionFilter(st, key) {
  if (!st.af) st.af = {};
  if (!st.af[key]) st.af[key] = { char: '', q: '' };
  return st.af[key];
}
/** 角色名参数选择器的搜索词 */
function cfCharQuery(st, key) {
  if (!st.cq) st.cq = {};
  if (st.cq[key] === undefined) st.cq[key] = '';
  return st.cq[key];
}

/**
 * 「动作参数」选择器里角色筛选下拉的选项与「当前角色」的哨兵值。
 * 「当前角色」在动作模型里的 character 是空字符串，而 <option value=""> 已经是「（全部角色）」，
 * 两者共用空值会让「当前角色」既选不中、又表现成“选了但筛选没生效”（下拉会跳回「全部角色」）。
 * 所以筛选下拉的选项值用这个哨兵值表示「当前角色」；筛选状态里存的就是这个值，
 * 判断时由 cfFilterAllowsChar 负责把它翻译回模型里的空字符串。
 */
const CF_CHAR_CURRENT = '__current__';

/** 筛选下拉里选了「（全部角色）」= 不筛选；选了「当前角色」= 只留 character 为空的动作 */
function cfFilterAllowsChar(charFilter, character) {
  if (charFilter === null || charFilter === undefined || charFilter === '') return true;
  return (character || '') === (charFilter === CF_CHAR_CURRENT ? '' : charFilter);
}

/** 角色筛选下拉：只列“已经添加了动作”的角色，并显示条数（当前选中的角色即使被搜索词过滤也保留，避免选择凭空消失） */
function cfCharFilterOptions(q, cur) {
  const cnt = new Map();
  for (const a of state.strategy.actions) {
    const k = a.character || '';
    cnt.set(k, (cnt.get(k) || 0) + 1);
  }
  const ql = String(q || '').trim().toLowerCase();
  const rows = [`<option value="" ${!cur ? 'selected' : ''}>（全部角色）</option>`];
  for (const [k, n] of cnt) {
    const value = k === '' ? CF_CHAR_CURRENT : k;
    const hay = (k || '当前角色').toLowerCase();
    if (ql && !hay.includes(ql) && value !== cur) continue;
    // 「当前角色」（character 为空）用哨兵值，避免和「（全部角色）」的空值撞车
    rows.push(`<option value="${attr(value)}" ${cur === value ? 'selected' : ''}>${esc(k || '当前角色')}（${n} 条）</option>`);
  }
  return rows.join('');
}

/** 动作下拉：值为动作节点的 index（已选中的动作即使被角色筛选排除也保留） */
function cfActionOptions(charFilter, selected) {
  const list = state.strategy.actions.filter(a => cfFilterAllowsChar(charFilter, a.character) || String(a.index) === String(selected));
  list.sort((a, b) => a.index - b.index);
  const rows = [`<option value="">（默认：本动作）</option>`];
  for (const a of list) {
    const inFilter = cfFilterAllowsChar(charFilter, a.character);
    rows.push(`<option value="${a.index}" ${String(selected) === String(a.index) ? 'selected' : ''}>${a.index} · ${esc(a.name || '(未命名)')}${inFilter ? '' : ` · ${esc(a.character || '当前角色')}`}</option>`);
  }
  return rows.join('');
}

/** 角色下拉（可按搜索词过滤；已选中的角色始终保留） */
function cfCharOptions(q, selected) {
  const ql = String(q || '').trim().toLowerCase();
  const rows = [`<option value="">（默认：本动作的角色）</option>`];
  for (const a of AVATARS) {
    if (a.virtual) continue;
    if (ql && !a.name.toLowerCase().includes(ql) && selected !== a.name) continue;
    rows.push(`<option value="${attr(a.name)}" ${selected === a.name ? 'selected' : ''}>${esc(a.name)}</option>`);
  }
  return rows.join('');
}

/** 动作参数：角色筛选 + 角色搜索 + 动作下拉（选中的是动作 index） */
function cfActionPicker(st, key, value) {
  const f = cfActionFilter(st, key);
  return `<span class="row" style="gap:6px;margin:2px 0">
      <select data-cfchar="${attr(key)}" style="width:150px" title="按角色筛选动作">${cfCharFilterOptions(f.q, f.char)}</select>
      <input data-cfcharq="${attr(key)}" style="width:90px" value="${attr(f.q)}" placeholder="搜索角色">
      <select data-cfp="${attr(key)}" style="width:250px">${cfActionOptions(f.char, value)}</select>
    </span>`;
}

/** 角色参数：角色下拉 + 角色搜索 */
function cfCharPicker(st, key, value) {
  return `<span class="row" style="gap:6px;margin:2px 0">
      <select data-cfp="${attr(key)}" style="width:150px">${cfCharOptions(cfCharQuery(st, key), value)}</select>
      <input data-cfcs="${attr(key)}" style="width:90px" value="${attr(cfCharQuery(st, key))}" placeholder="搜索角色">
    </span>`;
}

/** 比较 + 数值（数值型条件函数专用） */
function cfCmpRow(st, def) {
  const vals = st.vals || {};
  const op = vals.cmp === undefined ? String(def || '') : String(vals.cmp);
  const num = vals.num === undefined || vals.num === null ? '' : String(vals.num);
  return `<div class="row">
      <label class="f">比较 <select data-cfp="cmp" style="width:190px">${COND_CMP_OPTIONS.map(([v, t]) => `<option value="${attr(v)}" ${op === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <label class="f">数值 <input data-cfp="num" type="number" step="any" style="width:110px" value="${attr(num)}" placeholder="可留空"></label>
    </div>
    <div class="hint">比较选「（空选）」或数值留空时，只插入条件函数本身，之后手动补充即可。</div>`;
}

/** 项数下拉（参数项数：min / max 与组合函数共用） */
function cfCountOptions(n, min) {
  const rows = [];
  for (let k = min; k <= 9; k++) rows.push(`<option value="${k}" ${k === n ? 'selected' : ''}>${k}</option>`);
  return rows.join('');
}

/** 生成一个条件函数片段（不弹窗、就地生成，可插到输入框的光标位置） */
function buildCondSnippet(fn, get) {
  const opt = (v) => {
    const t = String(v === undefined || v === null ? '' : v).trim();
    return t === '' ? null : t;
  };
  switch (fn) {
    case 't':
      return condCmpExpr('t', get('cmp'), get('num'));
    case 'since': {
      const a = opt(get('a'));
      return condCmpExpr(`since${a ? `(${a})` : ''}`, get('cmp'), get('num'));
    }
    case 'count': {
      const a = opt(get('a'));
      const b = opt(get('b'));
      const c = opt(get('c'));
      const args = a ? [a, b, c].filter(x => x !== null).join(',') : '';
      return condCmpExpr(`count${args ? `(${args})` : ''}`, get('cmp'), get('num'));
    }
    case 'last-check':
      return condCmpExpr('last-check', get('cmp'), get('num'));
    case 'q-ready': case 'e-ready': {
      const a = opt(get('a'));
      return `${fn}${a ? `(${a})` : ''}`;
    }
    case 'e-cd': {
      const a = opt(get('a'));
      return condCmpExpr(`e-cd${a ? `(${a})` : ''}`, get('cmp'), get('num'));
    }
    case 'low-hp': return 'low-hp';
    case 'onfield': return 'onfield';
    case 'min': case 'max': {
      const n = clamp(Number(get('n')) || 0, 0, 9);
      const vals = [];
      for (let i = 1; i <= n; i++) vals.push(opt(get('arg' + i)) || '');
      return condCmpExpr(`${fn}(${vals.join(',')})`, get('cmp'), get('num'));
    }
    // 组合 1：多个动作中是否有至少一个动作的距上次执行时间小于 → min(since(…),since(…)) < 数值
    case 'combo-min-since': {
      const n = clamp(Number(get('n')) || 2, 1, 9);
      const items = [];
      for (let i = 1; i <= n; i++) items.push(`since(${opt(get('arg' + i)) || ''})`);
      return condCmpExpr(`min(${items.join(',')})`, get('cmp') === undefined ? '<' : get('cmp'), get('num'));
    }
    // 组合 2：多个动作中是否有至少一个动作执行超过指定次数 → max(count(…,…,…),…) > 数值
    case 'combo-max-count': {
      const n = clamp(Number(get('n')) || 2, 1, 9);
      const b = opt(get('b'));
      const c = opt(get('c'));
      const items = [];
      for (let i = 1; i <= n; i++) {
        const a = opt(get('arg' + i));
        const args = a ? [a, b, c].filter(x => x !== null).join(',') : '';
        items.push(args ? `count(${args})` : 'count()');
      }
      return condCmpExpr(`max(${items.join(',')})`, get('cmp') === undefined ? '>' : get('cmp'), get('num'));
    }
    default: return '';
  }
}

/** 条件函数快捷添加的参数输入区 */
function renderCondFnParams(ref, st) {
  const fn = st.fn;
  const V = (k) => ((st.vals && st.vals[k] !== undefined && st.vals[k] !== null) ? String(st.vals[k]) : '');
  if (!fn) return '<div class="hint">先选一个条件函数。</div>';
  switch (fn) {
    case 't':
      return cfCmpRow(st, '');
    case 'since':
      return `<div class="row"><label class="f">目标动作 ${cfActionPicker(st, 'a', V('a'))}</label></div>
        ${cfCmpRow(st, '')}`;
    case 'count': {
      return `<div class="row"><label class="f">目标动作 ${cfActionPicker(st, 'a', V('a'))}</label></div>
        <div class="row">
          <label class="f">起始秒 <input data-cfp="b" type="number" step="any" style="width:110px" value="${attr(V('b'))}" placeholder="可空"></label>
          <label class="f">结束秒 <input data-cfp="c" type="number" step="any" style="width:110px" value="${attr(V('c'))}" placeholder="可空"></label>
        </div>
        <div class="hint">目标动作留空表示“本动作”；起始/结束秒留空表示开战到当前时间。</div>
        ${cfCmpRow(st, '')}`;
    }
    case 'last-check':
      return cfCmpRow(st, '');
    case 'q-ready': case 'e-ready':
      return `<div class="row"><label class="f">目标角色 ${cfCharPicker(st, 'a', V('a'))}</label></div>`;
    case 'e-cd':
      return `<div class="row"><label class="f">目标角色 ${cfCharPicker(st, 'a', V('a'))}</label></div>${cfCmpRow(st, '')}`;
    case 'min': case 'max': {
      const n = clamp(Number(V('n')) || 0, 0, 9);
      let html = `<div class="row"><label class="f">参数项数 <select data-cfp="n" style="width:70px">${cfCountOptions(n, 0)}</select></label></div>`;
      for (let i = 1; i <= n; i++) {
        html += `<div class="row"><label class="f">参数 ${i} <input data-cfp="arg${i}" style="width:260px" value="${attr(V('arg' + i))}" placeholder="例如 t-15 或 since(43111)"></label></div>`;
      }
      if (n === 0) html += '<div class="hint">项数为 0 时会插入空的 <span class="pill">min()</span>，之后请自己补充参数。</div>';
      html += '<div class="hint">项与项之间请用<b>英文逗号</b>分隔；参数里可以写任意表达式（例如 <span class="pill">t-15</span>、<span class="pill">since(43111)</span>）。</div>';
      return html + cfCmpRow(st, '');
    }
    case 'combo-min-since': {
      const n = clamp(Number(V('n')) || 2, 1, 9);
      let html = `<div class="row"><label class="f">参数项数 <select data-cfp="n" style="width:70px">${cfCountOptions(n, 1)}</select></label>
        <span class="hint">min() 里的项数（1~9）；每一项对应一个 since(目标动作)</span></div>`;
      for (let i = 1; i <= n; i++) {
        html += `<div class="row"><label class="f">参数 ${i} 的目标动作 ${cfActionPicker(st, 'arg' + i, V('arg' + i))}</label></div>`;
      }
      html += '<div class="hint">只要这些动作里<b>有一个</b>“距上次执行的时间小于”下面的数值，条件就成立；没执行过的动作 since 为 +∞，不影响判断（即使有动作的角色不在队伍里也没关系）。</div>';
      html += cfCmpRow(st, '<');
      return html;
    }
    case 'combo-max-count': {
      const n = clamp(Number(V('n')) || 2, 1, 9);
      let html = `<div class="row"><label class="f">参数项数 <select data-cfp="n" style="width:70px">${cfCountOptions(n, 1)}</select></label>
        <span class="hint">max() 里的项数（1~9）；每一项对应一个 count(目标动作,起始秒,结束秒)</span></div>`;
      for (let i = 1; i <= n; i++) {
        html += `<div class="row"><label class="f">参数 ${i} 的目标动作 ${cfActionPicker(st, 'arg' + i, V('arg' + i))}</label></div>`;
      }
      html += `<div class="row">
          <label class="f">起始秒（统一应用） <input data-cfp="b" type="number" step="any" style="width:110px" value="${attr(V('b'))}" placeholder="可空"></label>
          <label class="f">结束秒（统一应用） <input data-cfp="c" type="number" step="any" style="width:110px" value="${attr(V('c'))}" placeholder="可空"></label>
        </div>
        <div class="hint">起始/结束秒会统一写进 max() 里的每一项 count()；目标动作留空表示“本动作”（此时该 count 不会写入起始/结束秒）。</div>`;
      html += '<div class="hint">只要这些动作里<b>有一个</b>“在指定时间区间内执行次数大于”下面的数值，条件就成立；从未执行过的动作次数为 0，不影响判断。</div>';
      html += cfCmpRow(st, '>');
      return html;
    }
    default: return '';
  }
}

/** 快捷添加条件（就地展开的整块 UI） */
function renderCondQuickAdd(ref, kind, id, idx) {
  const st = condSnippetState(ref);
  const pos = st.pos === 'append' ? 'append' : 'cursor';
  const ops = [['||', '逻辑或 ||'], ['&&', '逻辑与 &&'], ['>', '是否大于 >'], ['<', '是否小于 <'], ['=', '是否等于 ='], ['()', '括号 ()']];
  const math = [['+', '加 +'], ['-', '减 -'], ['*', '乘 *'], ['/', '除 /'], ['!', '逻辑非 !'], ['true', '逻辑真 true'], ['false', '逻辑假 false']];
  return `
    <div class="card" style="background:var(--bg3);margin:0;padding:8px 10px" data-cfbox="${attr(ref)}" data-kind="${attr(kind)}" data-id="${attr(id)}" data-idx="${attr(idx)}">
      <div class="row mb">
        <label class="f">条件函数
          <select data-cfp="fn" style="width:200px">
            <option value="">（请选择）</option>
            ${COND_QUICK_FUNCS.map(([n, label, tpl]) => `<option value="${attr(n)}" ${st.fn === n ? 'selected' : ''}>${esc(label)}${tpl && tpl !== n ? ` — ${esc(tpl)}` : ''}</option>`).join('')}
          </select>
        </label>
        <button type="button" class="mini primary" data-cf="ins" ${st.fn ? '' : 'disabled'}>插入此片段到光标位置</button>
        <button type="button" class="mini" data-cf="insend" ${st.fn ? '' : 'disabled'}>插入此片段到末尾</button>
        <span class="hint">先在条件输入框里点一下可以决定“光标位置”；也可以先插入再手动补充</span>
      </div>
      <div data-cfparams="1">${renderCondFnParams(ref, st)}</div>
      <hr>
      <div class="row mb">
        <span class="hint">插入位置：</span>
        <button type="button" class="chip ${pos === 'cursor' ? 'on' : ''}" data-cfpos="cursor">光标位置</button>
        <button type="button" class="chip ${pos === 'append' ? 'on' : ''}" data-cfpos="append">末尾</button>
        <span class="hint">（对下面的运算符与逻辑值生效）</span>
      </div>
      <div class="row mb"><span class="hint">运算符与逻辑值：</span>
        ${ops.concat(math).map(([v, t]) => `<button type="button" class="mini" data-cfi="${attr(v)}">${esc(t)}</button>`).join('')}
      </div>
      <div class="hint">将插入：<span class="mono pill" data-cfsnip="1">${esc(st.fn ? buildCondSnippet(st.fn, (k) => (st.vals || {})[k]) : '（请选择条件函数）')}</span></div>
    </div>`;
}

/** 同步快捷添加面板里按钮的可用状态与“插入位置”高亮 */
function syncCfButtons(box, st) {
  const on = !!st.fn;
  box.querySelectorAll('[data-cf="ins"],[data-cf="insend"]').forEach(b => { b.disabled = !on; });
  const pos = st.pos === 'append' ? 'append' : 'cursor';
  box.querySelectorAll('[data-cfpos]').forEach(b => b.classList.toggle('on', b.getAttribute('data-cfpos') === pos));
}

/** 绑定条件快捷添加面板（渲染之后调用） */
function bindCondQuickPanels() {
  document.querySelectorAll('[data-cfbox]').forEach(box => {
    const ref = box.getAttribute('data-cfbox');
    if (box.__cfBound) return;
    box.__cfBound = true;
    box.addEventListener('input', (e) => onCfInput(box, e.target));
    box.addEventListener('change', (e) => onCfInput(box, e.target));
    box.addEventListener('click', (e) => {
      const t = e.target && e.target.closest ? e.target : null;
      if (!t) return;
      // 插入位置切换
      const posBtn = t.closest('[data-cfpos]');
      if (posBtn) {
        const st = condSnippetState(ref);
        st.pos = posBtn.getAttribute('data-cfpos') === 'append' ? 'append' : 'cursor';
        syncCfButtons(box, st);
        return;
      }
      // 插入整个条件函数片段
      const insBtn = t.closest('[data-cf="ins"],[data-cf="insend"]');
      if (insBtn) { cfInsert(box, insBtn.getAttribute('data-cf') === 'insend' ? 'append' : 'cursor'); return; }
      // 运算符 / 逻辑值 / 括号
      const b = t.closest('[data-cfi]');
      if (!b) return;
      const text = b.getAttribute('data-cfi');
      if (text === null) return;
      const st = condSnippetState(ref);
      cfInsertText(box, text, st.pos === 'append' ? 'append' : 'cursor');
    });
  });
}

/** 动作参数选择器：角色筛选/搜索只重画下拉里的选项，不重建整个面板（保住输入焦点） */
function refreshActionPicker(box, ref, st, key) {
  const f = cfActionFilter(st, key);
  const charSel = box.querySelector(`[data-cfchar="${cssEsc(key)}"]`);
  if (charSel) { charSel.innerHTML = cfCharFilterOptions(f.q, f.char); charSel.value = f.char; }
  const actSel = box.querySelector(`[data-cfp="${cssEsc(key)}"]`);
  if (actSel) { const cur = actSel.value; actSel.innerHTML = cfActionOptions(f.char, cur); }
  refreshCfPreview(box, ref, st);
}

/** 角色参数选择器：搜索词只重画角色下拉里的选项 */
function refreshCharPicker(box, ref, st, key) {
  const sel = box.querySelector(`[data-cfp="${cssEsc(key)}"]`);
  if (sel) { const cur = sel.value; sel.innerHTML = cfCharOptions(cfCharQuery(st, key), cur); }
  refreshCfPreview(box, ref, st);
}

function cfInsertText(box, text, mode) {
  applyCondInsert(box.getAttribute('data-kind'), box.getAttribute('data-id'), box.getAttribute('data-idx'), text, mode);
}

function onCfInput(box, el) {
  if (!el || !el.getAttribute) return;
  const ref = box.getAttribute('data-cfbox');
  const st = condSnippetState(ref);
  // 角色筛选下拉（''=全部角色、哨兵值=当前角色、其余=角色名，筛选状态里原样保存）
  const charKey = el.getAttribute('data-cfchar');
  if (charKey !== null) {
    cfActionFilter(st, charKey).char = el.value;
    refreshActionPicker(box, ref, st, charKey);
    return;
  }
  // 角色搜索框（筛选动作选择器的角色列表）
  const charQKey = el.getAttribute('data-cfcharq');
  if (charQKey !== null) {
    cfActionFilter(st, charQKey).q = el.value;
    refreshActionPicker(box, ref, st, charQKey);
    return;
  }
  // 角色搜索框（筛选角色名下拉）
  const charSKey = el.getAttribute('data-cfcs');
  if (charSKey !== null) {
    cfCharQuery(st, charSKey);
    st.cq[charSKey] = el.value;
    refreshCharPicker(box, ref, st, charSKey);
    return;
  }
  const key = el.getAttribute('data-cfp');
  if (!key) return;
  if (key === 'fn') {
    st.fn = el.value;
    st.vals = {};
    st.pick = null;
    st.af = {};
    st.cq = {};
    const box2 = box.querySelector('[data-cfparams]');
    if (box2) box2.innerHTML = renderCondFnParams(ref, st);
    syncCfButtons(box, st);
    refreshCfPreview(box, ref, st);
    return;
  }
  st.vals[key] = el.value;
  // 参数项数变化时要重建参数输入框
  if (key === 'n') {
    const box2 = box.querySelector('[data-cfparams]');
    if (box2) box2.innerHTML = renderCondFnParams(ref, st);
  }
  refreshCfPreview(box, ref, st);
}

function refreshCfPreview(box, ref, st) {
  const pv = box.querySelector('[data-cfsnip]');
  if (pv) pv.textContent = st.fn ? buildCondSnippet(st.fn, (k) => (st.vals || {})[k]) : '（请选择条件函数）';
  const info = condFieldInfo(condTextareaByRef(ref));
  if (info) updateCondExplanation(info);
}

function cfInsert(box, mode) {
  const ref = box.getAttribute('data-cfbox');
  const st = condSnippetState(ref);
  if (!st.fn) { alert('请先选择一个条件函数。'); return; }
  const text = buildCondSnippet(st.fn, (k) => (st.vals || {})[k]);
  if (!text) { alert('这个条件函数暂时不支持快捷插入，请手动输入。'); return; }
  applyCondInsert(box.getAttribute('data-kind'), box.getAttribute('data-id'), box.getAttribute('data-idx'), text,
    mode || (st.pos === 'append' ? 'append' : 'cursor'));
}

function condTextareaByRef(ref) {
  return document.querySelector(`textarea[data-cond-ref="${cssEsc(ref)}"]`);
}
function condFieldInfo(ta) {
  if (!ta || !ta.getAttribute) return null;
  const kind = ta.getAttribute('data-kind');
  if (kind !== 'condtext' && kind !== 'moretext' && kind !== 'morenewtext') return null;
  return {
    kind: kind === 'moretext' ? 'more' : (kind === 'morenewtext' ? 'morenew' : 'cond'),
    id: ta.getAttribute('data-id') || '', idx: ta.getAttribute('data-idx') || '', el: ta,
  };
}
/** 释义用的上下文：把 since/count/last-exec 里的动作引用渲染成动作名（带 index 与指令的悬停提示） */
function condExplainCtx(actionId) {
  return { actions: state.strategy.actions, currentActionId: actionId || '' };
}

/** 卡片的各区块渲染前记录「当前动作」，供条件行编辑弹窗里的释义把自身引用显示成「本动作」 */
let condUiActionId = '';
function withCondUiAction(actionId, fn) {
  const prev = condUiActionId;
  condUiActionId = String(actionId || '');
  try { return fn(); } finally { condUiActionId = prev; }
}

/** 释义 HTML：动作引用渲染成动作名（带 index 与指令的悬停提示），并转义其余文本 */
function condExplainHtml(ast) {
  return condExplain(ast, condExplainCtx(condUiActionId));
}

/** 运算顺序预览 HTML */
function condPrettyTreeHtml(ast) {
  return esc(condPrettyTree(ast, 0, condExplainCtx(condUiActionId)));
}

/** 其他触发条件条目的提示行（释义，或语法错误的红字）。
 *  单独抽出来是为了手输修正后能就地刷新，不至于把上一次的报错红字留在条目上。 */
function moreHintHtml(text, actionId) {
  const parsed = condParse(text || '', allActionNames(state.strategy.actions));
  if (parsed.error) return `<span style="color:var(--err)">${esc(parsed.error)}</span>`;
  if ((text || '').trim() === '') return '恒真（只要轮到就命中）';
  return parsed.ast ? condExplain(parsed.ast, condExplainCtx(actionId)) : '';
}

/** 输入过程中只刷新“释义/运算顺序/最终表达式”，不重建面板（避免打断输入法与光标） */
function updateCondExplanation(info) {
  const a = state.strategy.actions.find(x => x.id === info.id);
  if (!a) return;
  const text = getCondText(info.kind, info.id, info.idx);
  const box = document.getElementById(`condPreview-${info.kind}-${info.id}-${info.idx}`);
  if (box) box.innerHTML = renderCondPreview(text, info.id);
  const fin = document.getElementById(`condFinal-${info.id}`);
  if (fin) fin.textContent = buildExpression(a, state.strategy.actions) || '（空 = 恒真）';
  const more = document.getElementById(`moreExpr-${info.id}-${info.idx}`);
  if (more) {
    const arr = buildMorePriorities(a, state.strategy.actions);
    more.textContent = (arr[Number(info.idx)] || {}).expression || '（空 = 恒真）';
  }
  // 其他触发条件条目里的提示行（红字报错 / 释义）必须跟着当前输入一起刷新
  const hint = document.querySelector(`[data-morehint="${cssEsc(`${info.id}:${info.idx}`)}"]`);
  if (hint) hint.innerHTML = moreHintHtml(text, info.id);
}

/** 条件编辑区（直接输入框 + 快捷添加 + 释义 + 运算顺序预览 + 运算顺序说明） */
function renderCondEditor(kind, id, idx, opts) {
  const o = Object.assign({ text: '', title: '', intro: '' }, opts || {});
  const ref = refIdOf(kind, id, idx);
  const text = o.text === undefined || o.text === null ? getCondText(kind, id, idx) : o.text;
  const st = condSnippetState(ref);
  return `
    ${o.intro ? `<div class="hint" style="margin:8px 0 6px">${o.intro}</div>` : ''}
    <div class="hint" style="margin-bottom:4px">${esc(o.title || '触发条件表达式')}（可直接手输，也可以用下面的「快捷添加条件」拼）</div>
    ${ctrl({ tag: 'textarea', kind: kind === 'more' ? 'moretext' : (kind === 'morenew' ? 'morenewtext' : 'condtext'), actionId: id, idx, field: 'text', value: text || '', rows: 2, cls: 'mono', placeholder: '例如：low-hp || since(33011)>20　（留空 = 恒真）', extra: ` data-cond-ref="${attr(ref)}"` })}
    <details class="det sub" data-details="${attr(ref)}:quickadd" ${detailOpen(`${ref}:quickadd`, false) ? 'open' : ''}><summary>快捷添加条件</summary>
      ${renderCondQuickAdd(ref, kind, id, idx)}
    </details>
    <hr>
    <div id="condPreview-${attr(kind)}-${attr(id)}-${attr(idx)}">${renderCondPreview(text, id)}</div>
  `;
}

function renderCondPreview(text, actionId) {
  const parsed = condParse(text || '', allActionNames(state.strategy.actions));
  if (parsed.error) return `<div class="errbox">${esc(parsed.error)}</div>`;
  if (!parsed.ast) {
    return `<div class="warnbox">表达式为空：空条件<b>恒为真</b>，也就是说只要按 priority 轮到这条动作，它就会被执行（不满足条件的动作根本不会被考虑，所以不需要额外写条件）。</div>
      <div class="hint" style="margin-top:4px">如果你想临时停用这条动作又不想删掉它，把表达式写成 <span class="pill">false</span>（恒假）即可。</div>`;
  }
  const rows = [];
  const ctx = actionId ? condExplainCtx(actionId) : null;
  const ex = condExplain(parsed.ast, ctx);
  rows.push(`<div class="kv"><div class="k">释义</div><div class="v">${ctx ? ex : esc(ex)}</div></div>`);  const cnst = condConstValue(parsed.ast);
  if (cnst !== null) rows.push(`<div class="warnbox" style="margin-top:6px">该表达式是常量：${cnst ? '恒真（动作只要轮到就执行）' : '恒假（动作永远不会执行，等价于停用）'}</div>`);
  rows.push(`<details class="det sub" style="margin-top:6px"><summary>运算顺序预览</summary>
      <div class="hint" style="margin:4px 0 2px">下面按<b>缩进层级</b>展示运算顺序：<b>越靠里的行越先算</b>，同一层里<b>靠上的先算</b>；运算优先级从高到低是 <span class="pill">! 和负号</span> → <span class="pill">* /</span> → <span class="pill">+ -</span> → <span class="pill">&gt; &lt; =</span> → <span class="pill">&amp;&amp;</span> → <span class="pill">||</span>；同优先级的运算符按<b>从左到右</b>计算。</div>
      <div class="tree">${ctx ? condPrettyTree(parsed.ast, 0, ctx) : esc(condPrettyTree(parsed.ast, 0))}</div>
    </details>`);
  return rows.join('');
}

function renderCardCondTab(act) {
  return withCondUiAction(act.id, () => renderCardCondTabInner(act));
}

function renderCardCondTabInner(act) {
  const auto = autoExcludeExpr(act, state.strategy.actions);
  const wrap = [teammateExpr(act, state.strategy.actions), auto ? `自动排除：${auto}` : ''].filter(Boolean);
  const finalExpr = buildExpression(act, state.strategy.actions);
  return `
    ${renderCondEditor('cond', act.id, '', {
      text: act.conditionText,
      title: '基础动作触发条件 → 写入 condition.expression',
      intro: '除 <span class="pill">in-party</span> 以外的条件判断都写在这里（队友条件已单独分离到「队友条件」区块，会自动与本区块内容取与）。',
    })}
    <hr>
    <div class="hint" style="margin-bottom:4px">与队友条件合并后，最终写入动作节点的 expression（每个片段都会单独加括号，保证运算顺序）：</div>
    <div class="mono pill" style="display:block;padding:6px 8px;white-space:pre-wrap" id="condFinal-${attr(act.id)}">${esc(finalExpr || '（空 = 恒真）')}</div>
    <div class="hint" style="margin-top:4px">队友条件片段：${wrap.length ? wrap.map(esc).join(' ; ') : '（无）'}</div>`;
}

/* ---------------- 队友条件 ---------------- */

/** 取「角色组合」里第 i 项前面的运算符（1 起；空 → 跟随整体默认 mode） */
function teamOpAt(list, i, ops, mode) {
  if (i <= 0) return '';
  const raw = (ops || [])[i - 1];
  if (raw === 'or' || raw === 'and') return raw;
  return mode === 'and' ? 'and' : 'or';
}

/** 角色标签列表（必要队友 / 排除队友共用；同一个角色可以出现多次） */
function renderRoleTags(list, field, actionId, emptyText) {
  if (!list || !list.length) return `<span class="dim">${esc(emptyText)}</span>`;
  const act = state.strategy.actions.find(x => x.id === actionId);
  const tm = (act && act.teammates) || {};
  const mode = tm.mode === 'and' ? 'and' : 'or';
  const ops = field === 'include' ? tm.includeOps : tm.excludeOps;
  const fieldName = field === 'include' ? 'includeOp' : 'excludeOp';
  const title = field === 'include'
    ? '「与」= 这些角色要同时在队伍里；「或」= 任意一个在队伍里即可'
    : '「与」= 这些角色同时在场时才排除本动作；「或」= 任意一个在场就排除本动作（表达式里每一项自己取非，按运算优先级展开）';
  return list.map((n, i) => {
    let opSel = '';
    if (i === 0) opSel = '<span class="hint" title="第一个角色前面没有运算符">（首项）</span>';
    else {
      const cur = teamOpAt(list, i, ops, mode);
      opSel = `<select data-kind="team" data-id="${attr(actionId)}" data-field="${fieldName}" data-sub="${i}" style="width:70px" title="${attr(title)}">
          <option value="and" ${cur === 'and' ? 'selected' : ''}>与 &amp;&amp;</option>
          <option value="or" ${cur === 'or' ? 'selected' : ''}>或 ||</option>
        </select>`;
    }
    return `<span class="tag">${opSel}${avatarLabel(n)}<button data-act="team-remove" data-id="${attr(actionId)}" data-field="${field}" data-sub="${i}" data-name="${attr(n)}">×</button></span>`;
  }).join('');
}

function renderCardTeamTab(act) {
  const tm = act.teammates;
  const others = state.strategy.actions.filter(a => a.id !== act.id && (a.character || '') === (act.character || ''));
  const sameType = others.filter(a => a.type === act.type);
  const opOf = (field) => ((state.ui.teamFilterOps[`${act.id}:${field}`]) === 'and' ? 'and' : 'or');
  const opSel = (field, label) => `<label class="f">${esc(label)}
      <select data-kind="team" data-id="${attr(act.id)}" data-field="newOp" data-sub="${field}" style="width:120px">
        <option value="and" ${opOf(field) === 'and' ? 'selected' : ''}>与 &amp;&amp;</option>
        <option value="or" ${opOf(field) === 'or' ? 'selected' : ''}>或 ||</option>
      </select></label>`;
  return `
    <div class="hint" style="margin:8px 0 6px">这里选择的条件会应用到该动作节点<b>所有</b> expression（主条件与全部其他触发条件），与触发条件取与后生效。角色之间的运算符可以逐个修改，因此可以写“甲与乙或丙”这类组合；同一个角色也允许重复出现（多个角色组合里出现同一角色很正常）。</div>

    <div class="grid2">
      <label class="f">必要队友</label>
      <div>
        <div class="row mb">
          ${opSel('include', '新增角色前用：')}
          <button class="mini" data-act="team-pick" data-id="${attr(act.id)}" data-field="include">选择角色…</button>
          <select data-kind="team" data-id="${attr(act.id)}" data-field="mode" style="width:210px">
            <option value="and" ${tm.mode === 'and' ? 'selected' : ''}>未单独指定时默认用「与」</option>
            <option value="or" ${tm.mode !== 'and' ? 'selected' : ''}>未单独指定时默认用「或」</option>
          </select>
          <span class="hint">转化为 in-party(角色) 条件；「与」= 都要在队伍里，「或」= 任一在队伍里即可</span>
        </div>
        <div>${renderRoleTags(tm.include, 'include', act.id, '未设置（表示不限制队友）')}</div>
      </div>

      <label class="f">排除队友</label>
      <div>
        <div class="row mb">
          ${opSel('exclude', '新增角色前用：')}
          <button class="mini" data-act="team-pick" data-id="${attr(act.id)}" data-field="exclude">选择角色…</button>
          <span class="hint">「与」= 这些角色同时在场时才排除；「或」= 任意一个在场就排除。下面的算式就是括号里那段（整段加括号后取非，运算符与所选一致，导入时能原样还原）：</span>
          <span class="mono hint">${esc(excludeGroupTextOf(tm) || '（空）')}</span>
        </div>
        <div>${renderRoleTags(tm.exclude, 'exclude', act.id, '未设置')}</div>
      </div>

      <label class="f">自动排除</label>
      <div>
        <div class="hint mb">勾选本角色其他动作后，这些动作的「必要队友」会作为本动作的排除条件（表达式里写成对它们的必要队友整体取非；相同的必要队友表达式只取一次）。勾了「自动排除同一动作类型」时，同类动作里凡设置了必要队友的都会自动算进来。</div>
        <label class="f mb"><input type="checkbox" data-kind="team" data-id="${attr(act.id)}" data-field="autoExcludeSameType" ${tm.autoExcludeSameType ? 'checked' : ''}> 自动排除其他「同一动作类型」动作的必要队友（以后新增的同类动作也会自动勾上）</label>
        <div class="scroll" style="max-height:150px;border:1px solid var(--line);border-radius:6px;padding:4px">
          ${others.length ? others.map(o => {
            const hasInc = (o.teammates.include || []).length > 0;
            const checked = (tm.autoExclude || []).includes(o.id) || (tm.autoExcludeSameType && o.type === act.type && hasInc);
            return `<label class="roleitem">
              <input type="checkbox" data-kind="team" data-id="${attr(act.id)}" data-field="autoExclude" data-sub="${attr(o.id)}" ${checked ? 'checked' : ''}>
              ${elementDot((getAvatar(o.character) || { code: 0 }).code)}
              <span class="nm">${esc(o.name || '(未命名)')} <span class="pill">${o.type}·${esc(actionTypeShort(o.type))}</span>
                ${hasInc ? `<span class="hint">必要队友：${esc(o.teammates.include.join('、'))}</span>` : '<span class="dim">未设置必要队友（忽略）</span>'}</span>
              <span class="cnt">${o.index}</span></label>`;
          }).join('') : '<div class="hint">本角色还没有其他动作</div>'}
        </div>
        ${sameType.length ? `<div class="hint" style="margin-top:4px">同类型动作：${sameType.map(o => esc(o.name || '(未命名)')).join('、')}</div>` : ''}
      </div>
    </div>
    <hr>
    <div class="hint" style="margin-bottom:4px">队友条件最终生成的表达式片段：</div>
    <div class="mono pill" style="display:block;padding:6px 8px;white-space:pre-wrap">${esc(teammateExpr(act, state.strategy.actions) || '（无）')}</div>
    <div class="hint" style="margin-top:4px">排除队友：<span class="mono">${esc((tm.exclude || []).length ? excludeGroupTextOf(tm) : '（无，表达式里会写成 (true) 占位）')}</span></div>
    <div class="hint" style="margin-top:4px">自动排除生成：<span class="mono">${esc(autoExcludeExpr(act, state.strategy.actions) || '（无）')}</span></div>
    <hr>
    <div class="hint">最终写入的 condition.expression：</div>
    <div class="mono pill" style="display:block;padding:6px 8px;white-space:pre-wrap;margin-top:4px">${esc(buildExpression(act, state.strategy.actions) || '（空 = 恒真）')}</div>`;
}

/* ---------------- 其他触发条件 ---------------- */

/** 其他触发条件的 priority 段边界取值（type=0 时是 0~9999，修正后取 10000） */
function moreCmpPriority(mp) {
  const calc = mp.scope && mp.scope.type !== null && mp.scope.type !== undefined && mp.scope.type !== ''
    ? computePriority(mp.scope, mp.cmp, state.strategy.actions) : null;
  if (!calc) return null;
  return { value: calc.priority, empty: calc.empty, range: calc.range };
}

function morePriOptions(sel) {
  const cur = sel === null || sel === undefined ? '' : String(sel);
  return ACTION_TYPES.map(t => {
    const sp = prioritySpan({ type: t.code });
    return `<option value="${t.code}" ${cur === String(t.code) ? 'selected' : ''}>${esc(t.name)}（${sp ? `${sp.before}~${sp.hi}` : '-'}）</option>`;
  }).join('');
}

function morePriForm(id, idx) {
  const act = state.strategy.actions.find(x => x.id === id);
  const mp = act && act.morePriorities[Number(idx)];
  if (!mp) return '';
  const scope = mp.scope || { type: null, element: '', character: '' };
  const typeVal = scope.type === null || scope.type === undefined || scope.type === '' ? '' : String(scope.type);
  const typeZero = typeVal === '0';
  const elVal = typeZero ? '' : (scope.element === null || scope.element === undefined ? '' : String(scope.element));
  const charPool = elVal !== '' ? AVATARS.filter(a => !a.virtual && String(a.code) === String(elVal)) : [];
  const cmp = mp.cmp === 'before' ? 'before' : 'after';
  const calc = moreCmpPriority(mp);
  const dis = (typeVal === '' || typeZero) ? 'disabled' : '';
  return `<div class="card" style="background:var(--bg3);margin:6px 0 0;padding:8px 10px" data-moreform="${attr(id)}:${idx}">
    <div class="row mb">
      <span class="hint">判定顺序</span>
      <select data-kind="more" data-id="${attr(id)}" data-idx="${idx}" data-field="cmp" style="width:100px">
        <option value="after" ${cmp === 'after' ? 'selected' : ''}>次于</option>
        <option value="before" ${cmp === 'before' ? 'selected' : ''}>优先于</option>
      </select>
      <span class="hint">动作类型</span>
      <select data-kind="more" data-id="${attr(id)}" data-idx="${idx}" data-field="stype" style="width:190px">
        <option value="">（请选择动作类型）</option>
        ${morePriOptions(typeVal)}
      </select>
      <span class="hint">元素</span>
      <select data-kind="more" data-id="${attr(id)}" data-idx="${idx}" data-field="selement" style="width:150px" ${dis}>
        <option value="">（不限元素）</option>
        ${ELEMENTS.filter(e => e.code !== 0).map(e => {
          const sp = typeVal === '' ? null : prioritySpan({ type: Number(typeVal), element: e.code });
          return `<option value="${e.code}" ${elVal === String(e.code) ? 'selected' : ''}>${esc(e.name)}元素（${sp ? `${sp.before}~${sp.hi}` : '-'}）</option>`;
        }).join('')}
      </select>
      <span class="hint">角色</span>
      <select data-kind="more" data-id="${attr(id)}" data-idx="${idx}" data-field="scharacter" style="width:160px" ${elVal === '' ? 'disabled' : ''}>
        <option value="">（不限角色）</option>
        ${charPool.map(a => `<option value="${attr(a.name)}" ${scope.character === a.name ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
      </select>
      <button class="mini" data-act="more-recalc" data-id="${attr(id)}" data-idx="${idx}">按选择重算 priority</button>
      <span style="flex:1"></span>
      <span class="pill">priority = ${mp.priority}</span>
      <span class="hint">${esc(scopeLabel(scope))}${calc ? (calc.empty ? '（该段当前没有动作，取段边界）' : '（段内有动作，按规则取边界值）') : ''}</span>
    </div>
    ${typeZero ? '<div class="hint">动作类型 0（战斗检查与标记）是一整段，不能再按元素/角色细分；它的段边界是 0~9999，priority 不会落到某个元素或角色上。</div>' : ''}
    ${renderCondEditor('more', id, idx, { text: mp.text, title: `其他触发条件 #${idx + 1} 的触发条件` })}
    <div class="hint" style="margin-top:6px">写入 morePriorities 的表达式：</div>
    <div class="mono pill" style="display:block;padding:6px 8px;white-space:pre-wrap" id="moreExpr-${attr(id)}-${attr(idx)}">${esc((buildMorePriorities(state.strategy.actions.find(x => x.id === id), state.strategy.actions)[Number(idx)] || {}).expression || '（空 = 恒真）')}</div>
  </div>`;
}

function renderCardMoreTab(act) {
  return withCondUiAction(act.id, () => renderCardMoreTabInner(act));
}

function renderCardMoreTabInner(act) {
  const list = act.morePriorities || [];
  const rows = list.map((mp, i) => {
    const calc = moreCmpPriority(mp);
    return `<div class="card" style="background:var(--bg3);margin-bottom:8px;padding:8px 10px">
      <div class="row mb">
        <span class="hint">#${i + 1}</span>
        <span class="pill">priority = ${mp.priority}</span>
        <span class="hint">${mp.cmp === 'before' ? '优先于' : '次于'} ${esc(scopeLabel(mp.scope))}${calc ? (calc.empty ? '（该段当前没有动作，取段边界）' : '（段内有动作，按规则取边界值）') : ''}</span>
        <span style="flex:1"></span>
        <span class="hint">触发条件：<span class="mono">${esc(mp.text || '（空 = 恒真）')}</span></span>
        <button class="mini danger" data-act="more-del" data-id="${attr(act.id)}" data-idx="${i}">删除</button>
      </div>
      <div class="hint" style="margin-bottom:4px" data-morehint="${attr(act.id)}:${i}">${moreHintHtml(mp.text, act.id)}</div>
      <details class="det sub" data-details="${attr(act.id)}:more:${i}" ${detailOpen(`${act.id}:more:${i}`, false) ? 'open' : ''}>
        <summary>编辑触发条件与优先级</summary>
        ${morePriForm(act.id, i)}
      </details>
    </div>`;
  }).join('');

  // 「添加其他触发条件」表单：判定范围的选择存在 state.ui.moreAddForm 里，重建面板后不会丢
  const f = moreAddFormState(act.id);
  const typeZero = String(f.type) === '0';
  const elVal = typeZero || f.type === '' ? '' : String(f.element || '');
  const charPool = elVal !== '' ? AVATARS.filter(a => !a.virtual && String(a.code) === elVal) : [];
  const sp = f.type === '' ? null : prioritySpan({ type: Number(f.type), element: elVal, character: '' });
  const calc = f.type === '' ? null : computePriority({ type: Number(f.type), element: elVal, character: typeZero ? '' : String(f.character || '') }, f.cmp, state.strategy.actions);

  return `
    <div class="hint" style="margin:8px 0 6px">其他触发条件 → 写入 morePriorities。同一个动作可以在不同情境下占据不同的优先级位置；这些条目彼此平级、独立，命中哪条就执行同一个动作，不会再去看基础触发条件。</div>
    ${rows || '<div class="hint">还没有其他触发条件。常见用法：低血时把这个动作提到最前面；或者平时降低优先级让位给其他动作。</div>'}
    <details class="det sub" data-details="${attr(act.id)}:moreadd" ${detailOpen(`${act.id}:moreadd`, false) ? 'open' : ''}>
      <summary>添加其他触发条件</summary>
      <div class="hint" style="margin-top:6px">先填触发条件（可以用「快捷添加条件」拼），再选择它相对哪一类动作“优先于 / 次于”，priority 会按规则自动算出。</div>
      <div class="row mb" style="margin-top:6px" data-moreaddform="${attr(act.id)}">
        <span class="hint">判定顺序</span>
        <select data-na="cmp" style="width:100px">
          <option value="after" ${f.cmp !== 'before' ? 'selected' : ''}>次于</option>
          <option value="before" ${f.cmp === 'before' ? 'selected' : ''}>优先于</option>
        </select>
        <span class="hint">动作类型</span>
        <select data-na="type" style="width:190px">
          <option value="">（请选择动作类型）</option>
          ${morePriOptions(f.type)}
        </select>
        <span class="hint">元素</span>
        <select data-na="element" style="width:150px" ${f.type === '' || typeZero ? 'disabled' : ''}>
          <option value="">（不限元素）</option>
          ${ELEMENTS.filter(e => e.code !== 0).map(e => {
            const s = f.type === '' ? null : prioritySpan({ type: Number(f.type), element: e.code });
            return `<option value="${e.code}" ${elVal === String(e.code) ? 'selected' : ''}>${esc(e.name)}元素（${s ? `${s.before}~${s.hi}` : '-'}）</option>`;
          }).join('')}
        </select>
        <span class="hint">角色</span>
        <select data-na="character" style="width:160px" ${elVal === '' ? 'disabled' : ''}>
          <option value="">（不限角色）</option>
          ${charPool.map(a => `<option value="${attr(a.name)}" ${f.character === a.name ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
        </select>
      </div>
      <div class="hint mb">${sp
        ? `判定范围：<b>${esc(sp.label)}</b> → 取值区间 ${sp.before} ~ ${sp.hi}；当前将取 <b>${calc ? calc.priority : '-'}</b>${calc && calc.empty ? '（该段还没有动作，取段边界）' : ''}${typeZero ? '（动作类型 0 是一整段，不能按元素/角色细分）' : ''}`
        : '请选择动作类型。'}</div>
      <div>${renderCondEditor('morenew', act.id, '', { title: '这条其他触发条件的触发条件' })}</div>
      <div class="row" style="margin-top:6px">
        <button class="mini primary" data-act="more-add2" data-id="${attr(act.id)}">+ 添加这条其他触发条件</button>
      </div>
    </details>`;
}

/* ---------------- 注释（tags） ----------------
 * 每个动作节点可以写一段注释，保存在该动作的 tags 字段里。
 * BetterGI 的动作模型里没有 tags，但 Newtonsoft.Json 默认忽略未知属性（MissingMemberHandling.Ignore），
 * 所以它不会影响策略运行；导出时注释为空会省略这个字段（再次导入时「注释」仍为空）。
 */

/** 卡片标题栏上的「注释」标签（空注释时不显示） */
function tagsPillHtml(tags) {
  const t = String(tags || '').trim();
  return t ? `<span class="pill" title="注释：${attr(String(tags || ''))}">注释</span>` : '';
}

/** 「注释」区块标题后面的「已填写」标记（空注释时不显示） */
function tagsFilledHintHtml(tags) {
  return String(tags || '').trim() ? ' <span class="hint">已填写</span>' : '';
}

/**
 * 注释输入框里的内容变化后，只就地刷新与注释有关的标记，不重建面板
 * （重建会打断输入法与光标）：
 *   · 卡片标题栏的「注释」标签；
 *   · 「注释」区块标题后的「已填写」标记；
 *   · 输入框下面的字符数。
 */
function updateTagsBadges(actId, tags) {
  const key = cssEsc(String(actId));
  const pill = document.querySelector(`[data-tagspill="${key}"]`);
  if (pill) pill.innerHTML = tagsPillHtml(tags);
  const sum = document.querySelector(`[data-tagssum="${key}"]`);
  if (sum) sum.innerHTML = tagsFilledHintHtml(tags);
  const cnt = document.querySelector(`[data-tagscount="${key}"]`);
  if (cnt) cnt.textContent = `${String(tags || '').length} 个字符`;
}

function renderCardTagsTab(act) {
  const tags = String(act.tags || '');
  return `
    <div class="hint" style="margin:8px 0 6px">这里写的内容只用于给自己/他人做说明，保存在该动作节点的 <span class="pill">tags</span> 字段里。BetterGI 不读取这个字段（它会静默忽略动作里的多余字段），不影响战斗行为。</div>
    ${ctrl({ tag: 'textarea', kind: 'act', actionId: act.id, field: 'tags', value: tags, rows: 4, placeholder: '例如：开场先手；只有带盾的队伍才用这条；对应 BetterGI v0.4x 的改动…' })}
    <div class="row" style="margin-top:5px">
      <span class="hint" data-tagscount="${attr(act.id)}">${tags.length} 个字符</span>
      <span class="hint">导出时注释为空会省略 tags 字段；写入 JSON 的位置在 index 下面、morePriorities 上面。</span>
    </div>`;
}

/* ---------------- 动作编辑页渲染 ---------------- */

function renderActionsPanel() {
  const ui = state.ui;
  const ch = ui.editingCharacter || '';
  const list = actionsOf(state.strategy.actions, ch).sort((a, b) => a.index - b.index);
  const av = ch ? getAvatar(ch) : null;
  const chName = ch || '当前角色';
  const typeCnt = new Array(10).fill(0);
  for (const a of list) typeCnt[a.type] = (typeCnt[a.type] || 0) + 1;

  $('paneActions').innerHTML = `
    <div class="split">
      <div class="col" style="max-width:360px;flex:none;width:360px">
        ${renderCharacterColumn()}
      </div>
      <div class="col">
        <div class="card">
          <h3>正在编辑：${elementDot(av ? av.code : 0)}${esc(chName)}
            <span class="hint">${ch ? '编号 ' + avatarCodeLabel(av) : 'character 字段留空（特殊条目）'} · ${list.length} 条动作</span></h3>
          <div class="row">
            <label class="f">动作类型
              <select id="newType" style="width:190px">
                ${ACTION_TYPES.filter(t => t.code !== 0 || !ch).map(t => `<option value="${t.code}">${t.code} · ${esc(t.name)}（已 ${typeCnt[t.code] || 0}/9）</option>`).join('')}
              </select>
            </label>
            <label class="f">动作名称 <input id="newName" style="width:200px" placeholder="可留空，稍后再填"></label>
            <button class="primary" data-act="new-action" data-char="${attr(ch)}">+ 添加新动作</button>
            <span style="flex:1"></span>
            <button class="mini" data-act="renumber">按规则重排编号</button>
          </div>
          <div class="hint" style="margin-top:5px">
            ${ch ? '各动作类型的含义见「策略信息 / 导入导出」页的“关于编号规则”。' : '各动作类型的含义见「策略信息 / 导入导出」页的“关于编号规则”；动作类型 0（战斗检查与标记）只能添加到「当前角色」下。'}
          </div>
          ${ch ? '' : '<div class="hint">「当前角色」指 character 字段留空的动作：轮到它执行时使用当时的出战角色。</div>'}
        </div>
        ${list.length ? list.map(renderActionCard).join('') : `<div class="empty">「${esc(chName)}」还没有动作。<br>选择动作类型后点「+ 添加新动作」开始。</div>`}
      </div>
    </div>`;
  bindQuickCommandPanels();
  bindCondQuickPanels();
  bindMoreAddForm();
}

/** 读取“新增其他触发条件”表单里手写的触发条件（草稿存在 state.ui.newMoreText 里） */
function readNewMoreText(a) {
  const t = (state.ui.newMoreText || {})[a.id];
  if (t !== undefined && t !== null) return String(t).trim();
  const el = document.querySelector(`textarea[data-cond-ref="${cssEsc(refIdOf('morenew', a.id, ''))}"]`);
  return el ? el.value.trim() : '';
}

/** 清空“新增其他触发条件”表单里手写的触发条件与片段状态 */
function resetNewMoreText(a) {
  if (state.ui.newMoreText) delete state.ui.newMoreText[a.id];
  const el = document.querySelector(`textarea[data-cond-ref="${cssEsc(refIdOf('morenew', a.id, ''))}"]`);
  if (el) el.value = '';
  state.ui.condSnippet[refIdOf('morenew', a.id, '')] = { fn: '', vals: {}, pos: 'cursor', af: {}, cq: {} };
}

/** 「添加其他触发条件」表单里「判定范围」的选择（每个动作一份，重建面板后保留） */
function moreAddFormState(actId) {
  if (!state.ui.moreAddForm) state.ui.moreAddForm = {};
  const f = state.ui.moreAddForm[actId];
  if (!f) { state.ui.moreAddForm[actId] = { cmp: 'after', type: '', element: '', character: '' }; return state.ui.moreAddForm[actId]; }
  if (!f.cmp) f.cmp = 'after';
  if (f.type === undefined || f.type === null) f.type = '';
  if (f.element === undefined || f.element === null) f.element = '';
  if (!f.character) f.character = '';
  return f;
}

/** 「添加其他触发条件」表单的联动：把选择记进 state，重画面板（这样切换类型/元素时角色下拉与提示会同步） */
function bindMoreAddForm() {
  document.querySelectorAll('[data-moreaddform]').forEach(form => {
    if (form.__bound) return;
    form.__bound = true;
    const actId = form.getAttribute('data-moreaddform');
    form.addEventListener('change', (e) => {
      const el = e.target;
      const key = el && el.getAttribute ? el.getAttribute('data-na') : null;
      if (!key) return;
      const f = moreAddFormState(actId);
      f[key] = el.value;
      if (key === 'type' && String(el.value) === '0') { f.element = ''; f.character = ''; }
      if (key === 'type') f.character = '';
      if (key === 'element') f.character = '';
      rerenderCurrent();
    });
  });
}

/* ---------------- 事件处理 ---------------- */

const COND_VALUE_FUNCS = { since: 1, count: 1, 'last-exec': 3 };
const COND_ACTIONSET = ['since', 'count', 'last-exec'];

function condFnInfo(sig) { return COND_FUNCTION_BY_NAME.get(sig.toLowerCase()); }

function fnParamBlock(fnName, args, idSuffix) {
  const sig = fnName;
  if (!sig) return '<div class="hint">请选择条件函数。</div>';
  const blocks = [];
  const numInput = (i, def, ph) => `<input data-cfa="${idSuffix}:${i}" type="number" step="any" style="width:110px" value="${attr(def)}" placeholder="${attr(ph || '')}">`;
  const numTpl = (label, i, def, ph, hint) => `<label class="f">${esc(label)} ${numInput(i, def, ph)}</label>${hint ? `<span class="hint">${esc(hint)}</span>` : ''}`;
  const charSelect = (i, def) => `<select data-cfa="${idSuffix}:${i}" style="width:150px">
      <option value="">（默认：本动作的角色）</option>
      ${AVATARS.filter(a => !a.virtual).map(a => `<option value="${attr(a.name)}" ${def === a.name ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
    </select>`;
  const actionSelect = (i, def) => `<select data-cfa="${idSuffix}:${i}" style="width:190px">
      <option value="">（默认：本动作自己）</option>
      ${state.strategy.actions.map(a => `<option value="${a.index}" ${String(def) === String(a.index) ? 'selected' : ''}>${a.index} · ${esc(a.name || '(未命名)')}</option>`).join('')}
    </select>`;
  const boolSelect = (i, def) => `<select data-cfa="${idSuffix}:${i}" style="width:120px">
      <option value="true" ${def !== 'false' ? 'selected' : ''}>true（大于）</option>
      <option value="false" ${def === 'false' ? 'selected' : ''}>false（小于）</option></select>`;

  switch (sig) {
    case 't': case 'low-hp': case 'onfield': case 'last-check':
      blocks.push('<span class="hint">该函数没有参数。</span>');
      break;
    case 'battle-time':
      blocks.push(numTpl('秒数', 0, args[0] ?? 5));
      blocks.push(boolSelect(1, args[1] ?? 'true'));
      break;
    case 'since':
      blocks.push(`<label class="f">目标动作 ${actionSelect(0, args[0])}</label>`);
      break;
    case 'count':
      blocks.push(`<label class="f">目标动作 ${actionSelect(0, args[0])}</label>`);
      blocks.push(numTpl('起始秒(可空)', 1, args[1] ?? ''));
      blocks.push(numTpl('结束秒(可空)', 2, args[2] ?? ''));
      break;
    case 'last-exec':
      blocks.push(numTpl('阈值秒', 0, args[0] ?? 5));
      blocks.push(boolSelect(1, args[1] ?? 'true'));
      blocks.push(`<label class="f">目标动作 ${actionSelect(2, args[2])}</label>`);
      break;
    case 'q-ready': case 'e-ready': case 'e-cd':
      blocks.push(`<label class="f">角色 ${charSelect(0, args[0])}</label>`);
      break;
    case 'in-party':
      blocks.push(`<label class="f">角色 ${charSelect(0, args[0])}</label><span class="hint">参数必须是裸角色名</span>`);
      break;
    case 'min': case 'max':
      blocks.push(`<label class="f">表达式 <input data-cfa="${idSuffix}:0" style="width:260px" value="${attr(args[0] ?? 'since')}" placeholder="例如 since 或 t-15"></label>`);
      blocks.push('<span class="hint">可只填一个，或写完整表达式（会原样保留）。</span>');
      break;
    default:
      blocks.push('<span class="hint">该函数暂无参数编辑器。</span>');
  }
  return `<div class="row" style="gap:10px">${blocks.join('')}</div><div class="hint" style="margin-top:4px">${esc(condFnInfo(sig) ? condFnInfo(sig).cn : '')}</div>`;
}

/** 条件行编辑器弹窗：editing = { title, text } 返回新文本或 null */
function openCondRowEditor(title, text, note) {
  const state0 = { fn: '', args: [], op: '>', value: '5', raw: text || '', direct: false };
  const body = `
    ${note ? `<div class="hint mb">${esc(note)}</div>` : ''}
    <div class="row mb">
      <button class="chip on" data-cmode="build">按条件函数组合</button>
      <button class="chip" data-cmode="direct">直接输入表达式</button>
      <span class="hint">大多数情况用左边这种就够了</span>
    </div>
    <div id="cBuild">
      <div class="row mb">
        <label class="f">条件函数
          <select id="cfn" style="width:230px">
            <option value="">（请选择）</option>
            ${COND_FUNCTIONS.map(f => `<option value="${f.name}">${f.name} — ${esc(f.cn.slice(0, 34))}</option>`).join('')}
          </select>
        </label>
        <label class="f" id="copWrap">比较
          <select id="cop" style="width:110px"></select>
        </label>
        <label class="f" id="cvalWrap">数值 <input id="cval" type="number" step="any" style="width:110px" value="5"></label>
      </div>
      <div id="cparams"></div>
      <details style="margin-top:8px"><summary>不知道选哪个函数？</summary>
        <div class="hint" style="line-height:1.7;margin-top:4px">
          ${COND_FUNCTIONS.filter(f => f.name !== 'in-party').map(f => `· <span class="pill">${f.name}</span> ${esc(f.cn)}`).join('<br>')}
        </div>
      </details>
    </div>
    <div id="cDirect" style="display:none">
      <textarea id="craw" rows="3" class="mono">${esc(text || '')}</textarea>
      <div class="hint">可用的运算符：<span class="pill">&amp;&amp;</span> <span class="pill">||</span> <span class="pill">!</span> <span class="pill">></span> <span class="pill">&lt;</span> <span class="pill">=</span> <span class="pill">+ - * /</span>；布尔字面量必须小写。</div>
    </div>
    <hr>
    <div class="hint">将生成：</div>
    <div class="mono pill" id="cpreview" style="display:block;padding:6px 8px;margin-top:4px;white-space:pre-wrap"></div>
    <div id="ccheck" style="margin-top:6px"></div>`;

  const p = openModal({
    title: title || '编辑条件', body,
    actions: [{ label: '取消', value: null }, { label: '确定', primary: true, value: 'ok' }],
  });

  const isBoolFn = (name) => {
    const f = COND_FUNCTION_BY_NAME.get(name);
    return f && f.ret === 'bool';
  };
  const needsCompare = (name) => {
    const f = COND_FUNCTION_BY_NAME.get(name);
    return f && f.ret === 'number';
  };
  const buildFnCall = () => {
    const fn = state0.fn;
    if (!fn) return state0.raw || '';
    const arity = COND_FUNCTION_BY_NAME.get(fn).arity;
    const parts = [];
    for (let i = 0; i < arity[0]; i++) parts.push(state0.args[i] ?? '');
    // 可选参数：仅当填写了才追加
    for (let i = arity[0]; i < arity[1]; i++) {
      const v = state0.args[i];
      if (v !== undefined && v !== null && String(v).trim() !== '') parts.push(v);
    }
    if (fn === 'min' || fn === 'max') return `${fn}(${state0.args[0] || ''})`;
    return parts.length ? `${fn}(${parts.join(',')})` : fn;
  };
  const buildText = () => {
    if (state0.direct) return $('craw').value.trim();
    const fn = state0.fn;
    if (!fn) return '';
    if (needsCompare(fn)) return `${buildFnCall()} ${state0.op} ${state0.value}`;
    if (fn === 't' || fn === 'e-cd' || fn === 'since' || fn === 'count' || fn === 'last-check') {
      // 数值型但没选比较？保留裸调用
      return buildFnCall();
    }
    return buildFnCall();
  };
  function refresh2() {
    const txt = buildText();
    $('cpreview').textContent = txt || '（空）';
    const parsed = condParse(txt, allActionNames(state.strategy.actions));
    const v = txt ? condValidate(txt, { actionNames: allActionNames(state.strategy.actions), knownIndexes: knownIndexes(state.strategy.actions), currentAction: { character: '' } }) : { errors: [], warnings: [] };
    $('ccheck').innerHTML = (parsed.error ? `<div class="errbox">${esc(parsed.error)}</div>` : '')
      + v.errors.map(e => `<div class="errbox">${esc(e)}</div>`).join('')
      + v.warnings.map(e => `<div class="warnbox">${esc(e)}</div>`).join('')
      + (!parsed.error && parsed.ast ? `<div class="hint">释义：${condExplainHtml(parsed.ast)}</div>` : '');
  }
  function renderParams() {
    $('cparams').innerHTML = fnParamBlock(state0.fn, state0.args, 'a');
    // 参数绑定
    document.querySelectorAll('[data-cfa]').forEach(el => {
      const [sid, idx] = el.getAttribute('data-cfa').split(':');
      const i = Number(idx);
      el.value = state0.args[i] ?? (el.tagName === 'SELECT' ? '' : '');
      const h = () => { state0.args[i] = el.value; refresh2(); };
      el.oninput = h; el.onchange = h;
    });
    refresh2();
  }
  function renderOps() {
    const fn = state0.fn;
    const ops = ['>', '<', '=', '>='].filter(x => true);
    $('cop').innerHTML = `
      <option value=">">大于 &gt;</option>
      <option value="<">小于 &lt;</option>
      <option value="=">等于 =</option>
      <option value="!=">不等于（写法 !(a=b)）</option>
      <option value=">=">不小于（写法 !(a&lt;b)）</option>
      <option value="<=">不大于（写法 !(a&gt;b)）</option>`;
    const need = needsCompare(fn);
    $('copWrap').style.display = need ? '' : 'none';
    $('cvalWrap').style.display = need ? '' : 'none';
  }
  function opToExpr(call, op, val) {
    switch (op) {
      case '>': return `${call} > ${val}`;
      case '<': return `${call} < ${val}`;
      case '=': return `${call} = ${val}`;
      case '!=': return `!(${call} = ${val})`;
      case '>=': return `!(${call} < ${val})`;
      case '<=': return `!(${call} > ${val})`;
      default: return `${call} > ${val}`;
    }
  }
  // 覆盖 buildText 支持 >= <= != 展开
  const origBuild = buildText;
  const buildText2 = () => {
    if (state0.direct) return $('craw').value.trim();
    const fn = state0.fn;
    if (!fn) return '';
    const call = buildFnCall();
    if (needsCompare(fn)) return opToExpr(call, state0.op, state0.value);
    return call;
  };
  // 重新定义 refresh2 使用 buildText2
  const refresh3 = () => {
    const txt = buildText2();
    $('cpreview').textContent = txt || '（空）';
    const parsed = condParse(txt, allActionNames(state.strategy.actions));
    const v = txt ? condValidate(txt, { actionNames: allActionNames(state.strategy.actions), knownIndexes: knownIndexes(state.strategy.actions), currentAction: { character: '' } }) : { errors: [], warnings: [] };
    $('ccheck').innerHTML = (parsed.error ? `<div class="errbox">${esc(parsed.error)}</div>` : '')
      + v.errors.map(e => `<div class="errbox">${esc(e)}</div>`).join('')
      + v.warnings.map(e => `<div class="warnbox">${esc(e)}</div>`).join('')
      + (!parsed.error && parsed.ast ? `<div class="hint">释义：${condExplainHtml(parsed.ast)}</div>` : '');
  };
  // 重新绑定
  $('cfn').onchange = () => {
    state0.fn = $('cfn').value;
    state0.args = [];
    const f = COND_FUNCTION_BY_NAME.get(state0.fn);
    if (f) {
      if (f.name === 'since') state0.args = [];
      if (f.name === 'last-exec') state0.args = ['5', 'true'];
      if (f.name === 'battle-time') state0.args = ['5', 'true'];
      if (f.name === 'count') state0.args = [];
      if (f.name === 'min' || f.name === 'max') state0.args = ['since'];
      if (f.name === 't' || f.name === 'low-hp' || f.name === 'onfield' || f.name === 'last-check') state0.args = [];
    }
    renderOps();
    renderParams();
    refresh3();
  };
  $('cop').onchange = () => { state0.op = $('cop').value; refresh3(); };
  $('cval').oninput = () => { state0.value = $('cval').value; refresh3(); };
  document.querySelectorAll('[data-cmode]').forEach(b => {
    b.onclick = () => {
      const m = b.getAttribute('data-cmode');
      state0.direct = m === 'direct';
      document.querySelectorAll('[data-cmode]').forEach(x => x.classList.toggle('on', x === b));
      $('cBuild').style.display = state0.direct ? 'none' : '';
      $('cDirect').style.display = state0.direct ? '' : 'none';
      refresh3();
    };
  });
  $('craw').oninput = refresh3;

  // 预填：尝试从 text 反解
  if (text) {
    const parsed = condParse(text, allActionNames(state.strategy.actions));
    let pre = false;
    if (!parsed.error && parsed.ast) {
      const a = parsed.ast;
      // 形如 fn(...) op num
      if (a.type === 'binary' && ['>', '<', '='].includes(a.op) && a.left.type === 'call' && a.right.type === 'number' && COND_FUNCTION_BY_NAME.has(a.left.lower)) {
        state0.fn = a.left.name;
        if (a.op === '>') { state0.op = '>'; state0.value = String(a.right.value); }
        else if (a.op === '<') { state0.op = '<'; state0.value = String(a.right.value); }
        else { state0.op = '='; state0.value = String(a.right.value); }
        state0.args = a.left.args.map(x => (x.type === 'ident' ? x.name : condToText(x)));
        pre = true;
      } else if (a.type === 'call' && COND_FUNCTION_BY_NAME.has(a.lower)) {
        state0.fn = a.name;
        state0.args = a.args.map(x => (x.type === 'ident' ? x.name : condToText(x)));
        pre = true;
      } else if (a.type === 'ident' && COND_FUNCTION_BY_NAME.has(a.lower)) {
        state0.fn = a.name;
        pre = true;
      }
    }
    if (!pre) {
      state0.direct = true;
      document.querySelectorAll('[data-cmode]').forEach(x => x.classList.toggle('on', x.getAttribute('data-cmode') === 'direct'));
      $('cBuild').style.display = 'none';
      $('cDirect').style.display = '';
    } else {
      $('cfn').value = state0.fn;
      if (state0.op === '!=') $('cop').value = '!=';
      if (state0.op === '>=') $('cop').value = '>=';
      if (state0.op === '<=') $('cop').value = '<=';
      else $('cop').value = state0.op;
      $('cval').value = state0.value;
    }
  }
  renderOps();
  renderParams();
  refresh3();

  return p.then(v => (v === 'ok' ? buildText2().trim() : null));
}

/* ---------------- 添加动作类型选择 ---------------- */

function openAddAction(character) {
  const allowed = ACTION_TYPES.filter(t => t.code !== 0 || !character);
  openModal({
    title: `为「${character || '当前角色'}」添加动作`,
    body: `<div class="hint mb">选择动作类型；条目会自动获得编号（元素号 + 角色编号 + 该类型内的序号）。</div>
      <div class="row">${allowed.map(t => `<button class="chip" data-addtype="${t.code}">${t.code} · ${esc(t.name)}<span class="hint">已 ${countOfType(state.strategy.actions, character, t.code)}/9</span></button>`).join('')}</div>`,
    actions: [{ label: '取消', value: null }],
  }).then(v => { /* 由 data-addtype 处理 */ });
  $('modalBody').onclick = (e) => {
    const b = e.target.closest('[data-addtype]');
    if (!b) return;
    const type = Number(b.getAttribute('data-addtype'));
    closeModal(null);
    const r = addAction(character, type, { name: '', action: '' });
    if (!r.ok) { alert(r.error); return; }
    state.ui.editingCharacter = character;
    state.ui.collapsed[r.action.id] = false;
    state.ui.activeCardTab[r.action.id] = 'cmd';
    refresh(['actions', 'preview']);
    setTimeout(() => {
      const el = document.querySelector(`[data-card="${r.action.id}"] textarea`);
      if (el) el.focus();
    }, 60);
  };
}

/* ---------------- 事件处理 ---------------- */

const actionsHandlers = {
  'pick-char': (t) => { state.ui.editingCharacter = t.getAttribute('data-char') || ''; saveUi(); rerenderCurrent(); },
  'rarity-edit': () => openRarityEditor(),
  'card-toggle': (t) => {
    const id = t.getAttribute('data-id');
    state.ui.collapsed[id] = !state.ui.collapsed[id];
    rerenderCurrent();
  },
  'card-tab': (t) => { /* 卡片内已不再使用子页签，全部改为可折叠区块 */ },
  'name-quick': (t) => {
    const a = state.strategy.actions.find(x => x.id === t.getAttribute('data-id'));
    if (!a) return;
    a.name = t.getAttribute('data-name');
    refresh(['actions']);
  },
  'card-up': (t) => { doSwap(t.getAttribute('data-id'), -1); },
  'card-down': (t) => { doSwap(t.getAttribute('data-id'), 1); },
  'card-dup': (t) => {
    const a = state.strategy.actions.find(x => x.id === t.getAttribute('data-id'));
    if (!a) return;
    const r = addAction(a.character, a.type, { name: '', action: a.action, ensureCast: a.ensureCast });
    if (!r.ok) { alert(r.error); return; }
    const na = r.action;
    na.name = nextCopyName(a.name);
    na.conditionText = a.conditionText;
    na.tags = a.tags || '';
    na.teammates = JSON.parse(JSON.stringify(a.teammates));
    na.morePriorities = (a.morePriorities || []).map(mp => ({ ...mp, id: newId(), scope: { ...mp.scope } }));
    refresh(['actions', 'preview']);
  },
  'card-del': (t) => {
    const id = t.getAttribute('data-id');
    const a = state.strategy.actions.find(x => x.id === id);
    if (!a) return;
    const refs = [];
    const names = allActionNames(state.strategy.actions);
    for (const o of state.strategy.actions) {
      const r = condCollectRefs(condParse(o.conditionText || '', names).ast, { indexes: [], names: [] });
      if (r.names.includes(a.name) || r.indexes.some(x => x.value === a.index)) refs.push(o.name || '(未命名)');
      for (const mp of (o.morePriorities || [])) {
        const r2 = condCollectRefs(condParse(mp.text || '', names).ast, { indexes: [], names: [] });
        if (r2.names.includes(a.name) || r2.indexes.some(x => x.value === a.index)) refs.push(o.name || '(未命名)');
      }
    }
    openModal({
      title: '删除动作',
      body: `<div class="warnbox">确定删除「${esc(a.name || '(未命名)')}」（index ${a.index}）？</div>
        ${refs.length ? `<div class="errbox" style="margin-top:8px">以下动作的条件里引用了它：${esc(uniq(refs).join('、'))}；删除后这些引用会失效（条件恒为 false）。</div>` : ''}
        <div class="hint" style="margin-top:6px">删除后同类型动作的编号不会自动紧凑（保持稳定），如需紧凑可点「按规则重排编号」。</div>`,
      actions: [{ label: '取消', value: null }, { label: '删除', primary: true, value: 'ok', danger: true }],
    }).then(v => {
      if (v !== 'ok') return;
      removeAction(id);
      refresh(['actions', 'preview']);
    });
  },
  'new-action': (t) => {
    const ch = t.getAttribute('data-char') || '';
    const type = Number($('newType') ? $('newType').value : 1);
    const name = $('newName') ? $('newName').value.trim() : '';
    const r = addAction(ch, type, { name, action: '' });
    if (!r.ok) { alert(r.error); return; }
    state.ui.collapsed[r.action.id] = false;
    refresh(['actions', 'preview']);
    setTimeout(() => {
      const el = document.querySelector(`[data-card="${r.action.id}"]`);
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 50);
  },
  'renumber': () => {
    const plan = planRenumber();
    if (plan.error) { alert(plan.error); return; }
    openModal({
      title: '按规则重排编号',
      body: `<div class="hint mb">会按「角色 + 动作类型」重新分配尾数（1~9，按当前 index 顺序），并同步改写条件里 next 数字引用。</div>
        <div class="scroll" style="max-height:280px">
        ${plan.changes.slice(0, 60).map(c => `<div class="mono" style="font-size:12px">${esc(c.character || '当前角色')} · ${esc(c.name || '(未命名)')}：${c.from} → <b>${c.to}</b></div>`).join('') || '<div class="hint">编号已经符合规则，无需变化。</div>'}
        </div>`,
      actions: [{ label: '取消', value: null }, { label: '执行重排', primary: true, value: 'ok' }],
    }).then(v => {
      if (v !== 'ok') return;
      const notes = applyRenumber(plan);
      refresh(['info', 'actions', 'preview']);
      if (notes.length) alert('已完成重排。\n' + notes.join('\n'));
    });
  },
  'cond-add': (t) => { editCondRow(t, -1); },
  'cond-edit': (t) => { editCondRow(t, Number(t.getAttribute('data-sub'))); },
  'cond-del': (t) => {
    const kind = t.getAttribute('data-kind');
    const idx = t.getAttribute('data-idx');
    const sub = Number(t.getAttribute('data-sub'));
    const cur = getCondTarget(kind, t.getAttribute('data-id'), idx);
    const rows = parseCondRows(cur.text);
    if (!rows) return;
    rows.rows.splice(sub, 1);
    setCondTarget(kind, t.getAttribute('data-id'), idx, buildCondExpr(rows.rows, rows.mode), rows.mode);
    refresh(['actions', 'preview']);
  },
  'cond-raw': (t) => {
    const kind = t.getAttribute('data-kind');
    const cur = getCondTarget(kind, t.getAttribute('data-id'), t.getAttribute('data-idx'));
    const rp = openModal({
      title: '直接编辑表达式文本',
      body: `<div class="hint mb">运算符：<span class="pill">&amp;&amp;</span> <span class="pill">||</span> <span class="pill">!</span> <span class="pill">&gt;</span> <span class="pill">&lt;</span> <span class="pill">=</span> <span class="pill">+ - * /</span>，没有 == != &gt;= &lt;=；布尔字面量必须小写。</div>
        <textarea id="rawExpr" rows="4" class="mono">${esc(cur.text || '')}</textarea>
        <div id="rawCheck" style="margin-top:6px"></div>`,
      actions: [{ label: '取消', value: null }, { label: '保存', primary: true, value: 'ok' }],
    });
    const upd = () => {
      const txt = $('rawExpr').value;
      const parsed = condParse(txt, allActionNames(state.strategy.actions));
      const v = condValidate(txt, { actionNames: allActionNames(state.strategy.actions), knownIndexes: knownIndexes(state.strategy.actions), currentAction: { character: '' } });
      $('rawCheck').innerHTML = (parsed.error ? `<div class="errbox">${esc(parsed.error)}</div>` : '')
        + v.errors.map(e => `<div class="errbox">${esc(e)}</div>`).join('')
        + v.warnings.map(e => `<div class="warnbox">${esc(e)}</div>`).join('')
        + (!parsed.error && parsed.ast ? `<div class="hint">释义：${condExplainHtml(parsed.ast)}</div><div class="tree" style="margin-top:4px">${condPrettyTreeHtml(parsed.ast)}</div>` : '');
    };
    $('rawExpr').oninput = upd;
    upd();
    return rp.then(v => {
      if (v !== 'ok') return;
      setCondTarget(kind, t.getAttribute('data-id'), t.getAttribute('data-idx'), $('rawExpr').value.trim(), null);
      refresh(['actions', 'preview']);
    });
  },
  'cond-parse': (t) => {
    const kind = t.getAttribute('data-kind');
    const cur = getCondTarget(kind, t.getAttribute('data-id'), t.getAttribute('data-idx'));
    const rows = parseCondRows(cur.text || '');
    if (!rows) { alert('当前表达式无法反解（语法有问题），请先用「直接编辑表达式文本」修正。'); return; }
    setCondTarget(kind, t.getAttribute('data-id'), t.getAttribute('data-idx'), buildCondExpr(rows.rows, rows.mode), rows.mode);
    refresh(['actions']);
    alert(rows.rows.length ? `已反解为 ${rows.rows.length} 行条件。` : '该表达式不是可由条件行组合的形式（例如常量），已保留原样。');
  },
  'team-pick': (t) => {
    const a = state.strategy.actions.find(x => x.id === t.getAttribute('data-id'));
    if (!a) return;
    const field = t.getAttribute('data-field');
    const cur = (a.teammates[field] || []).slice();
    const disallow = [a.character];
    pickAvatarsLive({
      title: field === 'include' ? '选择必要队友' : '选择排除队友',
      selected: cur,
      withMode: false,
      allowDuplicates: true,
      disallow: disallow.filter(Boolean),
      note: field === 'include'
        ? '同一个角色可以重复添加（用于多个角色组合）。这些角色必须都在队伍中（或任选其一，取决于每个角色前面的“与/或”运算符）。'
        : '同一个角色可以重复添加。按“与”连接表示这些角色同时在场时才排除本动作，按“或”连接表示任意一个在场就排除本动作。',
    }).then(r => {
      if (!r) return;
      const before = cur.length;
      a.teammates[field] = r.names;
      // 新加入的角色按“新增角色前用”的运算符处理；原有项保持不变
      const op = state.ui.teamFilterOps[`${a.id}:${field}`] === 'and' ? 'and' : 'or';
      const opsKey = field === 'include' ? 'includeOps' : 'excludeOps';
      const oldOps = Array.isArray(a.teammates[opsKey]) ? a.teammates[opsKey] : [];
      const prefixSame = r.names.length >= before && cur.every((n, i) => r.names[i] === n);
      const ops = [];
      for (let i = 1; i < r.names.length; i++) {
        const prev = oldOps[i - 1];
        const isNew = !prefixSame || i >= before;
        ops[i - 1] = isNew ? op : (prev === 'or' || prev === 'and' ? prev : op);
      }
      a.teammates[opsKey] = ops;
      refresh(['actions', 'preview']);
    });
  },
  'team-remove': (t) => {
    const a = state.strategy.actions.find(x => x.id === t.getAttribute('data-id'));
    if (!a) return;
    const field = t.getAttribute('data-field');
    const sub = Number(t.getAttribute('data-sub'));
    const name = t.getAttribute('data-name');
    const list = (a.teammates[field] || []).slice();
    // 同一个角色可能出现多次，所以优先按位置删除
    const i = Number.isInteger(sub) && sub >= 0 && sub < list.length && (name === undefined || list[sub] === name)
      ? sub : list.indexOf(name);
    if (i < 0) return;
    list.splice(i, 1);
    a.teammates[field] = list;
    // 删角色时一并删掉它前面那个运算符；被删的是首项时删掉它后面那个
    const opsKey = field === 'include' ? 'includeOps' : 'excludeOps';
    const ops = Array.isArray(a.teammates[opsKey]) ? a.teammates[opsKey].slice() : [];
    if (i === 0) ops.splice(0, 1); else ops.splice(i - 1, 1);
    a.teammates[opsKey] = ops.slice(0, Math.max(0, list.length - 1));
    refresh(['actions', 'preview']);
  },
  'cd-cmd': () => {},
  'more-add': (t) => { /* 改为在面板内就地展开，见 more-add2 */ },
  'more-add2': (t) => {
    const a = state.strategy.actions.find(x => x.id === t.getAttribute('data-id'));
    if (!a) return;
    const f = moreAddFormState(a.id);
    const type = f.type === '' || f.type === undefined || f.type === null ? NaN : Number(f.type);
    if (!Number.isInteger(type)) { alert('请先选择动作类型。'); return; }
    const element = type === 0 ? '' : (f.element || '');
    const character = element !== '' ? (f.character || '') : '';
    const scope = { type, element, character };
    const cmp = f.cmp === 'before' ? 'before' : 'after';
    const calc = computePriority(scope, cmp, state.strategy.actions);
    const ref = refIdOf('morenew', a.id, '');
    const st = condSnippetState(ref);
    const text = st.fn ? buildCondSnippet(st.fn, (k) => (st.vals || {})[k]) : '';
    const typed = readNewMoreText(a);
    const finalText = typed || text;   // 手输优先，没有手输就用快捷添加拼出来的片段
    a.morePriorities.push({
      id: newId(), text: finalText, priority: calc ? calc.priority : 0,
      cmp, scope, manualPriority: false,
    });
    resetNewMoreText(a);
    // 判定范围的选择保留在 state.ui.moreAddForm 里，方便连着添加同类的其他触发条件
    refresh(['actions', 'preview']);
  },
  'more-edit': (t) => { /* 改为在卡片内就地编辑，见 morePriForm */ },
  'more-del': (t) => {
    const a = state.strategy.actions.find(x => x.id === t.getAttribute('data-id'));
    const i = Number(t.getAttribute('data-idx'));
    if (!a) return;
    a.morePriorities.splice(i, 1);
    refresh(['actions', 'preview']);
  },
  'more-recalc': (t) => {
    const a = state.strategy.actions.find(x => x.id === t.getAttribute('data-id'));
    const i = Number(t.getAttribute('data-idx'));
    if (!a || !a.morePriorities[i]) return;
    const mp = a.morePriorities[i];
    if (!mp.scope || mp.scope.type === null || mp.scope.type === undefined || mp.scope.type === '') { alert('请先选择动作类型（优先于/次于的对象）。'); return; }
    const calc = computePriority(mp.scope, mp.cmp, state.strategy.actions);
    mp.priority = calc.priority;
    mp.manualPriority = false;
    refresh(['actions', 'preview']);
  },
  /* -------- 条件快捷添加：直接在面板内绑定，见 bindCondQuickPanels -------- */
  'cmd-quick': (t) => { /* 快捷插入指令已在原面板内展开，无需弹窗 */ },
  '*': (t, e) => { /* 兜底 */ },
};

function nextCopyName(name) {
  if (!name) return '';
  const names = new Set(state.strategy.actions.map(a => a.name));
  let i = 2;
  let n = `${name}-副本`;
  while (names.has(n)) { n = `${name}-副本${i}`; i++; }
  return n;
}

function doSwap(id, dir) {
  const r = swapActionOrder(id, dir);
  if (!r.ok) { alert(r.error); return; }
  refresh(['actions', 'preview']);
}

function getCondTarget(kind, actionId, idx) {
  if (kind === 'more') {
    const a = state.strategy.actions.find(x => x.id === actionId);
    const mp = a && a.morePriorities[Number(idx)];
    return { text: mp ? mp.text : '', set: (txt) => { if (mp) mp.text = txt; } };
  }
  const a = state.strategy.actions.find(x => x.id === actionId);
  return { text: a ? (a.conditionText || '') : '', set: (txt) => { if (a) a.conditionText = txt; } };
}
function setCondTarget(kind, actionId, idx, text, mode) {
  if (kind === 'more') {
    const a = state.strategy.actions.find(x => x.id === actionId);
    const mp = a && a.morePriorities[Number(idx)];
    if (mp) mp.text = text;
    return;
  }
  const a = state.strategy.actions.find(x => x.id === actionId);
  if (!a) return;
  a.conditionText = text;
  if (mode) a.conditionMode = mode;
}

function editCondRow(t, sub) {
  const kind = t.getAttribute('data-kind');
  const actionId = t.getAttribute('data-id');
  const idx = t.getAttribute('data-idx');
  const cur = getCondTarget(kind, actionId, idx);
  const rows = parseCondRows(cur.text);
  const existing = (sub >= 0 && rows) ? rows.rows[sub].text : '';
  openCondRowEditor(sub >= 0 ? `编辑条件 #${sub + 1}` : '添加条件', existing, '除 in-party 以外的条件都写在这里；队友判断请用「队友条件」页。').then(txt => {
    if (txt === null) return;
    let list = rows ? rows.rows : [];
    const mode = rows ? rows.mode : 'all';
    if (sub >= 0) list[sub] = { text: txt, id: list[sub] ? list[sub].id : newId() };
    else list.push({ text: txt, id: newId() });
    setCondTarget(kind, actionId, idx, buildCondExpr(list, mode), mode);
    refresh(['actions', 'preview']);
  });
}

/** 便捷：把 openModal 的 Promise 用在一个需要后续读取 DOM 的场景（占位保留） */

/* ---------------- 字段处理 ---------------- */

const actionsFieldHandlers = {
  charlist: (i) => {
    if (i.field === 'search') { state.ui.characterSearch = i.value; return true; }
    if (i.field === 'filterElement') { state.ui.filterElement = i.value; saveUi(); return true; }
    if (i.field === 'filterRarity') { state.ui.filterRarity = i.value; saveUi(); return true; }
    if (i.field === 'filterHasAction') { state.ui.filterHasAction = i.value; saveUi(); return true; }
    if (i.field === 'onlyTeam') { state.ui.onlyTeam = i.value; saveUi(); return true; }
    return false;
  },
  act: (i) => {
    const a = state.strategy.actions.find(x => x.id === i.actionId);
    if (!a) return false;
    switch (i.field) {
      case 'name': {
        a.name = i.value;
        refreshLiveIssues();   // 动作名合法性/重名检查也实时显示在右侧校验面板
        return false;
      }
      case 'ensureCast': a.ensureCast = !!i.value; return false;
      case 'tags': {
        a.tags = i.value;
        // 只就地把与注释有关的标记刷新掉，不重建面板（否则会打断输入法与光标）
        updateTagsBadges(a.id, i.value);
        return false;
      }
      case 'type': {
        const r = changeActionType(a.id, Number(i.value));
        if (!r.ok) { alert(r.error); return true; }
        return 'refresh';
      }
      case 'slot': {
        const r = moveActionToSlot(a.id, Number(i.value));
        if (!r.ok) { alert(r.error); return true; }
        return 'refresh';
      }
      case 'action': {
        a.action = i.value;
        // 手输动作指令后实时检查：刷新该卡片的指令反馈、释义表与右侧校验面板（不重建面板）
        updateCommandFeedback(`act:${a.id}`, i.value);
        refreshLiveIssues();
        return false;
      }
      default: return false;
    }
  },
  condtext: (i) => {
    const a = state.strategy.actions.find(x => x.id === i.actionId);
    if (!a) return false;
    if (i.field === 'mode') { a.conditionMode = i.value; return false; }
    if (i.field === 'text') {
      a.conditionText = i.value;
      updateCondExplanation({ kind: 'cond', id: a.id, idx: '', el: i.el });
      refreshLiveIssues();
      return false;   // 输入过程中不重建面板，避免打断输入法与光标
    }
    return false;
  },
  moretext: (i) => {
    const a = state.strategy.actions.find(x => x.id === i.actionId);
    const mp = a && a.morePriorities[Number(i.idx)];
    if (!mp) return false;
    if (i.field === 'text') {
      mp.text = i.value;
      updateCondExplanation({ kind: 'more', id: a.id, idx: i.idx, el: i.el });
      refreshLiveIssues();
      return false;
    }
    return false;
  },
  // 「添加其他触发条件」表单里的触发条件：草稿不写进模型，等点“添加”时才生成条目
  morenewtext: (i) => {
    if (!state.ui.newMoreText) state.ui.newMoreText = {};
    state.ui.newMoreText[i.actionId] = i.value;
    updateCondExplanation({ kind: 'morenew', id: i.actionId, idx: '', el: i.el });
    return false;
  },
  more: (i) => {
    const a = state.strategy.actions.find(x => x.id === i.actionId);
    const mp = a && a.morePriorities[Number(i.idx)];
    if (!mp) return false;
    if (i.field === 'cmp') { mp.cmp = i.value; if (mp.scope) { const c = computePriority(mp.scope, mp.cmp, state.strategy.actions); if (c) mp.priority = c.priority; } return 'refresh'; }
    if (i.field === 'stype') {
      const t = i.value === '' ? null : Number(i.value);
      // 选了动作类型 0 时元素/角色不可选；其它类型保留原来的元素与角色选择
      const keepEl = (t === null || t === 0 || mp.scope?.type === 0) ? '' : (mp.scope?.element ?? '');
      const keepChar = keepEl === '' ? '' : (mp.scope?.character ?? '');
      mp.scope = { type: t, element: keepEl, character: keepChar };
      const c = computePriority(mp.scope, mp.cmp, state.strategy.actions);
      if (c) mp.priority = c.priority;
      return 'refresh';
    }
    if (i.field === 'selement') {
      const el = i.value === '' ? '' : Number(i.value);
      mp.scope = { type: mp.scope?.type ?? null, element: el, character: '' };
      if (mp.scope.type !== null && mp.scope.type !== undefined) { const c = computePriority(mp.scope, mp.cmp, state.strategy.actions); if (c) mp.priority = c.priority; }
      return 'refresh';
    }
    if (i.field === 'scharacter') {
      const ch = i.value;
      mp.scope = { type: mp.scope?.type ?? null, element: mp.scope?.element ?? '', character: ch };
      if (ch) { const av = getAvatar(ch); if (av) mp.scope.element = av.code; }
      if (mp.scope.type !== null) { const c = computePriority(mp.scope, mp.cmp, state.strategy.actions); if (c) mp.priority = c.priority; }
      return 'refresh';
    }
    return false;
  },
  team: (i) => {
    const a = state.strategy.actions.find(x => x.id === i.actionId);
    if (!a) return false;
    if (i.field === 'mode') { a.teammates.mode = i.value === 'and' ? 'and' : 'or'; return 'refresh'; }
    if (i.field === 'newOp') {
      const key = `${a.id}:${i.sub}`;
      state.ui.teamFilterOps[key] = i.value === 'and' ? 'and' : 'or';
      return false;   // 只是个待用选项，不必重建面板
    }
    if (i.field === 'includeOp' || i.field === 'excludeOp') {
      const field = i.field === 'includeOp' ? 'include' : 'exclude';
      const opsKey = i.field === 'includeOp' ? 'includeOps' : 'excludeOps';
      const at = Number(i.sub);
      const list = a.teammates[field] || [];
      const ops = Array.isArray(a.teammates[opsKey]) ? a.teammates[opsKey].slice() : [];
      const mode = a.teammates.mode === 'and' ? 'and' : 'or';
      for (let k = 1; k < list.length; k++) if (ops[k - 1] !== 'or' && ops[k - 1] !== 'and') ops[k - 1] = mode;
      if (at >= 1) ops[at - 1] = i.value === 'and' ? 'and' : 'or';
      a.teammates[opsKey] = ops;
      return 'refresh';
    }
    if (i.field === 'autoExcludeSameType') {
      a.teammates.autoExcludeSameType = !!i.value;
      if (i.value) {
        for (const o of state.strategy.actions) {
          if (o.id !== a.id && (o.character || '') === (a.character || '') && o.type === a.type) {
            if (!a.teammates.autoExclude.includes(o.id)) a.teammates.autoExclude.push(o.id);
          }
        }
      }
      return 'refresh';
    }
    if (i.field === 'autoExclude') {
      const id = i.sub;
      const list = a.teammates.autoExclude;
      if (i.value) { if (!list.includes(id)) list.push(id); }
      else { a.teammates.autoExclude = list.filter(x => x !== id); }
      return 'refresh';
    }
    return false;
  },
};
