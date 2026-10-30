/* 优先级预览页：展开条目、排序、模拟队伍过滤、说明 */

function renderPreviewPanel() {
  const team = state.ui.team || [];
  const teamFull = team.length === 4;
  const list = expandPriorities(state.strategy.actions, teamFull ? team : null);
  const dropped = state.strategy.actions.filter(a => a.character && teamFull && !team.includes(a.character));
  const condMode = state.ui.previewCondMode === 'explain' ? 'explain' : 'raw';

  const priClass = (p) => (p < 10000 ? 'hi' : p < 50000 ? 'mid' : 'low');

  // 「动作触发条件」列：
  //   raw     —— 原始 expression 文本（只给 since / count / last-exec 的动作参数套悬停提示，正文仍是原文）；
  //   explain —— 与动作卡片「基础触发条件」下的「释义」同一套渲染：动作引用显示成动作名称并带 index / 指令的悬停提示。
  // 两种模式都解释表里那一行的完整 expression（含队友条件、命座要求），保证与列里显示的内容一一对应。
  const condHtml = (e) => {
    const text = e.expression || '';
    if (!text) return esc('（空 = 恒真）');
    const ctx = condExplainCtx(e.action ? e.action.id : '');
    if (condMode !== 'explain') return condRawExprHtml(text, ctx);
    const parsed = condParse(text, allActionNames(state.strategy.actions));
    if (parsed.error) return `<span style="color:var(--err)">${esc(parsed.error)}</span>`;
    if (!parsed.ast) return esc('（空 = 恒真）');
    return condExplain(parsed.ast, ctx);
  };

  const rows = list.map((e, i) => `<tr>
      <td style="width:30px" class="dim">${i + 1}</td>
      <td class="pri ${priClass(e.priority)}">${e.priority}</td>
      <td>${e.index}</td>
      <td><span title="${attr(String((e.action && e.action.action) || '').trim())}">${esc(e.name)}</span>${e.source !== '主条目' ? ` <span class="pill">${esc(e.source)}</span>` : ''}</td>
      <td>${avatarLabel(e.character === '当前角色' ? '' : e.character)}${e.character === '当前角色' ? '' : ''}</td>
      <td class="mono" style="white-space:pre-wrap;word-break:break-all">${condHtml(e)}</td>
    </tr>`).join('');

  $('panePreview').innerHTML = `
    <div class="card">
      <h3>模拟队伍过滤 <span class="hint">选满 4 名角色后，不在队伍中的角色动作会被剔除（与 BetterGI 开战前的过滤一致）</span></h3>
      <div class="row mb">
        <button class="mini" data-act="team-edit">选择 4 人队伍…</button>
        <button class="mini" data-act="team-save">保存队伍</button>
        <button class="mini" data-act="team-load">加载队伍</button>
        <button class="mini" data-act="team-clear">清空</button>
        ${teamFull ? '<span class="badge ok">过滤已生效</span>' : `<span class="badge warn">已选 ${team.length}/4，未生效</span>`}
      </div>
      <div class="row">
        ${team.length ? team.map(n => `<span class="tag">${avatarLabel(n)}<button data-act="team-slot-remove" data-name="${attr(n)}">×</button></span>`).join('') : '<span class="dim">未选择</span>'}
      </div>
      ${teamFull ? `<div class="hint" style="margin-top:6px">此队伍也会在动作编辑页的“只看当前队伍”筛选中复用。</div>` : ''}
      <div class="hint" style="margin-top:6px">「保存队伍 / 加载队伍」只把队伍的选择保存在浏览器本地（最多 ${MAX_TEAMS} 支），与战斗策略内容没有任何关联。</div>
    </div>

    <div class="card">
      <h3>优先级排序预览 <span class="hint">共 ${list.length} 个条目（每个动作 = 1 个主条目 + N 个其他触发条件条目）</span></h3>
      <div class="row mb">
        <span class="hint">「动作触发条件」列显示：</span>
        <button type="button" class="chip ${condMode === 'raw' ? 'on' : ''}" data-act="preview-cond-mode" data-mode="raw">原始表达式</button>
        <button type="button" class="chip ${condMode === 'explain' ? 'on' : ''}" data-act="preview-cond-mode" data-mode="explain">释义</button>
        <span class="hint">释义与「动作编辑」里「基础触发条件」下的释义相同；鼠标移到动作名上可查看 index 与动作指令。</span>
      </div>
      <div class="row mb">
        <span class="hint">按 priority 从小到大排序；同 priority 时按动作在策略中的声明顺序（主条目在前、额外条件按顺序）。</span>
      </div>
      <div class="scroll" style="max-height:calc(100vh - 430px);border:1px solid var(--line);border-radius:6px">
        <table>
          <thead><tr><th>#</th><th>priority</th><th>index</th><th>动作名</th><th>角色</th><th>动作触发条件</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6"><div class="empty">还没有动作</div></td></tr>'}</tbody>
        </table>
      </div>
      ${dropped.length ? `<div class="warnbox" style="margin-top:8px">被队伍过滤剔除的动作（${dropped.length} 条）：${esc(dropped.map(a => a.name || '(未命名)').join('、'))}</div>` : ''}
    </div>

    <div class="split">
      <div class="col">
        <div class="card">
          <h3>这张表和实际战斗是什么关系？</h3>
          <div style="line-height:1.85;font-size:12.5px">
            BetterGI 在战斗中是这样循环的：<br>
            <ol style="margin:6px 0 6px 18px;padding:0">
              <li>从 <b>priority 最小</b>的条目开始，一条一条往下检查（priority 大的排在后面）。</li>
              <li>把每个条目的条件拿到当前画面里判断一次。</li>
              <li>遇到<b>第一个条件成立</b>的条目，就执行它对应的动作，然后<b>不再继续往下检查</b>了。</li>
              <li>回到第 1 步，重新从 priority 最小的条目开始下一轮检查（所以实际顺序是动态的、每轮都可能不同）。</li>
              <li>如果一整轮里没有任何条目条件成立，就空转 200ms 再看一轮。</li>
            </ol>
            所以这张表是“<b>检查顺序</b>”，不是“执行顺序”：<br>
            · priority 小的先被检查，也就更容易抢到出手机会；<br>
            · 排在后面的条目只有在前面所有条目的条件都不成立时才会被轮到；<br>
            · 一个动作如果设了其他触发条件，它会以不同的 priority 出现在表里多次，命中任意一条都是执行同一个动作。
          </div>
        </div>
      </div>
      <div class="col" style="max-width:430px">
        <div class="card">
          <h3>priority 数值怎么来的</h3>
          <div class="hint" style="line-height:1.8">
            priority 与 index 使用同一套十进制错位结构，只是多出一个“段边界”：<br>
            <span class="pill">[动作类型][元素类型][角色编号×2][尾数]</span><br><br>
            <b>优先于某类动作</b> → 取该段的最小值<br>
            <b>次于某类动作</b> → 取该段的最大值 + 1<br>
            如果该段里当前没有任何动作，就直接取段边界值。<br><br>
            各动作类型段的边界（取值区间 = 最小值 ~ 最大值，<b>次于</b>取最大值 + 1；动作类型 9 的段是 90000~99999，所以<b>次于</b>类型 9 会得到 100000，也就是所有动作之后）：<br>
            ${ACTION_TYPES.map(t => {
              const sp = prioritySpan({ type: t.code });
              return `<span class="pill">${t.code} ${esc(t.name)}</span> ${sp.before} ~ ${sp.hi}`;
            }).join('<br>')}
            <br><br>
            尾数 0 的插入位：同类型内如果要插到所有动作之前，用 <span class="pill">类型 × 10000</span> 作为 priority（例如开盾取 10000）。
          </div>
        </div>
      </div>
    </div>`;
}

