// 生成 src/js/data_avatars.js
// 数据来源（BetterGI 源码）：
//   1) better-genshin-impact-main/BetterGenshinImpact/GameTask/AutoFight/Assets/combat_avatar.json
//      → 角色标准名、id、内置角色表次序（name 必须与之一致，否则动作会被静默过滤）
//      → 该文件里的 alias 列表：**只**用来在网页的搜索框里匹配角色，永远不会显示出来，
//        也不会写进任何导出的 JSON（页面上一律只显示标准名）。
//   2) better-genshin-impact-main/BetterGenshinImpact/GameTask/AutoCombo/AvatarProfiles.cs
//      → 元素标签（每个角色恰好一个 "X元素"），无档案者归入元素类型 0
//
// 编号规则：
//   元素类型 0：当前角色(00，虚拟条目) / 旅行者(01) / 奇偶·男性(02) / 奇偶·女性(03)
//   元素类型 1..7（冰 火 水 雷 风 岩 草）：按 combat_avatar.json 中出现次序从 01 递增
//   星级一律留空，由网页内补录后存 localStorage
//
// 用法：node tools/gen_avatars.mjs [输出路径]
//   不给输出路径时写回 src/js/data_avatars.js；
//   给了就写到那个路径（用于先看一眼生成结果、或写进临时目录做对比）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// BetterGI 源码快照既可能在编辑器目录里，也可能与编辑器目录同级（本工作区的实际布局）
const repoCandidates = [
  path.join(root, 'better-genshin-impact-main', 'BetterGenshinImpact'),
  path.join(root, '..', 'better-genshin-impact-main', 'BetterGenshinImpact'),
];
const repo = repoCandidates.find(p => fs.existsSync(p)) || repoCandidates[0];
const avatarJsonPath = path.join(repo, 'GameTask', 'AutoFight', 'Assets', 'combat_avatar.json');
const outPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'src', 'js', 'data_avatars.js');

/** 在源码快照里找 AvatarProfiles.cs：BetterGI 挪过它的位置（AutoCombo / AutoCombo/ComboBuild），
 *  所以先试几个已知路径，再退回递归查找，免得上游一动目录生成脚本就报 ENOENT。 */
function findProfileFile() {
  const known = [
    path.join(repo, 'GameTask', 'AutoCombo', 'AvatarProfiles.cs'),
    path.join(repo, 'GameTask', 'AutoCombo', 'ComboBuild', 'AvatarProfiles.cs'),
  ];
  for (const p of known) if (fs.existsSync(p)) return p;
  const stack = [repo];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name === 'AvatarProfiles.cs') return p;
    }
  }
  return known[0];
}
const profilesPath = findProfileFile();

const avatars = JSON.parse(fs.readFileSync(avatarJsonPath, 'utf8'));
const cs = fs.readFileSync(profilesPath, 'utf8');

// BetterGI 源码快照还没有、但确认会在下个版本实装的新角色：先手工预留在角色表里，
// 方便提前编写包含该角色的战斗策略。等上游 combat_avatar.json 补上同名角色后，
// 这里的条目会自动跳过（不会重复），再按上游顺序重新编号即可。
const EXTRA_AVATARS = [
  {
    after: '瓦列里',
    entry: { id: '10000136', name: '米提亚', nameEn: 'Mitya', alias: ['米提亚', 'Mitya', '米神', '天才小子'] },
  },
];
for (const ex of EXTRA_AVATARS) {
  if (avatars.some(a => a.name === ex.entry.name)) continue;
  const i = avatars.findIndex(a => a.name === ex.after);
  avatars.splice(i < 0 ? avatars.length : i + 1, 0, ex.entry);
}

/**
 * combat_avatar.json 里每个角色的 alias（该角色在玩家口中的其它写法）。
 * 只用于网页搜索框的匹配，不参与编号、不写进导出 JSON、也不显示。
 * 去重、去掉与标准名完全一样的、去掉空白项。
 */
