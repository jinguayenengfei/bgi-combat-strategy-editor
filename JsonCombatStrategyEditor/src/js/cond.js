/* 条件表达式：词法 / 语法 / 校验 / 释义 / 引用重写
 * 严格对照 BetterGenshinImpact/GameTask/AutoFight/Script/ConditionEvaluator.cs
 *   - 运算符：|| && ! > < = + - * / ( ) ,
 *   - 没有 == != >= <= %
 *   - 布尔字面量只认小写 true / false
 *   - 不存在字符串字面量
 *   - 标识符支持中文；含 '-' 时先尝试合并为已知标识符（内置函数名 ∪ 策略动作名），否则退化为减号
 *   - 内置函数 14 个，大小写不敏感
 */

const COND_FUNCTIONS = [
  { name: 't', arity: [0, 0], ret: 'number', cn: '距开战经过的秒数', def: 't()' },
  { name: 'battle-time', arity: [1, 2], ret: 'bool', cn: '开战时间比较：battle-time(秒) = t()>秒；battle-time(秒,false) = t()<秒', def: 'battle-time(5)' },
  { name: 'since', arity: [0, 1], ret: 'number', cn: '距目标动作上次执行的秒数（不填参数时指本动作；从未执行过返回 +∞）', def: 'since>8' },
  { name: 'count', arity: [0, 3], ret: 'number', cn: '目标动作在时间区间内的执行次数（不填参数时指本动作）', def: 'count=0' },
  { name: 'last-exec', arity: [1, 3], ret: 'bool', cn: 'since 的布尔版：last-exec(秒) = since()>秒（从未执行时直接返回第二个参数，默认 true）', def: 'last-exec(5)' },
  { name: 'last-check', arity: [0, 0], ret: 'number', cn: '距上次战斗结束检查的秒数', def: 'last-check>3' },
  { name: 'q-ready', arity: [0, 1], ret: 'bool', cn: '元素爆发是否就绪（OCR 识别；不填角色时指本动作的角色，通用动作则退化为“队伍中任意角色就绪”）', def: 'q-ready' },
  { name: 'e-ready', arity: [0, 1], ret: 'bool', cn: '元素战技是否就绪（CD 记录推算；通用动作下恒为 false）', def: 'e-ready' },
  { name: 'e-cd', arity: [0, 1], ret: 'number', cn: '元素战技剩余冷却秒数（0 表示就绪）', def: 'e-cd<2' },
  { name: 'low-hp', arity: [0, 0], ret: 'bool', cn: '当前出战角色是否低血量', def: 'low-hp' },
  { name: 'onfield', arity: [0, 0], ret: 'bool', cn: '本动作的角色是否已在场上（通用动作恒 false）', def: 'onfield()' },
  { name: 'in-party', arity: [1, 1], ret: 'bool', cn: '角色是否在队伍中（参数必须是裸角色名；本编辑器的队友条件走专门通道，一般不手写它）', def: 'in-party(芙宁娜)' },
  { name: 'min', arity: [0, 99], ret: 'number', cn: '取最小值', def: 'min(since,5)' },
  { name: 'max', arity: [0, 99], ret: 'number', cn: '取最大值', def: 'max(since(1),since(2))' },
];
const COND_FUNCTION_NAMES = COND_FUNCTIONS.map(f => f.name);
const COND_FUNCTION_SET = new Set(COND_FUNCTION_NAMES.map(n => n.toLowerCase()));
const COND_FUNCTION_BY_NAME = new Map(COND_FUNCTIONS.map(f => [f.name.toLowerCase(), f]));

/* ---------------- 词法 ---------------- */

function condIsIdentChar(ch) { return /[A-Za-z0-9_\u4e00-\u9fff\u3400-\u4dbf]/.test(ch); }

/**
 * 词法分析。known 为额外已知标识符（策略动作名），用于 '-' 合并判断。
 * 返回 { tokens, error }
 */
