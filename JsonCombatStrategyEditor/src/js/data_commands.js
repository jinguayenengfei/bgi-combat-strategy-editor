/* 指令词表与按键表
 * 依据 BetterGI 源码：
 *   - GameTask/AutoFight/Script/Method.cs        方法别名表（别名匹配区分大小写）
 *   - GameTask/AutoFight/Script/CombatCommand.cs 参数校验与执行分支
 *   - GameTask/AutoFight/Script/CombatScriptParser.cs 逗号分隔 / 括号配对规则
 *   - GameTask/AutoFight/Model/Avatar.cs         mousedown|mouseup|click 的参数为 left/right/middle（小写）
 *   - Helpers/User32Helper.cs                   keydown|keyup|keypress 参数转大写并补 VK_ 前缀后 Enum.Parse
 */

// 规范化方法表：canonical 为规范写法，alias 为全部合法别名（大小写敏感）
const METHODS = [
  { canonical: 'attack', alias: ['attack', '普攻', '普通攻击'], argKind: 'none', maxArgs: 1, cat: '战斗', cn: '普通攻击（循环点击左键）' },
  { canonical: 'charge', alias: ['charge', '重击'], argKind: 'none', maxArgs: 1, cat: '战斗', cn: '重击（按住左键蓄力）' },
  { canonical: 'e', alias: ['skill', 'e'], argKind: 'flagset', flags: ['hold', 'wait', 'fast'], cat: '战斗', cn: '元素战技' },
  { canonical: 'q', alias: ['burst', 'q'], argKind: 'none', maxArgs: 0, cat: '战斗', cn: '元素爆发' },
  { canonical: 'wait', alias: ['wait', 'after', '等待'], argKind: 'seconds', required: true, cat: '流程', cn: '等待指定秒数' },
  { canonical: 'ready', alias: ['ready', '完成'], argKind: 'none', maxArgs: 0, cat: '流程', cn: '等待角色恢复可操作状态' },
  { canonical: 'check', alias: ['check', '检测'], argKind: 'none', maxArgs: 0, cat: '流程', cn: '触发一次战斗结束检测（空操作指令）' },
  { canonical: 'walk', alias: ['walk', '行走'], argKind: 'walk', cat: '移动', cn: '按住方向键行走' },
  { canonical: 'w', alias: ['w'], argKind: 'seconds', required: true, cat: '移动', cn: '向前行走' },
  { canonical: 's', alias: ['s'], argKind: 'seconds', required: true, cat: '移动', cn: '向后行走' },
  { canonical: 'a', alias: ['a'], argKind: 'seconds', required: true, cat: '移动', cn: '向左行走' },
  { canonical: 'd', alias: ['d'], argKind: 'seconds', required: true, cat: '移动', cn: '向右行走' },
  { canonical: 'dash', alias: ['dash', '冲刺'], argKind: 'seconds', cat: '移动', cn: '冲刺' },
  { canonical: 'jump', alias: ['jump', 'j', '跳跃'], argKind: 'none', maxArgs: 0, cat: '移动', cn: '跳跃' },
  { canonical: 'mousedown', alias: ['mousedown'], argKind: 'mouse', cat: '鼠标', cn: '按下鼠标键' },
  { canonical: 'mouseup', alias: ['mouseup'], argKind: 'mouse', cat: '鼠标', cn: '抬起鼠标键' },
  { canonical: 'click', alias: ['click'], argKind: 'mouse', cat: '鼠标', cn: '单击鼠标键' },
  { canonical: 'moveby', alias: ['moveby'], argKind: 'twodouble', cat: '鼠标', cn: '相对移动镜头' },
  { canonical: 'scroll', alias: ['scroll', 'verticalscroll'], argKind: 'int', cat: '鼠标', cn: '滚动鼠标滚轮' },
  { canonical: 'keydown', alias: ['keydown'], argKind: 'key', cat: '按键', cn: '按下按键' },
  { canonical: 'keyup', alias: ['keyup'], argKind: 'key', cat: '按键', cn: '抬起按键' },
  { canonical: 'keypress', alias: ['keypress'], argKind: 'key', cat: '按键', cn: '单击按键' },
  { canonical: 'round', alias: ['round'], argKind: 'none', cat: '不可用', cn: '回合分组：在 JSON 策略中无效' },
  { canonical: 'aim', alias: ['aim', 'r', '瞄准'], argKind: 'none', cat: '不可用', cn: '瞄准：源码中已注释掉，使用会报“未知的方法”' },
];

