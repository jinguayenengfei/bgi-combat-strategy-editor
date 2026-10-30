/* 核心：编号引擎、动作模型、priority 推导、指令解析、校验器 */

/* 动作类型 -> priority 分段的基准值（段 = [基准, 基准+9999]）。
 * 动作类型 0（战斗检查与标记）的编号只有 1~9，但它的段仍然是 0~9999，
 * 这样“次于战斗检查与标记”= 10000 正好等于“优先于开盾”，各段首尾相接不重叠。 */
const ACTION_CODE_BASE = { 0: 0, 1: 10000, 2: 20000, 3: 30000, 4: 40000, 5: 50000, 6: 60000, 7: 70000, 8: 80000, 9: 90000 };
const MAX_SLOT = 9;
/**
 * 动作类型 0（战斗检查与标记）只能用于「当前角色」，编号是「退化的 1 位尾数」：正常只会有 1~9。
 * 万一 9 个槽位都满了（例如「新建（含兜底动作）」以及后续手工添加），再往后分配会落到 index=10；
 * parseIndex 把 10~9999 判成「位数不足」并报错，所以这里单独给类型 0 留一个额外槽位：
 * 尾数取 10 → index 退化成 2 位数字（10），语义上仍然是「类型 0 的第 10 条」，
 * 校验面板会提示需要「按规则重排编号」。
 */
const MAX_SLOT_TYPE0 = 10;
/** 某个动作类型的尾数上限（类型 0 多留一个槽位，见 MAX_SLOT_TYPE0） */
function maxSlotOfType(type) { return Number(type) === 0 ? MAX_SLOT_TYPE0 : MAX_SLOT; }
/** 某个动作类型最多能有几条动作 */
function capacityOfType(type) { return Number(type) === 0 ? MAX_SLOT_TYPE0 : MAX_SLOT; }

/* ---------------- 命座要求（consRequirement） ----------------
 * BetterGI 的动作节点里没有任何能保存「这条动作要求角色几命」的字段，
 * 而 Newtonsoft.Json 默认忽略未知属性（MissingMemberHandling.Ignore），
 * 于是本编辑器把命座要求写进自定义字段 consRequirement，约定：
 *   0      —— 无命座要求（导出时省略该字段；导入时缺省也按 0 处理）；
 *   1~6    —— 「达到命座开启」：达到 x 命时这条动作改为执行（正数 = 模式是“开启”）；
 *   -1~-6  —— 「达到命座关闭」：达到 x 命时这条动作改为不执行（负数 = 模式是“关闭”）。
 *
 * 界面上编辑的是「模式（达到命座开启 / 达到命座关闭）+ 目标命座数 + 按达到x命设置动作启用/停用」：
 *   · consMode   —— 'none' | 'open' | 'close'
 *   · consTarget —— 目标命座数 1~6（'none' 时是 0）
 *   · consEnabled—— 勾选框：勾上 = 在编辑器里**视作角色已达到 x 命**，不勾 = 视作未达到 x 命；
 *                   再结合模式决定 x 命及以上这条动作是启用还是停用（true = 启用、false = 停用）。
 *
 * 三个信息分别落在两个地方，合起来是**一一对应**的，可以逐字还原：
 *   · consRequirement 的**符号** —— 「模式」（正 = 达到命座开启、负 = 达到命座关闭）、
 *     绝对值 —— 目标命座数；
 *   · expression 里那一段布尔字面量（wantConsValue → consExprText）—— 「启用 / 停用」的结果；
 *   · 勾选状态 = 视作角色达到目标命座（勾上 = 达到）。
 * 例：「达到命座关闭 + 3 命 + 勾选」= 视作 3 命 → 3 命及以上停用 → consRequirement = -3、expression 片段是 false；
 * 「达到命座关闭 + 3 命 + 不勾选」= 视作未达到 3 命 → 3 命以下仍然启用 → 也是 -3，但 expression 片段是 true。
 * 两种写法语义不同却共用同一个数值，靠 expression 里的布尔值区分。
 */
const CONS_MODES = ['none', 'open', 'close'];
const CONS_MAX = 6;

/** 这条动作是否设置了命座要求（模式不是「无命座要求」且目标命座数有效） */
function consHasRequirement(act) {
  return !!act && CONS_MODES.includes(act.consMode) && act.consMode !== 'none' && Number(act.consTarget) > 0;
}
/** 命座要求那一段的布尔值（true = 达到目标命座时这条动作被启用）；没有命座要求时返回 null */
function wantConsValue(act) {
  if (!consHasRequirement(act)) return null;
  // 勾选 = 视作达到 x 命：「达到命座开启 + 勾选」→ true（启用）；
  // 「达到命座关闭 + 勾选」→ false（停用）；不勾选时各自相反。
  const on = (act.consMode === 'open') === !!act.consEnabled;
  if (typeof CONSWANT_DEBUG !== 'undefined' && CONSWANT_DEBUG) console.log('[wantConsValue]', act.name, act.consMode, act.consTarget, act.consEnabled, '->', on);
  return on;
}
/** 「命座要求」那一段的表达式文本（true / false）；没有命座要求时返回 '' */
function consExprText(act) {
  const v = wantConsValue(act);
  return v === null ? '' : (v ? 'true' : 'false');
}
/** 写进 consRequirement 字段的数值（0 = 无需写这个字段）
 *  符号 = 模式（正数 = 达到命座开启、负数 = 达到命座关闭），绝对值 = 目标命座数；
 *  「启用 / 停用」由 expression 里那个布尔字面量表达（见 wantConsValue → consExprText）。 */
function consRequirementOf(act) {
  if (!consHasRequirement(act)) return 0;
  const x = Number(act.consTarget);
  return act.consMode === 'close' ? -x : x;
}
/**
 * 由 consRequirement 数值 + expression 里的布尔值还原「模式 + 目标命座数 + 启用/停用」三元组。
 * exprValue 是 expression 里那一段布尔字面量（true / false；没有那一段时按 true 处理）。
 */
function consEnabledFromExpr(mode, exprValue) {
  return (mode === 'open') === (exprValue === undefined || exprValue === null ? true : !!exprValue);
}
/** 由 consRequirement 数值还原「模式 + 目标命座数」；没有可用数值时清空命座要求 */
function applyConsRequirement(act, value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n === 0 || Math.abs(n) > CONS_MAX) {
    act.consMode = 'none';
    act.consTarget = 0;
    act.consEnabled = false;
    act.consRequirement = 0;
    return;
  }
  act.consTarget = Math.abs(n);
  act.consMode = n > 0 ? 'open' : 'close';
  // 「启用 / 停用」要靠 expression 里的布尔值还原（导入 / 读草稿时由调用方再写一次）。
  // 这里先给一个「不改变表达式」的缺省值：这样单独改模式 / 命座数时表达式不会被悄悄翻面。
  act.consEnabled = consEnabledFromExpr(act.consMode, true);
  act.consRequirement = consRequirementOf(act);
}
/** 设置这条动作在目标命座之上是启用（true）还是停用（false） */
function setConsEnabled(act, want) { act.consEnabled = !!want; }
/** 命座要求的中文说明（模式 + 目标命座数 + 启用/停用） */
function consDescribe(act) {
  if (!consHasRequirement(act)) return '无命座要求';
  const x = Number(act.consTarget);
  const on = wantConsValue(act);
  return `达到 ${x} 命${act.consMode === 'close' ? '关闭' : '开启'}：${x} 命及以上${on ? '启用' : '停用'}，${x - 1} 命及以下${on ? '停用' : '启用'}`;
}

/* ---- 高命座手法的勾选联动 ----
 * 「按达到x命设置动作启用/停用」的勾选状态遵循「有高命必有低命，没有低命必没有高命」：
 *   勾选某个目标命座 x → 目标命座不高于 x 的同类一起勾上；
 *   取消勾选某个目标命座 x → 目标命座不低于 x 的同类一起取消。
 *
 * 例：A、B 选「达到命座开启」，C、D 选「达到命座关闭」；A、C 是三命，B 是一命，D 是六命。
 * 勾选 A（三命）→ B（一命，≤3）与 C（三命，≤3）一起勾上，D（六命，>3）不动；
 * 取消勾选 A → C（三命，≥3）一起取消，B（一命，<3）不动。
 * 于是「已勾选的目标命座集合」恒为向下闭合的 {1..k}，
 * 它正好等价于「这个角色当前按几命来设置动作开关」。
 */

/** 这条动作「按达到x命设置动作启用/停用」当前是否勾选 */
function consActiveState(act) {
  return consHasRequirement(act) && !!act.consEnabled;
}

/**
 * 用户勾选 / 取消勾选某条动作的「按达到x命设置动作启用/停用」之后，按联动规则同步同一角色的其他动作。
 * 返回被改动过的动作数组（含传入的那条）。
 */
function syncConsEnabled(act, checked) {
  if (!consHasRequirement(act)) return [];
  const x = Number(act.consTarget);
  const changed = [];
  if (!!act.consEnabled !== !!checked) { act.consEnabled = !!checked; changed.push(act); }
  for (const o of state.strategy.actions) {
    if (o.id === act.id) continue;
    if (String(o.character || '') !== String(act.character || '')) continue;
    if (!consHasRequirement(o)) continue;
    const y = Number(o.consTarget);
    // 勾选：目标命座不高于 x 的一起勾上；取消勾选：目标命座不低于 x 的一起取消。
    // 注意这里只能用 true / false 判断，不要把 null 当「不处理」的哨兵：
    // `false === null` 是 false，会把「要取消勾选」误判成「照常处理」。
    if (checked) {
      if (o.consEnabled) continue;
      if (y > x) continue;
      o.consEnabled = true;
    } else {
      if (!o.consEnabled) continue;
      if (y < x) continue;
      o.consEnabled = false;
    }
    changed.push(o);
  }
  return changed;
}

/** 某个角色「有命座要求的动作」用到的全部目标命座数（升序去重） */
function consTargetsFor(actions, character) {
  const set = new Set();
  for (const a of (actions || [])) {
    if (String(a.character || '') !== String(character || '')) continue;
    if (!consHasRequirement(a)) continue;
    set.add(Number(a.consTarget));
  }
  return [...set].sort((p, q) => p - q);
}

/**
 * 把某角色「视作达到几命」设置成 k（0 = 不启用任何高命手法）：
 * 目标命座不高于 k 的动作勾选（视作达到），高于 k 的取消勾选（视作未达到）。
 */
function applyConsLevel(actions, character, k) {
  const level = Number(k) || 0;
  const changed = [];
  for (const a of (actions || [])) {
    if (String(a.character || '') !== String(character || '')) continue;
    if (!consHasRequirement(a)) continue;
    const want = Number(a.consTarget) <= level;
    if (!!a.consEnabled === want) continue;
    a.consEnabled = want;
    changed.push(a);
  }
  return changed;
}

/**
 * 把某角色的勾选状态规整成「向下闭合」的一致状态：
 * 若最大的已勾选目标命座是 k，则 ≤k 的目标命座一律勾上、>k 的一律取消。
 * 导入 / 载入草稿时用它兜住「expression 里的布尔值与 consRequirement 换算出的
 * 勾选状态在同一个角色内互相矛盾」的情况（冲突时按「同命座有一个选了就都统一勾上，
 * 低命座没勾选高命座也取消勾选」处理）。返回被改动过的动作数组。
 */
function normalizeConsChecks(actions, character) {
  const list = (actions || []).filter(a => String(a.character || '') === String(character || '') && consHasRequirement(a));
  if (!list.length) return [];
  const targets = [...new Set(list.map(a => Number(a.consTarget)))].sort((p, q) => p - q);
  let level = 0;
  for (const t of targets) {
    const any = list.some(a => Number(a.consTarget) === t && !!a.consEnabled);
    if (any) level = t;
  }
  const changed = [];
  for (const a of list) {
    const want = Number(a.consTarget) <= level;
    if (!!a.consEnabled === want) continue;
    a.consEnabled = want;
    changed.push(a);
  }
  return changed;
}

/** 对全部角色做一次勾选状态规整（导入 / 载入草稿之后调用） */
function normalizeAllConsChecks(actions) {
  const chars = new Set((actions || []).map(a => String(a.character || '')));
  const changed = [];
  for (const ch of chars) changed.push(...normalizeConsChecks(actions, ch));
  return changed;
}

/** 需要出现在「快捷开关高命座手法」弹窗里的角色（有动作设置了命座要求的角色） */
function consCharacters(actions) {
  const out = [];
  const seen = new Set();
  for (const a of (actions || [])) {
    if (!consHasRequirement(a)) continue;
    const ch = String(a.character || '');
    if (seen.has(ch)) continue;
    seen.add(ch);
    out.push(ch);
  }
  return out;
}

/* ---------------- 角色表 ---------------- */

const AVATAR_BY_NAME = new Map(AVATARS.filter(a => !a.virtual).map(a => [a.name, a]));
const AVATAR_BY_INDEX = new Map(AVATARS.map(a => [a.code * 100 + a.seq, a]));
const ELEMENT_BY_CODE = new Map(ELEMENTS.map(e => [e.code, e]));

function getAvatar(name) { return AVATAR_BY_NAME.get(name) || null; }
function getElement(code) { return ELEMENT_BY_CODE.get(code) || ELEMENT_BY_CODE.get(0); }
function elementLabel(code) { const e = getElement(code); return e.code === 0 ? '元素未定' : e.name + '元素'; }
/** 检索次序键：元素号 * 100 + 角色编号 */
function avatarOrderKey(av) { return av.code * 100 + av.seq; }
function avatarCodeLabel(av) { return `${av.code}${String(av.seq).padStart(2, '0')}`; }

/* ---------------- 编号引擎 ---------------- */

function isCurrentAvatarName(name) { return !name; }

/** 生成动作 index */
function makeIndex(type, code, seq, slot) {
  return type * 10000 + code * 1000 + seq * 10 + slot;
}

/** 解析 index 的结构，返回 { ok, type, code, seq, slot, reason }。
 *  注意：动作类型是十进制首位（1 位），元素是第 2 位，角色是第 3~4 位，尾数是第 5 位。
 *  因此 index = 类型*10000 + 元素*1000 + 角色*10 + 尾数；类型 0 时只占尾数（1 位）。
 */
function parseIndex(index) {
  if (!Number.isInteger(index) || index < 0) return { ok: false, reason: 'index 必须是非负整数' };
  if (index > 99999) return { ok: false, reason: 'index 不应超过 99999（动作类型 9 / 元素 9 已超出元素表范围）' };
  // 动作类型 0（战斗检查与标记）只用于「当前角色」，编号只剩尾数 1 位：index = 1~9
  // （它的首位数字同时也是尾数，因此无法与「类型 9」区分；按规则约定 10 以下一律视为类型 0）
  if (index < 10) {
    if (index < 1) return { ok: false, type: 0, reason: `动作类型 0 的 index 只能是 1~${MAX_SLOT}（战斗检查与标记只用于「当前角色」；9 个槽位都满时编辑器会临时多给一个尾数 ${MAX_SLOT_TYPE0}，此时需要「按规则重排编号」）` };
    return { ok: true, type: 0, code: 0, seq: 0, slot: index };
  }
  if (index < 10000) {
    return { ok: false, reason: `index=${index} 位数不足：动作类型 0 以外的动作编号必须是 5 位数（类型+元素+角色2位+尾数），例如 11111` };
  }
  const s = String(index);
  const type = Number(s[0]);
  const rest = s.slice(1).padStart(4, '0');
  const code = Number(rest[0]);
  const seq = Number(rest.slice(1, 3));
  const slot = Number(rest[3]);
  if (code > 7) return { ok: false, type, code, seq, slot, reason: `第 2 位（元素类型）只能是 0~7，当前 index 的第 2 位是 ${code}` };
  if (slot === 0) return { ok: false, type, code, seq, slot, reason: '第 5 位不能为 0（0 是预留给「额外优先级插入位」的，只允许出现在 morePriorities 的 priority 里）' };
  if (code === 0 && seq === 0) return { ok: true, type, code, seq, slot }; // 当前角色
  const av = AVATAR_BY_INDEX.get(code * 100 + seq);
  if (!av) return { ok: false, type, code, seq, slot, reason: `编号 ${code}${String(seq).padStart(2, '0')} 不对应任何角色` };
  return { ok: true, type, code, seq, slot, avatar: av };
}

function indexDisplay(index) {
  const pi = parseIndex(index);
  if (!pi.ok && pi.type === undefined) return '编号不符合规则';
  return `类型${pi.type} · 元素${pi.code} · 角色${String(pi.seq).padStart(2, '0')} · 尾${pi.slot}`;
}

/* ---------------- 动作模型 ---------------- */

let _idSeq = 1;
function newId() { return 'a' + (_idSeq++); }

function createAction(opts = {}) {
  const type = opts.type ?? 1;
  const character = type === 0 ? '' : (opts.character ?? '');
  const a = {
    id: newId(),
    name: opts.name || '',
    character,
    type,
    action: opts.action ?? '',
    ensureCast: opts.ensureCast ?? (type === 1),
    conditionText: opts.conditionText ?? '',
    conditionMode: 'all',
    conditionCacheFor: null,
    // 队友条件：include/exclude 允许同一个角色出现多次（多个「角色组合」里出现同一角色很正常），
    // includeOps / excludeOps 是「项与项之间」的运算符（长度 = 项数 - 1），mode 是未单独指定时的默认值。
    // 新增角色项前的运算符默认用「或」。
    teammates: { include: [], includeOps: [], exclude: [], excludeOps: [], mode: opts.teammatesMode ?? 'or', autoExclude: [], autoExcludeSameType: opts.type === 0 ? false : true },
    morePriorities: [],
    slot: 0,
    index: 0,
    manualIndex: false,
    enabled: true,
    // tags：专用于保存用户对该动作节点的注释。BetterGI 的动作节点里没有这个属性，
    // 但 Newtonsoft.Json 默认忽略未知属性（MissingMemberHandling.Ignore），所以可以安全地用它存注释。
    tags: opts.tags ?? '',
    // 命座要求（consRequirement）：见文件上方 consRequirement 的说明。
    // 界面上编辑的是「模式 + 目标命座数 + 启用/停用」三元组，consRequirement 由它换算出来。
    consMode: opts.consMode ?? 'none',
    consTarget: Number.isInteger(opts.consTarget) ? opts.consTarget : 0,
    consEnabled: !!opts.consEnabled,
    consRequirement: 0,
  };
  // 调用方可以直接给 consRequirement 数值，也可以给「模式 + 目标命座数 + 勾选」三元组；
  // 给了数值就以数值为准（导入时走这条路），否则由三元组换算。
  if (Number.isInteger(opts.consRequirement) && opts.consRequirement !== 0) {
    applyConsRequirement(a, opts.consRequirement);
  } else {
    a.consRequirement = consRequirementOf(a);
  }
  return a;
}