function condTokenize(src, known) {
  const knownSet = new Set([...COND_FUNCTION_SET]);
  if (known) for (const n of known) knownSet.add(String(n).toLowerCase());

  const tokens = [];
  let i = 0;
  const n = src.length;
  const isOpenBracket = (ch) => ch === '(' || ch === '（';

  while (i < n) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '（' || ch === '）' || ch === '，' || ch === '；' || ch === '：' || ch === '“' || ch === '”') {
      return { error: `第 ${i + 1} 个字符出现了中文标点「${ch}」，条件表达式只能用半角符号（必须是半角 () , 与英文运算符）` };
    }
    if (ch === '(') { tokens.push({ t: 'lparen', pos: i }); i++; continue; }
    if (ch === ')') { tokens.push({ t: 'rparen', pos: i }); i++; continue; }
    if (ch === ',') { tokens.push({ t: 'comma', pos: i }); i++; continue; }
    if (ch === '&' && src[i + 1] === '&') { tokens.push({ t: 'op', v: '&&', pos: i }); i += 2; continue; }
    if (ch === '|' && src[i + 1] === '|') { tokens.push({ t: 'op', v: '||', pos: i }); i += 2; continue; }
    if (ch === '&' || ch === '|') return { error: `第 ${i + 1} 个字符处出现了单个「${ch}」，逻辑运算必须写成 && 或 ||` };
    if (ch === '=' && src[i + 1] === '=') return { error: `第 ${i + 1} 个字符处出现了 ==，条件表达式没有 ==，相等比较请用单个 =` };
    if (ch === '!' && src[i + 1] === '=') return { error: `第 ${i + 1} 个字符处出现了 !=，请改写成 !(a=b)` };
    if (ch === '>' && src[i + 1] === '=') return { error: `第 ${i + 1} 个字符处出现了 >=，请改写成 !(a<b) 或 a>b || a=b` };
    if (ch === '<' && src[i + 1] === '=') return { error: `第 ${i + 1} 个字符处出现了 <=，请改写成 !(a>b) 或 a<b || a=b` };
    if ('!><='.includes(ch)) { tokens.push({ t: 'op', v: ch, pos: i }); i++; continue; }
    if (ch === '+' || ch === '*' || ch === '/') { tokens.push({ t: 'op', v: ch, pos: i }); i++; continue; }
    if (ch === '-') { tokens.push({ t: 'op', v: '-', pos: i }); i++; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < n && /[0-9.]/.test(src[j])) j++;
      const raw = src.slice(i, j);
      if ((raw.match(/\./g) || []).length > 1) return { error: `数字「${raw}」不合法（小数点过多）` };
      tokens.push({ t: 'num', v: parseFloat(raw), raw, pos: i });
      i = j; continue;
    }
    if (condIsIdentChar(ch)) {
      let j = i;
      while (j < n && condIsIdentChar(src[j])) j++;
      // '-' 合并：向后尝试最长候选，命中已知标识符则整体作为一个标识符
      outer: while (j < n && src[j] === '-') {
        let k = j + 1;
        if (k >= n || !condIsIdentChar(src[k])) break;
        while (k < n && (condIsIdentChar(src[k]) || src[k] === '-')) k++;
        for (let e = k; e > j; e--) {
          if (src[e - 1] === '-') continue;
          const cand = src.slice(i, e);
          if (knownSet.has(cand.toLowerCase())) { j = e; break outer; }
        }
        break;
      }
      const word = src.slice(i, j);
      const lower = word.toLowerCase();
      if (lower === 'true' || lower === 'false') tokens.push({ t: 'bool', v: lower === 'true', pos: i, raw: word });
      else tokens.push({ t: 'ident', v: word, lower, pos: i });
      i = j; continue;
    }
    return { error: `第 ${i + 1} 个字符处出现了无法识别的字符「${ch}」` };
  }
  tokens.push({ t: 'eof', pos: n });
  return { tokens };
}

/* ---------------- 语法 ---------------- */

/** 文本是否已经被一对外层括号完整包住（`(a || b)`） */
function fullyParen(text) {
  const t = String(text || '').trim();
  if (!/^\(.*\)$/.test(t)) return false;
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '(') depth++;
    else if (t[i] === ')') { depth--; if (depth === 0) return i === t.length - 1; }
  }
  return false;
}

function condParse(src, known) {
  // 空表达式在 BetterGI 中恒为真（Evaluate 对空白表达式直接返回 true），这里也用 ast=null 表示
  if (String(src || '').trim() === '') return { ast: null };
  const tk = condTokenize(src, known);
  if (tk.error) return { error: tk.error };
  const tokens = tk.tokens;
  let p = 0;
  const peek = () => tokens[p] || { t: 'eof', pos: src.length };
  const next = () => (p < tokens.length ? tokens[p++] : { t: 'eof', pos: src.length });

  const bad = (x) => x && x.error;
  function parseOr() {
    let left = parseAnd();
    while (!bad(left) && peek().t === 'op' && peek().v === '||') { next(); const right = parseAnd(); if (bad(right)) return right; left = { type: 'binary', op: '||', left, right }; }
    return left;
  }
  function parseAnd() {
    let left = parseCompare();
    while (!bad(left) && peek().t === 'op' && peek().v === '&&') { next(); const right = parseCompare(); if (bad(right)) return right; left = { type: 'binary', op: '&&', left, right }; }
    return left;
  }
  function parseCompare() {
    let left = parseAdd();
    while (!bad(left) && peek().t === 'op' && '><='.includes(peek().v)) { const op = next().v; const right = parseAdd(); if (bad(right)) return right; left = { type: 'binary', op, left, right }; }
    return left;
  }
  function parseAdd() {
    let left = parseMul();
    while (!bad(left) && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) { const op = next().v; const right = parseMul(); if (bad(right)) return right; left = { type: 'binary', op, left, right }; }
    return left;
  }
  function parseMul() {
    let left = parseUnary();
    while (!bad(left) && peek().t === 'op' && (peek().v === '*' || peek().v === '/')) { const op = next().v; const right = parseUnary(); if (bad(right)) return right; left = { type: 'binary', op, left, right }; }
    return left;
  }
  function parseUnary() {
    const t = peek();
    if (t.t === 'op' && t.v === '!') {
      next();
      const operand = parseUnary();
      if (bad(operand)) return operand;
      // 括号在 AST 里是透明的（parsePrimary 只把节点标记成 paren，聚合出来的新节点不带这个标记），
      // 但区分「整段取非」`!(甲 && 乙)` 与「逐项取非」`!甲 && !乙` 必须知道有没有这层括号
      // （两种写法拆出来的 in-party 链完全同形）。这里把「括号正好包住整个操作数」这个
      // 解析结果记到一元节点自己身上：`!((甲 || 乙))` 这种多包一层的不算。
      const wrapped = !!(operand && operand.paren && operand.parenEnd === peek().pos);
      if (operand && typeof operand === 'object') delete operand.parenEnd;
      return { type: 'unary', op: '!', operand, parenWrapped: wrapped };
    }
    if (t.t === 'op' && t.v === '-') { next(); const operand = parseUnary(); if (bad(operand)) return operand; return { type: 'unary', op: '-', operand }; }
    if (t.t === 'op' && t.v === '+') return { error: `第 ${t.pos + 1} 个字符处的 + 无法解析：条件表达式不支持一元正号` };
    return parsePrimary();
  }
  function parsePrimary() {
    const t = next();
    if (t.t === 'eof') return { error: src.trim() === '' ? '表达式为空' : '表达式在末尾意外结束（可能缺少操作数或括号未闭合）' };
    if (t.t === 'num') return { type: 'number', value: t.v };
    if (t.t === 'bool') return { type: 'bool', value: t.v };
    if (t.t === 'lparen') {
      const inner = parseOr();
      if (inner && inner.error) return inner;
      if (peek().t !== 'rparen') {
        const last = peek();
        if (last.t === 'eof') return { error: `括号不配对：第 ${t.pos + 1} 个字符处的 '(' 没有对应的 ')'（表达式在末尾意外结束）` };
        return { error: `括号不配对：第 ${t.pos + 1} 个字符处的 '(' 没有对应的 ')'` };
      }
      next();
      // 记下「这个节点外面本来有一层括号」：括号在 AST 里是透明的，但区分
      // `!(甲 && 乙)`（整段取非）与 `!甲 && !乙`（逐项取非）时必须知道有没有这层括号，
      // 这两种写法拆出来的 in-party 链完全同形。只做标记，不改变求值语义。
      if (inner && typeof inner === 'object') { inner.paren = true; inner.parenEnd = peek().pos; }
      return inner;
    }
    if (t.t === 'ident') {
      if (peek().t === 'lparen') {
        next();
        const args = [];
        if (peek().t !== 'rparen') {
          for (;;) {
            const a = parseOr();
            if (a && a.error) return a;
            args.push(a);
            if (peek().t === 'comma') { next(); continue; }
            break;
          }
        }
        if (peek().t !== 'rparen') return { error: `函数 ${t.v} 的括号不配对或参数分隔有误` };
        next();
        return { type: 'call', name: t.v, lower: t.lower, args, pos: t.pos };
      }
      // 裸标识符：既可能是零参数函数，也可能被当作“动作引用/变量”
      return { type: 'ident', name: t.v, lower: t.lower, pos: t.pos };
    }
    if (t.t === 'eof') return { error: src.trim() === '' ? '表达式为空' : '表达式在末尾意外结束（可能缺少操作数或括号未闭合）' };
    return { error: `第 ${t.pos + 1} 个字符处出现了意外的符号` };
  }

  const ast = parseOr();
  if (ast && ast.error) return { error: ast.error };
  if (!ast) return { error: src.trim() === '' ? '表达式为空' : '表达式不完整' };
  if (peek().t !== 'eof') return { error: `第 ${peek().pos + 1} 个字符处存在无法解析的多余内容` };
  return { ast };
}

