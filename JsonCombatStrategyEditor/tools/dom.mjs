// 面向本项目的 DOM 模拟：用真实节点树支持 innerHTML 解析与结构感知选择器
// 仅供 Node 冒烟测试使用，不追求浏览器级完备
export function createDom() {
  const allElements = [];
  const roots = [];
  const detached = [];

  class ClassList {
    constructor(el) { this.el = el; this.set = new Set(); }
    add(...c) { c.forEach(x => x && this.set.add(x)); }
    remove(...c) { c.forEach(x => this.set.delete(x)); }
    contains(c) { return this.set.has(c); }
    toggle(c, force) {
      const on = force === undefined ? !this.set.has(c) : !!force;
      if (on) this.set.add(c); else this.set.delete(c);
      return on;
    }
    toString() { return [...this.set].join(' '); }
  }

  class Element {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.children = [];
      this.parentNode = null;
      this.style = {};
      this.dataset = {};
      this._attrs = new Map();
      this._listeners = new Map();
      this.classList = new ClassList(this);
      this._text = '';
      this.value = '';
      this.checked = false;
      this.type = '';
      this.disabled = false;
      this.files = [];
      this.selectionStart = 0;
      this.selectionEnd = 0;
      detached.push(this);
      allElements.push(this);
    }
    getAttribute(n) { return this._attrs.has(n) ? this._attrs.get(n) : null; }
    setAttribute(n, v) {
      this._attrs.set(n, String(v));
      if (n.startsWith('data-')) this.dataset[n.slice(5)] = String(v);
      // 与浏览器一致：写 class 属性等于改 classList（否则 innerHTML 解析出来的元素用 .cls 选择器选不中）
      if (n === 'class') this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean));
      // 与浏览器一致：type 属性会反映到 .type 属性上（编辑器靠 el.type === 'checkbox' 取勾选状态，
      // 解析出来的 input 只有属性、没有属性值时，.type 会是空串，勾选框就会被当成文本框读 value）
      if (n === 'type') this.type = String(v).toLowerCase();
    }
    removeAttribute(n) { this._attrs.delete(n); }
    hasAttribute(n) { return this._attrs.has(n); }
    get id() { return this.getAttribute('id') || ''; }
    set id(v) { this.setAttribute('id', v); }
    /** 是否还挂在文档节点树上（innerHTML 重建后旧节点应变为 false）
     *  实现：沿着 parentNode 往上找根即可 —— 以前是从所有根递归搜索整棵树，
     *  面板一大（几十万个节点）每次调用都要遍历一遍，测试跑几分钟全都耗在这里。 */
    get isConnected() {
      let n = this;
      while (n) {
        if (roots.includes(n)) return true;
        n = n.parentNode;
      }
      return false;
    }
    get className() { return this.classList.toString(); }
    set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get tag() { return this.tagName.toLowerCase(); }

    get innerHTML() { return serialize(this); }
    set innerHTML(v) { parseInto(this, String(v)); }
    get textContent() {
      let s = this._text;
      for (const c of this.children) s += c.textContent;
      return s;
    }
    set textContent(v) { for (const c of this.children) unindexSubtree(c); this.children = []; this._text = String(v); }

    appendChild(c) {
      if (c.parentNode) c.parentNode.removeChild(c);
      c.parentNode = this;
      this.children.push(c);
      // 增量维护 id 索引：parseInto 是自顶向下建的，每个 appendChild 只会索引新节点自己（O(1)），
      // 不会变成「每插一个节点重扫整棵树」。
      indexSubtree(c);
      return c;
    }
    /** 与浏览器一致：把节点插到 ref 之前（ref 不在自己名下时退化为 append） */
    insertBefore(c, ref) {
      if (!ref) return this.appendChild(c);
      const i = this.children.indexOf(ref);
      if (i < 0) return this.appendChild(c);
      if (c.parentNode) c.parentNode.removeChild(c);
      c.parentNode = this;
      this.children.splice(i, 0, c);
      indexSubtree(c);
      return c;
    }
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; unindexSubtree(c); } return c; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    addEventListener(t, fn) { const l = this._listeners.get(t) || []; if (!l.includes(fn)) l.push(fn); this._listeners.set(t, l); }
    removeEventListener(t, fn) { const l = this._listeners.get(t) || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }
    dispatch(type, ev) {
      const e = Object.assign({
        type, target: this, currentTarget: this,
        preventDefault() { }, stopPropagation() { e._stopped = true; },
        closest: (sel) => doc.closestFrom(this, sel),
      }, ev || {});
      // 模拟事件冒泡：沿着祖先链依次触发监听，最后到达 document（真实浏览器行为，
      // 编辑器把 input/change 委托挂在 document 上，所以这一步不能少）
      let cur = this;
      while (cur) {
        e.currentTarget = cur;
        for (const fn of (cur._listeners.get(type) || [])) fn(e);
        const onProp = cur['on' + type];
        if (typeof onProp === 'function') onProp.call(cur, e);
        if (e._stopped) break;
        cur = cur.parentNode;
      }
      if (!e._stopped) {
        for (const fn of (doc._listeners.get(type) || [])) fn(e);
      }
      return e;
    }
    click() { this.dispatch('click', {}); }
    focus() { doc.activeElement = this; }
    blur() { if (doc.activeElement === this) doc.activeElement = null; }
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
    matches(sel) { return matchOne(this, sel); }
    closest(sel) { return doc.closestFrom(this, sel); }
    querySelector(sel) { return doc.querySelector(sel, this); }
    /** 与浏览器一致：返回真正的数组（编辑器里到处在用 .find / .map / .filter） */
    querySelectorAll(sel) { return doc.querySelectorAll(sel, this); }
    scrollIntoView() { }
  }

  /* ---------- HTML 解析（只解析编辑器自己生成的简单 HTML） ---------- */
  const VOID_TAGS = new Set(['input', 'br', 'hr', 'img', 'meta', 'link']);
  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ', apos: "'" };
  function decode(s) { return s.replace(/&(#?\w+);/g, (m, e) => (e in ENTITIES ? ENTITIES[e] : m)); }

  function parseSelectorChain(sel) {
    // 支持 "tag#id.cls[attr=v] tag2" 形式，返回数组
    return String(sel).trim().split(/\s+/).map(part => {
      const spec = { tag: '', id: '', classes: [], attrs: [] };
      const re = /^([a-zA-Z][\w-]*)?(?:#([\w-]+))?((?:\.[\w-]+)*)((?:\[[^\]]*\])*)$/;
      const m = part.match(re);
      if (!m) return { ok: false, tag: '', id: '', classes: [], attrs: [] };
      spec.tag = (m[1] || '').toUpperCase();
      spec.id = m[2] || '';
      spec.classes = (m[3] || '').split('.').filter(Boolean);
      for (const a of (m[4] || '').match(/\[[^\]]*\]/g) || []) {
        const inner = a.slice(1, -1);
        const eq = inner.indexOf('=');
        if (eq < 0) spec.attrs.push({ name: inner.trim(), value: undefined });
        else {
          const name = inner.slice(0, eq).trim();
          let val = inner.slice(eq + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
          spec.attrs.push({ name, value: decode(val) });
        }
      }
      return spec;
    });
  }
  /** 支持逗号分隔的选择器列表（与浏览器一致），返回若干条选择器链 */
  function parseSelectorList(sel) {
    return String(sel).split(',').map(s => s.trim()).filter(Boolean).map(parseSelectorChain);
  }
  function matchOne(el, sel) {
    if (!el || !el.tagName) return false;
    return matchAnyChain(el, parseSelectorList(sel));
  }
  function matchAnyChain(el, list) {
    if (!el || !el.tagName) return false;
    return list.some(chain => chain.length && chain[0].ok !== false && matchChain(el, chain));
  }
  function matchSpec(el, spec) {
    if (!el || !el.tagName || spec.ok === false) return false;
    if (spec.tag && el.tagName !== spec.tag) return false;
    if (spec.id && el.getAttribute('id') !== spec.id) return false;
    for (const c of (spec.classes || [])) if (!el.classList.contains(c)) return false;
    for (const a of (spec.attrs || [])) {
      if (!el.hasAttribute(a.name)) return false;
      if (a.value !== undefined && el.getAttribute(a.name) !== a.value) return false;
    }
    return true;
  }
  function matchChain(el, chain) {
    // chain 最后一项必须匹配 el，前面的项按祖先顺序匹配
    if (!matchSpec(el, chain[chain.length - 1])) return false;
    let cur = el.parentNode;
    let i = chain.length - 2;
    while (cur && i >= 0) {
      if (matchSpec(cur, chain[i])) i--;
      cur = cur.parentNode;
    }
    return i < 0;
  }

  function tokenizeHtml(html) {
    const tokens = [];
    const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
    let last = 0, m;
    while ((m = re.exec(html)) !== null) {
      if (m.index > last) tokens.push({ type: 'text', value: html.slice(last, m.index) });
      if (m[0].startsWith('<!--')) { /* 注释忽略 */ }
      else if (m[1]) tokens.push({ type: 'close', tag: m[1].toUpperCase() });
      else {
        tokens.push({ type: 'open', tag: m[2].toUpperCase(), attrs: parseAttrs(m[3] || ''), selfClose: m[4] === '/' });
      }
      last = re.lastIndex;
    }
    if (last < html.length) tokens.push({ type: 'text', value: html.slice(last) });
    return tokens;
  }
  function parseAttrs(s) {
    const out = new Map();
    const re = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      const name = m[1];
      const val = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : ''));
      out.set(name, decode(val));
    }
    return out;
  }
  function parseInto(host, html) {
    // 旧子树要从 id 索引里摘掉（innerHTML 替换不走 removeChild）
    for (const c of host.children) unindexSubtree(c);
    host.children = [];
    host._text = '';
    const stack = [host];
    for (const tk of tokenizeHtml(html)) {
      const top = stack[stack.length - 1];
      if (tk.type === 'text') {
        // 文本按出现位置作为子节点插入：编辑器会生成「文字里夹着 <span>」的行内 HTML
        // （例如优先级预览里带悬停提示的动作引用），文字必须留在原位置，不能被挪到元素前后。
        if (tk.value === '') continue;
        const t = new Element('#text');
        t._raw = tk.value;                       // 原样保存（序列化时要还原成原文）
        t._text = decode(tk.value);              // 解析后的文本（textContent 用）
        top.appendChild(t);
        continue;
      }
      if (tk.type === 'open') {
        const el = new Element(tk.tag);
        for (const [k, v] of tk.attrs) el.setAttribute(k, v);
        if (el.hasAttribute('checked')) el.checked = true;
        if (el.hasAttribute('disabled')) el.disabled = true;
        if (el.hasAttribute('selected')) el.selected = true;
        if (el.hasAttribute('open')) el.open = true;
        if (el.hasAttribute('value')) el.value = el.getAttribute('value');
        top.appendChild(el);
        // 空元素（br / hr / input / img…）永远不会成为父节点 —— 与浏览器一致。
        // 否则 <hr> 后面的所有内容都会变成 hr 的子节点（hr 不是容器，浏览器里就是兄弟节点）。
        if (!tk.selfClose && !VOID_TAGS.has(tk.tag.toLowerCase())) stack.push(el);
        continue;
      }
      if (tk.type === 'close') {
        for (let i = stack.length - 1; i > 0; i--) {
          if (stack[i].tagName === tk.tag) { stack.length = i; break; }
        }
      }
    }
    syncSelects(host);
    syncTextareas(host);
  }

  /** <textarea> 的内容文本就是它的初始 value（与真实浏览器一致） */
  function syncTextareas(host) {
    for (const c of host.children) {
      if (c.tagName === 'TEXTAREA') c.value = c.textContent;
      syncTextareas(c);
    }
  }

  /** <select> 的 value 取 selected 的 option（没有则第一个），与真实浏览器一致 */
  function syncSelects(host) {
    for (const c of host.children) {
      if (c.tagName === 'SELECT') {
        const opts = c.children.filter(o => o.tagName === 'OPTION');
        const sel = opts.find(o => o.selected) || opts[0];
        if (sel) c.value = sel.getAttribute('value') || '';
      }
      syncSelects(c);
    }
  }

  function serialize(el) {
    let s = el._text;
    for (const c of el.children) {
      if (c.tagName === '#TEXT') { s += (c._raw !== undefined ? c._raw : c._text); continue; }
      const attrs = [...c._attrs.entries()].map(([k, v]) => ` ${k}="${k === 'class' ? c.classList.toString() : v}"`).join('');
      const cls = c.classList.set.size && !c._attrs.has('class') ? ` class="${c.classList.toString()}"` : '';
      const isVoid = VOID_TAGS.has(c.tagName.toLowerCase());
      s += `<${c.tagName.toLowerCase()}${attrs}${cls}${isVoid ? '/>' : '>'}`;
      if (!isVoid) s += serialize(c) + `</${c.tagName.toLowerCase()}>`;
    }
    return s;
  }

  /* ---------- 文档 ---------- */
  const byId = new Map();      // 挂在文档上的元素的 id 索引（增量维护，见 indexSubtree）
  const applyQueue = new Map(); // 静态 HTML 里声明但尚未挂载的元素
  // <body>：真实浏览器里一定有；编辑器下载文件时会往它上面挂 <a>。
  const bodyEl = new Element('body');
  roots.push(bodyEl);

  /** 把一棵子树的 id 记进索引（同一个 id 多个节点时以先到的为准，与浏览器一致） */
  function indexSubtree(n) {
    if (!n || !n.getAttribute) return;
    const id = n.getAttribute('id');
    if (id && !byId.has(id)) byId.set(id, n);
    for (const c of n.children) indexSubtree(c);
  }
  /** 把一棵子树的 id 从索引里摘掉（只摘指向自己的那些条目） */
  function unindexSubtree(n) {
    if (!n || !n.getAttribute) return;
    const id = n.getAttribute('id');
    if (id && byId.get(id) === n) byId.delete(id);
    for (const c of n.children) unindexSubtree(c);
  }

  const doc = {
    activeElement: null,
    body: bodyEl,
    _listeners: new Map(),
    createElement(tag) { return new Element(tag); },
    createTextNode(t) { const e = new Element('span'); e._text = String(t); return e; },
    /** 只返回当前挂在节点树上的节点（id 索引随结构增量维护，与 innerHTML 重建保持一致） */
    getElementById(id) {
      const found = byId.get(id);
      if (found) {
        if (found.isConnected) return found;
        byId.delete(id);        // 索引里的是已经脱离文档的旧节点：丢掉，按“找不到”处理
      }
      if (applyQueue.has(id)) return applyQueue.get(id);
      const el = new Element('div');
      el.setAttribute('id', id);
      applyQueue.set(id, el);
      return el;
    },
    /** 把临时创建的容器正式接到文档上（模拟 index.html 里已有的静态元素） */
    mount(el) {
      if (!roots.includes(el)) roots.push(el);
      applyQueue.delete(el.getAttribute('id'));
      indexSubtree(el);
      return el;
    },
    addEventListener(t, fn) { if (!this._listeners.has(t)) this._listeners.set(t, []); this._listeners.get(t).push(fn); },
    removeEventListener(t, fn) { const l = this._listeners.get(t) || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
    dispatch(type, ev) {
      const e = Object.assign({ type, preventDefault() { }, stopPropagation() { } }, ev || {});
      for (const fn of (this._listeners.get(type) || [])) fn(e);
      return e;
    },
    querySelectorAll(sel, scope) { const list = parseSelectorList(sel); return walkAll(el => matchAnyChain(el, list), scope); },
    querySelector(sel, scope) { const list = parseSelectorList(sel); return walkFirst(el => matchAnyChain(el, list), scope); },
    /** 给新解析出来的节点补上文档级监听（模拟浏览器行为，便于测试） */
    addEventListener(t, fn) { if (!this._listeners.has(t)) this._listeners.set(t, []); this._listeners.get(t).push(fn); },
    closestFrom(el, sel) {
      const list = parseSelectorList(sel);
      let cur = el;
      while (cur) {
        for (const chain of list) {
          const last = chain[chain.length - 1];
          if (last && last.ok !== false && matchSpec(cur, last)) return cur;
        }
        cur = cur.parentNode;
      }
      return null;
    },
    _all: () => allElements,
    _nodes: () => allElements,
  };
  function walkAll(pred, scope) {
    const out = [];
    const seen = new Set();
    const visit = (n) => {
      for (const c of n.children) {
        if (seen.has(c)) continue;
        seen.add(c);
        if (pred(c)) out.push(c);
        visit(c);
      }
    };
    // 指定了 scope 时只在子树里找（与浏览器里 element.querySelector 的语义一致）
    if (scope) { visit(scope); return out; }
    // 只找挂在文档上的节点 —— 与浏览器一致。
    // innerHTML 重建会把旧节点摘下来，那些旧节点**不能再**被 document.querySelector 查到，
    // 否则「同一个 data-id 的旧节点」会先于新节点被选中，测试里的交互就落到了脱离文档的节点上。
    for (const root of roots) visit(root);
    return out;
  }

  /** 深度优先找第一个匹配的元素；给了 scope 就只在它的子树里找（与浏览器里 element.querySelector 一致） */
  function walkFirst(pred, scope) {
    const seen = new Set();
    const visit = (n) => {
      for (const c of n.children) {
        if (seen.has(c)) continue;
        seen.add(c);
        if (pred(c)) return c;
        const r = visit(c);
        if (r) return r;
      }
      return null;
    };
    if (scope) return visit(scope);
    for (const root of roots) { const r = visit(root); if (r) return r; }
    return null;
  }

  const localStorage = {
    _m: new Map(),
    getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
    setItem(k, v) { this._m.set(k, String(v)); },
    removeItem(k) { this._m.delete(k); },
    clear() { this._m.clear(); },
  };

  const windowMock = {
    _listeners: new Map(),
    $: null,    addEventListener(t, fn) { if (!this._listeners.has(t)) this._listeners.set(t, []); this._listeners.get(t).push(fn); },
    removeEventListener(t, fn) { const l = this._listeners.get(t) || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
    dispatch(t) {
      for (const fn of (this._listeners.get(t) || [])) {
        try { fn({ type: t }); }
        catch (e) {
          console.log('[window.dispatch ' + t + '] ' + (e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : e));
          throw e;
        }
      }
    },
    localStorage,
    document: doc,
    URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => { } },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
  };

  return { window: windowMock, document: doc, localStorage, Element, allElements, roots };
}