function setConditionText(act, text) {
  act.conditionText = text ?? '';
  act.conditionCacheFor = null;
  const parsed = condParse(act.conditionText, allActionNames(state.strategy.actions));
  act.conditionAst = parsed.error ? null : parsed.ast;
  return parsed;
}

/** 条件构造器 -> 表达式文本 */
function buildCondExpr(rows, mode) {
  const parts = (rows || []).map(r => {
    const t = (r.text || '').trim();
    if (!t) return null;
    return t;
  }).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];
  const op = mode === 'any' ? ' || ' : ' && ';
  const needParen = (s) => (mode === 'all' ? /\|\|/.test(s) : /&&/.test(s));
  return parts.map(p => (needParen(p) ? `(${p})` : p)).join(op);
}

/** 表达式文本 -> 条件构造器行 */
function parseCondRows(text) {
  const parsed = condParse(text || '', allActionNames(state.strategy.actions));
  if (parsed.error) return null;
  const rows = [];
  let mode = 'all';
  const root = parsed.ast;
  if (!root) return { rows: [], mode: 'all', constant: false };
  if (root.type === 'binary' && (root.op === '&&' || root.op === '||')) {
    mode = root.op === '&&' ? 'all' : 'any';
    const stack = [root];
    while (stack.length) {
      const n = stack.shift();
      if (n.type === 'binary' && n.op === root.op) { stack.unshift(n.left); stack.unshift(n.right); }
      else rows.push({ text: condToText(n), id: newId() });
    }
  } else if (root.type === 'bool') {
    return { rows: [], mode: 'all', constant: true, ast: root };
  } else {
    rows.push({ text: condToText(root), id: newId() });
  }
  return { rows, mode, ast: root };
}

function allActionNames(actions) {
  return (actions || []).map(a => a.name).filter(n => n && n.trim());
}
function knownIndexes(actions) {
  return new Set((actions || []).map(a => a.index));
}

/**
 * 找出「哪些动作的条件表达式里引用了目标动作」，用于动作卡片里「编号（自动）」下面那行注释。
 * 覆盖入参为动作的条件函数（since / count / last-exec）的两种写法：
 *   · 数字入参等于目标动作的 index；
 *   · 名称入参（标识符）等于目标动作的 name（大小写不敏感，与 BetterGI 的匹配方式一致）。
 * 主条件与全部其他触发条件都会检查。返回 [{ action, via: 'index'|'name' }]。
 */
function findActionReferrers(actions, target) {
  const out = [];
  if (!target) return out;
  const name = String(target.name || '').toLowerCase();
  for (const a of (actions || [])) {
    if (a.id === target.id) continue;
    const texts = [a.conditionText || '', ...(a.morePriorities || []).map(mp => mp.text || '')];
    let via = null;
    for (const t of texts) {
      if (!String(t).trim()) continue;
      const p = condParse(t, allActionNames(actions));
      if (p.error || !p.ast) continue;
      const refs = condCollectRefs(p.ast, { indexes: [], names: [] });
      if (refs.indexes.some(n => n && n.value === target.index)) { via = 'index'; break; }
      if (name && refs.names.some(n => String(n).toLowerCase() === name)) { via = 'name'; break; }
    }
    if (via) out.push({ action: a, via });
  }
  return out;
}

/** 角色下的动作分组（按类型） */
function actionsOf(actions, character) {
  return actions.filter(a => (a.character || '') === (character || ''));
}
function slotTaken(actions, character, type, slot, exceptId) {
  return actions.some(a => (a.character || '') === (character || '') && a.type === type && a.slot === slot && a.id !== exceptId);
}
function nextFreeSlot(actions, character, type, exceptId) {
  for (let s = 1; s <= maxSlotOfType(type); s++) if (!slotTaken(actions, character, type, s, exceptId)) return s;
  return 0;
}
function countOfType(actions, character, type) {
  return actions.filter(a => (a.character || '') === (character || '') && a.type === type).length;
}

/** 重算所有动作的 index（type/character/slot 已确定） */
function recomputeIndexes(actions) {
  for (const a of actions) {
    if (a.manualIndex && Number.isInteger(a.index)) continue;
    const av = a.character ? getAvatar(a.character) : { code: 0, seq: 0 };
    const code = av ? av.code : 0;
    const seq = av ? av.seq : 0;
    a.index = makeIndex(a.type, code, seq, a.slot || 1);
  }
}

/** 为某角色/类型分配一个可用的 slot，失败返回 0 */
function allocateSlot(actions, character, type, exceptId) {
  return nextFreeSlot(actions, character, type, exceptId);
}

/**
 * 新增动作：容量检查（同角色同类型最多 9 条）
 * 返回 { ok, action, error }
 */
function addAction(character, type, opts = {}) {
  const actions = state.strategy.actions;
  if (type === 0 && character) return { ok: false, error: '动作类型 0（战斗检查与标记）只能添加到「当前角色」下' };
  if (countOfType(actions, character, type) >= capacityOfType(type)) {
    return {
      ok: false,
      error: `「${character || '当前角色'}」的「${actionTypeName(type)}」动作已达上限 ${capacityOfType(type)} 条，无法继续新增。请删除该类型下的某条动作，或把某条动作改成别的动作类型。`
    };
  }
  const slot = allocateSlot(actions, character, type);
  if (!slot) return { ok: false, error: `「${character || '当前角色'}」的「${actionTypeName(type)}」动作序号 1~${capacityOfType(type)} 已全部被占用` };
  const act = createAction({ ...opts, type, character });
  act.slot = slot;
  recomputeIndexes([act]);
  actions.push(act);
  return { ok: true, action: act };
}

/** 删除动作 */
function removeAction(id) {
  const actions = state.strategy.actions;
  const i = actions.findIndex(a => a.id === id);
  if (i >= 0) actions.splice(i, 1);
}

/** 切换动作类型：需要重新分配 slot */
function changeActionType(id, newType) {
  const actions = state.strategy.actions;
  const act = actions.find(a => a.id === id);
  if (!act) return { ok: false, error: '动作不存在' };
  if (newType === act.type) return { ok: true };
  if (newType === 0 && act.character) {
    return { ok: false, error: '动作类型 0（战斗检查与标记）只能用于「当前角色」。请先把该动作的角色改为「当前角色」。' };
  }
  if (countOfType(actions, act.character, newType) >= capacityOfType(newType)) {
    return {
      ok: false,
      error: `「${act.character || '当前角色'}」的「${actionTypeName(newType)}」动作已达上限 ${capacityOfType(newType)} 条，无法转入。请先删除该类型下的某条动作，或改用其他动作类型。`
    };
  }
  const slot = allocateSlot(actions, act.character, newType);
  if (!slot) return { ok: false, error: `「${actionTypeName(newType)}」的序号 1~${capacityOfType(newType)} 已全部被占用，无法转入` };
  act.type = newType;
  act.slot = slot;
  act.manualIndex = false;
  if (newType === 1 && act.ensureCast === false) act.ensureCast = true; // 开盾默认勾选
  recomputeIndexes(actions);
  return { ok: true };
}

/** 同类型内与相邻动作交换顺序（交换第 5 位） */
function swapActionOrder(id, dir) {
  const actions = state.strategy.actions;
  const act = actions.find(a => a.id === id);
  if (!act) return { ok: false, error: '动作不存在' };
  const siblings = actions.filter(a => (a.character || '') === (act.character || '') && a.type === act.type)
    .sort((x, y) => (x.index - y.index) || (actions.indexOf(x) - actions.indexOf(y)));
  const i = siblings.findIndex(a => a.id === id);
  const j = i + (dir < 0 ? -1 : 1);
  if (j < 0 || j >= siblings.length) {
    return { ok: false, error: dir < 0 ? '已经是该类型中 index 最小的动作，无法再上移' : '已经是该类型中 index 最大的动作，无法再下移' };
  }
  const other = siblings[j];
  const s1 = act.slot, s2 = other.slot;
  act.slot = s2; other.slot = s1;
  act.manualIndex = false; other.manualIndex = false;
  act.indexViolation = false; other.indexViolation = false;
  recomputeIndexes(actions);
  // 保证声明顺序与 index 顺序一致，避免 priority 并列时先检查错的动作
  const i1 = actions.indexOf(act), i2 = actions.indexOf(other);
  if (i1 >= 0 && i2 >= 0) {
    const lo = Math.min(i1, i2), hi = Math.max(i1, i2);
    const first = dir > 0 ? other : act;
    const second = dir > 0 ? act : other;
    actions.splice(lo, 2, first, second);
  }
  return { ok: true };
}

/** 把一个动作移动到指定 slot（0 表示插入位） */
function moveActionToSlot(id, slot) {
  const actions = state.strategy.actions;
  const act = actions.find(a => a.id === id);
  if (!act) return { ok: false, error: '动作不存在' };
  if (slot < 0 || slot > MAX_SLOT) return { ok: false, error: '尾数只能是 0~9' };
  if (slot !== 0 && slotTaken(actions, act.character, act.type, slot, act.id)) {
    return { ok: false, error: `尾数 ${slot} 已被同角色同类型的另一条动作占用，请改用其他尾数或先移走那条动作` };
  }
  act.slot = slot;
  act.manualIndex = false;
  recomputeIndexes(actions);
  return { ok: true };
}

/* ---------------- priority 推导 ---------------- */

/**
 * 判定优先级的取值范围（按十进制错位定位，与 index 结构一致）
 * scope: { type, element, character }
 * 返回 { min, max, lo, hi, label, empty }
 */
function priorityRange(scope) {
  const t = scope.type;
  if (t === null || t === undefined || t === '') return null;
  const base = ACTION_CODE_BASE[t];
  if (base === undefined) return null;
  // 动作类型 0（战斗检查与标记）是一整段，不能再按元素/角色细分
  if (t === 0 && scope.element !== null && scope.element !== undefined && scope.element !== '') return null;
  let lo = base, hi = base + 9999, label = actionTypeName(t);
  if (scope.element !== null && scope.element !== undefined && scope.element !== '') {
    const e = Number(scope.element);
    if (e < 0 || e > 7) return null;
    lo = base + e * 1000;
    hi = lo + 999;
    label += ' / ' + elementLabel(e);
    if (scope.character) {
      const av = getAvatar(scope.character);
      if (!av) return null;
      if (av.code !== e) return null;
      const cLo = base + e * 1000 + av.seq * 10;
      lo = cLo; hi = cLo + 9;
      label += ' / ' + scope.character;
    }
  }
  return { lo, hi, min: lo, max: hi, label };
}

/** 按 scope 生成 [优先于, 次于) 的数值区间，用于各种“优先/次于某类动作”的选项 */
function prioritySpan(scope) {
  const r = priorityRange(scope);
  if (!r) return null;
  return { before: r.lo, after: r.hi + 1, label: r.label, lo: r.lo, hi: r.hi };
}

/** 计算 priority：before=段内最小值，after=段内最大值+1；段内无动作则用段边界 */
function computePriority(scope, cmp, actions) {
  const r = priorityRange(scope);
  if (!r) return null;
  const inRange = (actions || state.strategy.actions).filter(a => a.index >= r.lo && a.index <= r.hi).map(a => a.index);
  const empty = inRange.length === 0;
  if (cmp === 'before') return { priority: r.lo, empty, range: r };
  return { priority: r.hi + 1, empty, range: r };
}

/** 生成一段可读的 scope 描述 */
function scopeLabel(scope) {
  const r = priorityRange(scope);
  if (!r) return '（未完整选择）';
  return r.label;
}

/**
 * 找出与给定 priority 数值完全相等的所有「判定顺序 + 判定范围」候选，用于导入/读草稿时把数值还原成选择。
 * 同一个数值往往既能解释成「优先于某段」也能解释成「次于上一段」（例如 10000 = 优先于开盾 = 次于战斗检查与标记），
 * 按需求「优先选次于」；同为同一判定顺序时，判定范围越具体越优先。
 */
function priorityScopeCandidates(p) {
  const out = [];
  if (!Number.isInteger(p)) return out;
  const add = (level, scope, cmp) => out.push({ level, scope, cmp });
  for (let t = 0; t <= 9; t++) {
    const base = ACTION_CODE_BASE[t];
    if (p === base) add(3, { type: t, element: '', character: '' }, 'before');
    if (p === base + 10000) add(3, { type: t, element: '', character: '' }, 'after');
    if (t === 0) continue;                    // 类型 0 是一整段，不能再按元素/角色细分
    for (let e = 1; e <= 7; e++) {
      const lo = base + e * 1000;
      if (p === lo) add(2, { type: t, element: e, character: '' }, 'before');
      if (p === lo + 1000) add(2, { type: t, element: e, character: '' }, 'after');
    }
  }
  for (const av of AVATARS) {
    if (av.virtual || !av.code || av.code > 7) continue;
    for (let t = 1; t <= 9; t++) {
      const lo = ACTION_CODE_BASE[t] + av.code * 1000 + av.seq * 10;
      if (p === lo) add(1, { type: t, element: av.code, character: av.name }, 'before');
      if (p === lo + 10) add(1, { type: t, element: av.code, character: av.name }, 'after');
    }
  }
  out.sort((a, b) => (a.cmp === b.cmp ? a.level - b.level : (a.cmp === 'after' ? -1 : 1)));
  return out;
}

/** 把 priority 数值还原成选择；还原不了时返回 null（保留手工数值） */
function priorityScopeFromNumber(p) {
  const cand = priorityScopeCandidates(p)[0];
  if (!cand) return null;
  return { scope: cand.scope, cmp: cand.cmp };
}

function actionTypeName(t) {
  const x = ACTION_TYPES.find(a => a.code === t);
  return x ? x.name : `类型${t}`;
}
function actionTypeShort(t) {
  const x = ACTION_TYPES.find(a => a.code === t);
  return x ? x.short : `T${t}`;
}

/* ---------------- 指令串解析与校验 ---------------- */

/** 按顶层逗号切分指令串（自动合并括号内的逗号） */
function splitCommandString(str) {
  const out = [];
  let buf = '';
  let depth = 0;
  for (const ch of str) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth <= 0) { out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  out.push(buf);
  return out.map(s => s.trim()).filter(s => s !== '');
}

/**
 * 解析单条指令 token：{ raw, method, args }
 * 返回 { text, errors: [], method }
 */
function parseCommand(token, opts = {}) {
  const raw = token.trim();
  const errors = [];
  if (raw === '') return { raw, method: null, errors: ['空指令'] };
  if (/[（）]/.test(raw)) errors.push('指令中出现了中文括号，必须使用半角 ( )');
  if (/[，；]/.test(raw)) errors.push('指令中出现了中文逗号/分号，必须使用半角 , 分隔');
  const open = (raw.match(/\(/g) || []).length;
  const close = (raw.match(/\)/g) || []).length;
  if (open !== close) errors.push('括号不配对');
  if (open > 1) errors.push('一条指令中出现了多个 (（请检查是否漏了逗号）');

  const m = raw.match(/^([^()]*?)\s*(?:\((.*)\))?$/);
  const name = (m && m[1] ? m[1] : raw).trim();
  const argsRaw = m && m[2] !== undefined ? m[2] : null;
  const method = METHOD_BY_ALIAS.get(name) || null;
  if (!method) {
    errors.push(`未知指令「${name}」：BetterGI 会抛出「战斗策略脚本中出现未知的方法」。注意别名区分大小写（'普攻' 合法，'attack' 合法，'E' 不合法，应为 'e'）`);
    return { raw, method: null, name, args: [], errors };
  }
  if (method.cat === '不可用') errors.push(`指令「${name}」不可用：${method.cn}`);

  const args = argsRaw === null || argsRaw.trim() === '' ? [] : argsRaw.split(',').map(s => s.trim());
  if (argsRaw !== null && argsRaw.trim() === '' && method.argKind !== 'none' && method.argKind !== 'flagset') {
    // 允许空括号，例如 q()，等价无参
  }

  const needNum = (v, label, { integer = false, positive = false } = {}) => {
    if (v === '' || v === undefined) return `${label}不能为空`;
    if (!/^-?\d+(\.\d+)?$/.test(v)) return `${label}必须是数字（当前为「${v}」）`;
    if (integer && !/^-?\d+$/.test(v)) return `${label}必须是整数（当前为「${v}」）`;
    if (positive && Number(v) <= 0) return `${label}必须大于 0`;
    return null;
  };

  switch (method.argKind) {
    case 'none': {
      const max = method.maxArgs ?? 0;
      if (args.length > max) errors.push(`指令 ${method.canonical} 最多接受 ${max} 个参数，当前给了 ${args.length} 个`);
      if (max >= 1 && args.length === 1) { const e = needNum(args[0], '参数'); if (e) errors.push(e); }
      break;
    }
    case 'seconds': {
      if (args.length > 1) errors.push(`指令 ${method.canonical} 最多接受 1 个参数（秒数）`);
      if (method.required && args.length === 0) errors.push(`指令 ${method.canonical} 必须带一个秒数参数，例如 ${method.canonical}(0.2)`);
      if (args.length === 1) { const e = needNum(args[0], '秒数', { positive: method.canonical === 'walk' }); if (e) errors.push(e); }
      break;
    }
    case 'flagset': {
      for (const a of args) if (!(method.flags || []).includes(a)) errors.push(`指令 ${method.canonical} 不支持参数「${a}」，可用参数：${(method.flags || []).join(' / ')}`);
      break;
    }
    case 'walk': {
      if (args.length !== 2) errors.push('walk 必须有两个参数：方向 + 秒数，例如 walk(s,0.2)');
      else {
        if (!['w', 'a', 's', 'd'].includes(args[0])) errors.push(`walk 的方向只能是 w / a / s / d，当前为「${args[0]}」`);
        const e = needNum(args[1], '行走时间', { positive: true }); if (e) errors.push(e);
      }
      break;
    }
    case 'twodouble': {
      if (args.length !== 2) errors.push('moveby 必须有两个参数：横向像素 + 纵向像素，例如 moveby(100,100)');
      else { const a = needNum(args[0], '横向像素', { integer: true }); if (a) errors.push(a); const b = needNum(args[1], '纵向像素', { integer: true }); if (b) errors.push(b); }
      break;
    }
    case 'int': {
      if (args.length !== 1) errors.push('scroll 必须有一个整数参数，例如 scroll(10) 或 scroll(-1)');
      else { const e = needNum(args[0], '滚动格数', { integer: true }); if (e) errors.push(e); }
      break;
    }
    case 'mouse': {
      if (args.length > 1) errors.push(`${method.canonical} 最多一个参数（left / right / middle）`);
      if (args.length === 1 && !['left', 'right', 'middle'].includes(args[0])) errors.push(`${method.canonical} 的参数只能是 left / right / middle（小写），当前为「${args[0]}」`);
      break;
    }
    case 'key': {
      if (args.length !== 1) errors.push(`${method.canonical} 必须有一个按键参数，例如 ${method.canonical}(VK_E)`);
      else if (!VK_SET.has(args[0].toUpperCase())) errors.push(`「${args[0]}」不是合法的虚拟键名。可用形如 VK_E / E / VK_SPACE 的写法（BetterGI 内部会转大写并补 VK_ 前缀）`);
      if (args.length === 1 && /^VK_[LRMX]BUTTON/i.test(args[0]) && args[0] !== args[0].toUpperCase()) {
        errors.push(`鼠标键必须写全大写（如 VK_LBUTTON）：BetterGI 内部 switch 区分大小写，写错会静默退化成普通键盘按键`);
      }
      break;
    }
    default: break;
  }

  if (args.length === 1 && args[0] === '' && !['none'].includes(method.argKind)) errors.push('参数不能为空');
  return { raw, method, name, args, errors };
}