/** 遍历 AST */
function condWalk(node, fn) {
  if (!node || node.error) return;
  fn(node);
  if (node.type === 'binary') { condWalk(node.left, fn); condWalk(node.right, fn); }
  else if (node.type === 'unary') condWalk(node.operand, fn);
  else if (node.type === 'call') for (const a of node.args) condWalk(a, fn);
}

function condDeepClone(node) {
  if (!node) return node;
  if (node.type === 'binary') return { ...node, left: condDeepClone(node.left), right: condDeepClone(node.right) };
  if (node.type === 'unary') return { ...node, operand: condDeepClone(node.operand) };
  if (node.type === 'call') return { ...node, args: node.args.map(condDeepClone) };
  return { ...node };
}

function condToText(node) {
  if (!node) return '';
  switch (node.type) {
    case 'number': return String(node.value);
    case 'bool': return node.value ? 'true' : 'false';
    case 'ident': return node.name;
    case 'call': return `${node.name}(${node.args.map(condToText).join(',')})`;
    case 'unary': {
      // 一元运算符只对它后面的 primary 生效，所以操作数是二元表达式时必须自己补括号：
      // 漏括号时 `!(a || b)` / `-(a - b)` 会被渲染成 `!a || b` / `-a - b`，
      // 文本再解析回来就变成了另一套优先级（BetterGI 与本站的解析器都按“括号内先整体求值”处理）
      const t = condToText(node.operand);
      const needParen = node.operand.type === 'binary' && !(node.op === '!' && node.parenWrapped && fullyParen(t));
      return `${node.op}${needParen ? `(${t})` : t}`;
    }
    case 'binary': {
      const l = node.left.type === 'binary' ? `(${condToText(node.left)})` : condToText(node.left);
      const r = node.right.type === 'binary' ? `(${condToText(node.right)})` : condToText(node.right);
      return `${l} ${node.op} ${r}`;
    }
    default: return '';
  }
}

/* ---------------- 动作名合法性 ---------------- */

const BOOL_LITERALS = new Set(['true', 'false']);

/** 动作名能否作为条件标识符解析（对照 ConditionEvaluator.IsValidActionName） */
function isValidActionName(name, allActionNames) {
  if (!name) return { ok: false, reason: '名称为空' };
  if (BOOL_LITERALS.has(name.toLowerCase())) return { ok: false, reason: '不能使用布尔字面量 true/false' };
  if (/^\d+(\.\d+)?$/.test(name)) return { ok: false, reason: '不能是纯数字' };
  if (COND_FUNCTION_SET.has(name.toLowerCase())) return { ok: false, reason: `不能与内置条件函数 ${name} 同名` };
  if (/[\s,()（）&|!><=+*/]/.test(name)) return { ok: false, reason: '不能包含空白、逗号、括号或运算符' };
  const known = [...COND_FUNCTION_NAMES, ...(allActionNames || [])];
  const tk = condTokenize(name, known);
  if (tk.error) return { ok: false, reason: tk.error };
  const real = tk.tokens.filter(t => t.t !== 'eof');
  if (real.length !== 1 || real[0].t !== 'ident') return { ok: false, reason: '无法作为单个标识符解析（可能被拆成了多段或运算符）' };
  if (real[0].v.toLowerCase() !== name.toLowerCase()) return { ok: false, reason: '无法作为单个标识符解析' };
  return { ok: true };
}

