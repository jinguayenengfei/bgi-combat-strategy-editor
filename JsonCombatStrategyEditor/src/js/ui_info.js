/* 信息页：策略名称 / 作者 / 描述 / 战斗前动作 / 导入导出 / 合并策略 / 草稿 */

const DESC_TEMPLATE = `请注意！！！使用本JSON策略前，请按照以下说明配置好队伍和调度器的战斗设置！

无论在任何情况下，使用自动战斗功能都务必严格遵守BGI配队逻辑！配队逻辑为“盾（刚需）+奶（可选）+后台C（可选）+其他（如果需要捡材料，请带万叶或琴）”。其中，盾位必须带且只能带一个，盾量不够用千岩套补；其他三个位置没有硬性要求，推荐攻击距离远、索敌远的角色；万叶和琴不要一起带，捡材料只要带一个就够了。

战斗配置设置流程
该设置从调度器入口开始，按以下层级路径操作，核心为开启相关功能并配置关键参数。独立任务中的自动战斗，也可以在独立任务下展开其设置后，参考以下流程设置。

1. 进入战斗配置页面
路径：调度器 → 配置组 → 设置 → 战斗配置
操作：将 “战斗配置” 功能开启！（必须同时开启上方的“地图追踪行走配置”和此处的“战斗配置”，底下的设置才能生效，每个配置组设置是相互独立的。“地图追踪行走配置”的设置请参考配置组里的JS脚本或地图追踪任务的相关说明，不同的JS脚本在这方面的要求各不相同）

2. 战斗结束检测相关设置（----------此处只说明公版BGI的设置项----------）
下面将按照所有可展开项全部展开后，在界面上的位置顺序，从上到下依次说明。值得一提的是，旋转寻找敌人位置可以让角色主动接近敌人，对战斗效率有明显提升。
自动检测战斗结束：开启
更快检查结束战斗：开启
更快触发战斗结束检查参数：0.4
切人后再执行战斗结束检查：开启
敌人可见时跳过战斗结束检查：关闭（看远处丘丘人跳舞看到超时结束很好玩么？还与旋转索敌互斥）
开战后一段时间阻断战斗结束检查（秒）设置为：1（需要打像原海异种或丘丘人哨塔那样的无敌意敌人则填10）
派蒙辅助检测：开启（务必开启，不可遮挡左上角派蒙图标）
派蒙检测延时（秒）: 设置为： 0.2（默认值）
旋转寻找敌人位置：开启（旋转速度把条拉到最右边，再往左拉一格就好，过快会导致卡检测以及乱转，要是真卡检测了就往左拉更多）
Q 前检测：关闭
尝试面向敌人：开启
检查战斗结束的延时：设置为：0.4;钟离,1.4;（默认值）
按键触发后检查延时：设置为 ：0.4（默认值）

3. 战斗中视觉识别配置
此项的作用是在战斗中让视角持续朝向敌人，配合策略中的向前移动动作可改善角色索敌问题。
战斗中持续索敌: 开启
脱锁等待时间(秒)：0.5 （默认值）或更高（应根据你队伍中攻击距离最远的角色的攻击频率决定，具体怎么计算自己试）
其余未提及选项保持默认即可。

4. 盾奶位角色优先释放技能
由于json策略可通过优先级机制实现盾奶技能优先释放，这一项无需开启。如果开启则绝对不能选错位置，选对无奖励，选错有惩罚！
盾奶角色优先释放技能：关闭（空选即可）
其余未提及选项保持默认即可。

5. 战斗后拾取动作
需根据队伍角色情况选择开启，核心注意万叶 / 琴的特殊设置。
扫描掉落物光柱：关闭（队伍中有万叶 / 琴时，一定要关闭！！！）
聚集材料动作：开启（该功能会自动选择万叶或琴（优先万叶），通过长 E 动作收集掉落物。）
二次拾取：关闭（用万叶的情况下一定要关闭！）可选开启（使用琴的情况下）
基于经验值判断拾取：关闭（或参考配置组中的地图追踪任务或JS脚本的说明进行设置）
拾取战斗人次阈值：关闭（输入框留空，或参考配置组中的地图追踪任务或JS脚本的说明进行设置）
只拾取精英掉落模式：关闭功能（或参考配置组中的地图追踪任务或JS脚本的说明进行设置）
万叶拾取队伍名：留空（切队伍很废时间，要捡东西还是直接把万叶放战斗队伍吧）

6. 自动战斗超时（秒）：60 或 120（默认值）（根据自己队伍练度和战斗难度来设置，建议用木桩类奇域测试一下60秒内打移动靶能灌多少伤害再做判断）

7. 游泳检测：开启`;

/* ---------------- 指令编辑器（通用） ---------------- */