/* ---------------- 模拟队伍：本地保存 / 加载 ----------------
 * 只保存「4 人队伍的选择」本身，与战斗策略内容没有任何关联；
 * 队伍名只用于保存与在加载时区分不同队伍，不在「模拟队伍过滤」下方展示。
 */

/** 读取本地保存的队伍列表：[{ name, team: [角色名…] }]，最多 MAX_TEAMS 支 */
function loadSavedTeams() {
  let raw = null;
  try { raw = localStorage.getItem(LS_TEAMS); } catch (e) { raw = null; }
  if (!raw) return [];
  let list = null;
  try { list = JSON.parse(raw); } catch (e) { return []; }
  if (!Array.isArray(list)) return [];
  return list
    .filter(x => x && typeof x.name === 'string' && Array.isArray(x.team))
    .map(x => ({ name: x.name, team: x.team.filter(n => typeof n === 'string' && n).slice(0, 4) }))
    .filter(x => x.name.trim() !== '' && x.team.length === 4)
    .slice(0, MAX_TEAMS);
}

function saveSavedTeams(list) {
  try { localStorage.setItem(LS_TEAMS, JSON.stringify((list || []).slice(0, MAX_TEAMS))); } catch (e) { /* 本地存储不可用时忽略 */ }
}

/** 「保存队伍」：已经选满 4 人时弹窗询问队伍名，否则提醒继续添加选择的角色 */
function saveTeamDialog() {
  const team = (state.ui.team || []).slice();
  if (team.length !== 4) {
    openModal({
      title: '还不能保存队伍',
      body: `<div class="warnbox">当前只选了 ${team.length} 名角色（${team.map(n => esc(n)).join('、') || '空'}）。请先点「选择 4 人队伍…」把 4 名角色都选满，再保存队伍。</div>
        <div class="hint" style="margin-top:6px">保存队伍只记录这 4 名角色的选择，与战斗策略内容没有关联。</div>`,
      actions: [{ label: '知道了', primary: true, value: null }],
    });
    return;
  }
  const saved = loadSavedTeams();
  const full = saved.length >= MAX_TEAMS;
  const p = openModal({
    title: '保存队伍',
    body: `<div class="hint mb">当前队伍：${team.map(n => avatarLabel(n)).join('、')}</div>
      ${full ? `<div class="warnbox mb">本地已经保存了 ${MAX_TEAMS} 支队伍（上限）。请先在「加载队伍」的弹窗里删除一些，再保存新队伍。</div>` : ''}
      <div class="row mb"><label class="f">队伍名 <input id="teamNameInput" style="width:260px" placeholder="例如：芙芙锄地队" ${full ? 'disabled' : ''}></label></div>
      <div class="hint">队伍名只用于保存与在「加载队伍」时区分不同队伍，不会显示在「模拟队伍过滤」下方，也不会写进战斗策略。
        ${saved.length ? `<br>同名队伍会被覆盖（当前本地已保存：${esc(saved.map(x => x.name).join('、'))}）。` : ''}</div>`,
    actions: [{
      label: '保存',
      primary: true,
      onClick: () => {
        if (full) return 'keep';
        const el = $('teamNameInput');
        const name = String(el && el.value ? el.value : '').trim();
        if (!name) { alert('请输入队伍名。'); return 'keep'; }
        const list = loadSavedTeams();
        const i = list.findIndex(x => x.name === name);
        if (i >= 0) list[i] = { name, team };
        else {
          if (list.length >= MAX_TEAMS) { alert(`本地最多保存 ${MAX_TEAMS} 支队伍，请先删除一些。`); return 'keep'; }
          list.push({ name, team });
        }
        saveSavedTeams(list);
        openModal({
          title: '已保存队伍',
          body: `<div class="okbox">队伍「${esc(name)}」已保存到本地（当前共 ${list.length} 支）。</div>`,
          actions: [{ label: '知道了', primary: true, value: null }],
        });
        return 'keep';
      },
    }, { label: '取消', value: null }],
  });
  return p;
}