/* ---------------- 释义 ----------------
 * opts（可选）把「动作引用」渲染成人能看懂的样子：
 *   {
 *     actions:        [{ id, name, index, action, character, type }...],
 *     currentActionId: 当前正在编辑的动作的 id（引用它时显示「本动作」）
 *   }
 * 传了 opts 时，入参为动作的函数（since / count / last-exec）会把 index 或动作名换成
 * 「动作名」，并带一个鼠标悬停提示（index + 动作指令）；不传 opts 时保持纯文本（供测试与
 * 不支持 HTML 的地方使用）。
 */

/** HTML 转义（不依赖 ui_common.js 里的 esc，保证 cond.js 单独可用） */
function condEsc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 动作引用节点 → 动作对象（支持 index 数字与裸动作名两种写法） */function condFindActionRef(ast, opts) {
  if (!ast || !opts || !Array.isArray(opts.actions)) return null;
  if (ast.type === 'number') return opts.actions.find(a => a.index === ast.value) || null;
  if (ast.type === 'ident') {
    const lower = String(ast.name).toLowerCase();
    return opts.actions.find(a => String(a.name || '').toLowerCase() === lower) || null;
  }
  if (ast.type === 'call' && ast.args.length === 0) {
    const lower = String(ast.lower || ast.name).toLowerCase();
    return opts.actions.find(a => String(a.name || '').toLowerCase() === lower) || null;
  }
  return null;
}

/** 命中当前动作（含「不填参数 = 本动作」与显式引用自己） */
function condIsSelfRef(ast, opts) {
  if (!opts || !opts.currentActionId) return false;
  const cur = (opts.actions || []).find(a => a.id === opts.currentActionId);
  if (!cur) return false;
  if (!ast) return true;                                   // 不填参数 = 本动作
  if (ast.type === 'number') return ast.value === cur.index;
  const lower = String(ast.type === 'call' ? (ast.lower || ast.name) : ast.name || '').toLowerCase();
  return !!cur.name && lower === String(cur.name).toLowerCase();
}

/** 动作引用的释义文本（传了 opts 时是人话，否则退回原文） */
function condRefText(ast, opts) {
  if (condIsSelfRef(ast, opts)) return '本动作';
  const hit = condFindActionRef(ast, opts);
  if (hit) return `动作「${hit.name || '(未命名)'}」`;
  if (!ast) return '本动作';
  if (ast.type === 'number') return `index=${ast.value} 的动作`;
  if (ast.type === 'ident') return `动作「${ast.name}」`;
  if (ast.type === 'call' && ast.args.length === 0) return `动作「${ast.name}」`;
  return `(${condToText(ast)})`;
}

/** 动作引用节点的悬停提示文本：index + 动作名（有动作指令时一并附上） */
function condRefTitle(hit) {
  const idx = hit && hit.index !== undefined && hit.index !== null ? hit.index : '';
  const cmd = String((hit && hit.action) || '').trim();
  return `index=${idx}　动作名：${(hit && hit.name) || '(未命名)'}${cmd ? `　动作指令：${cmd}` : ''}`;
}

/**
 * 动作引用的释义 HTML（动作名 + 悬停显示 index 与动作指令）。
 * 找不到对应动作 / 没传 opts 时退回 esc 过的纯文本。
 */
function condRefHtml(ast, opts) {
  const plain = condRefText(ast, opts);
  const hit = condFindActionRef(ast, opts);
  if (!hit) return condEsc(plain);
  const self = condIsSelfRef(ast, opts) ? '（本动作）' : '';
  return `<span class="aref" title="${condEsc(condRefTitle(hit))}">${condEsc(`动作「${hit.name || '(未命名)'}」${self}`)}</span>`;
}

/** 释义里的动作引用：传了 opts 用 HTML（带悬停提示），否则用纯文本 */
function condRefAny(ast, opts) {
  return opts ? condRefHtml(ast, opts) : condEsc(condRefText(ast, opts));
}

/* ---------------- 原样表达式 + 动作引用悬停提示 ----------------
 * 「优先级预览」的动作触发条件列要显示 **原始 expression 文本**，但鼠标移到
 * 「入参为动作的条件函数」（since / count / last-exec）的动作参数上时要提示这个动作的 index 与动作名。
 * 实现方式：先从 AST 定位出每个动作参数在原文里的 [start, end) 区间，再按区间把原文切片，
 * 只在切出来的那一段外面套一层 <span title="...">，其余字符原样输出 —— 所以列里看到的文本不会变。
 */

/** 条件函数里「入参是动作」的参数位置（与 condCollectRefs 保持一致） */
function condActionArgIndexes(lower, argc) {
  if (lower === 'since') return argc >= 1 ? [0] : [];
  if (lower === 'count') return argc >= 1 ? [0] : [];
  if (lower === 'last-exec') return argc >= 3 ? [2] : [];   // last-exec(秒数, 比较方向, 动作)
  return [];
}