/** 指令串里的按键名归一化（BetterGI 内部会把参数转大写并补 VK_ 前缀） */
function normVkName(a) {
  const s = String(a === undefined || a === null ? '' : a).trim();
  return s ? s.toUpperCase().replace(/^VK_/, '') : '';
}

/**
 * 找出「按下了却没有松开」的按键：同一条指令串里出现了 keydown(某按键) 却没有对应的 keyup(同一按键)。
 * 这种残留会让那个按键一直被按住（例如一直按着 e，之后连普攻都点不出来），所以只提示、不阻止导出。
 */
function findUnpairedKeydowns(parts) {
  const held = new Map();     // 归一化按键名 -> 原始的 keydown 指令原文
  const order = [];           // 保持出现顺序，提示更接近阅读顺序
  const released = new Set();
  for (const p of parts || []) {
    if (!p || !p.method) continue;
    const canon = p.method.canonical;
    if (canon !== 'keydown' && canon !== 'keyup') continue;
    const key = normVkName(p.args && p.args[0]);
    if (!key) continue;
    if (canon === 'keydown') {
      if (!held.has(key)) order.push(key);
      held.set(key, p.raw);
    } else {
      held.delete(key);
      released.add(key);
    }
  }
  return order.filter(k => held.has(k)).map(k => ({ key: k, raw: held.get(k), released: released.has(k) }));
}

/** 解析整条指令串。
 *  opts: { skipEmptyWarning: true } = 不报「指令串为空」的警告。
 *  校验器用它来处理「当前角色 + 动作类型 0（战斗检查与标记）」这一种情况：
 *  那种动作可以只写触发条件、不写任何指令（指令串与触发条件**同时**为空才提示）。 */
function parseActionString(str, opts) {
  const o = opts || {};
  const tokens = splitCommandString(str || '');
  const parts = tokens.map(t => parseCommand(t));
  const errors = [];
  const warnings = [];
  for (const p of parts) for (const e of p.errors) errors.push(`指令「${p.raw}」：${e}`);
  if (/[|]/.test(str || '')) errors.push('指令串中出现了 | 分隔符：JSON 策略不支持（只有 .txt 策略和 preActions 才支持）');
  if (/[;]/.test(str || '')) errors.push('指令串中出现了 ; 分号：JSON 策略不支持，请改用半角逗号');
  if (/（|）/.test(str || '')) errors.push('指令串中出现了中文括号，必须使用半角 ( )');
  if (tokenHasRound(parts)) errors.push('指令串中出现了 round(...)：在 JSON 策略中它是空操作指令，不起回合分组作用');
  for (const u of findUnpairedKeydowns(parts)) {
    warnings.push(`指令「${u.raw}」按下了按键「${u.key}」，但整条指令串里没有对同一个按键的 keyup（${u.released ? '它只在松开别的按键时被顺带松开过' : '这条指令串里根本没出现松开它的指令'}）：这个按键可能会被一直按住，导致后续按键/普攻等操作失灵。请补一条 keyup(${u.key})，或改用「长按后松开按键」这类成对的写法`);
  }
  if (parts.length === 0 && !o.skipEmptyWarning) warnings.push('指令串为空：该动作执行时不会有任何操作');
  return { parts, errors, warnings };
}

/**
 * 「当前角色 + 动作类型 0（战斗检查与标记）」的空指令特例。
 * 这类动作常被用来“只做一次判定/标记”（条件成立就按优先级顺序往下走），
 * 可以只写触发条件、不写任何指令，所以这时不提示「指令串为空」；
 * 只有指令串与触发条件**同时**为空（既没内容也没条件，纯占位）才提示。
 */
function isMarkerOnlyAction(a) {
  if (!a || a.type !== 0 || a.character) return false;
  if (String(a.action || '').trim() !== '') return false;
  return String(a.conditionText || '').trim() !== '';
}

function tokenHasRound(parts) {
  return parts.some(p => p.method && p.method.canonical === 'round');
}

/** 首个指令是否触发切人 */
function firstSwitchInfo(parts) {
  const first = parts[0];
  if (!first || !first.method) return { canSwitch: false, reason: '首个指令无法解析' };
  if (NO_SWITCH.has(first.method.canonical)) return { canSwitch: false, reason: `首个指令「${first.method.canonical}」属于宏/等待类指令，不会触发切人` };
  if (SWITCH_TRIGGERING.has(first.method.canonical)) return { canSwitch: true, method: first.method.canonical };
  return { canSwitch: false, reason: `首个指令「${first.method.canonical}」不在切人指令名单内` };
}

/** 指令串是否包含 e 技能相关指令（供 ensureCast 检查） */
function hasESkill(parts) {
  return parts.some(p => {
    if (!p.method) return false;
    if (p.method.canonical === 'e') return true;
    if (['keydown', 'keyup', 'keypress'].includes(p.method.canonical)) {
      return (p.args[0] || '').toUpperCase().replace(/^VK_/, '') === 'E';
    }
    return false;
  });
}

/* ---------------- 条件表达式组装 ----------------
 * 组装规则（与拆分规则一一对应，见 README）：
 *   1) 没有任何队友条件 → 触发条件原样写入 expression；
 *   2) 有队友条件 → 一律写成「(触发条件) && (队友条件)」，触发条件为空时用 true 占位。
 * 队友条件本身分三种结构：
 *   a) 只有必要队友：  (必要队友表达式)
 *   b) 还有排除队友：  (必要队友或true) && !(排除队友表达式)
 *   c) 还有自动排除：  (必要队友或true) && !(排除队友表达式或false) && (true) && (自动排除表达式)
 * 「排除队友」由用户按「角色组合」选择（项与项之间可以逐个选「与 / 或」），**内部一律不取非**：
 *   写出来的条件函数与运算符只有 in-party / && / ||，用户选的「与 / 或」原样出现在表达式里，
 *   等到组装队友条件时才把整段加括号后取非：
 *   组合「或」→ !(in-party(甲) || in-party(乙))，组合「与」→ !(in-party(甲) && in-party(乙))。
 *   这样用户选的运算符与表达式里出现的运算符完全一致，并且和「必要队友」一样可以用「或」切分
 *   「角色组合」，靠运算优先级实现对多个「角色组合」的精准选择。
 *   说明（别搞反）：BetterGI 的解析器（ConditionEvaluator）里 `!` 是一元运算符、优先级高于
 *   && / ||，括号里的表达式会先整体求值，所以 `!(甲 || 乙)` 与 `!甲 && !乙` 语义完全等价；
 *   这里统一写成 `!(…)`，拆回来时按「剥掉最外层的取非」还原成同一个「角色组合」。
 *   「排除队友」为空时括号里填 false，取非后正好是 true（= 视为满足）。
 * 结构 c) 里的 `(true)` 是恒等占位，同时充当**格式标记**：见到它就知道这份队友条件是本编辑器
 * 写出来的，其中的取非项才按「是否等于同角色某个动作的必要队友表达式」区分「自动排除」与
 * 「排除队友」；没有这个标记的旧格式表达式两者同形，一律按「排除队友」还原。
 */

/** 运算符取反（与 ⇄ 或）：还原「排除队友」时用得上（德摩根） */
function invertTeamOp(op) { return op === 'or' ? 'and' : 'or'; }
function normTeamOp(op, fallback) { return op === 'or' || op === 'and' ? op : (fallback === 'or' ? 'or' : 'and'); }

/**
 * 把 in-party 项组表达式（**不自动加外层括号**）。
 * items: [{ name, neg }]；ops 是「项与项之间」的运算符（'and'/'or'，与表达式里的 && / || 一致），
 * 项数与 ops 长度不匹配时用 fallback 兜底。
 * 调用方负责按需要套括号：嵌进队友条件时用 parenIfLogical，取非时用 `!( … )`。
 */
function joinInPartyItems(items, ops, fallback) {
  const list = (items || []).filter(x => x && x.name);
  if (!list.length) return '';
  const parts = list.map(x => `${x.neg ? '!' : ''}in-party(${x.name})`);
  let text = parts[0];
  for (let i = 1; i < list.length; i++) {
    const op = normTeamOp((ops || [])[i - 1], fallback);
    text += ` ${op === 'or' ? '||' : '&&'} ${parts[i]}`;
  }
  return text;
}

/** 「必要队友」表达式：组合运算符与表达式里的 && / || 一致（**不含最外层括号**，由 teammateExpr 按需补） */
function includeExprOf(tb) {
  const tm = tb || {};
  const mode = tm.mode === 'and' ? 'and' : 'or';
  return joinInPartyItems(
    (tm.include || []).filter(Boolean).map(n => ({ name: n, neg: false })),
    tm.includeOps, mode);
}
/** 「排除队友」（单个角色组合）那一段的表达式文本：**不含取非，也不加外层括号**；没有排除队友时返回 '' */
function excludeGroupTextOf(tb) {
  return excludeChainText(excludeGroupChainOf(tb));
}

/** 「排除队友」的「角色组合」（项 + 项间运算符）；没有排除队友时 items 为空 */
function excludeGroupChainOf(tb) {
  return { items: (tb && tb.exclude || []).filter(Boolean).map(n => ({ name: n, neg: false })), ops: padTeamOps(tb && tb.excludeOps, Math.max(0, (tb && tb.exclude || []).filter(Boolean).length - 1), 'or') };
}

/**
 * 单个「排除角色组合」的表达式文本（**取非之前的原样算式，不自动加外层括号**）。
 *
 * 「排除队友」和「必要队友」一样：用户选的「与 / 或」原样写进表达式，因此可以用「或」切分
 * 「角色组合」、靠运算优先级实现对多个组合的精准选择；取非统一留到组装「队友条件」时
 * 由 teammateExpr 把整段加括号后一次性完成（组合「或」→ !(甲 || 乙)，组合「与」→ !(甲 && 乙)）。
 * 因此这里**不要**对每一项自己取非，也不要按德摩根律取反运算符。
 */
function excludeChainText(chain) {
  const list = ((chain && chain.items) || []).filter(x => x && x.name);
  if (!list.length) return '';
  const mode = ((chain && chain.ops || [])[0] === 'and') ? 'and' : 'or';
  return joinInPartyItems(list.map(x => ({ name: x.name, neg: false })), chain.ops, mode);
}

/** 把要嵌进整条表达式里的片段包一层括号：有顶层的 && / || 时必需，否则会被外层运算符吃掉 */
function parenIfLogical(text) {
  if (!hasTopLevelLogical(text)) return text;
  return fullyWrapped(text) ? text : `(${text})`;
}

/** 文本是否已经被一对外层括号完整包住（`(a || b)`），是的话不必再套一层 */
function fullyWrapped(text) {
  const t = String(text || '').trim();
  if (!/^\(.*\)$/.test(t)) return false;
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '(') depth++;
    else if (t[i] === ')') { depth--; if (depth === 0) return i === t.length - 1; }
  }
  return false;
}

/** 文本里是否存在「顶层」的 && / ||（括号里面的不算） */
function hasTopLevelLogical(text) {
  const t = String(text || '');
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '(') { depth++; continue; }
    if (ch === ')') { depth--; continue; }
    if (depth === 0 && (ch === '&' || ch === '|') && t[i + 1] === ch) return true;
  }
  return false;
}

/** 「排除队友」表达式（单个「角色组合」）→ !( … )；没有排除队友时返回 '' */
function excludeExprOf(tb) {
  const text = excludeGroupTextOf(tb);
  return text ? `!(${text})` : '';
}

/** 自动排除：本动作引用的其他动作 */
function effectiveAutoExclude(act, actions) {
  const out = new Set(act.teammates?.autoExclude || []);
  if (act.teammates?.autoExcludeSameType) {
    for (const a of actions) {
      if (a.id === act.id) continue;
      if ((a.character || '') !== (act.character || '')) continue;
      if (a.type !== act.type) continue;
      out.add(a.id);
    }
  }
  return [...out];
}

/**
 * 自动排除表达式：对被勾选动作的「必要队友」表达式去重（空表达式忽略），每项取非：
 *   !( 甲动作必要队友 ) && !( 乙动作必要队友 ) && …
 * 勾了的动作都没有必要队友时返回 ''（等于没有自动排除）。
 */
function autoExcludeExpr(act, actions) {
  const list = actions || state.strategy.actions;
  const seen = new Set();
  const clauses = [];
  for (const id of effectiveAutoExclude(act, list)) {
    const other = list.find(a => a.id === id);
    if (!other) continue;
    const inc = includeExprOf(other.teammates);
    if (!inc) continue;              // 没设置必要队友则忽略
    if (seen.has(inc)) continue;     // 多个动作的必要队友表达式相同时只取一次
    seen.add(inc);
    clauses.push(`!(${inc})`);
  }
  return clauses.join(' && ');       // 勾了的动作都没有必要队友 → 等于没有自动排除
}

/** 队友条件表达式片段；返回 '' 表示没有队友条件
 * 三种结构（「排除队友」整段加括号后统一取非，里面的运算符与用户所选一致，见 excludeChainText）：
 *   a) 只有必要队友： (必要队友)
 *   b) 还有排除队友： (必要队友或true) && !(排除队友或false)
 *   c) 还有自动排除： (必要队友或true) && !(排除队友或false) && (true) && (自动排除)
 * 「排除队友」为空时括号里填 false，取非后正好是 true（= 视为满足）。
 * 其中 c) 里那个 `true` 是恒等占位，它同时是**格式标记**：导入时看到它就说明这份队友条件是
 * 本编辑器写出来的，里面的取非项才需要按「是否等于某个同角色动作的必要队友表达式」进一步
 * 区分「自动排除」和「排除队友」；没有这个标记的旧格式表达式两者同形，只能一律按排除队友还原。
 */
/** 队友条件表达式片段；返回 '' 表示没有队友条件（触发条件原样写入）
 * 三种结构（「排除队友」整段加括号后统一取非，里面的运算符与用户所选一致，见 excludeChainText）：
 *   a) 只有必要队友： (必要队友)
 *   b) 还有排除队友： (必要队友或true) && !(排除队友或false)
 *   c) 还有自动排除： (必要队友或true) && !(排除队友或false) && (true) && (自动排除)
 * 只有排除队友（没有自动排除）时省掉 (true) 占位，直接写 !(排除队友)。
 * 返回值不含最外层括号：由 buildExpression 在拼接时按需包一层（见 parenIfLogical）。
 * 其中 c) 里那个 `true` 是恒等占位，它同时是**格式标记**：导入时看到它就说明这份队友条件是
 * 本编辑器写出来的，里面的取非项才需要按「是否等于某个同角色动作的必要队友表达式」进一步
 * 区分「自动排除」和「排除队友」；没有这个标记的旧格式表达式两者同形，只能一律按排除队友还原。
 */
/** 把一个片段当作「单个操作数」嵌进更大的算式：必要时整体包一层括号，避免被外层运算符吃掉 */
function wrapOperand(text) {
  return fullyWrapped(text) ? text : `(${text})`;
}

/** 「必要队友」当作单个操作数：整体包一层括号（in-party 项数量不限，一层就够） */
function includeOperand(text) {
  return `(${text})`;
}

function teammateExpr(act, actions) {
  const tm = act.teammates || {};
  const inc = includeExprOf(tm);
  const exc = excludeGroupTextOf(tm);
  const autoRaw = autoExcludeExpr(act, actions);
  // 结构 a) 只有必要队友
  if (!exc && !autoRaw) return inc ? includeOperand(inc) : '';
  // 「排除队友」那一段：整段加括号后取非；为空时写 !(false)（恒真占位，同时是新格式的标记）
  const excPart = `!(${exc || 'false'})`;
  // 结构 b) 还有排除队友。必要队友为空、且不需要写自动排除（结构 c）时省掉 (true) 占位
  if (!autoRaw) return inc ? `${includeOperand(inc)} && ${excPart}` : excPart;
  // 结构 c) 还有自动排除
  return `${inc ? includeOperand(inc) : '(true)'} && ${excPart} && (true) && (${autoRaw})`;
}

/** 组装最终 condition.expression
 *  无命座要求： 触发条件 或 (触发条件) && (队友条件)（原来的写法，一个字都不改）；
 *  有命座要求： ((触发条件) && (命座要求)) && (队友条件)，队友条件为空时是 (触发条件) && (命座要求)。
 *  「命座要求」只是一个布尔值字面量（true / false），见 consExprText。
 */
function buildExpression(act, actions) {
  const own = (act.conditionText || '').trim();
  const tm = teammateExpr(act, actions);
  const cons = consExprText(act);
  if (!cons) return tm ? `(${own || 'true'}) && ${wrapOperand(tm)}` : own;
  const base = `(${own || 'true'}) && (${cons})`;
  return tm ? `(${base}) && ${wrapOperand(tm)}` : base;
}

/** morePriorities 最终条目（与 buildExpression 同一套组装规则，「触发条件」换成该条目自己的条件） */
function buildMorePriorities(act, actions) {
  const tm = teammateExpr(act, actions);
  const cons = consExprText(act);
  return (act.morePriorities || []).map(mp => {
    const own = (mp.text || '').trim();
    // 没有命座要求时保持原状：没有队友条件就写这条条目自己的条件（空 = 空，恒真）
    if (!cons) {
      const expression = tm ? `(${own || 'true'}) && ${wrapOperand(tm)}` : own;
      return { expression, priority: mp.priority, cmp: mp.cmp, scope: mp.scope, text: own };
    }
    const base = `(${own || 'true'}) && (${cons})`;
    const expression = tm ? `(${base}) && ${wrapOperand(tm)}` : base;
    return { expression, priority: mp.priority, cmp: mp.cmp, scope: mp.scope, text: own };
  });
}

/* ---------------- 条件表达式拆分（触发条件 / 队友条件） ----------------
 * 与组装规则对应的反推：
 *   1) 顶层 && 链里的「队友条件」段：以第一个含 in-party 的操作数（或纯占位段
 *      `!(false)`）为锚点，再往前把 `true` / `!(false)` 这些占位操作数一起收进来；
 *      剩下的（去掉末尾多余的 true 占位）是「触发条件」；
 *   2) 队友条件里：不取非的 in-party 组合 → 必要队友；取非项 → 排除队友 / 自动排除：
 *      本编辑器导出的排除队友是「整段加括号取非」（!(甲 || 乙) / !(甲 && 乙)），
 *      自动排除的每一项则是 `!(该动作的必要队友表达式)`，并紧跟在一个 `(true)` 格式标记之后；
 *   3) 「自动排除」与「手选的排除队友」用「是否等于某个同角色动作的必要队友表达式」区分，
 *      且只有带 `(true)` 格式标记时才区分（旧格式表达式两者同形，一律按排除队友还原，避免丢内容）；
 *   4) 拆不出来（含 in-party 但不属于以上结构）时不拆，整条表达式按触发条件导入，避免丢内容。
 */

