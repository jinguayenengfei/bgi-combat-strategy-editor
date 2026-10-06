/* 通用 UI 工具：DOM 助手、模态框、角色选择器、星级表、按键选择器、文本片段 */

const $ = (id) => document.getElementById(id);
if (typeof window !== 'undefined') window.$ = $; // 便于自动化测试在脚本外取到它
const esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const attr = esc;
const nl2br = (s) => esc(s).replace(/\n/g, '<br>');
/** CSS 选择器里的属性值转义（只处理引号与反斜杠，够用即可） */
const cssEsc = (s) => String(s === null || s === undefined ? '' : s).replace(/(["\\])/g, '\\$1');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uniq = (arr) => [...new Set(arr)];

/* ---------------- 模态框 ---------------- */

let modalResolve = null;
/**
 * 打开模态框。返回的 Promise 在模态框关闭时 resolve 为：
 *   - 按钮的 value（'ok' / null / 任意值）
 *   - 或按钮 onClick 返回的非 keep 值
 */
function openModal({ title, body, actions }) {
  closeModal(null);
  $('modalTitle').innerHTML = title;
  $('modalBody').innerHTML = body;
  const foot = $('modalFoot');
  foot.innerHTML = '';
  (actions || [{ label: '关闭', primary: true, value: null }]).forEach((a) => {
    const b = document.createElement('button');
    b.className = a.primary ? 'primary' : (a.danger ? 'danger' : '');
    b.textContent = a.label;
    b.onclick = () => {
      const keep = a.onClick ? a.onClick() : undefined;
      if (keep === 'keep') return;
      closeModal(keep === undefined ? a.value : keep);
    };
    foot.appendChild(b);
  });
  $('modal').classList.remove('hidden');
  return new Promise(r => { modalResolve = r; });
}
function closeModal(value) {
  $('modal').classList.add('hidden');
  $('modalBody').innerHTML = '';
  $('modalFoot').innerHTML = '';
  const r = modalResolve; modalResolve = null;
  if (r) r(value);
}
function isModalOpen() { return !$('modal').classList.contains('hidden'); }

/* ---------------- 元素颜色 / 星级 ---------------- */

function elementColor(code) {
  const map = { 0: 'var(--e0)', 1: 'var(--e1)', 2: 'var(--e2)', 3: 'var(--e3)', 4: 'var(--e4)', 5: 'var(--e5)', 6: 'var(--e6)', 7: 'var(--e7)' };
  return map[code] || 'var(--e0)';
}
function elementDot(code) { return `<span class="dot" style="background:${elementColor(code)}"></span>`; }
function elementClass(code) { return 'el' + code; }

function rarityOf(name) { return state.rarity[name] || ''; }
function rarityStars(name) { const r = rarityOf(name); return r ? `<span class="stars">${'★'.repeat(Number(r))}</span>` : ''; }
function currentRarityFilterActive() { return state.ui.filterRarity !== 'all'; }

/* 角色显示名（带元素点） */
function avatarLabel(name) {
  if (!name) return '当前角色';
  const av = getAvatar(name);
  if (!av) return esc(name) + '（不在角色表）';
  return `${elementDot(av.code)}${esc(av.name)}`;
}

/* ---------------- 角色选择器 ---------------- */

/**
 * 角色多选弹窗
 * opts: { title, selected: [], allowCurrent, mode, withMode, disallow: [], note, allowDuplicates }
 * allowDuplicates = true 时同一个角色可以选多次（用于「必要队友 / 排除队友」里的多个角色组合）
 * 返回 { names: [], mode } 或 null（取消）
 */
function pickAvatarsLive(opts) {
  const o = Object.assign({ title: '选择角色', selected: [], allowCurrent: false, mode: 'and', withMode: false, disallow: [], note: '', allowDuplicates: false }, opts || {});
  // sel 用数组：allowDuplicates 时保留重复项与顺序，否则最终去重
  let sel = (o.selected || []).slice();
  if (!o.allowDuplicates) sel = uniq(sel);
  const dis = new Set(o.disallow || []);
  let search = '';
  let elFilter = 'all';
  let rarFilter = 'all';
  let orMode = o.mode === 'or';
  const countOf = (n) => sel.filter(x => x === n).length;

  const render = () => {
    const q = search.trim().toLowerCase();
    const rows = [];
    let lastCode = null;
    for (const av of AVATARS) {
      if (av.virtual && !o.allowCurrent) continue;
      if (q && !(av.name.toLowerCase().includes(q) || (av.id || '').includes(q))) continue;
      if (elFilter !== 'all' && String(av.code) !== String(elFilter)) continue;
      const r = rarityOf(av.name);
      if (rarFilter !== 'all') { if (rarFilter === 'none') { if (r) continue; } else if (r !== rarFilter) continue; }
      if (av.code !== lastCode) {
        rows.push(`<div class="secgroup">${av.code === 0 ? '元素未定/当前角色' : elementLabel(av.code)}</div>`);
        lastCode = av.code;
      }
      const cnt = actionsOf(state.strategy.actions, av.virtual ? '' : av.name).length;
      const codeTxt = av.virtual ? '00（特殊）' : avatarCodeLabel(av);
      const disabled = dis.has(av.name) && countOf(av.name) === 0;
      const picked = countOf(av.name);
      const right = o.allowDuplicates
        ? `<span class="cnt">${rarityStars(av.name)} ${codeTxt} · ${cnt} 条动作</span>
           <button class="mini" data-pkadd="${attr(av.name)}" ${disabled ? 'disabled' : ''}>+ 添加</button>
           <span class="pill" style="min-width:38px;text-align:center">已选 ${picked}</span>`
        : `<span class="cnt">${rarityStars(av.name)} ${codeTxt} · ${cnt} 条动作</span>`;
      rows.push(`<label class="roleitem" style="${disabled ? 'opacity:.4' : ''}">
        ${o.allowDuplicates ? '' : `<input type="checkbox" data-pk="${attr(av.name)}" ${picked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>`}
        ${elementDot(av.code)}<span class="nm">${esc(av.name)}${av.virtual ? ' <span class="dim">(character 留空)</span>' : ''}</span>
        ${right}</label>`);
    }
    if (!rows.length) rows.push('<div class="empty">没有匹配的角色</div>');
    $('pkList').innerHTML = rows.join('');
    $('pkCount').textContent = `已选 ${sel.length} 个`;
    $('pkSel').innerHTML = sel.length
      ? sel.map((n, i) => `<span class="tag">${avatarLabel(n)}<button data-pkrm="${i}">×</button></span>`).join('')
      : '<span class="dim">未选择</span>';
  };

  const body = `
    ${o.note ? `<div class="hint" style="margin-bottom:6px">${o.note}</div>` : ''}
    <div class="row mb">
      <input id="pkSearch" placeholder="搜索角色名 / id" style="width:180px">
      <select id="pkElement">
        <option value="all">全部元素</option>
        ${ELEMENTS.map(e => `<option value="${e.code}">${e.code === 0 ? '元素未定（当前角色/元素可变）' : e.name + '元素'}</option>`).join('')}
      </select>
      <select id="pkRarity">
        <option value="all">全部星级</option>
        <option value="5">五星</option>
        <option value="4">四星</option>
        <option value="none">未标注星级</option>
      </select>
      ${o.withMode ? `<label class="f"><input type="checkbox" id="pkOr" ${orMode ? 'checked' : ''}> 多个条件之间用「或」</label>` : ''}
      <span style="flex:1"></span>
      <span id="pkCount" class="hint"></span>
    </div>
    <div class="rolelist" id="pkList"></div>
    <div style="margin-top:8px"><div class="hint" style="margin-bottom:4px">已选：${o.allowDuplicates ? '<span class="dim">点「+ 添加」可重复选同一个角色，点标签上的 × 移除一个</span>' : ''}</div><div id="pkSel"></div></div>`;

  const p = openModal({
    title: o.title, body,
    actions: [
      { label: '取消', value: null },
      { label: '确定', primary: true, value: 'ok' },
    ],
  });

  // 绑定交互
  $('pkSearch').oninput = (e) => { search = e.target.value; render(); };
  $('pkElement').onchange = (e) => { elFilter = e.target.value; render(); };
  $('pkRarity').onchange = (e) => { rarFilter = e.target.value; render(); };
  if (o.withMode) $('pkOr').onchange = (e) => { orMode = e.target.checked; };
  $('pkList').onchange = (e) => {
    const n = e.target.getAttribute && e.target.getAttribute('data-pk');
    if (!n) return;
    if (e.target.checked) sel.push(n);
    else sel = sel.filter(x => x !== n);
    render();
  };
  $('pkList').onclick = (e) => {
    const b = e.target.closest ? e.target.closest('[data-pkadd]') : null;
    if (!b || b.disabled) return;
    sel.push(b.getAttribute('data-pkadd'));
    render();
  };
  $('pkSel').onclick = (e) => {
    const raw = e.target.getAttribute ? e.target.getAttribute('data-pkrm') : null;
    if (raw === null || raw === undefined) return;
    const i = Number(raw);
    if (Number.isInteger(i) && i >= 0 && i < sel.length) sel.splice(i, 1);
    else sel = sel.filter(x => x !== raw);
    render();
  };
  render();

  return p.then(v => (v === 'ok' ? { names: o.allowDuplicates ? sel.slice() : uniq(sel), mode: orMode ? 'or' : 'and' } : null));
}

/* ---------------- 按键选择器 ---------------- */

const KB_ROWS = [
  ['VK_ESCAPE', 'VK_F1', 'VK_F2', 'VK_F3', 'VK_F4', 'VK_F5', 'VK_F6', 'VK_F7', 'VK_F8', 'VK_F9', 'VK_F10', 'VK_F11', 'VK_F12'],
  ['VK_OEM_3', 'VK_1', 'VK_2', 'VK_3', 'VK_4', 'VK_5', 'VK_6', 'VK_7', 'VK_8', 'VK_9', 'VK_0', 'VK_OEM_MINUS', 'VK_OEM_PLUS', 'VK_BACK'],
  ['VK_TAB', 'VK_Q', 'VK_W', 'VK_E', 'VK_R', 'VK_T', 'VK_Y', 'VK_U', 'VK_I', 'VK_O', 'VK_P', 'VK_OEM_4', 'VK_OEM_6', 'VK_OEM_5'],
  ['VK_CAPITAL', 'VK_A', 'VK_S', 'VK_D', 'VK_F', 'VK_G', 'VK_H', 'VK_J', 'VK_K', 'VK_L', 'VK_OEM_1', 'VK_OEM_7', 'VK_RETURN'],
  ['VK_SHIFT', 'VK_Z', 'VK_X', 'VK_C', 'VK_V', 'VK_B', 'VK_N', 'VK_M', 'VK_OEM_COMMA', 'VK_OEM_PERIOD', 'VK_OEM_2', 'VK_SHIFT'],
  ['VK_CONTROL', 'VK_LWIN', 'VK_MENU', 'VK_SPACE', 'VK_MENU', 'VK_RWIN', 'VK_APPS', 'VK_CONTROL', 'VK_LEFT', 'VK_DOWN', 'VK_RIGHT', 'VK_UP'],
];
const MOUSE_BTNS = [['VK_LBUTTON', '鼠标左键'], ['VK_RBUTTON', '鼠标右键'], ['VK_MBUTTON', '鼠标中键']];

function pickKey(current) {
  let value = current || 'VK_E';
  const body = `
    <div class="row mb">
      <label class="f">按键代码 <input id="vkInput" class="mono" style="width:170px" value="${attr(value)}"></label>
      <span class="hint">会原样写入 keydown/keyup/keypress；BetterGI 内部转大写并补 VK_ 前缀</span>
    </div>
    <div class="row mb" id="vkMouse"></div>
    <div class="kbgrid" id="vkGrid"></div>
    <div class="hint" style="margin-top:8px">鼠标键必须使用全大写的 VK_LBUTTON / VK_RBUTTON / VK_MBUTTON，否则 BetterGI 会静默退化成普通键盘按键。</div>`;
  const p = openModal({
    title: '选择按键', body,
    actions: [{ label: '取消', value: null }, { label: '确定', primary: true, value: 'ok' }],
  });
  const input = $('vkInput');
  input.oninput = (e) => { value = e.target.value.trim(); };
  const setVal = (v) => { value = v; input.value = v; };
  for (const [code, label] of MOUSE_BTNS) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.innerHTML = `${label} <span class="pill">${code}</span>`;
    b.onclick = () => setVal(code);
    $('vkMouse').appendChild(b);
  }
  for (const row of KB_ROWS) {
    const rowEl = document.createElement('div');
    rowEl.className = 'kbrow';
    for (const code of row) {
      const b = document.createElement('button');
      b.className = 'kb';
      b.textContent = code.replace('VK_', '');
      b.onclick = () => setVal(code);
      rowEl.appendChild(b);
    }
    $('vkGrid').appendChild(rowEl);
  }
  return p.then(v => (v === 'ok' ? value : null));
}

/* ---------------- 星级补录 ---------------- */

function openRarityEditor() {
  let filter = '';
  const body = `
    <div class="hint mb">星级只用于角色列表的筛选与显示，不会写进导出的 JSON 策略。修改后自动保存在浏览器本地，也可以导出/导入补丁文件与别人共享。</div>
    <div class="row mb">
      <input id="rarSearch" placeholder="搜索角色" style="width:180px">
      <span class="hint">留空 = 未标注（按星级筛选时会隐藏未标注角色）</span>
    </div>
    <div class="rolelist" id="rarList" style="max-height:52vh"></div>`;
  const p = openModal({
    title: '星级补录', body,
    actions: [
      { label: '全部清空', danger: true, onClick: () => { if (confirm('确定清空所有已补录的星级？')) { state.rarity = {}; saveRarity(); renderRarityList(); } return 'keep'; } },
      { label: '导出补丁', onClick: () => { downloadText('星级补丁.json', JSON.stringify(state.rarity, null, 2)); return 'keep'; } },
      { label: '导入补丁', onClick: () => { importRarityPatch(); return 'keep'; } },
      { label: '关闭', primary: true, value: null },
    ],
  });
  function renderRarityList() {
    const q = filter.trim();
    let last = null;
    const rows = [];
    for (const av of AVATARS) {
      if (q && !av.name.includes(q)) continue;
      if (av.code !== last) { rows.push(`<div class="secgroup">${av.code === 0 ? '元素未定/当前角色' : elementLabel(av.code)}</div>`); last = av.code; }
      const r = rarityOf(av.name);
      rows.push(`<div class="roleitem">
        ${elementDot(av.code)}<span class="nm">${esc(av.name)}${av.virtual ? ' <span class="dim">(特殊条目)</span>' : ''}</span>
        <span class="cnt">${av.virtual ? '' : avatarCodeLabel(av)}</span>
        <span style="width:120px;text-align:right">
          <button class="mini ${r === '5' ? 'primary' : ''}" data-rar="5" data-n="${attr(av.name)}">★★★★★</button>
          <button class="mini ${r === '4' ? 'primary' : ''}" data-rar="4" data-n="${attr(av.name)}">★★★★</button>
          <button class="mini ${r === '' ? 'primary' : ''}" data-rar="" data-n="${attr(av.name)}">?</button>
        </span></div>`);
    }
    $('rarList').innerHTML = rows.join('') || '<div class="empty">无匹配</div>';
  }
  $('rarSearch').oninput = (e) => { filter = e.target.value; renderRarityList(); };
  $('rarList').onclick = (e) => {
    const b = e.target.closest('[data-rar]');
    if (!b) return;
    const n = b.getAttribute('data-n');
    const r = b.getAttribute('data-rar');
    if (r) state.rarity[n] = r; else delete state.rarity[n];
    saveRarity();
    renderRarityList();
  };
  renderRarityList();
  return p;
}

function importRarityPatch() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json';
  inp.onchange = () => {
    const f = inp.files[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const obj = JSON.parse(fr.result);
        if (!obj || typeof obj !== 'object') throw new Error('内容不是对象');
        let n = 0;
        for (const [k, v] of Object.entries(obj)) {
          if (!getAvatar(k)) continue;
          if (v === '5' || v === '4') { state.rarity[k] = v; n++; }
        }
        saveRarity();
        openRarityEditor();
        alert(`已导入 ${n} 条星级补录`);
      } catch (err) {
        alert('补丁解析失败：' + err.message);
      }
    };
    fr.readAsText(f, 'utf-8');
  };
  inp.click();
}

/* ---------------- 下载 / 读取文件 ---------------- */

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function pickTextFile(cb) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json,application/json,.txt';
  inp.onchange = () => {
    const f = inp.files[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => cb(fr.result, f.name);
    fr.readAsText(f, 'utf-8');
  };
  inp.click();
}

/* ---------------- 焦点保持 ---------------- */

function captureFocus() {
  const a = document.activeElement;
  if (!a || !a.getAttribute) return null;
  return {
    id: a.id || null,
    key: a.getAttribute('data-focus') || null,
    start: typeof a.selectionStart === 'number' ? a.selectionStart : null,
    end: typeof a.selectionEnd === 'number' ? a.selectionEnd : null,
  };
}
function restoreFocus(snap) {
  if (!snap) return;
  let el = null;
  if (snap.id) el = document.getElementById(snap.id);
  if (!el && snap.key) {
    try { el = document.querySelector(`[data-focus="${snap.key.replace(/["\\]/g, '')}"]`); } catch (e) { el = null; }
  }
  if (!el) return;
  el.focus();
  if (snap.start !== null && el.setSelectionRange) {
    try { el.setSelectionRange(snap.start, snap.end); } catch (e) { /* 某些类型不支持 */ }
  }
}