/**
 * 从 src 的 from 处开始扫描一个「函数调用」，返回该调用各参数的 [start, end) 区间与结束位置。
 * 只处理条件表达式里合法出现的字符（括号配对由调用方保证），扫描到配对的右括号就结束。
 */
function condScanCallArgs(src, from) {
  let i = from;
  while (i < src.length && src[i] !== '(') i++;
  if (i >= src.length) return null;
  let depth = 0;
  const args = [];
  let curStart = -1;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(') { depth++; if (depth === 1) curStart = i + 1; }
    else if (ch === ')') {
      depth--;
      if (depth === 0) { args.push([curStart, i]); return { args, end: i + 1 }; }
    } else if (ch === ',' && depth === 1) {
      args.push([curStart, i]);
      curStart = i + 1;
    }
  }
  return null;
}

/**
 * 找出表达式原文里所有「入参为动作的那个参数」的字符区间。
 * 逐个扫描形如 since( / count( / last-exec( 的位置（前一个字符不是标识符字符，避免命中动作名里的子串），
 * 再按 condActionArgIndexes 挑出动作参数的位置。
 */
function condActionArgSpans(src) {
  const text = String(src || '');
  const out = [];
  const re = /(since|count|last-exec)\s*\(/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const at = m.index;
    if (at > 0 && /[A-Za-z0-9_\u4e00-\u9fff\u3400-\u4dbf]/.test(text[at - 1])) continue;  // 属于更长的标识符
    const lower = m[1].toLowerCase();
    const open = text.indexOf('(', at);
    const call = condScanCallArgs(text, open);
    if (!call) continue;
    for (const ai of condActionArgIndexes(lower, call.args.length)) {
      const rg = call.args[ai];
      if (!rg) continue;
      const s = rg[0], e = rg[1];
      if (s === undefined || e === undefined || e <= s) continue;
      out.push({ start: s, end: e, arg: text.slice(s, e) });
    }
    re.lastIndex = call.end;
  }
  out.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const sp of out) {
    const last = merged[merged.length - 1];
    if (last && sp.start < last.end) continue;   // 区间重叠（嵌套调用）：保留外层
    merged.push(sp);
  }
  return merged;
}

/**
 * 保留原始写法、只给「入参为动作」的参数加上悬停提示的 HTML。
 * 表达式解析失败时返回 esc 过的原文，绝不改变显示内容。
 */
function condRawExprHtml(text, opts) {
  const src = String(text === null || text === undefined ? '' : text);
  if (!src) return '';
  const hitOf = (raw) => {
    const t = String(raw || '').trim();
    const a = condParse(t, []);
    if (!a.ast) return null;
    return condFindActionRef(a.ast, opts);
  };
  const spans = condActionArgSpans(src);
  if (!spans.length) return condEsc(src);
  let out = '';
  let cur = 0;
  for (const sp of spans) {
    const hit = hitOf(sp.arg);
    if (!hit) continue;
    out += condEsc(src.slice(cur, sp.start));
    out += `<span class="aref" title="${condEsc(condRefTitle(hit))}">${condEsc(src.slice(sp.start, sp.end))}</span>`;
    cur = sp.end;
  }
  out += condEsc(src.slice(cur));
  return out;
}

function condExplainFunction(call, opts) {
  const fn = COND_FUNCTION_BY_NAME.get(call.lower);
  if (!fn) return `未知函数 ${call.name}(...)`;

  const num = (a, d) => (a && a.type === 'number' ? a.value : d);
  const argText = (a) => condToText(a);
  const refArg = (a) => (opts ? condRefHtml(a, opts) : condEsc(condRefText(a, opts)));

  switch (fn.name) {
    case 't': return '开战至今的秒数';
    case 'battle-time': {
      const th = num(call.args[0], 0);
      const gt = call.args.length > 1 ? !(call.args[1].type === 'bool' && call.args[1].value === false) : true;
      return `开战时间${gt ? '超过' : '不足'} ${th} 秒`;
    }
    case 'since': {
      if (call.args.length === 0) return '本动作距上次执行的秒数（从未执行过时为 +∞，所以 since>X 开场即为真）';
      return `${refArg(call.args[0])} 距上次执行的秒数（从未执行过时为 +∞）`;
    }
    case 'count': {
      const target = call.args.length === 0 ? '本动作' : refArg(call.args[0]);
      if (call.args.length <= 1) return `${target} 从开战到现在的执行次数`;
      if (call.args.length === 2) return `${target} 从 t=${argText(call.args[1])} 到现在的执行次数`;
      return `${target} 在 t=${argText(call.args[1])} 到 t=${argText(call.args[2])} 之间的执行次数`;
    }
    case 'last-exec': {
      if (call.args.length === 0) return 'since 的布尔版（参数缺失）';
      const th = num(call.args[0], 0);
      const gt = !(call.args[1] && call.args[1].type === 'bool' && call.args[1].value === false);
      const target = call.args.length > 2 ? refArg(call.args[2]) : '本动作';
      return `${target} 距上次执行的时间${gt ? '超过' : '不足'} ${th} 秒（若从未执行过，结果直接取 ${gt ? 'true' : 'false'}）`;
    }
    case 'last-check': return '距上次战斗结束检查的秒数';
    case 'q-ready': {
      if (call.args.length === 0) return '本动作所属角色的元素爆发已就绪（OCR 识别）';
      return `角色「${call.args[0].name || argText(call.args[0])}」的元素爆发已就绪`;
    }
    case 'e-ready': {
      if (call.args.length === 0) return '本动作所属角色的元素战技已就绪（CD 记录推算）';
      return `角色「${call.args[0].name || argText(call.args[0])}」的元素战技已就绪`;
    }
    case 'e-cd': {
      if (call.args.length === 0) return '本动作所属角色的元素战技剩余冷却秒数';
      return `角色「${call.args[0].name || argText(call.args[0])}」的元素战技剩余冷却秒数`;
    }
    case 'low-hp': return '当前出战角色处于低血量';
    case 'onfield': return '本动作所属角色已经在场上';
    case 'in-party': return call.args.length === 0 ? '某个角色是否在队伍中（参数缺失）' : `角色「${call.args[0].name ? call.args[0].name : argText(call.args[0])}」在队伍中`;
    case 'min': return `取最小值：${call.args.map(argText).join('、')}`;
    case 'max': return `取最大值：${call.args.map(argText).join('、')}`;
    default: return fn.cn;
  }
}