// 参考 User32.VK（Vanara.PInvoke）常用成员：keydown/keyup/keypress 的合法参数
const VK_CODES = [
  // 字母
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(c => ({ code: 'VK_' + c, label: c, group: '字母' })),
  // 数字
  ...'0123456789'.split('').map(c => ({ code: 'VK_' + c, label: c, group: '数字' })),
  // 鼠标
  { code: 'VK_LBUTTON', label: '鼠标左键', group: '鼠标' },
  { code: 'VK_RBUTTON', label: '鼠标右键', group: '鼠标' },
  { code: 'VK_MBUTTON', label: '鼠标中键', group: '鼠标' },
  // 功能键
  { code: 'VK_SPACE', label: '空格', group: '功能键' },
  { code: 'VK_ESCAPE', label: 'Esc', group: '功能键' },
  { code: 'VK_TAB', label: 'Tab', group: '功能键' },
  { code: 'VK_RETURN', label: 'Enter', group: '功能键' },
  { code: 'VK_BACK', label: 'Backspace', group: '功能键' },
  { code: 'VK_DELETE', label: 'Delete', group: '功能键' },
  { code: 'VK_SHIFT', label: 'Shift', group: '功能键' },
  { code: 'VK_CONTROL', label: 'Ctrl', group: '功能键' },
  { code: 'VK_MENU', label: 'Alt', group: '功能键' },
  ...Array.from({ length: 12 }, (_, i) => ({ code: 'VK_F' + (i + 1), label: 'F' + (i + 1), group: '功能键' })),
];

const VK_SET = new Set(VK_CODES.map(k => k.code));
// BetterGI 的 ToVk 会先 ToUpper 再补 VK_ 前缀，所以单个字母/数字写成 e / E / 1 也都合法
for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') VK_SET.add(c);
const MOUSE_KEYS = ['left', 'right', 'middle'];

// 快捷指令词表
// params: 需要用户填写的参数；模板中用 {名} 占位；hint 只给确实是“参数说明”的项加（参数名已能从标签读懂的就不再重复）
const QUICK_COMMANDS = [
  { label: '点按普攻', tpl: 'attack', cn: '普通攻击 1 次', params: [] },
  { label: '连续普攻', tpl: 'attack({t})', cn: '按 200ms 一拍连打，次数 ≈ 秒数/0.2 + 1（不带参数时只打 1 次）', params: [{ key: 't', label: '秒数', type: 'number', def: '1', min: 0 }] },
  { label: '重击', tpl: 'charge({t})', cn: '按住左键蓄力重击（省略参数时默认 1 秒）', params: [{ key: 't', label: '秒数', type: 'number', def: '1', min: 0 }] },
  { label: '点按e技能', tpl: 'e', cn: '点按元素战技（可用 e(hold) 表示长按、e(wait) 表示等 CD结束）', params: [] },
  { label: '长按e技能', tpl: 'keydown(e),wait({t}),keyup(e)', cn: '按住 e 一段时间再松开；keyup(e) 会额外触发一次 E 技能 CD 的 OCR 检测', params: [{ key: 't', label: '按住秒数', type: 'number', def: '0.5', min: 0.01 }] },
  { label: '点按q技能', tpl: 'q,wait(0.1),ready', cn: '元素爆发后等 0.1 秒再等待角色可操作，避免大招动画期间被吞后续动作', params: [] },
  { label: '长按q技能', tpl: 'keydown(q),wait({t}),keyup(q),wait(0.1),ready', cn: '按住 q 一段时间再松开，随后等 0.1 秒并等待可操作', params: [{ key: 't', label: '按住秒数', type: 'number', def: '0.5', min: 0.01 }] },
  { label: '等待', tpl: 'wait({t})', cn: '纯等待指定秒数（不会被取消令牌打断）', params: [{ key: 't', label: '秒数', type: 'number', def: '0.2', min: 0, step: 0.05 }] },
  { label: '移动', tpl: 'walk({dir},{t})', cn: '按住方向键行走指定秒数', params: [{ key: 'dir', label: '方向', type: 'select', def: 'w', options: [['w', '前 w'], ['s', '后 s'], ['a', '左 a'], ['d', '右 d']] }, { key: 't', label: '秒数', type: 'number', def: '0.2', min: 0.01, hint: '必须大于 0' }] },
  { label: '检查战斗结束', tpl: 'check', cn: '空操作指令，但会触发一次战斗结束检测；其之前的指令会先执行完', params: [] },
  { label: '冲刺', tpl: 'dash({t})', cn: '冲刺（省略参数时默认 200ms）', params: [{ key: 't', label: '秒数', type: 'number', def: '0.2', min: 0 }] },
  { label: '跳跃', tpl: 'jump', cn: '跳跃（别名 j / 跳跃）', params: [] },
  { label: '点击鼠标中键', tpl: 'click(middle)', cn: '单击中键，常用于重置镜头/索敌', params: [] },
  { label: '滚动鼠标滚轮', tpl: 'scroll({n})', cn: '滚动鼠标滚轮，正数与负数方向不同，具体方向受系统滚轮设置影响）', params: [{ key: 'n', label: '格数', type: 'int', def: '10', hint: '必须是整数，可正可负' }] },
  { label: '移动鼠标', tpl: 'moveby({x},{y})', cn: '相对移动镜头（像素）。横向：正数向右、负数向左；纵向：正数向下、负数向上', params: [{ key: 'x', label: '横向', type: 'int', def: '1800', hint: '正数向右，负数向左' }, { key: 'y', label: '纵向', type: 'int', def: '0', hint: '正数向下，负数向上' }] },
  { label: '点按按键', tpl: 'keypress({key})', cn: '单击一个按键。鼠标键必须写全大写的 VK_LBUTTON / VK_RBUTTON / VK_MBUTTON，否则会静默退化成键盘按键', params: [{ key: 'key', label: '按键', type: 'vk', def: 'VK_E' }] },
  { label: '持续按下按键', tpl: 'keydown({key})', cn: '按下并保持一个按键（需自行搭配「松开按键」）', params: [{ key: 'key', label: '按键', type: 'vk', def: 'VK_E' }] },
  { label: '松开按键', tpl: 'keyup({key})', cn: '松开一个按键；若为 e 会额外触发一次 E 技能 CD 检测', params: [{ key: 'key', label: '按键', type: 'vk', def: 'VK_E' }] },
  { label: '长按后松开按键', tpl: 'keydown({key}),wait({t}),keyup({key})', cn: '按下某个按键、持续指定秒数后再松开（keydown 与 keyup 用的是同一个按键）；若为 e 会额外触发一次 E 技能 CD 检测', params: [{ key: 'key', label: '按键', type: 'vk', def: 'VK_E' }, { key: 't', label: '按住秒数', type: 'number', def: '0.5', min: 0.01 }] },
  { label: '大招结束检查', tpl: 'ready', cn: '等待角色恢复可操作状态（最多轮询 20 次 × 150ms）。q 相关的动作串里已包含 ready，一般不需要单独使用', params: [] },
];