/** 表达式里是否出现 in-party(...) */
function condContainsInParty(node) {
  let found = false;
  condWalk(node, (n) => { if (n.type === 'call' && n.lower === 'in-party') found = true; });
  return found;
}

/** 把顶层 && 链摊平成操作数数组（括号在 AST 里已经消失，这里按运算顺序还原） */
function flattenAndOperands(node) {
  if (node && node.type === 'binary' && node.op === '&&') {
    return [...flattenAndOperands(node.left), ...flattenAndOperands(node.right)];
  }
  return [node];
}

/** 布尔字面量占位（true / false） */
function condBoolPlaceholder(node, value) {
  return !!node && node.type === 'bool' && node.value === value;
}

/** 文本是否等价于「一个括号里只有布尔字面量」（`(false)` / `((true))`） */
function textIsBoolPlaceholder(text, value) {
  return String(text || '').replace(/\s+/g, '') === String(value);
}

/** 是否恒假占位：文本（可能带括号）等于 false */
function isFalseText(text) { return textIsBoolPlaceholder(text, false); }

/**
 * 拆解纯 in-party 链：返回 { items: [{name, neg}], ops: ['and'|'or'…] }（ops 是表达式里的运算符），
 * 不是纯 in-party 链时返回 null。经过取非时按德摩根取反（!(A && B) ⇔ !A || !B）。
 */
function splitInPartyChain(node) {
  if (!node) return null;
  if (node.type === 'call' && node.lower === 'in-party') {
    const a = node.args && node.args[0];
    if (!a || a.type !== 'ident') return null;   // 参数必须是裸角色名
    return { items: [{ name: a.name, neg: false }], ops: [] };
  }
  if (node.type === 'unary' && node.op === '!') {
    const r = splitInPartyChain(node.operand);
    if (!r) return null;
    return { items: r.items.map(x => ({ name: x.name, neg: !x.neg })), ops: r.ops.map(invertTeamOp) };
  }
  if (node.type === 'binary' && (node.op === '&&' || node.op === '||')) {
    const L = splitInPartyChain(node.left);
    if (!L) return null;
    const R = splitInPartyChain(node.right);
    if (!R) return null;
    return { items: [...L.items, ...R.items], ops: [...L.ops, node.op === '&&' ? 'and' : 'or', ...R.ops] };
  }
  return null;
}

/**
 * 按顶层 && 把一段算式切成若干片段（保留每段里 || 的原文），用于旧格式「逐项取非」的还原：
 *   `甲 || 乙 && 丙` → ['甲 || 乙', '丙']
 */
function splitTopLevelAndText(text) {
  const t = String(text || '');
  const out = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0 && ch === '&' && t[i + 1] === '&') {
      out.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** 把一个「排除队友」片段（用户所作的写法）转成 model chain：项不取非、运算符取反（德摩根） */
function invertedExcludeChain(part) {
  const parsed = condParse(part, []);
  const r = parsed.ast ? splitInPartyChain(parsed.ast) : null;
  if (!r || !r.items.length) return null;
  if (r.items.some(x => x.neg)) return null;
  return { items: r.items.map(x => ({ name: x.name, neg: false })), ops: r.ops.map(invertTeamOp) };
}

/** 把若干条 in-party 链按顺序接起来（链与链之间在表达式里是 &&，即 'and'） */function concatInPartyChains(groups) {
  const items = [];
  const ops = [];
  for (const g of (groups || [])) {
    if (!g || !g.items.length) continue;
    if (items.length) ops.push('and');
    g.items.forEach((it, k) => {
      if (k > 0) ops.push(g.ops[k - 1]);
      items.push(it);
    });
  }
  return { items, ops };
}

/**
 * 取一个「取非片段」在取非之前的原文，用于和「其他动作的必要队友表达式」比对（自动排除）。
 * 新版导出：!(in-party(甲) || in-party(乙)) → 剥掉最外层的 ! 与它包裹的括号，得到组合本身；
 * 旧版导出：!in-party(甲) → 得到 in-party(甲)；
 * 取非的对象是「逐项取非的混合表达式」时（旧的排除队友写法）返回原文，交给调用方按德摩根还原。
 */
function negatedInnerText(node) {
  const operand = node && node.type === 'unary' && node.op === '!' ? node.operand : null;
  if (!operand) return '';
  const txt = condToText(operand);
  // 只剥一层「包住整个操作数的括号」（AST 里括号已经消失，这里按文本还原）
  if (/^\(.*\)$/.test(txt)) {
    let depth = 0;
    let wraps = true;
    for (let i = 0; i < txt.length; i++) {
      if (txt[i] === '(') depth++;
      else if (txt[i] === ')') { depth--; if (depth === 0 && i < txt.length - 1) { wraps = false; break; } }
    }
    if (wraps) return txt.slice(1, -1).trim();
  }
  return txt;
}

/** 「队友条件」段可能从某个恒真占位（(true) / true）或空排除占位 `!(false)` 开始 */
function isTeammateLeadingPlaceholder(node) {
  if (!node) return false;
  if (node.type === 'bool') return node.value === true;                       // (true) / true
  if (node.type === 'unary' && node.op === '!') return isFalseText(negatedInnerText(node));  // !(false)
  return false;
}

/**
 * 拆解「队友条件」操作数列表。
 * 返回 { ok:true, inc, autoGroups:[…], ops } 或 { ok:false, reason }
 *   inc        —— 不取非的 in-party 组合（必要队友）
 *   autoGroups —— 取非项：{ matcherText, chain, wholeGroup, negChain }
 *                 · matcherText 是该项取非前的原文，用于和「同角色其他动作的必要队友表达式」比对；
 *                 · wholeGroup = 取非的对象外面本来有一层括号（本编辑器新格式 `!(甲 && 乙)`）：
 *                   括号在 AST 里是透明的（cond.js 会给这样的节点打 paren 标记），靠它才能把新格式
 *                   的「整段取非」与旧格式的「逐项取非」区分开 —— 两者拆出来的 in-party 链完全同形；
 *                 · negChain = 还原成用户所选写法的「排除队友」组合（新格式原样采用，旧格式按德摩根反推）。
 *   ops        —— 原始操作数（调用方用它判断有没有 `true` 格式标记）
 * 说明：取非项究竟是「用户手选的排除队友」还是「自动排除」，本编辑器的新格式靠
 * `(true)` 格式标记 + 必要队友表达式比对来区分；旧格式 / 手写表达式解析后两者同形，
 * 由调用方统一按排除队友还原（见 analyzeImport 第二步的说明）。
 */
function decomposeTeammate(operands) {
  const incGroups = [];
  const negGroups = [];
  const ops = (operands || []).filter(Boolean);
  for (const n of ops) {
    if (n.type === 'bool') continue;                        // true / false 占位
    if (n.type === 'unary' && n.op === '!') {
      const inner = negatedInnerText(n);
      // `!(false)` 是「排除队友」为空时的占位（取非后恒真），不是任何角色组合
      if (textIsBoolPlaceholder(inner, false)) continue;
      const series = splitInPartyChain(n);
      if (!series || !series.items.length) {
        return { ok: false, reason: `出现了既不是 in-party 组合、也不是取非的 in-party 组合的片段「${condToText(n)}」` };
      }
      const wholeGroup = !!(n.operand && n.operand.paren);
      negGroups.push({ matcherText: inner, chain: series, wholeGroup, negChain: excludeChainFromNegation(inner, wholeGroup) });
      continue;
    }
    const chain = splitInPartyChain(n);
    if (!chain) return { ok: false, reason: `出现了既不是 in-party 组合、也不是取非的 in-party 组合的片段「${condToText(n)}」` };
    const negs = new Set(chain.items.map(x => !!x.neg));
    if (negs.size !== 1) return { ok: false, reason: `同一个片段里既有取非的 in-party 又有不取非的 in-party：「${condToText(n)}」` };
    if (!negs.has(true)) { incGroups.push(chain); continue; }
    negGroups.push({ matcherText: condToText(n), chain, wholeGroup: false, negChain: excludeChainFromNegation(condToText(n), false) });
  }
  if (!incGroups.length && !negGroups.length) return { ok: false, reason: '只有 true / false 占位' };
  return { ok: true, inc: concatInPartyChains(incGroups), autoGroups: negGroups, ops };
}

/** 解析一段「纯 in-party，项不取非」的算式，返回 { items, ops }（ops 就是算式里的 && / ||） */
function parseInPartyChainText(text) {
  const parsed = condParse(text, []);
  const r = parsed.ast ? splitInPartyChain(parsed.ast) : null;
  if (!r || !r.items.length || r.items.some(x => x.neg)) return null;
  return { items: r.items.map(x => ({ name: x.name, neg: false })), ops: r.ops };
}

/**
 * 把一个取非片段还原成用户所写的「排除队友」组合（项不取非，运算符是**用户所选**的与/或）。
 *
 * 关键：不要把整段取非再交给 splitInPartyChain 走一遍 —— 那会把德摩根算两次。
 *   · 新格式（取非对象外面有一整层括号）`!(甲 || 乙)`：括号里的算式就是用户选的写法，
 *     直接解析原文即可（`!(甲 && 乙)` → 用户选「与」，`!(甲 || 乙)` → 用户选「或」）；
 *   · 旧格式 `!甲 && !乙`：顶层 && 是「多个组合的并列」，不是用户选的运算符。
 *     按顶层 && 拆成若干片段，每个片段是「逐项取非」的写法（如 `!甲 || !乙`），
 *     其运算符按德摩根取反回来才是用户所选（`||` → 用户选「与」）。
 * 两种结果都已经是「用户所选」，带 preInverted 标记，applyTeammateExclude 不再取反。
 */
function excludeChainFromNegation(innerText, wholeGroup) {
  if (wholeGroup) {
    const chain = parseInPartyChainText(innerText);
    if (!chain) return null;
    chain.preInverted = true;
    return chain;
  }
  const parts = splitTopLevelAndText(innerText);
  const groups = parts.map(invertedExcludeChain).filter(Boolean);
  if (groups.length !== parts.length) return null;
  const merged = concatInPartyChains(groups);
  merged.preInverted = true;
  return merged;
}

/**
 * 「命座要求」在 expression 末尾的形态：`… && (true)` / `… && (false)`。
 * 返回 { text: 剥掉之后剩下的算式, value: true|false|null }。
 *
 * 只在**不可能有队友条件**的调用点使用（有队友条件时命座要求排在队友条件前面，
 * 由 splitTriggerAndTeammate 从顶层 && 链上取）。
 * 这里带一个「整体已经被一层括号包住」的保护：
 *   · 本编辑器导出的「有命座要求 + 有队友条件」形如 `((触发条件) && (命座要求)) && (队友条件)`，
 *     整条不是 fullyWrapped，末尾的 `&& (…队友条件…)` 也不是布尔字面量，所以不会被误剥；
 *   · 用户自己写的 `(true) && (in-party(甲))` 同样不是 fullyWrapped，也不会被误剥；
 *   · 只有 `((触发条件) && (命座要求))`（有命座要求、没有队友条件的那一种）是 fullyWrapped，
 *     这时才按末尾的布尔字面量剥出命座要求。
 */
function splitTrailingCons(text) {
  const t = String(text === null || text === undefined ? '' : text);
  // 整体被一对外层括号完整包住时（手写 / 旧数据的 `((触发条件) && (命座要求))`），先在里层找一次
  const inner = fullyWrapped(t) ? t.trim().slice(1, -1) : t;
  const m = inner.match(/^(.*?)\s*&&\s*\(\s*(true|false)\s*\)\s*$/);
  if (!m || !m[1].trim()) return { text: t, value: null, wrapped: false };
  // 剥掉命座要求之后剩下的那段触发条件：本编辑器导出时会把它整体包一层括号
  // （`(触发条件) && (命座要求)`），这里要把这层括号去掉，否则每往返一次就多一层括号。
  // 剩下的如果正好是恒真占位 `true`，按「空条件」还原（空 = 恒真，与输入框留空等价）。
  let body = unwrapWholeText(m[1]);
  if (body === 'true') body = '';
  return { text: body, value: m[2] === 'true', wrapped: true };
}

/** 去掉「完整包住整段」的括号（一层层剥：`((a) && (b))` → `(a) && (b)`、`(a || b)` → `a || b`） */
function unwrapWholeText(text) {
  let t = String(text === null || text === undefined ? '' : text).trim();
  while (fullyWrapped(t)) t = t.slice(1, -1).trim();
  return t;
}

/**
 * 把一条 expression 拆成 { trigger, teammate }
 * teammate 为 null 表示没有队友条件；teammate.ok=false 表示看起来有队友条件但拆不出来（此时 trigger 保留原文）
 *
 * 命座要求（consRequirement）那一段是组装时在最外层补的 `&& (true/false)`：
 *   · 有队友条件时，它在队友条件**里面**（`((触发条件) && (命座要求)) && (队友条件)`），
 *     按原来的规则拆完队友条件之后，末尾剩下的那个布尔字面量就是它；
 *   · 没有队友条件时它在末尾（`(触发条件) && (命座要求)`），用 splitTrailingCons 剥掉。
 * 只在「确实剥掉了队友条件」或「末尾确实跟着 `&& (布尔字面量)`」时才认它，
 * 免得把 `(true) && (队友条件)` 里的恒真占位误认成命座要求。
 */
function splitTriggerAndTeammate(text, actionNames) {
  const raw = String(text === null || text === undefined ? '' : text);
  const parsed = condParse(raw, actionNames || []);
  if (parsed.error || !parsed.ast) return { trigger: raw, teammate: null, cons: null };
  const ops = flattenAndOperands(parsed.ast);
  // 定位「队友条件」段的起点：
  //   · 从第一个含 in-party 的操作数开始，再把前面紧邻的恒真占位一起收进来
  //     （结构 c) 的 `(true)` 标记、必要队友为空时的 `(true)` 占位都在 in-party 前面）；
  //   · 完全没有 in-party 时，只有「空排除占位 !(false)」这种形状才可能是队友条件
  //     （必要队友与排除队友都为空、只勾了自动排除时，队友条件里就只有占位与自动排除项）。
  const atInParty = ops.findIndex(condContainsInParty);
  const atEmptyExclude = ops.findIndex((n) => !condBoolPlaceholder(n, true) && isTeammateLeadingPlaceholder(n));
  const at = atInParty >= 0 ? (atEmptyExclude >= 0 ? Math.min(atInParty, atEmptyExclude) : atInParty) : atEmptyExclude;
  if (at < 0) {
    // 没有队友条件：末尾可能跟着「命座要求」那一段（`(触发条件) && (命座要求)`，
    // 手写 / 旧数据里也可能是整体再包一层的 `((触发条件) && (命座要求))`）。
    // 两种情况都由 splitTrailingCons 处理：它会剥掉命座要求，并把触发条件那层括号去掉。
    const stripped = splitTrailingCons(raw);
    if (stripped.value === null || stripped.text === raw) return { trigger: raw, teammate: null, cons: null };
    return { trigger: stripped.text, teammate: null, cons: stripped.value };
  }
  let tmStart = at;
  while (tmStart > 0 && isTeammateLeadingPlaceholder(ops[tmStart - 1])) tmStart--;
  const head = ops.slice(0, tmStart);
  // 触发条件末尾的 true 占位（来自「(true) && (队友条件)」）与「命座要求」那一段都排在队友条件前面，
  // 这里从后往前收：先认出末尾的布尔字面量当命座要求，再把紧邻的 true 占位去掉。
  let cons = null;
  if (head.length && head[head.length - 1].type === 'bool') {
    cons = !!head[head.length - 1].value;
    head.pop();
  }
  while (head.length && head[head.length - 1].type === 'bool' && head[head.length - 1].value === true) head.pop();
  // 用 && 重新连接时要给 || 片段整体加括号，否则会改变运算顺序（只有一个操作数时不用加）
  const asAnd = (list) => list.map(n => (list.length > 1 && n.type === 'binary' && (n.op === '&&' || n.op === '||') ? `(${condToText(n)})` : condToText(n))).join(' && ');
  const trigger = head.length ? asAnd(head) : '';
  const r = decomposeTeammate(ops.slice(at));
  if (!r.ok) return { trigger: raw, teammate: r, cons: null };   // 拆不出来就整条按触发条件处理
  return { trigger, teammate: r, teammateText: asAnd(ops.slice(tmStart)), cons };
}

/** 运算符数组补齐到指定长度 */
function padTeamOps(ops, len, fallback) {
  const out = [];
  for (let i = 0; i < len; i++) out.push(normTeamOp((ops || [])[i], fallback));
  return out;
}

/** 模型里的运算符数组只存「项与项之间」的运算符，不存最外层那层括号（旧数据里可能带）。 */
function trimWrapOps(ops) {
  const s = String((ops && ops[0]) || '');
  if (!s.startsWith('(')) return ops;
  const out = (ops || []).slice();
  out[0] = s.slice(1);
  const last = out.length - 1;
  out[last] = String(out[last] || '').replace(/\)\s*$/, '');
  return out;
}

/** 第一步：只写「必要队友」（第二步的自动排除比对要用到其他动作的必要队友表达式） */
function applyTeammateInclude(act, tm) {
  act.teammates.include = tm.inc.items.map(x => x.name);
  act.teammates.includeOps = padTeamOps(trimWrapOps(tm.inc.ops), Math.max(0, tm.inc.items.length - 1), 'or');
}

/** 第二步：写「排除队友」（自动排除的项已在调用前剔除）
 * groups 里每一项是 { chain }（或直接是 chain），chain 是 decomposeTeammate 预先算好的 negChain：
 * 「用户所选的项 + 运算符」（新格式原样采用，旧格式按德摩根反推），原样存即可。
 * 兜底：传进来的还是表达式里的取非链（items 带 neg、ops 已取反）时，这里再取反一次还原。
 */
function applyTeammateExclude(act, groups) {
  const items = [];
  const ops = [];
  for (const g of (groups || [])) {
    const chain = g && g.chain ? g.chain : g;
    if (!chain || !chain.items || !chain.items.length) continue;
    if (items.length) ops.push('and');
    chain.items.forEach((it, k) => {
      if (k > 0) {
        const op = normTeamOp(chain.ops[k - 1], 'or');
        ops.push(chain.preInverted ? op : invertTeamOp(op));
      }
      items.push(it);
    });
  }
  act.teammates.exclude = items.map(x => x.name);
  act.teammates.excludeOps = padTeamOps(trimWrapOps(ops), Math.max(0, items.length - 1), 'or');
}

