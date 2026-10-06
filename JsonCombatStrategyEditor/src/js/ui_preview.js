/* 优先级预览页：展开条目、排序、模拟队伍过滤、说明 */

function renderPreviewPanel() {
  const team = state.ui.team || [];
  const teamFull = team.length === 4;
  const list = expandPriorities(state.strategy.actions, teamFull ? team : null);
  const dropped = state.strategy.actions.filter(a => a.character && teamFull && !team.includes(a.character));

  const priClass = (p) => (p < 10000 ? 'hi' : p < 50000 ? 'mid' : 'low');

  // 「动作触发条件」列显示原始 expression 文本；只给「入参为动作的条件函数」（since / count / last-exec）
  // 的动作参数套一层悬停提示（提示该动作的 index 与动作名），显示出来的正文仍是原文。
  const condHtml = (e) => {
    const text = e.expression || '';
    if (!text) return esc('（空 = 恒真）');
    return condRawExprHtml(text, condExplainCtx(e.action ? e.action.id : ''));
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
        <button class="mini" data-act="team-clear">清空</button>
        ${teamFull ? '<span class="badge ok">过滤已生效</span>' : `<span class="badge warn">已选 ${team.length}/4，未生效</span>`}
      </div>
      <div class="row">
        ${team.length ? team.map(n => `<span class="tag">${avatarLabel(n)}<button data-act="team-slot-remove" data-name="${attr(n)}">×</button></span>`).join('') : '<span class="dim">未选择</span>'}
      </div>
      ${teamFull ? `<div class="hint" style="margin-top:6px">此队伍也会在动作编辑页的“只看当前队伍”筛选中复用。</div>` : ''}
    </div>

    <div class="card">
      <h3>优先级排序预览 <span class="hint">共 ${list.length} 个条目（每个动作 = 1 个主条目 + N 个其他触发条件条目）</span></h3>
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

/* ---------------- 事件 ---------------- */

const previewHandlers = {
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
  'team-clear': () => { state.ui.team = []; saveUi(); refresh(['preview', 'actions']); },
  'team-slot-remove': (t) => {
    state.ui.team = (state.ui.team || []).filter(n => n !== t.getAttribute('data-name'));
    saveUi();
    refresh(['preview', 'actions']);
  },
};

const previewFieldHandlers = {};