/** 「加载队伍」：弹窗展示本地保存的队伍，选中一支就替换当前队伍；也可以就地删除 */
function loadTeamDialog() {
  const render = () => {
    const list = loadSavedTeams();
    const rows = list.length
      ? list.map((x, i) => `<div class="roleitem">
          <span class="nm">${esc(x.name)} <span class="dim">· ${x.team.map(n => esc(n)).join('、')}</span></span>
          <button class="mini primary" data-team-load="${i}">加载</button>
          <button class="mini danger" data-team-del="${i}">删除</button></div>`).join('')
      : '<div class="empty">本地还没有保存过队伍</div>';
    const body = `<div class="hint mb">选择一支队伍后，会用它替换「模拟队伍过滤」里当前选择的角色（保存的队伍只保存在浏览器本地，与战斗策略内容没有任何关联）。最多保存 ${MAX_TEAMS} 支。</div>
      <div class="scroll">${rows}</div>`;
    return { body, list };
  };
  let cur = render();
  openModal({
    title: '加载队伍（保存在本地）',
    body: cur.body,
    actions: [{ label: '关闭', primary: true, value: null }],
  });
  $('modalBody').onclick = (e) => {
    const l = e.target.closest ? e.target.closest('[data-team-load]') : null;
    const d = e.target.closest ? e.target.closest('[data-team-del]') : null;
    if (l) {
      const i = Number(l.getAttribute('data-team-load'));
      const hit = cur.list[i];
      if (!hit) return;
      state.ui.team = hit.team.slice(0, 4);
      saveUi();
      closeModal(null);
      refresh(['preview', 'actions']);
      return;
    }
    if (d) {
      const i = Number(d.getAttribute('data-team-del'));
      if (i < 0 || i >= cur.list.length) return;
      const list = cur.list.slice();
      list.splice(i, 1);
      saveSavedTeams(list);
      cur = render();
      $('modalBody').innerHTML = cur.body;
    }
  };
}

/* ---------------- 事件 ---------------- */

const previewHandlers = {
  'preview-cond-mode': (t) => {
    const mode = t.getAttribute('data-mode') === 'explain' ? 'explain' : 'raw';
    if (state.ui.previewCondMode === mode) return;
    state.ui.previewCondMode = mode;
    saveUi();
    refresh(['preview']);
  },
  'team-edit': () => {
    pickAvatarsLive({
      title: '模拟队伍（选 4 名角色）',
      selected: state.ui.team || [],
      note: '选满 4 人后，预览与角色栏筛选都会按这支队伍过滤；不选满则不启用过滤。',
    }).then(r => {
      if (!r) return;
      state.ui.team = r.names.slice(0, 4);
      saveUi();
      refresh(['preview', 'actions']);
    });
  },
  'team-save': () => { saveTeamDialog(); },
  'team-load': () => { loadTeamDialog(); },
  'team-clear': () => { state.ui.team = []; saveUi(); refresh(['preview', 'actions']); },
  'team-slot-remove': (t) => {
    state.ui.team = (state.ui.team || []).filter(n => n !== t.getAttribute('data-name'));
    saveUi();
    refresh(['preview', 'actions']);
  },
};

const previewFieldHandlers = {};