function commandTokenTable(parts) {
  if (!parts.length) return '<div class="hint">指令串为空。</div>';
  const rows = parts.map((p, i) => {
    let desc = '';
    if (p.method) {
      desc = p.method.cn;
      if (p.args && p.args.length) desc += `（参数：${p.args.join(' , ')}）`;
      if (p.method.canonical === 'e') desc += '｜会触发切人';
      if (p.method.canonical === 'check') desc += '｜触发一次战斗结束检测';
    } else desc = '<span style="color:var(--err)">未知指令</span>';
    const errs = p.errors.length ? `<div style="color:var(--err)">${p.errors.map(esc).join('<br>')}</div>` : '';
    const noSwitch = p.method && NO_SWITCH.has(p.method.canonical);
    return `<tr>
      <td class="mono" style="white-space:nowrap">${i + 1}. ${esc(p.raw)}</td>
      <td>${desc}${errs}</td>
      <td style="white-space:nowrap">${p.method ? (noSwitch ? '<span class="hint">不切人</span>' : '<span style="color:var(--ok)">可切人</span>') : '-'}</td></tr>`;
  }).join('');
  return `<table><thead><tr><th style="width:34%">指令</th><th>释义</th><th style="width:64px">切人</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/* -------- 指令串校验反馈（手输指令时实时刷新，不重建面板） -------- */

/**
 * 指令串 → 校验反馈 HTML（错误 + 警告）。
 * skipEmptyWarning 由调用方按「当前角色 + 动作类型 0 只写触发条件、不写指令」的规则决定
 * （见 core.js 的 isMarkerOnlyAction），这时不提示「指令串为空」。
 */
function commandFeedbackHtml(value, skipEmptyWarning) {
  const p = parseActionString(value || '', { skipEmptyWarning: !!skipEmptyWarning });
  const m = 'margin-bottom:6px';
  return (p.errors.length ? `<div class="errbox" style="${m}">${p.errors.map(esc).join('<br>')}</div>` : '')
    + (p.warnings.length ? `<div class="warnbox" style="${m}">${p.warnings.map(esc).join('<br>')}</div>` : '');
}

/** 战斗前动作一行的校验反馈 HTML（含“指令串不能有空格”的检查） */
function preCmdFeedbackHtml(pa) {
  const cmd = (pa && pa.cmd) || '';
  const p = parseActionString(cmd);
  const m = 'margin-top:5px';
  return (p.errors.length ? `<div class="errbox" style="${m}">${p.errors.map(esc).join('<br>')}</div>` : '')
    + (cmd.trim() && p.warnings.length ? `<div class="warnbox" style="${m}">${p.warnings.map(esc).join('<br>')}</div>` : '')
    + (pa && pa.character && /\s/.test(cmd.trim()) ? `<div class="errbox" style="${m}">指令串含空格，会被 BetterGI 误切成角色名的一部分</div>` : '');
}

/**
 * 手动输入指令后的实时检查：刷新该输入框下面的校验反馈、指令释义与释义条数。
 * mode='pre' 表示战斗前动作（用的是 preActions 的规则）。
 */
function updateCommandFeedback(ref, value, mode) {
  if (ref === undefined || ref === null) return;
  const key = cssEsc(String(ref));
  const p = parseActionString(value || '');
  const check = document.querySelector(`[data-cmdcheck="${key}"]`);
  if (check) {
    if (mode === 'pre') {
      const i = Number(String(ref).split(':')[1]);
      const pa = state.strategy.info.preActions[i] || {};
      check.innerHTML = preCmdFeedbackHtml({ character: pa.character || '', cmd: value });
    } else {
      // 角色动作：按「当前角色 + 动作类型 0 只写条件不写指令」的规则决定要不要提示指令串为空
      const a = state.strategy.actions.find(x => x.id === String(ref).replace(/^act:/, ''));
      const marker = !!a && isMarkerOnlyAction({ ...a, action: value });
      check.innerHTML = commandFeedbackHtml(value, marker);
    }
  }
  const tokens = document.querySelector(`[data-cmdtokens="${key}"]`);
  if (tokens) tokens.innerHTML = commandTokenTable(p.parts);
  const cnt = document.querySelector(`[data-cmdcount="${key}"]`);
  if (cnt) cnt.textContent = String(p.parts.length);
}

/* -------- 快捷插入指令：内联面板（不使用弹窗，选中词条后在原处展开参数） -------- */

const qcVal = (el) => (el ? String(el.value === null || el.value === undefined ? '' : el.value).trim() : '');

/** 找到某个动作/战斗前动作的指令输入框（用于“插入光标位置”） */
function resolveActionTextarea(kind, ref) {
  const lf = app.lastQcField;
  const wantRef = kind === 'pre' ? `pre:${ref}` : `act:${ref}`;
  if (lf && lf.ref === wantRef && lf.el && lf.el.isConnected) return lf.el;
  // 角色动作的指令框是 textarea，战斗前动作的指令框是单行 input
  return document.querySelector(`textarea[data-ref="${cssEsc(wantRef)}"]`)
    || document.querySelector(`input[data-ref="${cssEsc(wantRef)}"]`)
    || null;
}

function getQcTarget(panel) {
  return panel.getAttribute('data-kind') === 'pre'
    ? { kind: 'pre', index: panel.getAttribute('data-ref') }
    : { kind: 'act', actionId: panel.getAttribute('data-ref') };
}

function buildQuickCommand(panel) {
  const uid = panel.getAttribute('data-qk');
  const st = state.qc[uid];
  if (!st || st.sel === null || st.sel === undefined) return '';
  const q = QUICK_COMMANDS[st.sel];
  if (!q) return '';
  const vals = {};
  q.params.forEach((prm, i) => {
    const el = panel.querySelector(`[data-cqp="${i}"]`);
    vals[prm.key] = el ? qcVal(el) : String(prm.def === undefined ? '' : prm.def);
  });
  let s = q.tpl;
  for (const prm of q.params) {
    const ph = `{${prm.key}}`;
    if (!s.includes(ph)) continue;
    if (vals[prm.key] === '') s = s.replace(new RegExp(`[,(]\\s*${ph.replace(/[{}]/g, '\\$&')}\\s*`), '(');
    else s = s.split(ph).join(vals[prm.key]);
  }
  s = s.replace(/\(\s*\)/g, '');
  return s.replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ').trim();
}

function renderQuickParamPanel(panel) {
  const uid = panel.getAttribute('data-qk');
  const st = state.qc[uid];
  const box = panel.querySelector(`[data-qp="${uid}"]`);
  if (!box) return;
  if (!st || st.sel === null || st.sel === undefined) {
    box.innerHTML = '<div class="hint">请先选择一个词条。</div>';
    return;
  }
  const q = QUICK_COMMANDS[st.sel];
  // 参数框的值以“已填过的值”为准（否则点按键图选完键后又被默认值覆盖回去）
  const curVal = (i, def) => (st.vals && st.vals[i] !== undefined && st.vals[i] !== null ? String(st.vals[i]) : String(def === undefined ? '' : def));
  const fields = q.params.map((prm, i) => {
    if (prm.type === 'select') {
      const cur = curVal(i, prm.def);
      return `<label class="f">${esc(prm.label)}
        <select data-cqp="${i}">${prm.options.map(([v, t]) => `<option value="${attr(v)}" ${String(v) === cur ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
    }
    if (prm.type === 'vk') {
      const open = st.pick === i;
      return `<label class="f">${esc(prm.label)}
        <input data-cqp="${i}" class="mono" style="width:150px" value="${attr(curVal(i, prm.def))}">
        <button type="button" class="mini" data-qvk="${i}">按键图…</button></label>
        ${open ? `<div style="width:100%">${renderKeyPicker(uid, i)}</div>` : ''}`;
    }
    return `<label class="f">${esc(prm.label)} <input data-cqp="${i}" type="number" step="${prm.step || 'any'}" style="width:110px" value="${attr(curVal(i, prm.def))}"></label>`;
  }).join(' ');
  const hints = q.params.filter(x => x.hint).map(x => '· ' + esc(x.label) + '：' + esc(x.hint)).join('<br>');
  box.innerHTML = `
    <div class="card" style="margin:0">
      <h3>${esc(q.label)} <span class="hint">${esc(q.cn)}</span></h3>
      <div class="row mb">${fields}</div>
      ${hints ? `<div class="hint mb">${hints}</div>` : ''}
      <div class="row">
        <button type="button" class="primary" data-cqins="cursor">插入光标位置</button>
        <button type="button" data-cqins="append">插入末尾</button>
        <button type="button" data-cqins="replace">替换全部</button>
        <span class="hint">插入光标位置：先在左边的输入框里点一下、把光标放到想插入的位置</span>
      </div>
      <div class="hint" style="margin-top:6px">将插入：<span class="mono pill" data-cqpv="${uid}"></span></div>
    </div>`;
  bindQuickCmd(panel);
  updateQuickPreview(panel);
}

/** 按键图：在原面板内展开（不弹窗，避免打断连续输入） */
function renderKeyPicker(uid, i) {
  return `<div class="card" style="margin:4px 0 0;background:var(--bg3);padding:8px 10px">
    <div class="row mb">
      <label class="f">按键代码 <input data-qvkinput="${i}" class="mono" style="width:170px" value="VK_E"></label>
      <button type="button" class="mini primary" data-qvkok="${i}">确定</button>
      <button type="button" class="mini" data-qvkcancel="${i}">收起</button>
      <span class="hint">会原样写入 keydown/keyup/keypress；BetterGI 内部会转大写并补 VK_ 前缀</span>
    </div>
    <div class="row mb">${MOUSE_BTNS.map(([code, label]) => `<button type="button" class="chip" data-qvkset="${i}:${attr(code)}">${esc(label)} <span class="pill">${code}</span></button>`).join('')}</div>
    <div class="kbgrid">${KB_ROWS.map(row => `<div class="kbrow">${row.map(code => `<button type="button" class="kb" data-qvkset="${i}:${attr(code)}">${esc(code.replace('VK_', ''))}</button>`).join('')}</div>`).join('')}</div>
    <div class="hint" style="margin-top:8px">鼠标键必须使用全大写的 VK_LBUTTON / VK_RBUTTON / VK_MBUTTON，否则 BetterGI 会静默退化成普通键盘按键。</div>
  </div>`;
}

function updateQuickPreview(panel) {
  const uid = panel.getAttribute('data-qk');
  const pv = panel.querySelector(`[data-cqpv="${uid}"]`);
  if (pv) pv.textContent = buildQuickCommand(panel) || '（请选择词条）';
}

function bindQuickCmd(panel) {
  const uid = panel.getAttribute('data-qk');
  const st = state.qc[uid];
  if (!st) return;
  panel.querySelectorAll('[data-cqp]').forEach(el => {
    const i = Number(el.getAttribute('data-cqp'));
    const h = () => { st.vals[i] = el.value; if (st.pick === i) return; updateQuickPreview(panel); };
    el.oninput = h;
    el.onchange = h;
  });
  panel.querySelectorAll('[data-qvk]').forEach(b => {
    b.onclick = () => {
      const i = Number(b.getAttribute('data-qvk'));
      st.pick = st.pick === i ? null : i;
      renderQuickParamPanel(panel);
    };
  });
  panel.querySelectorAll('[data-qvkset]').forEach(b => {
    b.onclick = () => {
      const [i, code] = b.getAttribute('data-qvkset').split(':');
      st.vals[Number(i)] = code;
      st.pick = null;
      renderQuickParamPanel(panel);
    };
  });
  panel.querySelectorAll('[data-qvkok]').forEach(b => {
    b.onclick = () => {
      const i = Number(b.getAttribute('data-qvkok'));
      const inp = panel.querySelector(`[data-qvkinput="${i}"]`);
      st.vals[i] = qcVal(inp) || 'VK_E';
      st.pick = null;
      renderQuickParamPanel(panel);
    };
  });
  panel.querySelectorAll('[data-qvkcancel]').forEach(b => {
    b.onclick = () => {
      st.pick = null;
      renderQuickParamPanel(panel);
    };
  });
  panel.querySelectorAll('[data-cqins]').forEach(b => {
    b.onclick = () => {
      const text = buildQuickCommand(panel);
      if (!text) { alert('请先选择一个词条。'); return; }
      const target = getQcTarget(panel);
      const caret = applyCommandInsert(target, text, b.getAttribute('data-cqins'));
      // 插入后整块面板会重建，这里要重新找新的输入框（旧节点已经脱离文档）
      const fresh = findCommandInput(target);
      if (fresh) {
        // 先放好光标再聚焦：重建出来的输入框是全新节点，光标默认停在开头，
        // 不显式放回去的话用户就没法接着输（浏览器里点击插入按钮后焦点在按钮上，更需要这一步）
        if (caret !== null && caret !== undefined) restoreCommandCaret(target, caret);
        try { fresh.focus(); } catch (e) { /* 忽略 */ }
      }
    };
  });
}

/** 按插入目标找回（重建后的）指令输入框 */
function findCommandInput(target) {
  if (!target) return null;
  if (target.kind === 'pre') return document.querySelector(`input[data-ref="pre:${cssEsc(String(target.index))}"]`);
  const id = target.actionId || target.id;
  return document.querySelector(`textarea[data-ref="act:${cssEsc(String(id))}"]`);
}

/** 快捷插入指令面板的 HTML（在“快捷插入指令”这项下面直接展开） */
function renderQuickCommandPanel(id, target, value) {
  if (!state.qc[id]) state.qc[id] = { sel: null, vals: {}, pick: null };
  return `<div data-qk="${attr(id)}" data-kind="${attr(target.kind)}" data-ref="${attr(target.kind === 'pre' ? target.index : target.actionId)}" data-value="${attr(value || '')}">
    <div class="row mb">
      ${QUICK_COMMANDS.map((q, i) => `<button type="button" class="chip" data-cq="${i}">${esc(q.label)}</button>`).join('')}
    </div>
    <div data-qp="${attr(id)}"></div>
  </div>`;
}

/** 绑定页面上所有快捷插入指令面板（渲染后调用） */
function bindQuickCommandPanels() {
  document.querySelectorAll('[data-qk]').forEach(panel => {
    const uid = panel.getAttribute('data-qk');
    const value = panel.getAttribute('data-value') || '';
    const st = state.qc[uid] || (state.qc[uid] = { sel: null, vals: {}, pick: null });
    if (st.value !== value) { st.value = value; st.sel = null; st.vals = {}; st.pick = null; }
    panel.querySelectorAll('[data-cq]').forEach(b => {
      b.onclick = () => {
        const i = Number(b.getAttribute('data-cq'));
        st.sel = st.sel === i ? null : i;
        st.vals = {};
        st.pick = null;
        panel.querySelectorAll('[data-cq]').forEach(x => x.classList.toggle('on', x === b && st.sel === i));
        renderQuickParamPanel(panel);
      };
    });
    renderQuickParamPanel(panel);
  });
}

/** 通用指令编辑器 HTML */
function commandEditorHtml(value, kind, actionId, opts) {
  const o = Object.assign({ rows: 3, label: '动作指令（action）', hint: '', qid: '' }, opts || {});
  const p = parseActionString(value || '');
  const id = o.qid || `${kind}:${actionId}`;
  // 角色动作按「当前角色 + 动作类型 0 只写条件不写指令」的规则决定要不要提示指令串为空
  const act = kind === 'act' ? state.strategy.actions.find(x => x.id === actionId) : null;
  const marker = !!act && isMarkerOnlyAction({ ...act, action: value });
  return `
    <div class="hint" style="margin-bottom:4px">${esc(o.label)}</div>
    ${ctrl({ tag: 'textarea', kind, actionId, field: 'action', value: value || '', rows: o.rows, placeholder: '用半角逗号分隔，例如：q,wait(0.1),ready', extra: ` data-ref="${attr(id)}"` })}
    <div class="row" style="margin:6px 0">
      <span class="hint">${esc(o.hint || '必须以半角逗号分隔；不支持 | 与 round()；中文括号/逗号会报错')}</span>
    </div>
    <div data-cmdcheck="${attr(id)}">${commandFeedbackHtml(value, marker)}</div>
    <details class="det sub" data-details="${attr(id)}:quick" ${detailOpen(`${id}:quick`, true) ? 'open' : ''}><summary>快捷插入指令</summary>
      ${renderQuickCommandPanel(id, { kind, actionId, index: actionId }, value)}
    </details>
    <details class="det sub" data-details="${attr(id)}:explain" ${detailOpen(`${id}:explain`, false) ? 'open' : ''}><summary>已输入指令的释义（<span data-cmdcount="${attr(id)}">${p.parts.length}</span> 条）</summary>
      <div style="margin-top:6px" data-cmdtokens="${attr(id)}">${commandTokenTable(p.parts)}</div>
    </details>`;
}

function getActionText(target) {
  if (target.kind === 'pre') {
    const pa = state.strategy.info.preActions[Number(target.index)];
    return pa ? pa.cmd : '';
  }
  const a = state.strategy.actions.find(x => x.id === (target.actionId || target.id));
  return a ? a.action : '';
}
function setActionText(target, text) {
  if (target.kind === 'pre') {
    const pa = state.strategy.info.preActions[Number(target.index)];
    if (pa) pa.cmd = text;
  } else {
    const a = state.strategy.actions.find(x => x.id === (target.actionId || target.id));
    if (a) a.action = text;
  }
}
function applyCommandInsert(target, text, mode) {
  const cur = getActionText(target) || '';
  let next;
  // 插入完成后光标应当停在哪里（被插入内容的后面），便于用户接着往下写 / 连续插入
  let caret = null;
  const insideBy = (ins) => (/\(\)\s*$/.test(ins) ? 1 : 0);
  if (mode === 'replace') { next = text; caret = next.length - insideBy(next.trim()); }
  else if (mode === 'append') {
    next = cur.trim() ? cur.replace(/,\s*$/, '') + ',' + text : text;
    caret = next.length - insideBy(text.trim());
  } else {
    // 插入光标位置：优先用刚失焦的那个输入框里的光标位置（点击按钮本身就会让输入框失焦）
    const el = resolveActionTextarea(target.kind, target.kind === 'pre' ? target.index : (target.actionId || target.id));
    const s = el && typeof el.selectionStart === 'number' ? el.selectionStart : null;
    const e2 = el && typeof el.selectionEnd === 'number' ? el.selectionEnd : null;
    if (s === null) {
      next = cur.trim() ? cur.replace(/,\s*$/, '') + ',' + text : text;
      caret = next.length - insideBy(text.trim());
      alert('没有找到可用的光标位置（请先在左侧输入框里点一下、把光标放到要插入的位置），已改为插入到末尾。');
    } else {
      const before = cur.slice(0, s);
      let after = cur.slice(e2);
      let ins = (before && !/,\s*$/.test(before) ? ',' : '') + text + (after && !/^\s*,/.test(after) ? ',' : '');
      // 光标正好停在逗号前面时（插入点两侧都是逗号）去掉一个，避免拼出「e,,」
      if (/,\s*$/.test(before) && /^\s*,/.test(after)) { ins = ins.replace(/,$/, ''); after = after.replace(/^\s*,\s*/, ''); }
      next = before + ins + after;
      caret = (before + ins).length - insideBy(ins.trim());
    }
  }
  setActionText(target, next);
  refresh([state.ui.tab]);
  // 面板重建后光标会落在新输入框的开头，这里按上面算好的位置放回去（焦点本身由调用方负责）
  if (caret !== null) restoreCommandCaret(target, caret);
  return caret;
}

/**
 * 把光标放回（重建后的）指令输入框的指定位置。
 * refresh() 会重建整个面板，旧输入框上的光标位置不会被浏览器带过来，
 * 所以必须重新找到新输入框并显式 setSelectionRange，否则光标会停在字符串开头。
 */
function restoreCommandCaret(target, caret) {
  const el = findCommandInput(target);
  if (!el || caret === null || caret === undefined) return el;
  if (typeof el.setSelectionRange === 'function') {
    try { el.setSelectionRange(caret, caret); } catch (e) { /* 某些类型不支持选区 */ }
  }
  return el;
}

/* ---------------- 信息页渲染 ---------------- */

/**
 * 「战斗前动作列表」每一行角色搜索框里的内容。
 * 只用于该行角色候选列表的过滤（选择框里始终保留全部角色），
 * 所以放在 app 上而不是 state.ui 里：不会被 saveUi 落盘，重建面板后也能保留。
 */
function preSearches() {
  if (!Array.isArray(app.preSearch)) app.preSearch = [];
  return app.preSearch;
}
function setPreSearch(i, v) {
  const list = preSearches();
  const n = Number(i);
  if (!Number.isInteger(n) || n < 0) return;
  list[n] = String(v === undefined || v === null ? '' : v);
}

function renderInfoPanel() {
  const s = state.strategy;
  const pre = s.info.preActions || [];
  const v = state.lastIssues || validateStrategy();
  const infoErrors = v.errors.filter(x => !x.actionId);
  const infoWarns = v.warnings.filter(x => !x.actionId);
  const drafted = loadDrafts();
  // 每一行「战斗前动作」自己的角色搜索词：值跟着 DOM 走（不放进 state.ui，避免被 saveUi 落盘）
  const searches = preSearches();
  const prePool = AVATARS.filter(a => !a.virtual);

  $('paneInfo').innerHTML = `
    <div class="split">
      <div class="col">
        <div class="card">
          <h3>基本信息 <span class="hint">写入 info 节点</span></h3>
          <div class="grid2">
            <label class="f">策略名称</label>
            <div>${ctrl({ kind: 'info', field: 'name', value: s.info.name, placeholder: '例如：全角色通用（实验性）', style: 'width:320px' })}
              <div class="hint">对应 name 字段，只用于日志显示，与文件名无关。命名时请遵守BetterGI脚本仓库中的战斗策略命名规则。</div></div>
            <label class="f">作者</label>
            <div>${ctrl({ kind: 'info', field: 'author', value: s.info.author, placeholder: '你的名字', style: 'width:220px' })}</div>
            <label class="f">版本</label>
            <div>${ctrl({ kind: 'info', field: 'version', value: s.info.version, placeholder: '例如：v1.2 或 2025-06-30', style: 'width:220px' })}
              <div class="hint">对应 version 字段（可选，BetterGI 运行时不读取它）。它同时用于本地草稿的归档：<b>策略名称 + 版本</b> 二者有其一不同就是两份不同的草稿，方便做版本管理。留空时导出的 JSON 里省略这个字段。</div></div>
            <label class="f">描述</label>
            <div>
              ${ctrl({ tag: 'textarea', kind: 'info', field: 'description', value: s.info.description, rows: 8, placeholder: '可选。会作为额外的 description 字段写在 author 下面，BetterGI 运行时不读取它。' })}
              <div class="row" style="margin-top:5px">
                <button class="mini" data-act="desc-template">一键填写「战斗配置设置流程」</button>
                <button class="mini" data-act="desc-clear">清空描述</button>
                <span class="hint">${(s.info.description || '').length} 个字符</span>
              </div>
            </div>
            <label class="f">设置</label>
            <div><span class="pill">${esc(JSON.stringify(s.info.config || {}))}</span>
              <div class="hint">当前版本下，设置不提供编辑，因为对应的 config 字段在 BetterGI 运行时暂不读取，从本编辑器导出的 config 固定为空对象 {}。</div></div>
          </div>
        </div>

        <div class="card">
          <h3>战斗前动作列表 <span class="hint">info.preActions：开战前按顺序执行一次</span></h3>
          <div class="hint mb">格式为 <span class="pill">角色名 指令串</span> 或只有 <span class="pill">指令串</span>（不写角色名时使用队伍第 1 名角色）。注意：BetterGI 按<b>第一个空格</b>切分角色名，所以指令串里不能有空格（要写 <span class="pill">walk(s,0.2)</span> 而不是 <span class="pill">walk(s, 0.2)</span>）。</div>
          <div class="hint mb">每一个动作的角色下拉旁边都有自己的搜索框：在里面输入角色名 / 编号，旁边的<b>角色选择框</b>里就只剩匹配到的角色，从选择框里挑一个即可。</div>
          ${pre.length ? pre.map((pa, i) => {
            const qid = `pre:${i}`;
            const q = searches[i] || '';
            return `<div class="card" style="background:var(--bg3);margin-bottom:8px;padding:8px 10px">
              <div class="row mb">
                <span class="hint">#${i + 1}</span>
                <select data-kind="pre" data-idx="${i}" data-field="character" style="width:150px" title="角色选择框：选项由旁边的搜索框筛选">
                  ${avatarFilterOptions(q, pa.character || '', { pool: prePool, allLabel: '（不指定角色）' })}
                </select>
                <input data-kind="pre" data-field="avatarSearch" data-idx="${i}" value="${attr(q)}" placeholder="搜索角色名 / 编号" style="width:150px" title="搜索词只用来筛选旁边的角色选择框">
                <button class="mini" data-act="pre-up" data-idx="${i}">↑</button>
                <button class="mini" data-act="pre-down" data-idx="${i}">↓</button>
                <button class="mini danger" data-act="pre-del" data-idx="${i}">删除</button>
              </div>
              ${ctrl({ kind: 'pre', idx: i, field: 'cmd', value: pa.cmd || '', placeholder: '例如：e,wait(0.3)', extra: ` data-ref="${attr(qid)}"` })}
              <details class="det sub" data-details="${attr(qid)}:quick" ${detailOpen(`${qid}:quick`, false) ? 'open' : ''}><summary>快捷插入指令</summary>
                ${renderQuickCommandPanel(qid, { kind: 'pre', index: i }, pa.cmd || '')}
              </details>
              <div class="row" style="margin-top:5px">
                ${pa.character ? `<span class="hint">将写成：<span class="pill">${esc(pa.character)} ${esc(pa.cmd || '')}</span></span>` : ''}
              </div>
              <div data-cmdcheck="${attr(qid)}">${preCmdFeedbackHtml(pa)}</div>
            </div>`;
          }).join('') : '<div class="empty">还没有战斗前动作</div>'}
          <button class="mini primary" data-act="pre-add">+ 添加战斗前动作</button>
        </div>
      </div>

      <div class="col" style="max-width:430px">
        <div class="card">
          <h3>导入 / 导出</h3>
          <div class="row mb">
            <button class="primary" data-act="import">导入 JSON 策略…</button>
            <button data-act="export">导出 JSON 策略</button>
          </div>
          <div class="row mb">
            <button data-act="merge">合并 JSON 策略…</button>
            <span class="hint">把另一份策略里有差异的部分有选择地并进当前策略（以当前策略为基础）</span>
          </div>
          <div class="hint mb">导出前会再做一次完整校验，有错误会拒绝导出并列出原因。</div>
          <hr>
          <div class="row mb">
            <button class="mini" data-act="new-preset">新建（含兜底动作）</button>
            <button class="mini" data-act="new-blank">新建空白策略（不建议）</button>
            <button class="mini" data-act="drafts">本地草稿…</button>
          </div>
          <div class="hint">草稿按「策略名称 + 版本」两个条件自动保存到浏览器本地（二者有其一不同就是不同的草稿），共 ${Object.keys(drafted).length} 份</div>
        </div>

        <div class="card">
          <h3>当前文件状态</h3>
          ${infoErrors.length ? infoErrors.map(x => `<div class="errbox mb">${esc(x.text)}</div>`).join('') : '<div class="okbox mb">本页没有错误。</div>'}
          ${infoWarns.length ? infoWarns.map(x => `<div class="warnbox mb">${esc(x.text)}</div>`).join('') : ''}
          <div class="kv">
            <div class="k">动作总数</div><div class="v">${s.actions.length}</div>
            <div class="k">涉及角色</div><div class="v">${new Set(s.actions.map(a => a.character || '当前角色')).size}</div>
            <div class="k">优先级条目</div><div class="v">${expandPriorities(s.actions, null).length}（含其他触发条件展开）</div>
            <div class="k">全局错误/警告</div><div class="v">${v.errors.length} / ${v.warnings.length}</div>
            <div class="k">命座要求</div><div class="v">${(() => {
              const n = s.actions.filter(a => consHasRequirement(a)).length;
              const chs = consCharacters(s.actions);
              return n ? `${n} 条动作设置了命座要求（${chs.length} 个角色）` : '没有动作设置命座要求';
            })()}</div>
          </div>
          <div class="row" style="margin-top:8px">
            <button class="mini" data-act="cons-switch">快捷开关高命座手法</button>
            <span class="hint">${(() => {
              const chs = consCharacters(s.actions);
              return chs.length ? `可切换的角色：${chs.map(c => esc(c || '当前角色')).join('、')}` : '还没有动作设置「达到命座开启 / 达到命座关闭」，在动作卡片的「触发条件」→「命座要求」里设置';
            })()}</span>
          </div>
        </div>

        <div class="card">
          <h3>关于编号规则</h3>
          <div class="hint" style="line-height:1.75">
            每条动作的 index 由 5 位数字构成，导出时省略首位非 0 数字之前的 0：<br>
            <span class="pill">[动作类型][元素类型][角色编号×2][同类型第 N 条]</span><br>
            元素类型号按元素反应的先后手顺序分配：<b>1</b> 冰 · <b>2</b> 火 · <b>3</b> 水 · <b>4</b> 雷 · <b>5</b> 风 · <b>6</b> 岩 · <b>7</b> 草（<b>0</b> 元素未定/当前角色；同元素内按 BetterGI 内置角色表次序 01、02…）。<br>
            例如 <b>33011</b> = 后台输出 · 水元素 · 芭芭拉(01) · 第 1 条；<b>14041</b> = 开盾 · 雷元素 · 菲谢尔(04) · 第 1 条。<br>
            动作类型 0（战斗检查与标记）只用于「当前角色」，编号退化成 1 位：<b>1</b>~<b>9</b>（这 9 个槽位都满时编辑器会临时多给一个尾数 <b>10</b>，校验面板会提示需要「按规则重排编号」）。<br>
            尾数 0 不用于动作，只出现在其他触发条件的 priority 里作为插入位。
          </div>
          <hr>
          <div class="hint" style="line-height:1.75">
            动作类型含义（数值越大越靠后）：<br>
            ${ACTION_TYPES.map(t => `<div style="margin:2px 0"><span class="pill">${t.code}</span> ${esc(t.name)}：${esc(t.cn || '')}</div>`).join('')}
            <div style="margin-top:6px">为以上动作类型分配的数字，是根据“高血量，所需前置动作未执行，动作可能从未释放过”的基础条件假定下的动作优先程度决定的。</div>
          </div>
        </div>
      </div>
    </div>`;
  bindQuickCommandPanels();
}

/* ---------------- 快捷开关高命座手法 ----------------
 * 列表里展示「有动作设置了达到命座开启 / 达到命座关闭」的每一个角色，
 * 以及该角色可切换动作开关的相关命座；同一个角色有多个可切换命座时就分成几条 chip 放在一起。
 * 点某个命座就等于「这个角色按 x 命来设置动作开关」：目标命座 ≤ x 的动作启用、> x 的停用
 * （也就是「有高命必有低命，没有低命必没有高命」），点「不启用高命手法」则把该角色全部停用。
 */

/** 某角色当前生效的命座（= 已勾选目标命座里最大的那个；0 表示没有启用任何高命手法） */
function consLevelOf(actions, character) {
  let k = 0;
  for (const a of (actions || [])) {
    if (String(a.character || '') !== String(character || '')) continue;
    if (!consHasRequirement(a)) continue;
    if (consActiveState(a)) k = Math.max(k, Number(a.consTarget));
  }
  return k;
}

function openConsSwitchModal() {
  const actions = state.strategy.actions;
  const chars = consCharacters(actions);
  if (!chars.length) {
    openModal({
      title: '快捷开关高命座手法',
      body: `<div class="warnbox">目前没有任何动作设置了「达到命座开启 / 达到命座关闭」。</div>
        <div class="hint" style="margin-top:6px">请在「动作编辑」页的动作卡片里展开「触发条件」区块，在其中的「命座要求」里选择模式与目标命座数、并按需要勾选「按达到x命设置动作启用/停用」。</div>`,
      actions: [{ label: '知道了', primary: true, value: null }],
    });
    return;
  }

  const render = () => {
    const rows = chars.map((ch, i) => {
      const targets = consTargetsFor(state.strategy.actions, ch);
      const level = consLevelOf(state.strategy.actions, ch);
      const cnt = state.strategy.actions.filter(a => String(a.character || '') === String(ch) && consHasRequirement(a)).length;
      return `<div class="card" style="background:var(--bg3);margin-bottom:8px;padding:8px 10px">
        <div class="row mb">
          <span style="min-width:130px">${avatarLabel(ch)}</span>
          <span class="hint">${cnt} 条动作有命座要求，可切换命座：${targets.map(x => `<span class="pill">${x}</span>`).join(' ')}</span>
          <span style="flex:1"></span>
          <span class="badge ${level ? 'ok' : 'warn'}">当前按 ${level ? level + ' 命' : '不启用高命手法'}</span>
        </div>
        <div class="row">
          <button class="chip ${level === 0 ? 'on' : ''}" data-cons-set="${i}" data-cons-level="0">不启用高命手法</button>
          ${[1, 2, 3, 4, 5, 6].map(x => `<button class="chip ${level === x ? 'on' : ''}" data-cons-set="${i}" data-cons-level="${x}">${x} 命</button>`).join('')}
        </div>
        <div class="hint" style="margin-top:4px">点某个命座就等于「这个角色按 x 命来设置动作开关」：目标命座不高于 x 的动作启用、高于 x 的停用（有高命必有低命，没有低命必没有高命）。</div>
      </div>`;
    }).join('');
    return `<div class="hint mb">这里只列出有动作设置了「达到命座开启 / 达到命座关闭」的角色。设置完之后，动作卡片里「命座要求」下「按达到x命设置动作启用/停用」的勾选状态会同步变化，导出时写进各动作的 <span class="pill">consRequirement</span> 字段与 expression。</div>
      <div class="scroll">${rows}</div>`;
  };

  openModal({
    title: '快捷开关高命座手法',
    body: render(),
    actions: [{ label: '关闭', primary: true, value: null }],
  });
  $('modalBody').onclick = (e) => {
    const btn = e.target.closest ? e.target.closest('[data-cons-set]') : null;
    if (!btn) return;
    const i = Number(btn.getAttribute('data-cons-set'));
    const level = Number(btn.getAttribute('data-cons-level'));
    const ch = chars[i];
    if (ch === undefined) return;
    applyConsLevel(state.strategy.actions, ch, level);
    // 勾选状态直接参与 expression，改完要重跑校验并刷新面板 / 预览
    refresh(['info', 'actions', 'preview']);
    $('modalBody').innerHTML = render();
  };
}

/* ---------------- 事件与字段处理 ---------------- */

const infoHandlers = {
  'desc-template': () => { state.strategy.info.description = DESC_TEMPLATE; refresh(['info']); },
  'desc-clear': () => { state.strategy.info.description = ''; refresh(['info']); },
  'pre-add': () => { state.strategy.info.preActions.push({ character: '', cmd: '' }); refresh(['info']); },
  'pre-del': (t) => { state.strategy.info.preActions.splice(Number(t.getAttribute('data-idx')), 1); refresh(['info']); },
  'pre-up': (t) => {
    const i = Number(t.getAttribute('data-idx'));
    if (i <= 0) return;
    const l = state.strategy.info.preActions;
    [l[i - 1], l[i]] = [l[i], l[i - 1]];
    refresh(['info']);
  },
  'pre-down': (t) => {
    const i = Number(t.getAttribute('data-idx'));
    const l = state.strategy.info.preActions;
    if (i >= l.length - 1) return;
    [l[i + 1], l[i]] = [l[i], l[i + 1]];
    refresh(['info']);
  },
  'pre-quick': (t) => { /* 快捷插入指令已在原面板内展开，无需弹窗 */ },
  'import': () => doImport(),
  'merge': () => doMerge(),
  'export': () => doExport(),
  'cons-switch': () => openConsSwitchModal(),
  'new-blank': () => confirmDiscard(() => newStrategy('blank')),
  'new-preset': () => confirmDiscard(() => newStrategy('preset')),
  'drafts': () => openDraftManager(),
};

const infoFieldHandlers = {
  info: (i) => {
    state.strategy.info[i.field] = i.value;
    // 「策略名称 / 版本」：只刷新标题与底栏提示，绝不重建面板 ——
    // 重建会打断中文输入法的候选框（change / 组字结束的补发也会走到这里），
    // 而且这两个输入框的落盘时机由 focusin / click 判定（见 main.js 的 markDirty / bindEvents）。
    if (i.field === 'name' || i.field === 'version') { renderHeaderStatus(); renderFooter(); return false; }
    if (!i.el.matches(':focus')) return true;
    return false;
  },
  pre: (i) => {
    const pa = state.strategy.info.preActions[Number(i.idx)];
    if (!pa) return false;
    // 角色搜索框：只更新这一行的角色选择框选项，不动模型、不重建面板
    // （不重建面板才不会打断输入法；搜索框自身也不再弹任何候选层）
    if (i.field === 'avatarSearch') {
      setPreSearch(i.idx, i.value);
      refreshPreAvatarSelect(i.el, i.idx);
      return false;
    }
    pa[i.field] = i.value;
    // 选中角色只更新模型，不重建面板（否则会打断旁边的搜索框与输入法）。
    // 顺手清空旁边的搜索框：搜索词的作用就是「把角色选择框缩小到几个候选」，
    // 选完就该恢复成全部角色，否则选择框会一直卡在筛选结果里。
    if (i.field === 'character') {
      setPreSearch(i.idx, '');
      const row = i.el && i.el.closest ? i.el.closest('.row') : null;
      const box = row && row.querySelector ? row.querySelector('[data-field="avatarSearch"]') : null;
      if (box) {
        box.value = '';
        // 搜索框已经清空：选择框的选项立刻恢复成全部角色（否则会一直卡在筛选结果里）
        refreshPreAvatarSelect(box, i.idx);
      }
      updateCommandFeedback(`pre:${i.idx}`, pa.cmd || '', 'pre');
      refreshLiveIssues();
      return false;
    }
    // 手输指令后立刻做一次输入内容检查：刷新本行反馈 + 右侧校验面板
    if (i.field === 'cmd') {
      updateCommandFeedback(`pre:${i.idx}`, pa.cmd || '', 'pre');
      refreshLiveIssues();
    }
    return false;
  },
};

/** 按该行角色搜索框里的内容重建旁边的角色下拉的选项（不重建面板，输入焦点与输入法都不受影响） */
function refreshPreAvatarSelect(input, idx) {
  if (!input || !input.getAttribute) return;
  const row = input.closest ? input.closest('.row') : null;
  const sel = row && row.querySelector ? row.querySelector('select[data-field="character"]') : null;
  if (!sel) return;
  const n = Number(idx);
  const pa = (state.strategy.info.preActions || [])[n];
  sel.innerHTML = avatarFilterOptions(input.value, pa ? (pa.character || '') : '', { pool: AVATARS.filter(a => !a.virtual), allLabel: '（不指定角色）' });
}