/* 条件函数快捷插入词表（[值, 显示名, 说明]；未列出的函数不提供快捷插入，但仍可手输） */
const COND_QUICK_FUNCS = [
  ['t', '距开战时间', 't'],
  ['since', '距上次执行动作时间', 'since'],
  ['count', '动作执行次数', 'count'],
  ['last-check', '距上次战斗结束检查时间', 'last-check'],
  ['q-ready', 'Q 是否就绪', 'q-ready'],
  ['e-ready', 'E 是否就绪', 'e-ready'],
  ['e-cd', 'E 剩余冷却时间', 'e-cd'],
  ['low-hp', '当前场上角色是否低血量', 'low-hp'],
  ['onfield', '执行此动作的角色是否在场上', 'onfield'],
  ['min', '取最小值', 'min'],
  ['max', '取最大值', 'max'],
  ['combo-min-since', '多个动作中是否有至少一个动作的距上次执行时间小于', 'min(since(参数1),since(参数2),…) < 参数a'],
  ['combo-max-count', '多个动作中是否有至少一个动作执行超过指定次数', 'max(count(参数1,参数a,参数b),count(参数2,参数a,参数b),…) > 参数c'],
  ['combo-max-ecd', '多个角色的 E 剩余冷却时间中是否有至少一个角色的剩余冷却时间超过', 'max(e-cd(参数1),e-cd(参数2),…) > 参数a'],
];

// 能触发切人的指令（CombatCommand.Execute 中的判断）
const SWITCH_TRIGGERING = new Set(['attack', 'charge', 'e', 'q', 'walk', 'w', 'a', 's', 'd', 'dash', 'jump', 'check']);
const NO_SWITCH = new Set(['wait', 'mousedown', 'mouseup', 'click', 'moveby', 'keydown', 'keyup', 'keypress', 'scroll', 'ready']);

// 按别名（大小写敏感）或规范名查方法
const METHOD_BY_ALIAS = (() => {
  const map = new Map();
  for (const m of METHODS) for (const a of m.alias) if (!map.has(a)) map.set(a, m);
  return map;
})();