function condExplainOpText(op) {
  return { '||': '或', '&&': '且', '>': '大于', '<': '小于', '=': '等于', '+': '加', '-': '减', '*': '乘', '/': '除', '!': '非' }[op] || op;
}

/** 生成中文释义（尽量使用自然语言）；传 opts 时动作引用会渲染成带悬停提示的动作名 */
function condExplain(node, opts) {
  if (!node) return '';
  switch (node.type) {
    case 'number': return String(node.value);
    case 'bool': return node.value ? '恒真' : '恒假';
    case 'ident': {
      if (COND_FUNCTION_SET.has(node.lower)) return condExplainFunction({ lower: node.lower, name: node.name, args: [] }, opts);
      return `动作「${node.name}」（注意：动作名不能直接当条件用，必须放进 since/count/last-exec 等函数里）`;
    }
    case 'call': return condExplainFunction(node, opts);
    case 'unary':
      return node.op === '!' ? `非（${condExplain(node.operand, opts)}）` : `负的（${condExplain(node.operand, opts)}）`;
    case 'binary': {
      const op = node.op;
      if (op === '&&') return `${wrap(node.left)} 并且 ${wrap(node.right)}`;
      if (op === '||') return `${wrap(node.left)} 或者 ${wrap(node.right)}`;
      return `${wrap(node.left)} ${condExplainOpText(op)} ${wrap(node.right)}`;
    }
    default: return '';
  }
  function wrap(n) {
    if (n.type === 'binary' && (n.op === '&&' || n.op === '||')) return `（${condExplain(n, opts)}）`;
    return condExplain(n, opts);
  }
}

/** 运算顺序预览：按求值优先级缩进打印（带 opts 时输出 HTML，否则纯文本） */
function condPrettyTree(node, depth = 0, opts) {
  const pad = '  '.repeat(depth);
  if (!node) return '';
  switch (node.type) {
    case 'binary': {
      const label = node.op === '&&' ? '&& 且（左右都真才为真）' : node.op === '||' ? '|| 或（任一边为真即为真）' : `${node.op} ${condExplainOpText(node.op)}`;
      return `${pad}${label}\n${condPrettyTree(node.left, depth + 1, opts)}\n${condPrettyTree(node.right, depth + 1, opts)}`;
    }
    case 'unary':
      return `${pad}${node.op} ${condExplainOpText(node.op)}\n${condPrettyTree(node.operand, depth + 1, opts)}`;
    case 'call':
      return `${pad}函数 ${node.name}() — ${condExplainFunction(node, opts)}\n` + node.args.map(a => condPrettyTree(a, depth + 1, opts)).join('\n');
    case 'ident':
      return `${pad}${node.name}`;
    case 'number':
      return `${pad}${node.value}`;
    case 'bool':
      return `${pad}${node.value}`;
    default:
      return pad + '?';
  }
}

/* ---------------- 引用重写 ---------------- */

/** 收集表达式里引用的 index 数字与未加括号的动作名 */
function condCollectRefs(node, out) {
  out = out || { indexes: [], names: [] };
  condWalk(node, (n) => {
    if (n.type === 'call' && ['since', 'count', 'last-exec'].includes(n.lower)) {
      if (n.lower === 'last-exec') {
        if (n.args.length > 2 && n.args[2].type === 'number') out.indexes.push(n.args[2]);
        else if (n.args.length > 2 && n.args[2].type === 'ident') out.names.push(n.args[2].name);
      } else if (n.args.length > 0) {
        if (n.args[0].type === 'number') out.indexes.push(n.args[0]);
        else if (n.args[0].type === 'ident') out.names.push(n.args[0].name);
      }
    }
  });
  return out;
}

/** 按 indexMap（old → new）重写表达式中的数字引用，返回 { text, changed } */
function condRewriteIndexes(node, indexMap) {
  const clone = condDeepClone(node);
  let changed = false;
  condWalk(clone, (n) => {
    if (n.type !== 'call') return;
    const slot = n.lower === 'last-exec' ? 2 : 0;
    if (!['since', 'count', 'last-exec'].includes(n.lower)) return;
    const a = n.args[slot];
    if (a && a.type === 'number' && indexMap.has(a.value)) { a.value = indexMap.get(a.value); changed = true; }
  });
  return { ast: clone, changed };
}

/* ---------------- 语义校验 ---------------- */

/**
 * 校验条件表达式
 * opts: { actionNames: [], currentAction: {name, character}, knownIndexes: Set }
 * 返回 { errors: [], warnings: [] }
 */