/* ---------------- 校验器 ---------------- */

/**
 * 全量校验
 * 返回 { errors: [{scopeId, actionId, text}], warnings: [...], indexIssues: [] }
 */
function validateStrategy() {
  const errors = [];
  const warnings = [];
  const s = state.strategy;
  const actions = s.actions;
  const names = allActionNames(actions);
  const idxSet = knownIndexes(actions);
  const push = (arr, text, actionId) => arr.push({ actionId: actionId || null, text });

  // info
  if (!s.info.name || !s.info.name.trim()) push(warnings, '策略名称为空（name 只用于日志，不影响运行）');
  if (s.info.version !== undefined && s.info.version !== null && typeof s.info.version !== 'string') push(errors, 'info.version 必须是字符串（本编辑器里它是「版本」，留空时导出会省略该字段）');
  if (!actions.length) push(errors, '策略中至少需要 1 个动作节点，否则 BetterGI 解析时会抛出「JSON 战斗策略中未定义任何动作」');

  if (s.info.preActions) {
    s.info.preActions.forEach((pa, i) => {
      if (pa.character && !getAvatar(pa.character)) push(errors, `战斗前动作第 ${i + 1} 行：角色「${pa.character}」不在角色表中（characters 必须与 BetterGI 内置角色名一致）`);
      if (pa.character && /\s/.test((pa.cmd || '').trim())) push(errors, `战斗前动作第 ${i + 1} 行：指令串内不能有空格（preActions 按第一个空格切分角色名）`);
      const p = parseActionString(pa.cmd || '');
      for (const e of p.errors) push(errors, `战斗前动作第 ${i + 1} 行：${e}`);
      if (/\bround\s*\(/.test(pa.cmd || '')) push(warnings, `战斗前动作第 ${i + 1} 行：preActions 支持 round() 回合分组，确认这是你想要的`);
    });
  }

  // 重名
  const nameCount = new Map();
  for (const a of actions) if (a.name) nameCount.set(a.name, (nameCount.get(a.name) || 0) + 1);
  for (const [n, c] of nameCount) if (c > 1) push(errors, `动作名「${n}」重复出现 ${c} 次：since/count/last-exec 按名称引用时只会命中最近一次执行，请改成不同名称`, null);

  const indexSeen = new Map();
  for (const a of actions) {
    const where = `动作「${a.name || '(未命名)'}」（${a.character || '当前角色'}）`;
    // 名称
    if (!a.name) push(warnings, `${where}：动作名为空，无法被 since/count 按名称引用，日志里也看不出是什么动作`, a.id);
    else {
      const v = isValidActionName(a.name, names);
      if (!v.ok) push(errors, `${where}：动作名不合法 —— ${v.reason}`, a.id);
    }
    // 角色
    if (a.character && !getAvatar(a.character)) push(errors, `${where}：角色「${a.character}」不在 BetterGI 角色表中，该动作会在开战前被静默过滤`, a.id);
    // 类型与编号
    if (a.indexViolation) push(warnings, `${where}：这条动作的 index 是从外部导入的旧编号（${a.index}），点“按规则重排编号”可统一修正`, a.id);
    if (a.type === 0 && a.character) push(errors, `${where}：动作类型 0（战斗检查与标记）只能用于「当前角色」`, a.id);
    if (a.type !== 0 && !a.character && false) { /* 允许 */ }
    const pi = parseIndex(a.index);
    if (!pi.ok) push(errors, `${where}：index=${a.index} 不符合编号规则 —— ${pi.reason}`, a.id);
    else {
      const av = a.character ? getAvatar(a.character) : { code: 0, seq: 0 };
      if (av && (pi.code !== av.code || pi.seq !== av.seq)) {
        push(errors, `${where}：index=${a.index} 的元素/角色位与所选角色不一致（应为元素 ${av.code}、角色 ${String(av.seq).padStart(2, '0')}）`, a.id);
      }
      if (pi.type !== a.type) push(errors, `${where}：index=${a.index} 的动作类型位是 ${pi.type}，与当前选择的类型 ${a.type} 不一致`, a.id);
    }
    if (indexSeen.has(a.index)) push(errors, `${where}：index=${a.index} 与动作「${indexSeen.get(a.index)}」重复（重复的 index 会让 since/count 按编号查询时只命中最近一次执行）`, a.id);
    else indexSeen.set(a.index, a.name || '(未命名)');

    // 指令
    // 「当前角色 + 动作类型 0」只写了触发条件、没写指令时不提示「指令串为空」：
    // 这种“只做判定/标记”的动作是正常用法，两处同时为空才提示（见 isMarkerOnlyAction）。
    const parsed = parseActionString(a.action, { skipEmptyWarning: isMarkerOnlyAction(a) });
    for (const e of parsed.errors) push(errors, `${where}：${e}`, a.id);
    for (const w of parsed.warnings) push(warnings, `${where}：${w}`, a.id);
    const fs = firstSwitchInfo(parsed.parts);
    if (!a.character && parsed.parts.length && !fs.canSwitch) {
      // 当前角色的动作不需要切人
    } else if (a.character && parsed.parts.length && !fs.canSwitch) {
      push(warnings, `${where}：指令串的第一个指令「${parsed.parts[0].raw}」不会触发切人（${fs.reason}），但该动作指定了角色 —— 如果轮到它执行时该角色不在场上，这个动作就不会切人`, a.id);
    }
    if (a.ensureCast && parsed.parts.length && !hasESkill(parsed.parts)) {
      push(warnings, `${where}：勾选了「确保E技能释放成功」，但指令串里没有 e / skill / keydown(e) / keypress(e)，会导致连续最多 5 次重试整个动作`, a.id);
    }
    const qTokens = parsed.parts.filter(p => p.method && p.method.canonical === 'q');
    if (qTokens.length && !/ready/.test(a.action)) {
      push(warnings, `${where}：使用了 q（元素爆发）但指令串里没有 ready：大招动画期间被切人容易被吞，建议写成 q,wait(0.1),ready`, a.id);
    }

    // 注释（tags）：本编辑器约定的注释字段，BetterGI 会忽略它；空注释在导出时省略该字段
    if (a.tags !== undefined && a.tags !== null && typeof a.tags !== 'string') push(errors, `${where}：注释必须是字符串（写入 tags 字段）`, a.id);

    // 命座要求（consRequirement）：本编辑器约定的字段，BetterGI 会忽略它；
    // 没有命座要求（0）时导出会省略该字段。
    if (!CONS_MODES.includes(a.consMode)) {
      push(errors, `${where}：命座要求的模式无法识别（${a.consMode}）`, a.id);
    } else if (a.consMode === 'none') {
      const need = Number(a.consTarget) > 0;
      if (need) push(errors, `${where}：命座要求的状态不一致（模式为「无命座要求」却带着目标命座数），请重新选择「命座要求」`, a.id);
    } else if (!(Number.isInteger(Number(a.consTarget)) && Number(a.consTarget) >= 1 && Number(a.consTarget) <= CONS_MAX)) {
      push(errors, `${where}：命座要求的目标命座数必须是 1~${CONS_MAX} 的整数`, a.id);
    }

    // 条件
    const cv = condValidate(a.conditionText, { actionNames: names, knownIndexes: idxSet, currentAction: a });
    for (const e of cv.errors) push(errors, `${where}：基础触发条件 —— ${e}`, a.id);
    for (const w of cv.warnings) push(warnings, `${where}：基础触发条件 —— ${w}`, a.id);

    // 队友条件（同一个角色允许重复出现，因为是按「角色组合」取与/或）
    const tm = a.teammates || {};
    const uniqNames = (arr) => [...new Set(arr)];
    for (const n of uniqNames([...(tm.include || []), ...(tm.exclude || [])])) {
      if (!getAvatar(n)) push(errors, `${where}：队友条件中的角色「${n}」不在角色表中`, a.id);
    }
    if ((tm.include || []).some(n => n === a.character)) push(warnings, `${where}：必要队友里包含了动作自己的角色「${a.character}」，character 字段本身已做过队伍过滤，这条限制是多余的`, a.id);
    if ((tm.exclude || []).includes(a.character)) push(errors, `${where}：排除队友里包含了动作自己的角色「${a.character}」，该条件恒为假，动作永远不会执行`, a.id);
    const overlap = uniqNames((tm.include || []).filter(n => (tm.exclude || []).includes(n)));
    if (overlap.length) push(warnings, `${where}：角色「${overlap.join('、')}」同时出现在必要队友和排除队友里；如果必要队友用「与」而排除队友用「或」，条件会恒为假，请确认这是你想要的组合`, a.id);

    // morePriorities
    (a.morePriorities || []).forEach((mp, i) => {
      const label = `${where} 额外触发条件 #${i + 1}`;
      const mv = condValidate(mp.text, { actionNames: names, knownIndexes: idxSet, currentAction: a });
      for (const e of mv.errors) push(errors, `${label} —— ${e}`, a.id);
      for (const w of mv.warnings) push(warnings, `${label} —— ${w}`, a.id);
      if (!mp.scope || mp.scope.type === null || mp.scope.type === undefined || mp.scope.type === '') {
        if (mp.manualPriority) push(warnings, `${label}：priority=${mp.priority} 来自导入的手工数值，尚未选择「优先于/次于」哪一类动作；如需重算请先做选择`, a.id);
        else push(errors, `${label}：还没有选择「优先于/次于」哪一类动作，无法确定 priority`, a.id);
      } else {
        const expected = computePriority(mp.scope, mp.cmp, actions);
        if (expected && expected.priority !== mp.priority) {
          push(warnings, `${label}：当前 priority=${mp.priority}，按现在的选择重新计算应为 ${expected.priority}（可点“重算”同步）`, a.id);
        }
      }
    });

    // 引用检查
    const refs = condCollectRefs(condParse(a.conditionText, names).ast || null, { indexes: [], names: [] });
    for (const n of refs.names) if (!names.some(x => x.toLowerCase() === n.toLowerCase())) push(errors, `${where}：条件里引用了不存在的动作名「${n}」`, a.id);
    for (const ix of refs.indexes) if (!idxSet.has(ix.value)) push(warnings, `${where}：条件里引用了 index=${ix.value}，但本策略中不存在该编号的动作`, a.id);
  }

  // 容量检查
  const groups = new Map();
  for (const a of actions) {
    const k = `${a.character || ''}|${a.type}`;
    groups.set(k, (groups.get(k) || 0) + 1);
  }
  for (const [k, c] of groups) {
    const [ch, t] = k.split('|');
    const cap = capacityOfType(Number(t));
    if (c > cap) {
      push(errors, `「${ch || '当前角色'}」的「${actionTypeName(Number(t))}」动作有 ${c} 条，超过上限 ${cap} 条`, null);
    }
  }

  // 隐式转换（数值 ↔ 布尔）：不作为错误/警告，由侧栏「隐式转换检查」单独展示
  const conversions = [];
  const addConv = (list, where, text, reason) => {
    for (const c of list) conversions.push({ actionId: null, where, text: c.text, reason: c.reason });
  };
  for (const a of actions) {
    const where = `动作「${a.name || '(未命名)'}」（${a.character || '当前角色'}）`;
    const own = (a.conditionText || '').trim();
    if (own) {
      const p = condParse(own, names);
      if (!p.error && p.ast) addConv(condCollectConversions(p.ast, names), `${where} 基础触发条件`, own);
    }
    (a.morePriorities || []).forEach((mp, i) => {
      const t = (mp.text || '').trim();
      if (!t) return;
      const p = condParse(t, names);
      if (!p.error && p.ast) addConv(condCollectConversions(p.ast, names), `${where} 其他触发条件 #${i + 1}`, t);
    });
  }

  return { errors, warnings, conversions };
}

/** 为不符合编号规则的动作生成重排方案：返回 { map: Map(oldIndex -> newIndex), changes: [] } 或 { error } */
function planRenumber() {
  const actions = state.strategy.actions;
  const map = new Map();
  const changes = [];
  const used = new Set();
  // 先按“角色 + 类型”分组，组内保持原有 index 升序
  const groups = new Map();
  actions.forEach((a, i) => {
    const key = `${a.character || ''}|${a.type}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ a, i });
  });
  for (const [key, list] of groups) {
    const [character, typeStr] = key.split('|');
    const type = Number(typeStr);
    list.sort((x, y) => (x.a.index - y.a.index) || (x.i - y.i));
    if (list.length > capacityOfType(type)) {
      return { error: `「${character || '当前角色'}」的「${actionTypeName(type)}」动作有 ${list.length} 条，超过上限 ${capacityOfType(type)} 条，无法自动编号。请先删除或改类型。` };
    }
    const av = character ? getAvatar(character) : { code: 0, seq: 0 };
    if (character && !av) return { error: `角色「${character}」不在角色表中，无法自动编号。` };
    list.forEach((item, k) => {
      const slot = k + 1;
      item.a.__newSlot = slot;           // 每条动作都要重算（哪怕 index 恰好没变，也要从手工模式切回自动模式）
      const ni = makeIndex(type, av.code, av.seq, slot);
      if (ni !== item.a.index) changes.push({ id: item.a.id, name: item.a.name, from: item.a.index, to: ni, type, character, slot });
      map.set(item.a.index, ni);
      used.add(ni);
    });
  }
  return { map, changes };
}

/** 应用重排（同时重写条件里的数字引用） */
function applyRenumber(plan) {
  const actions = state.strategy.actions;
  // 先清掉所有手工标记：重排之后一律改由编号规则自动推导
  for (const a of actions) a.manualIndex = false;
  for (const a of actions) {
    if (a.__newSlot !== undefined) {
      a.slot = a.__newSlot;
      a.indexViolation = false;
      delete a.__newSlot;
    }
  }
  const rewriteCond = (text) => {
    const parsed = condParse(text || '', allActionNames(actions));
    if (parsed.error) return { text, error: parsed.error };
    const r = condRewriteIndexes(parsed.ast, plan.map);
    return { text: condToText(r.ast), changed: r.changed };
  };
  const notes = [];
  for (const a of actions) {
    if (a.conditionText) {
      const r = rewriteCond(a.conditionText);
      if (r.error) notes.push(`动作「${a.name}」的基础条件无法解析，未改引用：${r.error}`);
      else if (r.changed) { a.conditionText = r.text; a.conditionAst = null; notes.push(`动作「${a.name}」的基础条件中的 index 引用已同步更新`); }
    }
    (a.morePriorities || []).forEach((mp, i) => {
      if (!mp.text) return;
      const r = rewriteCond(mp.text);
      if (r.error) notes.push(`动作「${a.name}」额外条件 #${i + 1} 无法解析，未改引用：${r.error}`);
      else if (r.changed) { mp.text = r.text; notes.push(`动作「${a.name}」额外条件 #${i + 1} 中的 index 引用已同步更新`); }
    });
  }
  recomputeIndexes(actions);
  actions.sort((x, y) => x.index - y.index);
  return notes;
}

/* ---------------- 优先级条目展开（预览用） ---------------- */

/** 展开为优先级条目列表（模拟 BetterGI 主循环的展开 + 稳定排序） */
function expandPriorities(actions, teamFilter) {
  const list = [];
  const filtered = actions.filter(a => {
    if (!teamFilter || !teamFilter.length) return true;
    return !a.character || teamFilter.includes(a.character);
  });
  filtered.forEach((a, order) => {
    list.push({
      order: order * 1000 + 0,
      priority: a.index,
      index: a.index,
      name: a.name || '(未命名)',
      character: a.character || '当前角色',
      expression: buildExpression(a, actions),
      source: '主条目',
      action: a,
      dropped: a.character && teamFilter && teamFilter.length ? !teamFilter.includes(a.character) : false,
    });
    buildMorePriorities(a, actions).forEach((mp, i) => {
      list.push({
        order: order * 1000 + i + 1,
        priority: mp.priority,
        index: a.index,
        name: a.name || '(未命名)',
        character: a.character || '当前角色',
        expression: mp.expression,
        source: `额外条件 #${i + 1}`,
        action: a,
      });
    });
  });
  list.sort((x, y) => (x.priority - y.priority) || (x.order - y.order));
  return list;
}

/* ---------------- 导入 / 导出 ---------------- */

/** 导出为 BetterGI 可用的 JSON 对象。
 *  字段顺序固定：info 是 name,author[,version],description,config,preActions；
 *  action 是 name,character,action,condition,ensureCast,index[,tags][,morePriorities]。
 *  约定（保证「导出 → 再导入」不改变界面上的内容）：
 *    · version 为空时省略该字段，再次导入时「版本」一项仍为空；
 *    · tags 为空时省略该字段，再次导入时「注释」一项仍为空；
 *    · tags 的位置放在 index 下面、morePriorities 上面。
 */
function buildJson() {
  const s = state.strategy;
  const actions = [...s.actions].sort((a, b) => a.index - b.index).map(a => {
    const mps = buildMorePriorities(a, s.actions);
    const tags = String(a.tags || '');
    const o = {
      name: a.name || '',
      character: a.character || '',
      action: a.action || '',
      condition: { expression: buildExpression(a, s.actions) },
      ensureCast: !!a.ensureCast,
      index: a.index,
    };
    if (tags.trim()) o.tags = tags;
    // 命座要求：0（无命座要求）时不写这个字段（写进去没有任何作用）
    const consReq = consRequirementOf(a);
    if (consReq) o.consRequirement = consReq;
    if (mps.length) o.morePriorities = mps.map(m => ({ expression: m.expression, priority: m.priority }));
    return o;
  });
  const version = String(s.info.version || '');
  const info = {
    name: s.info.name || '',
    author: s.info.author || '',
  };
  if (version.trim()) info.version = version;
  info.description = s.info.description || '';
  info.config = s.info.config && Object.keys(s.info.config).length ? s.info.config : {};
  info.preActions = (s.info.preActions || []).map(pa => {
    const cmd = (pa.cmd || '').trim();
    if (!cmd) return '';
    return pa.character ? `${pa.character} ${cmd}` : cmd;
  }).filter(x => x !== '');
  return { info, actions };
}

/** 导出文本 */
function buildJsonText() {
  return JSON.stringify(buildJson(), null, 2);
}