const aliasOf = new Map();
for (const a of avatars) {
  const list = Array.isArray(a.alias) ? a.alias : [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const t = String(raw === null || raw === undefined ? '' : raw).trim();
    if (!t || t === a.name || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  aliasOf.set(a.name, out);
}
/** 把若干个角色的 alias 并起来（用于「荧 / 空」合并进「旅行者」这种同一角色的多条词条） */
function mergedAlias(names) {
  const seen = new Set();
  const out = [];
  for (const n of names) for (const t of (aliasOf.get(n) || [])) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

// 解析 AvatarProfiles.cs 里的 new("角色名", "描述", [ ... ]) 元素标签
const elementOf = new Map();
const re = /new\("([^"]+)",\s*"(?:[^"\\]|\\.)*",\s*\[([^\]]*)\]\s*\)/g;
let m;
while ((m = re.exec(cs)) !== null) {
  const name = m[1];
  const tags = [...m[2].matchAll(/"([^"]+)"/g)].map(x => x[1]);
  const elems = tags.filter(t => t.endsWith('元素'));
  if (elems.length === 1) elementOf.set(name, elems[0]);
}

// 元素号分配（与元素反应先后手顺序相关，改动会影响 index 第 2 位与 priority 分段）
const ELEMENT_CODE = { '冰元素': 1, '火元素': 2, '水元素': 3, '雷元素': 4, '风元素': 5, '岩元素': 6, '草元素': 7 };
const NO_ELEMENT_NAMES = ['旅行者', '荧', '空', '奇偶·男性', '奇偶·女性'];
const EXCLUDED = new Set(['未知角色']); // BetterGI 无法识别角色时的兜底名，不作为可选角色
// 旅行者/荧/空 视为同一角色（取决于玩家选择的性别），只保留标准名「旅行者」
const MERGE_INTO_TRAVELER = new Set(['荧', '空']);
// 元素手工档案：AvatarProfiles.cs 里还没有这些角色的档案（源码快照滞后），先手工指定，档案优先。
// 等 AvatarProfiles.cs 补上档案后，可以把对应的条目删掉，再重跑本脚本。
const ELEMENT_FALLBACK = {
  '沃雅妮莎': '水元素',   // 依据战斗数据里的别名推定
  '薇斯纳': '风元素',     // 依据战斗数据里的别名推定
  '瓦列里': '雷元素',     // 该角色尚未实装（BetterGI 超前填充的词条），按游戏里已有内容推测为雷元素
  '米提亚': '雷元素',     // 同上；BetterGI 源码快照尚未收录，由 EXTRA_AVATARS 提前预留
};

const result = [];
const counters = {};

/** 只有搜索用的其它写法时，才写进数据文件（没有的就不写这个字段） */
function withAlias(obj, names) {
  const alias = mergedAlias(names);
  if (alias.length) obj.alias = alias;
  return obj;
}

// 元素类型 0 的特殊条目
result.push({
  code: 0, name: '当前角色', seq: 0, id: '', element: 0, noElement: true,
  virtual: true, note: 'character 字段留空，动作对所有当前出战角色生效'
});
// 旅行者与「荧 / 空」是同一角色的不同性别，只保留标准名「旅行者」，
// 但这两条词条里的搜索用写法要一起并进来（否则搜「女主 / 男主」之类的写法找不到旅行者）。
result.push(withAlias({
  code: 0, name: '旅行者', seq: 1, id: '20000000', element: 0, noElement: true,
  note: '荧/空 同一角色的两种性别；元素随命途变化，BetterGI 不识别其元素属性'
}, ['旅行者', '荧', '空']));
let seq0 = 2;

for (const a of avatars) {
  const name = a.name;
  if (EXCLUDED.has(name)) continue;
  if (MERGE_INTO_TRAVELER.has(name)) continue;
  if (NO_ELEMENT_NAMES.includes(name)) {
    if (name === '旅行者') continue; // 已手工加入
    result.push(withAlias({
      code: 0, name, seq: seq0++, id: a.id, element: 0, noElement: true,
      note: '无元素档案（主角类/特殊角色），BetterGI 不识别其元素属性'
    }, [name]));
    continue;
  }
  const elemName = elementOf.get(name) || ELEMENT_FALLBACK[name];
  if (!elemName) {
    result.push(withAlias({
      code: 0, name, seq: seq0++, id: a.id, element: 0, noElement: true,
      note: 'AvatarProfiles.cs 中无元素档案，已归入元素类型 0'
    }, [name]));
    continue;
  }
  const code = ELEMENT_CODE[elemName];
  counters[code] = (counters[code] || 0) + 1;
  result.push(withAlias({
    code, name, seq: counters[code], id: a.id, element: code,
    elementName: elemName, noElement: false
  }, [name]));
}

// 排序：元素类型 0..7，同元素按 seq
result.sort((a, b) => (a.code - b.code) || (a.seq - b.seq) || a.name.localeCompare(b.name, 'zh'));

const lines = [];
lines.push('/* 自动生成，请勿手工编辑：由 tools/gen_avatars.mjs 从 BetterGI 源码生成。');
lines.push(' * 数据源：GameTask/AutoFight/Assets/combat_avatar.json + GameTask/AutoCombo/AvatarProfiles.cs');
lines.push(' * code=动作编号第2位(元素类型)，seq=第3~4位(角色标识)，两者决定动作检索次序。');
lines.push(' * rarity 一律留空，由网页内「星级补录」维护（存 localStorage，可导出补丁）。 */');
lines.push('const AVATARS = ' + JSON.stringify(result, null, 1) + ';');
lines.push('');
lines.push('const ELEMENTS = [');
lines.push("  { code: 0, name: '元素未定', color: '#9aa0a6' },");
lines.push("  { code: 1, name: '冰', color: '#8fe3ff' },");
lines.push("  { code: 2, name: '火', color: '#ff7a52' },");
lines.push("  { code: 3, name: '水', color: '#4cc2ff' },");
lines.push("  { code: 4, name: '雷', color: '#b98cff' },");
lines.push("  { code: 5, name: '风', color: '#6fe0b8' },");
lines.push("  { code: 6, name: '岩', color: '#ffd166' },");
lines.push("  { code: 7, name: '草', color: '#9ade4b' },");
lines.push('];');
lines.push('');
lines.push('const ACTION_TYPES = [');
lines.push("  { code: 0, name: '战斗检查与标记', short: '检查与标记', cn: '仅为独立的战斗结束检测循环和不指定角色的标记动作预留的位置，可在“当前角色”下新增动作时选择' },");
lines.push("  { code: 1, name: '开盾', short: '开盾', cn: '开启护盾的技能当然是最优先的，并且要保证释放成功，护盾提供的是至关重要的抗打断能力和生存能力' },");
lines.push("  { code: 2, name: '先手', short: '先手', cn: '需要在开始爆发前一定时间释放的技能，和持续时间比较长的挂先手元素技能' },");
lines.push("  { code: 3, name: '后台输出', short: '后台', cn: '可以在后台持续造成较多伤害的技能，有这种技能的一般被认为是后台副C' },");
lines.push("  { code: 4, name: '辅助', short: '辅助', cn: '持续时间或次数有限的，具备减抗和增伤等效果的辅助技能，用于增加后续爆发伤害' },");
lines.push("  { code: 5, name: '爆发', short: '爆发', cn: '能在短时间内造成大量伤害的输出技能，可以挂额外优先级条目在关键辅助技能释放后优先执行' },");
lines.push("  { code: 6, name: '前台长轴输出', short: '前台', cn: '需要较长时间才能完全释放大量伤害的动作组，可以利用额外优先级条目在必要前置动作后一定时间内循环执行' },");
lines.push("  { code: 7, name: '回血或低收益技能', short: '低收益', cn: '包括回血技能在内的，伤害较低的技能，请绝对不要忘记挂额外优先级条目在低血量下优先执行回血技能' },");
lines.push("  { code: 8, name: '纯挂元素普攻', short: '元素普攻', cn: '字面意思，若没有其他动作可以执行，用普攻挂点元素与后台技能发生反应，并提供充能' },");
lines.push("  { code: 9, name: '兜底普攻/等待', short: '兜底', cn: '实在没有其他动作可以执行了，那就只能来点物理攻击了，或者至少得在日志里输出点什么' },");
lines.push('];');
lines.push('');

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join('\n'), 'utf8');

const stat = {};
for (const r of result) stat[r.code] = (stat[r.code] || 0) + 1;
console.log('已生成 ' + path.relative(root, outPath));
console.log('条目数：' + result.length);
for (const [k, v] of Object.entries(stat)) {
  const e = [{ 0: '无元素' }, { 1: '冰' }, { 2: '火' }, { 3: '水' }, { 4: '雷' }, { 5: '风' }, { 6: '岩' }, { 7: '草' }][Number(k)] || {};
  console.log('  元素 ' + k + '(' + (e[Number(k)] || '?') + ')：' + v + ' 个');
}
const missing = avatars.filter(a => !EXCLUDED.has(a.name) && !MERGE_INTO_TRAVELER.has(a.name) && !NO_ELEMENT_NAMES.includes(a.name)
  && !elementOf.get(a.name) && !ELEMENT_FALLBACK[a.name]);
if (missing.length) console.log('⚠ 无元素档案（已归入元素类型 0，需要的话可以补进 ELEMENT_FALLBACK）：' + missing.map(a => a.name).join('、'));