function condValidate(text, opts) {
  const errors = [];
  const warnings = [];
  const o = opts || {};
  const trimmed = (text || '').trim();
  if (trimmed === '') return { errors, warnings, ast: null };

  const parsed = condParse(trimmed, o.actionNames || []);
  if (parsed.error) { errors.push(parsed.error); return { errors, warnings, ast: null }; }
  const ast = parsed.ast;

  // 收集“处于函数实参位置”的节点：q-ready(芙宁娜) / since(芙芙e) 里的裸标识符是合法的
  const argNodes = new Set();
  condWalk(ast, (n) => {
    if (n.type === 'call') for (const a of n.args) argNodes.add(a);
    if (n.type === 'unary') argNodes.add(n.operand);
  });

  condWalk(ast, (n) => {
    if (n.type === 'ident') {
      if (argNodes.has(n)) return; // 由外层函数校验负责
      if (COND_FUNCTION_SET.has(n.lower)) {
        const fn = COND_FUNCTION_BY_NAME.get(n.lower);
        if (fn.arity[0] > 0) errors.push(`函数 ${fn.name}() 需要至少 ${fn.arity[0]} 个参数，不能省略括号（可写成 ${fn.def}）`);
        return;
      }
      if (o.actionNames && o.actionNames.some(x => String(x).toLowerCase() === n.lower)) {
        errors.push(`动作名「${n.name}」不能单独作为条件使用，必须写进 since()/count()/last-exec() 里（例如 since(${n.name})>5）`);
      } else {
        errors.push(`未知的条件函数或变量「${n.name}」：该表达式求值时会失败并被当作 false（动作将永不触发）`);
      }
      return;
    }
    if (n.type === 'call') {
      const fn = COND_FUNCTION_BY_NAME.get(n.lower);
      if (!fn) {
        if (o.actionNames && o.actionNames.some(x => String(x).toLowerCase() === n.lower)) {
          errors.push(`不能把动作名「${n.name}」当函数调用；引用动作请用 since(${n.name}) / count(${n.name}) / last-exec(5,true,${n.name})`);
        } else {
          errors.push(`未知条件函数「${n.name}」（内置函数共 ${COND_FUNCTION_NAMES.length} 个）`);
        }
        return;
      }
      const cnt = n.args.length;
      if (cnt < fn.arity[0] || cnt > fn.arity[1]) {
        errors.push(`函数 ${fn.name}() 参数个数不对：应为 ${fn.arity[0]}~${fn.arity[1]} 个，当前 ${cnt} 个`);
      }
      if (fn.name === 'in-party') {
        if (!n.args[0] || n.args[0].type !== 'ident') errors.push('in-party() 的参数必须是裸角色名（例如 in-party(芙宁娜)）');
      }
      if (['q-ready', 'e-ready', 'e-cd'].includes(fn.name) && n.args.length === 1) {
        const a = n.args[0];
        if (a.type !== 'ident') warnings.push(`${fn.name}() 的角色参数建议写成裸角色名（如 ${fn.name}(芙宁娜)），否则可能取不到目标角色`);
      }
      if (fn.name === 'last-exec' && n.args.length > 1 && n.args[1].type !== 'bool') {
        warnings.push('last-exec() 的第二个参数必须是字面量 true/false，否则会被静默当作 true');
      }
      if (['since', 'count', 'last-exec'].includes(fn.name)) {
        const slot = fn.name === 'last-exec' ? 2 : 0;
        const a = n.args[slot];
        if (a) {
          if (a.type === 'ident' && o.actionNames && !o.actionNames.some(x => String(x).toLowerCase() === a.lower)) {
            errors.push(`引用了不存在的动作名「${a.name}」（动作名必须与本策略中已声明的 name 完全一致，拼错会让条件恒为 false）`);
          }
          if (a.type === 'number' && o.knownIndexes && !o.knownIndexes.has(a.value)) {
            warnings.push(`引用了 index=${a.value}，但本策略中不存在该编号的动作`);
          }
        }
      }
      if (fn.name === 'q-ready' && n.args.length === 0 && !o.currentAction?.character) {
        warnings.push('通用动作（character 为空）里的 q-ready 会退化为“队伍中任意角色 Q 就绪”，不一定是你想要的效果');
      }
      if (fn.name === 'e-ready' && n.args.length === 0 && !o.currentAction?.character) {
        warnings.push('通用动作（character 为空）里的 e-ready 恒为 false');
      }
      if (fn.name === 'onfield' && !o.currentAction?.character) {
        warnings.push('通用动作（character 为空）里的 onfield() 恒为 false');
      }
    }
    if (n.type === 'bool' && n.raw && n.raw !== (n.value ? 'true' : 'false')) {
      errors.push(`布尔字面量必须小写：写 ${n.raw} 会被当成零参数函数，条件恒为 false（应写 ${n.value ? 'true' : 'false'}）`);
    }
  });

  return { errors, warnings, ast };
}

/** 顶层是否恒真/恒假（用于提示） */
function condConstValue(ast) {
  if (!ast) return null;
  if (ast.type === 'bool') return ast.value;
  if (ast.type === 'number') return ast.value > 0;
  return null;
}

/* ---------------- 隐式转换检查（数值 ↔ 布尔） ----------------
 * BetterGI 的表达式求值里，布尔与数值之间会发生隐式转换（true↔1、false↔0），
 * 写错参数类型不会报错，只会算出与预期不符的结果。这里只做“按位置推断类型”的检查，
 * 正常校验（condValidate）不会输出这类提示。
 */