/** 按指令内容猜测动作类型（用于从旧版编号的文件导入时给出合理初值） */
function guessActionType(actionStr, name) {
  const txt = `${actionStr || ''}`;
  const nm = `${name || ''}`;
  if (/(^|,)check(,|$)/.test(txt) || /检测|检查/.test(nm)) return 0;
  if (/开盾|盾|护盾|结盾/.test(nm)) return 1;
  if (/(^|,)q(,|\(|$)/.test(txt) || /burst/.test(txt) || /(^|-)q$/.test(nm)) return 5;
  if (/治疗|回血|奶/.test(nm)) return 7;
  if (/charge/.test(txt) || /重击/.test(txt)) return 6;
  if (/(^|,)e(,|\(|$)/.test(txt) || /skill/.test(txt) || /keypress\(e\)/i.test(txt) || /keydown\(e\)/i.test(txt)) {
    if (/wait\(0\)|attack\b/.test(txt)) return 2;
    return 4;
  }
  if (/^\s*wait\(/.test(txt) && !/[a-z]/i.test(txt.replace(/wait|[\d.(),\s]/g, ''))) return 9;
  if (/attack/.test(txt) || /click/.test(txt) || /keydown\(VK_LBUTTON\)/.test(txt)) return 8;
  return 4;
}

/**
 * 按需求推定动作类型（导入时 index 不符合内置编号规则时的默认选择）：
 *   1) 开了 ensureCast 且有 e / keypress(e) 之类指令 → 开盾(1)
 *   2) 没开 ensureCast 但有 e / keypress(e) 之类指令 → 辅助(4)
 *   3) 没有 e 类指令、有 q / keypress(q) 之类指令 → 爆发(5)
 *   4) 没有 e / q 类指令、有 attack / charge 之类指令 → 纯挂元素普攻(8)
 *   5) 上述攻击动作全都没有 → 兜底普攻/等待(9)
 */
function inferActionType(actionStr, name, ensureCast) {
  const txt = `${actionStr || ''}`;
  const hasE = /(^|,)(e|skill)(,|\(|$)/.test(txt) || /keypress\(\s*e\s*\)/i.test(txt) || /keydown\(\s*e\s*\)/i.test(txt);
  if (hasE) return ensureCast ? 1 : 4;
  const hasQ = /(^|,)(q|burst)(,|\(|$)/.test(txt) || /keypress\(\s*q\s*\)/i.test(txt) || /keydown\(\s*q\s*\)/i.test(txt);
  if (hasQ) return 5;
  const hasAtk = /(^|,)(attack|charge|普攻|普通攻击|重击)(,|\(|$)/.test(txt) || /keydown\(VK_LBUTTON\)/.test(txt) || /(^|,)click\b/.test(txt);
  if (hasAtk) return 8;
  return 9;
}

/** 导入：解析 + 修复（裸字符串 condition / index 重排） */

/** 动作节点里本编辑器认得的字段（比较时忽略大小写，因为 BetterGI 用的 Newtonsoft.Json 大小写不敏感）。
 *  其余字段一律忽略，但会在导入弹窗里提醒（见 unknownFields）。 */
const KNOWN_ACTION_KEYS = new Set(['name', 'character', 'action', 'condition', 'index', 'ensurecast', 'morepriorities', 'tags', 'consrequirement']);

function analyzeImport(obj) {
  const problems = [];
  const fatal = [];
  if (!obj || typeof obj !== 'object') return { fatal: ['JSON 根节点不是对象'], problems };
  if (obj.info === null) fatal.push('JSON 战斗策略缺少 Info 节点（info 显式写成了 null）');
  if (!Array.isArray(obj.actions) || obj.actions.length === 0) fatal.push('JSON 战斗策略中未定义任何动作（actions 缺失、为 null 或空数组）');
  if (fatal.length) return { fatal, problems };

  const actions = [];
  const elementFixes = [];   // 导入时按角色所属元素改写 index 元素位的记录
  const unknownFields = [];  // 既不能识别、也不支持编辑的额外字段（导入时统一提醒，不静默忽略）
  obj.actions.forEach((raw, i) => {
    const label = `第 ${i + 1} 个动作`;
    if (!raw || typeof raw !== 'object') { fatal.push(`${label} 不是对象`); return; }
    const a = createAction({});
    a.name = typeof raw.name === 'string' ? raw.name : '';
    a.character = typeof raw.character === 'string' ? raw.character : '';
    a.action = typeof raw.action === 'string' ? raw.action : '';
    a.index = Number.isInteger(raw.index) ? raw.index : 0;
    a.manualIndex = true;
    a.ensureCast = raw.ensureCast === undefined ? null : !!raw.ensureCast;
    // tags：本编辑器约定用来保存「注释」。不是字符串时按空处理（该字段本来就不参与运行）。
    // 比较时忽略大小写：BetterGI 用的 Newtonsoft.Json 大小写不敏感，写 Tags / TAGS 也能被识别。
    const tagKey = Object.keys(raw).find(k => String(k).toLowerCase() === 'tags');
    a.tags = tagKey !== undefined && typeof raw[tagKey] === 'string' ? raw[tagKey] : '';
    // consRequirement：本编辑器约定用来保存「命座要求」（见文件上方说明）。
    // 同样忽略大小写；值必须是 -6~-1 / 1~6 的整数，0 或缺失 = 无命座要求，
    // 其它取值按 0 处理（BetterGI 本来就忽略这个字段，导入时不该因为写错值而报错）。
    const consKey = Object.keys(raw).find(k => String(k).toLowerCase() === 'consrequirement');
    const consRaw = consKey === undefined ? undefined : raw[consKey];
    a.consRequirement = (Number.isInteger(consRaw) && consRaw !== 0 && Math.abs(consRaw) <= CONS_MAX) ? consRaw : 0;
    applyConsRequirement(a, a.consRequirement);
    // 多余字段（例如正式版 BGI 里不存在的 redArrowAim）：BetterGI 会静默忽略，本编辑器也忽略，
    // 但要在导入弹窗里列出来提醒用户（否则用户会以为这些内容被保存了）。
    for (const k of Object.keys(raw)) {
      if (KNOWN_ACTION_KEYS.has(String(k).toLowerCase())) continue;
      unknownFields.push(`第 ${i + 1} 个动作（${a.name || '未命名'}）里的字段「${k}」既不能识别、也不支持编辑，导入时已忽略；导出时不会写回。`);
    }

    // condition 兼容：对象 / 裸字符串 / 缺失
    const cond = raw.condition;
    if (cond === undefined || cond === null) a.conditionText = '';
    else if (typeof cond === 'string') { a.conditionText = cond; problems.push({ kind: 'cond-string', actionId: a.id, text: `${label}（${a.name || '未命名'}）的 condition 是裸字符串，BetterGI 反序列化会失败，需要修复为 {"expression": "..."}` }); }
    else if (typeof cond === 'object') a.conditionText = typeof cond.expression === 'string' ? cond.expression : '';
    else { a.conditionText = ''; problems.push({ kind: 'cond-bad', actionId: a.id, text: `${label} 的 condition 类型无法识别，已清空` }); }

    if (Array.isArray(raw.morePriorities)) {
      raw.morePriorities.forEach((mp, k) => {
        if (!mp || typeof mp !== 'object') return;
        a.morePriorities.push({
          id: newId(),
          text: typeof mp.expression === 'string' ? mp.expression : '',
          priority: Number.isInteger(mp.priority) ? mp.priority : 0,
          cmp: null,
          scope: { type: null, element: '', character: '' },
          manualPriority: true,
        });
      });
    }

    // 编号解析：判断是否符合规则
    // 说明：旧文件里的 index 往往是纯优先级数值（10/20/41…），只够推断出“这是一条动作”，
    // 推不出动作类型；因此导入时先按需求推一个类型作为初值，用户可在卡片里用「切换动作类型」修正。
    const pi = parseIndex(a.index);
    const av = a.character ? getAvatar(a.character) : { code: 0, seq: 0 };
    // 这些动作统一重排成“动作类型 0”（战斗检查与标记），用于让后续的类型推断落到兜底类型上
    const forceType0 = /(^|,)check(,|$)/.test(a.action || '') || /战斗结束|结束检查/.test(a.name || '');
    let indexMatches = false;
    if (pi.ok && av && pi.code === av.code && pi.seq === av.seq) {
      a.type = pi.type; a.slot = pi.slot;
      indexMatches = true;
    } else if (pi.ok && av && pi.type !== 0 && pi.seq === av.seq && pi.code !== av.code) {
      // 元素位修正：尾数与角色位都能对上，只有元素位不同 —— 典型情况是旧版编辑器用的元素号
      // 分派与现在不同（水/冰互换过）。这里只按角色所属元素改写元素位，其余保持不变，
      // 不触发“整体重排编号”，避免把用户原有的尾数顺序打乱。
      const from = a.index;
      a.type = pi.type;
      a.slot = pi.slot;
      a.index = makeIndex(pi.type, av.code, av.seq, pi.slot);
      elementFixes.push({
        from, to: a.index,
        text: `${label}（${a.name || '未命名'}）的 index=${from} 的元素位是 ${pi.code}，与角色「${a.character}」所属的 ${elementLabel(av.code)} 不符，已按角色修正为 ${a.index}`,
      });
      indexMatches = true;
    } else {
      const inferred = forceType0 ? 0 : inferActionType(a.action, a.name, a.ensureCast === true);
      problems.push({
        kind: 'index',
        actionId: a.id,
        text: `${label}（${a.name || '未命名'}）的 index=${a.index} 不符合编号规则：${pi.ok ? '元素/角色位与角色不符' : pi.reason}；将按「${actionTypeName(inferred)}」重新编号`
      });
      a.indexViolation = true;
      a.__typeInferred = true;
      a.type = inferred;
      a.slot = 1;
    }
    if (pi.ok && pi.type !== 0 && pi.code === 0 && pi.seq === 0 && a.type !== 0) {
      // 通用动作：合法
    }
    if (a.character && !av) problems.push({ kind: 'character', actionId: a.id, text: `${label} 的角色「${a.character}」不在角色表中，该动作会在开战前被静默过滤` });
    if (a.ensureCast === null) a.ensureCast = a.type === 1; // 未写 ensureCast：按类型默认（开盾默认勾选）
    actions.push(a);
  });

  // 索引不符合规则时的动作类型默认选择：类型满了就顺延到编号更大的类型（9 → 1 → …，最多顺延 8 次）
  const INFER_ORDER = [1, 4, 5, 8, 9];
  for (const a of actions) {
    if (!a.indexViolation) continue;
    const base = a.type === 0 ? 9 : a.type; // 类型 0 只有一个槽位：满了就从类型 9 开始顺延
    const start = INFER_ORDER.indexOf(base);
    const order = start >= 0 ? INFER_ORDER.slice(start).concat(INFER_ORDER.slice(0, start)) : INFER_ORDER;
    let picked = null;
    let kept = false;
    for (let k = 0; k < 8 && k < order.length; k++) {
      const t = order[k];
      const used = countOfType(actions, a.character || '', t);
      if (used < MAX_SLOT) { picked = t; break; }
      if (t === base) kept = true;
    }
    if (picked === null) {
      a.__drop = true;
      problems.push({ kind: 'capacity', text: `动作「${a.name || '未命名'}」（原 index=${a.index}）连续顺延 8 次仍找不到有空位的动作类型，导入时会被删除` });
      continue;
    }
    if (picked !== a.type) {
      problems.push({
        kind: 'type-shift',
        text: `动作「${a.name || '未命名'}」（原 index=${a.index}）：原定的「${actionTypeName(a.type)}」已满，顺延到「${actionTypeName(picked)}」`
      });
      a.type = picked;
      if (a.__typeInferred) a.ensureCast = picked === 1;
    } else if (kept) {
      /* 原本就落在顺延起点上，无需提示 */
    }
    a.slot = 1;
  }
  // 顺延结果可能让尾数互相冲突，这里按「角色 + 类型」重新分配尾数
  // （只处理重排了编号的动作：index 本来就对得上的动作要保留文件里的尾数，否则界面上
  //  “尾数”下拉框会和 index 的尾数位对不上）
  {
    const seq = new Map();
    for (const a of actions) {
      if (a.__drop) continue;
      if (!a.indexViolation) continue;
      const key = `${a.character || ''}|${a.type}`;
      const n = (seq.get(key) || 0) + 1;
      seq.set(key, n);
      a.slot = n > MAX_SLOT ? 1 : n;
    }
  }

  // 元素位修正后，同步改写条件里的 index 数字引用（since / count / last-exec）
  if (elementFixes.length) {
    const fixMap = new Map(elementFixes.map(f => [f.from, f.to]));
    const rewriteRefs = (text) => {
      if (!text) return text;
      const p = condParse(text, allActionNames(actions));
      if (p.error || !p.ast) return text;
      const r = condRewriteIndexes(p.ast, fixMap);
      return r.changed ? condToText(r.ast) : text;
    };
    for (const a of actions) {
      a.conditionText = rewriteRefs(a.conditionText);
      for (const mp of a.morePriorities) mp.text = rewriteRefs(mp.text);
    }
    for (const f of elementFixes) problems.push({ kind: 'element-fix', text: f.text });
  }

  /* ---- 把 expression 拆回「触发条件」与「队友条件」 ----
   * 之前的版本把整条 expression 都当成触发条件，导致自己保存的队友条件（in-party）也被塞进触发条件里。
   * 这里按「(触发条件) && (队友条件)」的结构反推；队友条件以 in-party 为特征。
   * 「不一致」按动作判定：
   *   - 同一个动作自己的 condition.expression 与 morePriorities 的队友条件不一致；
   *   - 只有 morePriorities 带队友条件、主条件没带（导出时主条件会被补上队友条件）；
   *   - 队友条件结构拆不出来（保持原样导入）。
   * 以上三种情况会记一条提示并在导入/读草稿时提醒。
   */
  {
    const names = allActionNames(actions);
    for (const a of actions) {
      a.teammates.autoExcludeSameType = false;   // 由下面按 expression 的实际内容还原
      a.teammates.autoExclude = [];
      a.__split = [
        { loc: 'cond', ...splitTriggerAndTeammate(a.conditionText, names) },
        ...a.morePriorities.map((mp, i) => ({ loc: 'mp', idx: i, ...splitTriggerAndTeammate(mp.text, names) })),
      ];
    }
    for (const a of actions) {
      const label = `动作「${a.name || '未命名'}」`;
      const withTm = a.__split.filter(e => e.teammate);
      const bad = withTm.filter(e => !e.teammate.ok);
      const good = withTm.filter(e => e.teammate.ok);
      // 拆得出来的：触发条件部分写回；拆不出来的（teammate.ok=false，trigger 保留原文）自然不动
      for (const e of good) {
        if (e.loc === 'cond') a.conditionText = e.trigger;
        else if (a.morePriorities[e.idx]) a.morePriorities[e.idx].text = e.trigger;
      }
      // 没有队友条件的那几条也要把「命座要求」剥掉（否则 expression 会整条变成触发条件）
      for (const e of a.__split) {
        if (e.teammate) continue;
        if (e.loc === 'cond') a.conditionText = e.trigger;
        else if (a.morePriorities[e.idx]) a.morePriorities[e.idx].text = e.trigger;
      }
      // ---- 命座要求（consRequirement） ----
      // 布尔值来自各条 expression 末尾/中间的命座要求段；一条都没认出来时按 true 处理
      // （没有那一句 `&& (false)` 就说明这条动作在对应命座下是启用的）。
      const consVals = a.__split.filter(e => e.cons !== undefined && e.cons !== null).map(e => e.cons);
      if (consHasRequirement(a)) {
        // 同一个动作的各条 expression 理论上应当一致；不一致时以主条件（没有则第一条）为准，
        // 并给出提示（导出时所有 expression 都会按这个选择重写）。
        const want = consVals.length ? consVals[0] : true;
        if (consVals.some(v => v !== want)) {
          problems.push({
            kind: 'cons-mismatch',
            actionId: a.id,
            text: `${label}：主条件与其他触发条件的「命座要求」布尔值不一致，已按${
              a.__split.find(e => e.cons !== undefined && e.cons !== null && e.loc === 'cond') ? '主条件' : '第一条其他触发条件'
            }导入；导出时各条 expression 的命座要求都会写成同一个值。`,
          });
        }
        // 三个信息分别来自两个地方（见文件上方的说明，合起来一一对应）：
        //   · consRequirement 的**符号** → 模式（正 = 达到命座开启、负 = 达到命座关闭）；
        //   · expression 里那一段布尔字面量 → 「启用 / 停用」；
        //   · 勾选状态 = （模式是「开启」）=== 那个布尔值。
        // 这样「达到命座开启 + 不勾选」与「达到命座关闭 + 勾选」虽然数值相同，也能各自原样还原，
        // 不会出现「本来没勾上的，导入后变成勾上」。
        const exprVal = consVals.length ? consVals[0] : true;
        a.consEnabled = consEnabledFromExpr(a.consMode, exprVal);
        a.consRequirement = consRequirementOf(a);
      } else {
        // 没有可用的 consRequirement 数值（0 / 缺失 / 超范围）：只按布尔值没法确定模式与命座数，
        // 这时丢弃命座要求那一段（触发条件已经剥出来了，不会丢内容）。
        a.consMode = 'none'; a.consTarget = 0; a.consEnabled = false; a.consRequirement = 0;
      }
      if (bad.length) {
        const where = bad.map(e => (e.loc === 'cond' ? '主条件' : `其他触发条件 #${e.idx + 1}`)).join('、');
        problems.push({
          kind: 'teammate-split',
          actionId: a.id,
          text: good.length
            ? `${label}：${where} 里的队友条件结构不属于「(必要队友) && (排除队友) && (自动排除)」（${bad[0].teammate.reason}），这部分保持原样、未拆分。`
            : `${label}：expression 里出现了 in-party，但不属于「(必要队友) && (排除队友) && (自动排除)」这几种结构（${bad[0].teammate.reason}），已整条按触发条件导入，未改动内容。`,
        });
      }
      if (!good.length) continue;
      const primary = good.find(e => e.loc === 'cond') || good[0];
      if (primary.loc !== 'cond') {
        problems.push({
          kind: 'teammate-split',
          actionId: a.id,
          text: `${label}：主条件（condition.expression）里没有可识别的队友条件，已按其他触发条件 #${primary.idx + 1} 的队友条件导入；导出时主条件也会被补上这段队友条件。`,
        });
      }
      for (const e of good) {
        if (e === primary) continue;
        if (e.teammateText === primary.teammateText) continue;
        problems.push({
          kind: 'teammate-split',
          actionId: a.id,
          text: `${label}：${e.loc === 'cond' ? '主条件' : `其他触发条件 #${e.idx + 1}`} 的队友条件与所采用的队友条件不一致，已按「${primary.loc === 'cond' ? '主条件' : `其他触发条件 #${primary.idx + 1}`}」的队友条件导入，该 expression 的队友条件部分会被替换。`,
        });
      }
      a.__tmParse = primary.teammate;
    }
    // 第一步：先写「必要队友」（自动排除的比对要用到其他动作的必要队友表达式）
    for (const a of actions) if (a.__tmParse) applyTeammateInclude(a, a.__tmParse);
    // 第二步：排除队友 / 自动排除
    for (const a of actions) {
      const tm = a.__tmParse;
      if (!tm) continue;
      const others = actions.filter(o => o.id !== a.id && (o.character || '') === (a.character || ''));
      const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      // 拆「排除队友」与「自动排除」。规则（见 decomposeTeammate 的说明）：
      //   · 本编辑器新格式的表达式里，结构 c) 一定带一个 `(true)` 格式标记 ——
      //     见到它就说明这份队友条件是新格式，取非项只需按「是否等于同角色其他动作的
      //     必要队友表达式」区分自动排除与排除队友；
      //   · 没有 `true` 占位（旧格式 / 手写表达式）时两种写法解析后同形，无法区分，
      //     为不吞掉用户手选的排除队友，一律按排除队友还原。
      const autoMatch = (want) => (want ? others.find(o => {
        const inc = includeExprOf(o.teammates);
        return inc && norm(inc) === want;
      }) : null);
      const structured = (tm.ops || []).some(n => n.type === 'bool' && n.value === true);
      const groups = tm.autoGroups || [];
      // 结构 c) 的操作数顺序固定为「必要队友 / 排除队友 / (true) 标记 / 自动排除…」，
      // 所以手选的「排除队友」只会出现在开头，末尾连续能对应到其他动作必要队友的那一段才是自动排除。
      // structured=false（旧格式 / 手写表达式）时全部按「排除队友」还原，绝不吞掉用户手选的内容。
      const autoNegs = [];
      const keptNegs = [];
      if (structured) {
        let autoStart = groups.length;
        while (autoStart > 0 && autoMatch(norm(groups[autoStart - 1].matcherText))) autoStart--;
        for (let i = 0; i < groups.length; i++) (i < autoStart ? keptNegs : autoNegs).push(groups[i]);
      } else {
        for (const g of groups) keptNegs.push(g);
      }
      for (const g of autoNegs) {
        const hit = autoMatch(norm(g.matcherText));
        if (hit && !a.teammates.autoExclude.includes(hit.id)) a.teammates.autoExclude.push(hit.id);
      }
      // 剩下没被认成自动排除的取非项就是「排除队友」。每项都已经由 decomposeTeammate 预先算成
      // 用户所选的写法（negChain）：新格式 `!(甲 && 乙)` 原样采用，旧格式 `!甲 && !乙` 按德摩根反推。
      const keptChains = keptNegs.map(g => g.negChain || g.chain);
      applyTeammateExclude(a, keptChains.map(chain => ({ chain })));
      // 还原「自动排除其他同一动作类型动作的必要队友」的勾选状态：
      //   · 同类其他动作里，凡设置了必要队友的，其必要队友都已经体现在本动作的排除条件里
      //     （显式勾选的 autoExclude，或者手选的「排除队友」表达式恰好就是那条必要队友）→ 勾上；
      //   · 同类其他动作里一个设置必要队友的都没有 → 勾上（勾不勾表达式都一样，保持默认值）；
      //   · 只在其中一部分被覆盖时 → 不勾（用户是逐条手选的）。
      {
        const excText = excludeExprOf(a.teammates);
        const covered = (o) => a.teammates.autoExclude.includes(o.id)
          || (!!excText && norm(excText) === norm(includeExprOf(o.teammates)));
        const withInc = others.filter(o => o.type === a.type && includeExprOf(o.teammates));
        a.teammates.autoExcludeSameType = withInc.every(covered);
      }
    }
    // 队友那块没有出现在 expression 里的动作（一个 in-party 都没有：必要队友、排除队友、自动排除全空）：
    // 上面那条还原规则同样适用，否则这个勾选会在往返之后从「勾上」掉成「不勾」。
    // 这类动作的排除条件为空，所以「同类其他动作里凡设置了必要队友的都已被覆盖」等价于
    // 「同类其他动作里根本没有设置必要队友的」。
    for (const a of actions) {
      if (a.__tmParse) continue;
      const others = actions.filter(o => o.id !== a.id && (o.character || '') === (a.character || ''));
      const withInc = others.filter(o => o.type === a.type && includeExprOf(o.teammates));
      a.teammates.autoExcludeSameType = withInc.length === 0;
    }
    for (const a of actions) { delete a.__split; delete a.__tmParse; }
  }

  // 其他触发条件的 priority：优先把数值还原成「优先于/次于某类动作」的选择；
  // 尾数不为 0 的数值还原不了选择，给出修正方案（判定顺序固定为“次于”）。
  const parseScopeFromPriority = (p) => {
    const type = Math.max(0, Math.min(9, Math.floor(p / 10000)));
    const element = Math.floor(p / 1000) % 10;
    const seq = Math.floor(p / 10) % 100;
    let scope = { type, element: '', character: '' };
    if (type !== 0 && element >= 1 && element <= 7) {
      const av = AVATAR_BY_INDEX.get(element * 100 + seq);
      scope = { type, element, character: av && av.seq ? av.name : '' };
    }
    if (!priorityRange(scope)) scope = { type, element: '', character: '' };
    return scope;
  };
  actions.forEach((a) => {
    const label = `动作「${a.name || '未命名'}」`;
    // 默认保留全部其他触发条件：只有“尾数不为 0、且修正后落在同一个段边界”的重复条目才去重。
    const keep = new Set(a.morePriorities);
    const groups = new Map();
    a.morePriorities.forEach((mp, i) => {
      let p = mp.priority;
      if (!Number.isInteger(p)) { mp.priority = 0; p = 0; }
      const slot = ((p % 10) + 10) % 10;
      if (slot === 0) {
        // 尾数为 0：数值本身就是某个段的边界，直接还原成「优先于/次于某类动作」
        // （同一个数值既能解释成“优先于某段”也能解释成“次于上一段”时，优先选“次于”）
        const back = priorityScopeFromNumber(p);
        if (back) {
          mp.scope = back.scope;
          mp.cmp = back.cmp;
          mp.manualPriority = false;
        } else {
          mp.manualPriority = true;   // 还原不了的数值原样保留
        }
        return;
      }
      const scope = parseScopeFromPriority(p);
      mp.scope = scope;
      mp.cmp = 'after';
      mp.manualPriority = false;
      const fixed = computePriority(scope, 'after', actions);
      const target = fixed ? fixed.priority : p - slot + 1;
      problems.push({
        kind: 'priority-tail',
        actionId: a.id,
        text: `${label} 其他触发条件 #${i + 1}：priority=${p} 的尾数是 ${slot}（非 0）。尾数 0 已预留给额外触发条件的优先级数值插入，正常值应形如 ${scope.type}0000；修正后为 ${target}（判定顺序按“次于”处理）`,
        fix: { index: i, from: p, to: target, scope, cmp: 'after' },
      });
      // 同一 priority 同时存在“优先于/次于”且指向同一判定范围时，优先保留“次于”的情况
      const key = `${a.id}|${target}`;
      const prev = groups.get(key);
      if (!prev) groups.set(key, mp);
      else if (prev.cmp === 'before' && mp.cmp === 'after') { keep.delete(prev); groups.set(key, mp); }
      else keep.delete(mp);
    });
    a.__mpKeep = keep;
  });

  // 同角色同类型超过 9 条 / 尾数重复
  const usedKeys = new Map();
  for (const a of actions) {
    const key = `${a.character || ''}|${a.type}|${a.slot}`;
    if (usedKeys.has(key)) { problems.push({ kind: 'dup', actionId: a.id, text: `动作「${a.name || '未命名'}」与「${usedKeys.get(key)}」的 index 重复（${a.index}）` }); a.duplicateIndex = true; }
    else usedKeys.set(key, a.name || '未命名');
  }
  const cnt = new Map();
  for (const a of actions) { const k = `${a.character || ''}|${a.type}`; cnt.set(k, (cnt.get(k) || 0) + 1); }
  for (const [k, c] of cnt) {
    const cap = capacityOfType(Number(k.split('|')[1]));
    if (c > cap) {
      const [ch, t] = k.split('|');
      problems.push({ kind: 'capacity', text: `「${ch || '当前角色'}」的「${actionTypeName(Number(t))}」动作有 ${c} 条，超过上限 ${cap} 条，需要删除或改类型后才能导入` });
    }
  }

  // info
  const info = { name: '', author: '', version: '', description: '', config: {}, preActions: [] };
  if (obj.info && typeof obj.info === 'object') {
    info.name = typeof obj.info.name === 'string' ? obj.info.name : '';
    info.author = typeof obj.info.author === 'string' ? obj.info.author : '';
    info.version = typeof obj.info.version === 'string' ? obj.info.version : '';
    info.description = typeof obj.info.description === 'string' ? obj.info.description : '';
    if (obj.info.config && typeof obj.info.config === 'object') info.config = obj.info.config;
    if (Array.isArray(obj.info.preActions)) {
      info.preActions = obj.info.preActions.filter(x => typeof x === 'string' && x.trim() !== '').map(line => {
        const sp = line.indexOf(' ');
        if (sp < 0) return { character: '', cmd: line.trim() };
        const maybeChar = line.slice(0, sp).trim();
        const rest = line.slice(sp + 1).trim();
        if (getAvatar(maybeChar)) return { character: maybeChar, cmd: rest };
        return { character: '', cmd: line.trim() };
      });
    }
  }
  // 多余字段统一提醒（收集在最后，避免提示被后面的流程覆盖）
  for (const t of unknownFields) problems.push({ kind: 'unknown-field', text: t });
  return { fatal, problems, actions, info };
}

/* ---------------- 导入弹窗的分步流程 ---------------- */

/** 可用的导入方式：编号重排 / 优先级尾数修正 / 类型顺延删除 */
function importNeeds(problems) {
  const p = problems || [];
  return {
    hasIndex: p.some(x => x.kind === 'index' || x.kind === 'dup'),
    hasPriorityTail: p.some(x => x.kind === 'priority-tail'),
    hasDrop: p.some(x => x.kind === 'capacity' && /顺延 8 次/.test(x.text)),
    hasCapacity: p.some(x => x.kind === 'capacity' && !/顺延 8 次/.test(x.text)),
  };
}

/** 修正所有「其他触发条件」的 priority 尾数（改成段边界值） */
function fixPriorityTails(problems) {
  for (const p of (problems || [])) {
    if (p.kind !== 'priority-tail' || !p.fix) continue;
    const a = state.strategy.actions.find(x => x.id === p.actionId);
    if (!a) continue;
    const mp = a.morePriorities[p.fix.index];
    if (!mp) continue;
    mp.priority = p.fix.to;
    mp.scope = p.fix.scope;
    mp.cmp = p.fix.cmp;
    mp.manualPriority = false;
  }
}

/** 应用导入结果时：删除无法顺延的动作、按判定范围去重 */
function applyImport(result, opts) {
  const o = opts || {};
  state.strategy.info = { ...state.strategy.info, ...result.info };
  if (typeof app !== 'undefined' && app) app._infoPending = false;   // 整份策略被替换，不再有待落盘的名称/版本
  const actions = (result.actions || []).filter(a => !a.__drop);
  for (const a of actions) {
    const keep = a.__mpKeep;
    if (keep) a.morePriorities = a.morePriorities.filter(mp => keep.has(mp));
    delete a.__mpKeep;
    delete a.__drop;
    delete a.__typeInferred;
    a.conditionCacheFor = null;
    a.conditionAst = null;
  }
  state.strategy.actions = actions;
  if (o.fixPriorityTail) fixPriorityTails(result.problems);
  // 命座要求的勾选状态在同一个角色内必须自洽（有高命必有低命）；
  // 导入的策略里万一出现矛盾（手写 / 改过 expression），这里统一按规则规整一次。
  normalizeAllConsChecks(actions);
  // 导入的动作默认按 index 升序排布
  state.strategy.actions.sort((x, y) => x.index - y.index);
}

/* ---------------- 合并 JSON 策略 ----------------
 * 以「当前正在编辑的策略」为基础，把另一份策略里有差异的部分有选择地并进来：
 *   · info：逐字段比对，当前为空就采用导入版本，两边都有且不同就交给用户逐个选择；
 *   · actions：按 name 配对。没配上的按原动作类型重新分配 index 后直接导入（类型满了顺延，
 *     9 满了顺延到 2）；配上的逐一比对「除 index 以外」的字段，交给用户选择
 *     「保留当前版本 / 使用导入版本替换 / 导入的版本改名后保留」；
 *   · 比对与替换时，条件里「入参为动作」的 index 数值都会按对应策略换算成动作名。
 * 只有能被本编辑器直接导入（不需要重新编号 / 修正 priority）的策略才允许参与合并。
 */

/** 被导入策略里出现这些「需要先调整才能导入本编辑器」的问题时，不允许合并 */
const MERGE_BLOCKING_KINDS = new Set(['index', 'dup', 'capacity', 'priority-tail', 'type-shift', 'element-fix', 'character']);
/** 这些是 BetterGI 反序列化阶段就会失败的情况，按错误原因报错（而不是提示“先单独导入编辑”） */
const MERGE_FATAL_KINDS = new Set(['cond-string', 'cond-bad']);

/**
 * 新导入动作的动作类型顺延顺序：原类型 → 更大 → 9 之后再回到 2 → … → 原类型 - 1。
 * （只用于「没有同名动作、直接导入」时找一个还有空位的类型；都不空则整份拒绝合并。）
 */
function mergeTypeOrder(type) {
  const t = Math.max(0, Math.min(9, Number(type) || 0));
  const out = [t];
  for (let x = t + 1; x <= 9; x++) out.push(x);
  for (let x = 2; x <= t - 1; x++) out.push(x);
  return out;
}

/**
 * 合并前校验被导入的策略（规则 1）。返回 { mode: 'ok'|'fatal'|'needs-edit', reasons, warnings, actions, info }
 *   fatal      —— BetterGI 解析期就会失败（含动作名不合法），按错误原因报错；
 *   needs-edit —— 本身能跑，但编号 / priority 等方面需要调整才能导入本编辑器。
 */
function checkMergeSource(obj) {
  const res = analyzeImport(obj);
  const out = { mode: 'ok', res, reasons: [], warnings: [], actions: [], info: res.info };
  if (res.fatal.length) { out.mode = 'fatal'; out.reasons = res.fatal.slice(); return out; }

  // 和 applyImport 一样：清掉导入过程中的临时标记（被删除的动作本来就会因 capacity 被拒绝）
  const actions = (res.actions || []).filter(a => !a.__drop);
  for (const a of actions) {
    const keep = a.__mpKeep;
    if (keep) a.morePriorities = a.morePriorities.filter(mp => keep.has(mp));
    delete a.__mpKeep; delete a.__drop; delete a.__typeInferred;
    a.conditionCacheFor = null;
    a.conditionAst = null;
  }
  out.actions = actions;

  const names = actions.map(a => a.name).filter(n => n && n.trim());
  const dupNames = [];
  const seen = new Set();
  for (const n of names) { if (seen.has(n)) { if (!dupNames.includes(n)) dupNames.push(n); } else seen.add(n); }
  const badNames = [];
  for (const a of actions) {
    if (!a.name) continue;
    const v = isValidActionName(a.name, names);
    if (!v.ok) badNames.push(`动作「${a.name}」的名称不合法：${v.reason}（BetterGI 解析时会直接抛异常）`);
  }
  if (badNames.length) { out.mode = 'fatal'; out.reasons = badNames; return out; }

  const fatalProblems = (res.problems || []).filter(p => MERGE_FATAL_KINDS.has(p.kind)).map(p => p.text);
  if (fatalProblems.length) { out.mode = 'fatal'; out.reasons = fatalProblems; return out; }

  const reasons = (res.problems || []).filter(p => MERGE_BLOCKING_KINDS.has(p.kind)).map(p => p.text);
  for (const n of dupNames) reasons.push(`动作名「${n}」在被导入的策略里重复出现，请先单独导入并改成不同名称`);
  out.warnings = (res.problems || []).filter(p => !MERGE_BLOCKING_KINDS.has(p.kind) && !MERGE_FATAL_KINDS.has(p.kind)).map(p => p.text);
  if (reasons.length) { out.mode = 'needs-edit'; out.reasons = reasons; }
  return out;
}

/* ---- info 部分（规则 2） ---- */

const MERGE_INFO_FIELDS = [
  { field: 'name', label: '策略名称' },
  { field: 'author', label: '作者' },
  { field: 'version', label: '版本' },
  { field: 'description', label: '描述' },
  { field: 'config', label: '设置（config）' },
  { field: 'preActions', label: '战斗前动作' },
];

function mergeInfoValue(info, field) {
  const i = info || {};
  if (field === 'preActions') {
    return (i.preActions || []).map(pa => (pa.character ? `${pa.character} ${pa.cmd || ''}` : String(pa.cmd || ''))).filter(x => String(x).trim() !== '');
  }
  if (field === 'config') return i.config && Object.keys(i.config).length ? i.config : {};
  const v = i[field];
  return v === undefined || v === null ? '' : String(v);
}
function mergeInfoEmptyValue(v) {
  if (Array.isArray(v)) return v.length === 0;
  if (v && typeof v === 'object') return Object.keys(v).length === 0;
  return String(v).trim() === '';
}
function mergeInfoTextOf(v) {
  if (Array.isArray(v)) return v.join('\n');
  if (v && typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
function mergeInfoSame(a, b) { return mergeInfoTextOf(a) === mergeInfoTextOf(b); }
function cloneMergeValue(v) { return (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v; }

/** 需要用户逐个选择的 info 字段（两边都有内容、且内容不同） */
function mergeInfoDiffs(curInfo, impInfo) {
  const out = [];
  for (const f of MERGE_INFO_FIELDS) {
    const cur = mergeInfoValue(curInfo, f.field);
    const imp = mergeInfoValue(impInfo, f.field);
    if (mergeInfoEmptyValue(cur) || mergeInfoEmptyValue(imp) || mergeInfoSame(cur, imp)) continue;
    out.push({ field: f.field, label: f.label, cur, imp, curText: mergeInfoTextOf(cur), impText: mergeInfoTextOf(imp) });
  }
  return out;
}

/**
 * 按规则 2 合并 info：当前为空 → 采用导入版本；导入为空或相同 → 保留当前；
 * 两边都有且不同 → 看 decisions[field]（'current' | 'imported'，缺省按 current）。
 * 返回 { info: 需要覆盖的字段, notes: 说明文字 }
 */
function applyInfoMerge(curInfo, impInfo, decisions) {
  const dec = decisions || {};
  const info = {};
  const notes = [];
  for (const f of MERGE_INFO_FIELDS) {
    const cur = mergeInfoValue(curInfo, f.field);
    const imp = mergeInfoValue(impInfo, f.field);
    const curEmpty = mergeInfoEmptyValue(cur);
    const impEmpty = mergeInfoEmptyValue(imp);
    if (curEmpty) {
      if (!impEmpty) { info[f.field] = cloneMergeValue(imp); notes.push(`${f.label}：当前为空，采用被导入策略的内容`); }
      continue;
    }
    if (impEmpty) { notes.push(`${f.label}：保留当前版本（被导入策略里为空）`); continue; }
    if (mergeInfoSame(cur, imp)) { notes.push(`${f.label}：两边相同，保留当前版本`); continue; }
    if (dec[f.field] === 'imported') { info[f.field] = cloneMergeValue(imp); notes.push(`${f.label}：已采用被导入策略的内容`); }
    else notes.push(`${f.label}：已保留当前版本的内容`);
  }
  return { info, notes };
}

/* ---- actions 部分（规则 3~5） ---- */

/**
 * 比对用的规范化表达式：把「入参为动作」的条件函数里的 index 数值换成对应策略里的动作名，
 * 再输出规范化文本（解析不了就退回原文），这样两份策略里的同一动作才能按名称对比。
 */
function mergeCanonExpr(text, actions) {
  const t = String(text === null || text === undefined ? '' : text);
  if (!t.trim()) return '';
  const byIndex = new Map();
  for (const a of (actions || [])) if (a.name) byIndex.set(a.index, a.name);
  const p = condParse(t, allActionNames(actions || []));
  if (p.error || !p.ast) return t.trim();
  const clone = condDeepClone(p.ast);
  condWalk(clone, (n) => {
    if (n.type !== 'call' || !['since', 'count', 'last-exec'].includes(n.lower)) return;
    const slot = n.lower === 'last-exec' ? 2 : 0;
    const a = n.args[slot];
    if (a && a.type === 'number' && byIndex.has(a.value)) {
      const nm = byIndex.get(a.value);
      n.args[slot] = { type: 'ident', name: nm, lower: String(nm).toLowerCase() };
    }
  });
  return condToText(clone);
}

function mergeMorePrioritiesText(act, actions) {
  return (act.morePriorities || [])
    .map(mp => `priority=${mp.priority}：${mergeCanonExpr(mp.text, actions) || '(空)'}`)
    .join('\n');
}

/** 两个同名动作「除 index 以外」的差异（比对前会把条件里的 index 入参换算成动作名） */
function mergeActionDiffs(src, cur, srcActions, curActions) {
  const diffs = [];
  const add = (field, label, c, i) => diffs.push({ field, label, cur: c, imp: i });
  if (String(src.character || '') !== String(cur.character || '')) add('character', '角色', cur.character || '(当前角色)', src.character || '(当前角色)');
  if (String(src.action || '') !== String(cur.action || '')) add('action', '动作指令', cur.action || '(空)', src.action || '(空)');
  if (!!src.ensureCast !== !!cur.ensureCast) add('ensureCast', '确保E技能释放成功（ensureCast）', cur.ensureCast ? '已勾选' : '未勾选', src.ensureCast ? '已勾选' : '未勾选');
  const cr = consRequirementOf(cur), sr = consRequirementOf(src);
  // 命座要求的「数值 + 勾选状态」要一起比：同一个数值（例如 -2）在「勾选」与「不勾选」下语义不同
  // （前者 2 命及以上停用、后者 2 命及以上仍然启用），只比数值会把这两种情况当成相同。
  if (cr !== sr || consActiveState(cur) !== consActiveState(src)) {
    add('consRequirement', '命座要求（consRequirement）', consDescribe(cur), consDescribe(src));
  }
  const cc = mergeCanonExpr(buildExpression(cur, curActions), curActions);
  const ic = mergeCanonExpr(buildExpression(src, srcActions), srcActions);
  if (cc !== ic) add('condition', '触发条件 / 队友条件（最终 expression）', cc || '(空 = 恒真)', ic || '(空 = 恒真)');
  if (String(cur.tags || '') !== String(src.tags || '')) add('tags', '注释', cur.tags || '(空)', src.tags || '(空)');
  const cm = mergeMorePrioritiesText(cur, curActions);
  const im = mergeMorePrioritiesText(src, srcActions);
  if (cm !== im) add('morePriorities', '其他触发条件', cm || '(无)', im || '(无)');
  return diffs;
}

/**
 * 生成合并方案（不改动 state）。返回 { items, infoDiffs }
 * items[i] = { order, src, cur（同名的当前动作，没有则为 null）, diffs }
 */
function planMerge(source) {
  const cur = state.strategy.actions;
  const byName = new Map();
  for (const a of cur) {
    const k = String(a.name || '');
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(a);
  }
  const used = new Set();
  const items = (source.actions || []).map((src, order) => {
    const cands = (byName.get(String(src.name || '')) || []).filter(a => !used.has(a.id));
    const match = cands[0] || null;
    if (match) used.add(match.id);
    return { order, src, cur: match, diffs: match ? mergeActionDiffs(src, match, source.actions, cur) : [] };
  });
  const matchedIds = new Set(items.filter(it => it.cur).map(it => it.cur.id));
  return {
    items,
    infoDiffs: mergeInfoDiffs(state.strategy.info, source.info),
    infoSrc: source.info,
    curOnlyCount: cur.filter(a => !matchedIds.has(a.id)).length,   // 当前策略独有、按原样保留的动作数
  };
}

/** 「导入的版本改名后保留」用的新名称：原名后面直接加数字（2、3…） */
function nextMergeName(name, extraTaken) {
  const base = String(name || '');
  if (!base) return '';
  const used = new Set(state.strategy.actions.map(a => String(a.name || '')).concat(extraTaken || []));
  let i = 2;
  let n = `${base}${i}`;
  while (used.has(n)) { i++; n = `${base}${i}`; }
  return n;
}

/** 把被导入动作的字段（除 index / 类型位以外）写进目标动作；表达式里的动作引用按 convertExpr 换算 */
function applyMergedFields(dst, src, convertExpr) {
  dst.action = src.action || '';
  dst.ensureCast = !!src.ensureCast;
  dst.tags = src.tags || '';
  // 命座要求（consRequirement）也属于动作内容，替换 / 合并时把三元组一起带过来
  // （数值只带「模式 + 目标命座数」，勾选状态必须从被导入动作那边一起复制，否则会翻面）。
  dst.consMode = CONS_MODES.includes(src.consMode) ? src.consMode : 'none';
  dst.consTarget = Number.isInteger(src.consTarget) ? src.consTarget : 0;
  dst.consEnabled = !!src.consEnabled;
  if (!consHasRequirement(dst)) { dst.consMode = 'none'; dst.consTarget = 0; dst.consEnabled = false; }
  dst.consRequirement = consRequirementOf(dst);
  dst.conditionText = convertExpr(src.conditionText);
  dst.conditionMode = src.conditionMode || 'all';
  dst.conditionCacheFor = null;
  dst.conditionAst = null;
  const tm = src.teammates || {};
  dst.teammates = {
    include: (tm.include || []).slice(),
    includeOps: (tm.includeOps || []).slice(),
    exclude: (tm.exclude || []).slice(),
    excludeOps: (tm.excludeOps || []).slice(),
    mode: tm.mode === 'and' ? 'and' : 'or',
    autoExclude: [],
    autoExcludeSameType: !!tm.autoExcludeSameType,
  };
  // 自动排除记的是「动作 id」，合并后 id 会变，先把名称记下来，最后统一换成本策略里的 id
  dst.__autoExcludeNames = (tm.autoExclude || []).map(id => {
    const hit = (src.__mergePool || []).find(x => x.id === id);
    return hit ? String(hit.name || '') : '';
  }).filter(n => n !== '');
  if (!tm.autoExclude || !tm.autoExclude.length) dst.__autoExcludeNames = [];
  dst.morePriorities = (src.morePriorities || []).map(mp => ({
    id: newId(),
    text: convertExpr(mp.text),
    priority: mp.priority,
    cmp: mp.cmp,
    scope: mp.scope ? { type: mp.scope.type, element: mp.scope.element, character: mp.scope.character } : { type: null, element: '', character: '' },
    manualPriority: !!mp.manualPriority,
  }));
}

/**
 * 应用合并（规则 3~5）。
 * decisions: { info: { [字段]: 'current'|'imported' }, actions: { [order]: 'keep'|'replace'|'rename' } }
 * 返回 { ok, error?, added, renamed, replaced, kept, infoNotes, warnings }
 */
function applyMergePlan(plan, decisions) {
  const dec = decisions || {};
  const cur = state.strategy.actions;
  const items = plan.items;
  const sourceActions = items.map(it => it.src);
  // 被导入策略的「index → 动作名」（用于把条件里的数字引用换算成名称）
  const srcIndexName = new Map();
  for (const a of sourceActions) if (!srcIndexName.has(a.index)) srcIndexName.set(a.index, String(a.name || ''));
  // applyMergedFields 里查自动排除用得到的「被导入策略的动作池」
  for (const a of sourceActions) a.__mergePool = sourceActions;

  const kinds = items.map(it => {
    if (!it.cur) return 'add';
    const d = dec.actions ? dec.actions[it.order] : 'keep';
    return d === 'replace' ? 'replace' : (d === 'rename' ? 'rename' : 'keep');
  });

  /* 1) 「使用导入版本替换」时角色可能变化：index 的元素 / 角色位跟着角色改写（类型与尾数不变） */
  const indexFixes = [];
  for (let i = 0; i < items.length; i++) {
    if (kinds[i] !== 'replace') continue;
    const it = items[i];
    const newChar = String(it.src.character || '');
    const oldChar = String(it.cur.character || '');
    if (newChar === oldChar) continue;
    const av = newChar ? getAvatar(newChar) : { code: 0, seq: 0 };
    if (!av) return { ok: false, error: `动作「${it.src.name || '(未命名)'}」的角色「${newChar}」不在角色表中，无法改写 index。` };
    indexFixes.push({ act: it.cur, from: it.cur.index, to: makeIndex(it.cur.type, av.code, av.seq, it.cur.slot), character: newChar });
  }
  // 换角色后目标分组不能超过 9 条
  {
    const moved = new Map(indexFixes.map(f => [f.act.id, f.character]));
    const groups = new Map();
    for (const a of cur) {
      const ch = moved.has(a.id) ? moved.get(a.id) : (a.character || '');
      const k = `${ch}|${a.type}`;
      groups.set(k, (groups.get(k) || 0) + 1);
    }
    for (const [k, c] of groups) {
      const idx0 = k.lastIndexOf('|');
      const t0 = Number(k.slice(idx0 + 1));
      if (c <= capacityOfType(t0)) continue;
      const idx = k.lastIndexOf('|');
      const ch = k.slice(0, idx), t = k.slice(idx + 1);
      return { ok: false, error: `「${ch || '当前角色'}」的「${actionTypeName(Number(t))}」动作会变成 ${c} 条，超过上限 ${capacityOfType(Number(t))} 条。用导入版本替换会改变动作的角色，请先整理该角色 / 该类型的动作后再合并。` };
    }
  }

  /* 2) 为「没有同名动作」与「改名后保留」的导入动作重新分配 index */
  const fixById = new Map(indexFixes.map(f => [f.act.id, f]));
  const work = cur.map(a => ({
    id: a.id,
    name: String(a.name || ''),
    character: fixById.has(a.id) ? fixById.get(a.id).character : (a.character || ''),
    type: a.type,
    slot: a.slot,
    index: fixById.has(a.id) ? fixById.get(a.id).to : a.index,
  }));
  const allocNames = [];
  const allocations = new Map();   // order → { character, type, slot, index, name }
  for (let i = 0; i < items.length; i++) {
    if (kinds[i] !== 'add' && kinds[i] !== 'rename') continue;
    const it = items[i];
    const character = String(it.src.character || '');
    const av = character ? getAvatar(character) : { code: 0, seq: 0 };
    if (!av) return { ok: false, error: `动作「${it.src.name || '(未命名)'}」的角色「${character}」不在角色表中。` };
    let picked = null;
    for (const t of mergeTypeOrder(it.src.type)) {
      if (work.filter(w => w.character === character && w.type === t).length < capacityOfType(t)) { picked = t; break; }
    }
    if (picked === null) {
      return { ok: false, error: `无法为被导入的动作「${it.src.name || '(未命名)'}」分配编号：「${character || '当前角色'}」的 9 种动作类型都已经各有 ${MAX_SLOT} 条动作了。请先删除或改类型后再合并。` };
    }
    const usedSlots = new Set(work.filter(w => w.character === character && w.type === picked).map(w => w.slot));
    let slot = 0;
    for (let s = 1; s <= capacityOfType(picked); s++) if (!usedSlots.has(s)) { slot = s; break; }
    const index = makeIndex(picked, av.code, av.seq, slot);
    const name = kinds[i] === 'rename'
      ? (String(it.src.name || '').trim() ? nextMergeName(it.src.name, allocNames) : nextMergeName('未命名', allocNames))
      : String(it.src.name || '');
    allocations.set(it.order, { character, type: picked, slot, index, name });
    work.push({ id: null, name, character, type: picked, slot, index });
    if (name) allocNames.push(name);
  }

  /* 3) 表达式换算：被导入条件里的 index 数值 → 对应动作名 → 合并后策略里同名动作的 index */
  const nameToIndex = new Map();
  for (const w of work) if (w.name) nameToIndex.set(w.name, w.index);
  const warnings = [];
  const warnOnce = (t) => { if (!warnings.includes(t)) warnings.push(t); };
  const convertExpr = (text) => {
    const t = String(text === null || text === undefined ? '' : text);
    if (!t.trim()) return t;
    const p = condParse(t, allActionNames(sourceActions));
    if (p.error || !p.ast) return t;
    const clone = condDeepClone(p.ast);
    let changed = false;
    condWalk(clone, (n) => {
      if (n.type !== 'call' || !['since', 'count', 'last-exec'].includes(n.lower)) return;
      const slot = n.lower === 'last-exec' ? 2 : 0;
      const a = n.args[slot];
      if (!a || a.type !== 'number') return;
      const has = srcIndexName.has(a.value);
      const nm = has ? srcIndexName.get(a.value) : '';
      if (nm && nameToIndex.has(nm)) { a.value = nameToIndex.get(nm); changed = true; return; }
      if (!has) warnOnce(`条件里的 index=${a.value} 在被导入的策略里找不到对应动作，已原样保留。`);
      else warnOnce(`条件里的 index=${a.value} 指向被导入策略里没有动作名的动作，无法按名称换算，已原样保留。`);
    });
    return changed ? condToText(clone) : t;
  };

  /* 4) 当前策略里指向「被替换动作」的旧 index 的引用，跟着 index 改写 */
  const replacedIds = new Set(items.filter((it, i) => kinds[i] === 'replace').map(it => it.cur.id));
  if (indexFixes.length) {
    const fixMap = new Map(indexFixes.map(f => [f.from, f.to]));
    const rewrite = (text) => {
      const t = String(text === null || text === undefined ? '' : text);
      if (!t.trim()) return t;
      const p = condParse(t, allActionNames(cur));
      if (p.error || !p.ast) return t;
      const r = condRewriteIndexes(p.ast, fixMap);
      return r.changed ? condToText(r.ast) : t;
    };
    for (const a of cur) {
      if (replacedIds.has(a.id)) continue;      // 被替换的动作整段内容都来自导入版本
      a.conditionText = rewrite(a.conditionText);
      for (const mp of a.morePriorities) mp.text = rewrite(mp.text);
    }
  }

  /* 5) info */
  const infoRes = applyInfoMerge(state.strategy.info, plan.infoSrc || {}, dec.info);
  Object.assign(state.strategy.info, infoRes.info);

  /* 6) 动作：替换 / 新增 / 改名新增 */
  const replaced = [], added = [], renamed = [], kept = [];
  const touched = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const k = kinds[i];
    if (k === 'keep') { kept.push({ src: it.src, cur: it.cur }); continue; }
    if (k === 'add' || k === 'rename') {
      const alloc = allocations.get(it.order);
      const fresh = createAction({});
      fresh.name = alloc.name;
      fresh.character = alloc.character;
      fresh.type = alloc.type;
      fresh.slot = alloc.slot;
      fresh.index = alloc.index;
      fresh.manualIndex = false;
      applyMergedFields(fresh, it.src, convertExpr);
      cur.push(fresh);
      touched.push(fresh);
      (k === 'add' ? added : renamed).push({ src: it.src, action: fresh });
    } else {
      const fix = indexFixes.find(f => f.act.id === it.cur.id);
      if (fix) it.cur.index = fix.to;
      it.cur.character = String(it.src.character || '');
      it.cur.manualIndex = false;
      applyMergedFields(it.cur, it.src, convertExpr);
      touched.push(it.cur);
      replaced.push({ src: it.src, action: it.cur });
    }
  }

  /* 7) 自动排除：把被导入策略里的动作 id 换成本策略里同名动作的 id */
  for (const a of touched) {
    const names = a.__autoExcludeNames || [];
    a.teammates.autoExclude = names.map(n => {
      const hit = cur.find(x => String(x.name || '') === n);
      return hit ? hit.id : null;
    }).filter(Boolean);
    delete a.__autoExcludeNames;
  }
  for (const a of sourceActions) delete a.__mergePool;

  cur.sort((x, y) => x.index - y.index);
  return { ok: true, added, renamed, replaced, kept, infoNotes: infoRes.notes, warnings, indexFixes };
}

/* ---------------- 草稿 ---------------- */

const LS_DRAFT = 'bgi_strategy_editor_drafts_v1';
const LS_RARITY = 'bgi_strategy_editor_rarity_v1';
const LS_UI = 'bgi_strategy_editor_ui_v1';
const LS_RECENT = 'bgi_strategy_editor_recent_v1';
/** 优先级预览页「模拟队伍过滤」里保存的队伍（只与本地有关，与战斗策略内容没有任何关联） */
const LS_TEAMS = 'bgi_strategy_editor_teams_v1';
/** 本地最多保存几支队伍（与原神里可保存的队伍数量一致） */
const MAX_TEAMS = 20;

/* ---------------- 全局状态 ---------------- */

const state = {
  strategy: { info: { name: '', author: '', version: '', description: '', config: {}, preActions: [] }, actions: [] },
  ui: {
    tab: 'info',
    editingCharacter: '',   // '' = 当前角色
    characterSearch: '',
    filterElement: 'all',
    filterRarity: 'all',
    filterHasAction: 'all',
    collapsed: {},          // actionId -> true 表示折叠
    detailsOpen: {},        // '<卡id|pre:序号>:<区块>' -> true/false（动作卡片内的可展开区块）
    condSnippet: {},        // 条件快捷添加：每个编辑器的当前片段状态
    moreAddForm: {},        // 「添加其他触发条件」表单的判定范围选择：actionId -> { cmp, type, element, character }
    teamOps: {},            // 队友条件里夹在两个角色中间的运算符：'<actId>:<field>:<序号>' -> 'and' | 'or'
    teamFilterOps: {},      // 队友条件“新增角色前”运算符的选择：'<actId>:<field>' -> 'and' | 'or'
    team: [],               // 模拟队伍（最多 4 人）
    previewCondMode: 'raw', // 优先级预览「动作触发条件」列：'raw' 原始表达式 / 'explain' 释义
    showIssues: true,
    convOpen: false,        // 校验面板「隐式转换检查（数值 ↔ 布尔）」是否展开
  },
  rarity: {},               // 角色名 -> '4' | '5'
  qc: {},                   // 快捷插入指令面板的状态（按面板 id）
  issues: { errors: [], warnings: [] },
  importDialog: null,
};