/** 词法层把多段名合并成了单个 ident 节点，这里按“原子”把连续 ident 重新拼起来（如 since 芙芙e → since(芙芙e)） */
function condRenderAtoms(node, names) {
  if (!node) return '';
  if (node.type === 'ident' && !COND_FUNCTION_SET.has(node.lower)
    && names && names.some(n => String(n).toLowerCase() === node.lower)) return node.name;
  if (node.type === 'ident') return `${node.name}()`;
  if (node.type === 'call') return `${node.name}(${node.args.map(a => condRenderAtoms(a, names)).join(',')})`;
  if (node.type === 'binary') {
    if (node.op === '&&' || node.op === '||') return `${condRenderAtoms(node.left, names)} ${node.op} ${condRenderAtoms(node.right, names)}`;
    if (['+', '-', '*', '/'].includes(node.op)) {
      // 空格连接的两个 ident 是词法合并的产物（since 芙芙e）→ 还原成函数调用
      if (node.left.type === 'ident' && node.right.type === 'ident'
        && !COND_FUNCTION_SET.has(node.left.lower) && !COND_FUNCTION_SET.has(node.right.lower)) {
        return `${condRenderAtoms(node.left, names)}(${condRenderAtoms(node.right, names)})`;
      }
      const lp = (x) => condRenderAtoms(x, names);
      return `${lp(node.left)} ${node.op} ${lp(node.right)}`;
    }
    return `${condRenderAtoms(node.left, names)} ${node.op} ${condRenderAtoms(node.right, names)}`;
  }
  if (node.type === 'unary') {
    // 与 condToText 同理：`!` 作用于二元表达式时必须补括号，否则渲染出来的文本会换语义
    if (node.op === '!') return node.operand.type === 'binary'
      ? `!(${condRenderAtoms(node.operand, names)})`
      : `!${condRenderAtoms(node.operand, names)}`;
    if (node.operand.type === 'binary' || node.operand.type === 'unary') return `-(${condRenderAtoms(node.operand, names)})`;
    return `-${condRenderAtoms(node.operand, names)}`;
  }
  if (node.type === 'number') return String(node.value);
  if (node.type === 'bool') return node.value ? 'true' : 'false';
  return '';
}

/** 各函数的参数类型期望：'num' 数值 / 'bool' 布尔 / 'any' 不做判断；索引从 0 开始 */
const COND_ARG_EXPECT = {
  'battle-time': ['num', 'bool'],
  'since': ['num'],
  'count': ['num', 'num', 'num'],
  'last-exec': ['num', 'bool', 'num'],
  'q-ready': ['any'],
  'e-ready': ['any'],
  'e-cd': ['any'],
  'in-party': ['any'],
  'min': ['num'],
  'max': ['num'],
};

/** 内置函数的返回类型（COND_FUNCTIONS 里写的是 'number'，这里统一成 'num' 便于比较） */
function condFnReturn(fn) {
  if (!fn) return 'any';
  return fn.ret === 'number' ? 'num' : fn.ret;
}

/** 推断表达式片段的类型：'num' | 'bool' | 'any' */
function condExprType(node, names) {
  if (!node) return 'any';
  switch (node.type) {
    case 'number': return 'num';
    case 'bool': return 'bool';
    case 'ident': {
      const fn = COND_FUNCTION_BY_NAME.get(node.lower);
      if (fn) return condFnReturn(fn);
      if (names && names.some(n => String(n).toLowerCase() === node.lower)) return 'any';
      return 'any';
    }
    case 'call': {
      const fn = COND_FUNCTION_BY_NAME.get(node.lower);
      return fn ? condFnReturn(fn) : 'any';
    }
    case 'unary': return node.op === '!' ? 'bool' : 'num';
    case 'binary': {
      if (['&&', '||', '>', '<', '='].includes(node.op)) return 'bool';
      if (['+', '-', '*', '/'].includes(node.op)) return 'num';
      return 'any';
    }
    default: return 'any';
  }
}

/**
 * 收集表达式中的隐式转换位置
 * 返回 [{ text, reason }]，text 为该位置的表达式片段
 */
function condCollectConversions(ast, actionNames) {
  const names = actionNames || [];
  const out = [];
  const seen = new Set();
  const push = (node, reason) => {
    const text = condRenderAtoms(node, names) || '(空)';
    const key = text + '|' + reason;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ text, reason });
  };
  const check = (node, need) => {
    if (!node) return;
    const got = condExprType(node, names);
    if (got !== 'any' && got !== need) {
      const conv = (got === 'num' && need === 'bool')
        ? '这里需要布尔值，实际是数值 —— 求值时数值会按“大于 0 即为真”转成布尔'
        : '这里需要数值，实际是布尔值 —— 求值时 true/false 会被当作 1/0';
      push(node, conv);
    }
  };

  const walk = (node, need) => {
    if (!node) return;
    check(node, need);
    if (node.type === 'binary') {
      const op = node.op;
      if (op === '&&' || op === '||') {
        walk(node.left, 'bool'); walk(node.right, 'bool');
      } else if (op === '>' || op === '<' || op === '=') {
        walk(node.left, 'num'); walk(node.right, 'num');
      } else {
        walk(node.left, 'num'); walk(node.right, 'num');
      }
      return;
    }
    if (node.type === 'unary') {
      walk(node.operand, node.op === '!' ? 'bool' : 'num');
      return;
    }
    if (node.type === 'call') {
      const exp = COND_ARG_EXPECT[node.lower] || [];
      node.args.forEach((a, i) => {
        const want = exp[i] || exp[exp.length - 1] || 'num';
        if (want === 'any') return;
        walk(a, want);
      });
    }
  };

  walk(ast, 'bool');
  return out;
}
