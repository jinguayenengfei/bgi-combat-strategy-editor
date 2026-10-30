# BetterGI JSON 战斗策略 — 格式与条件函数规范

> **文档依据**：BetterGI `0.65.2` 版本源码通读整理，非官方文档，内容可能存在过时的情况。
> 关键实现位置：
> - 数据模型：`BetterGenshinImpact/GameTask/AutoFight/Script/JsonCombatStrategy.cs`
> - 解析与校验：`BetterGenshinImpact/GameTask/AutoFight/Script/JsonCombatStrategyParser.cs`
> - 运行时主循环：`BetterGenshinImpact/GameTask/AutoFight/AutoFightJsonTask.cs`
> - 条件求值器：`BetterGenshinImpact/GameTask/AutoFight/Script/ConditionEvaluator.cs`
> - 指令解析：`BetterGenshinImpact/GameTask/AutoFight/Script/CombatScriptParser.cs` / `CombatCommand.cs` / `Method.cs`
>
> 本文所有语义均来自上述代码，凡与代码注释冲突处（注释过期）均以**实际代码行为**为准，并在文中标注。

---

## 目录

1. [定位、加载链路与文件位置](#1-定位加载链路与文件位置)
2. [顶层 JSON 结构](#2-顶层-json-结构)
3. [`info` 节点](#3-info-节点)
4. [`actions` 节点](#4-actions-节点)
5. [运行模型（主循环时序）](#5-运行模型主循环时序)
6. [`action` 指令串语法](#6-action-指令串语法)
7. [条件表达式语法](#7-条件表达式语法)
8. [条件函数详解（14 个）](#8-条件函数详解14-个)
9. [优先级机制](#9-优先级机制)
10. [校验规则与错误处理](#10-校验规则与错误处理)
11. [陷阱清单（Checklist）](#11-陷阱清单checklist)
12. [附录：完整示例逐行解读](#12-附录完整示例逐行解读)

---

## 1. 定位、加载链路与文件位置

### 1.1 文件位置

| 项目 | 值 |
|---|---|
| 策略目录 | `<程序目录>\User\AutoFight\` |
| 文件名 | 任意，扩展名 `.json`（大小写不敏感） |
| 支持子目录 | 支持，UI 递归扫描全部子目录，策略名 = 相对路径去掉扩展名 |
| 编码 | 文本文件，UTF-8；由 `File.ReadAllText` 读取 |
| 示例 | 见第 12 章的示例策略 |

### 1.2 加载与路由链路

```
用户选择策略名
  └─ AutoFightParam.ResolveStrategyPath(name)      // 先探测 .json，未命中回退 .txt
       └─ CombatTaskFactoryProvider.GetFactory(path)  // 按扩展名/固定名选工厂
            ├─ ComboCombatTaskFactory  → "自动连招（实验）"（无文件）
            ├─ JsonCombatTaskFactory   → 路径以 .json 结尾  → AutoFightJsonTask
            └─ TxtCombatTaskFactory    → 兜底            → AutoFightTask
                 └─ new AutoFightJsonTask(param)
                      └─ JsonCombatStrategyParser.ParseFile(path)   // 解析 + 校验
                           └─ Start(ct)  // 进入战斗主循环
```

**要点**：`.json` 与 `.txt` 是两套完全独立的执行器。JSON 策略由 `AutoFightJsonTask` 执行；`.txt` 策略由 `AutoFightTask` + `CombatScriptBag` 执行。部分旧任务（如自动秘境在未接入时）会显式拒绝 JSON 文件并抛出"当前任务暂不支持使用json策略"。

### 1.3 复用了 JSON 策略的下游任务

自动秘境、自动首领讨伐、幽境危战、地脉花、地图追踪战斗节点、JS 脚本调度器均通过 `AutoFightJsonTask` 复用同一份 JSON 执行引擎（部分任务通过参数抑制其自带的结束检测与拾取逻辑）。

---

## 2. 顶层 JSON 结构

```jsonc
{
  "info": {
    "name": "策略名称",
    "author": "作者",
    "config": { },          // 已解析但运行时未使用
    "preActions": [ ]       // 战斗前动作
  },
  "actions": [ /* 动作节点数组 */ ]
}
```

### 2.1 大小写与容错

- **属性名大小写不敏感**（Newtonsoft.Json 默认行为）：`info` / `Info` / `INFO` 均可，示例文件使用 lowerCamelCase。
- **未知属性被静默忽略**（`MissingMemberHandling.Ignore` 为默认值）。因此示例中的 `"description"` 字段不会报错，但**也不会被读取**（模型中不存在该属性）。
- 不支持 JSON 注释（`//`、`/* */`）与尾随逗号。

### 2.2 字段默认值（省略字段时的行为）

| 字段 | 类型 | 默认值 |
|---|---|---|
| `info` | object | `new JsonInfo()`（**省略不报错**，显式写 `null` 才报错） |
| `info.name` | string | `""` |
| `info.author` | string | `""` |
| `info.config` | object | `null`（运行时从不读取） |
| `info.preActions` | string[] | `[]` |
| `actions` | array | `[]`（**空数组或省略 → 抛异常**） |
| `action.name` | string | `""` |
| `action.character` | string | `""`（= 通用，使用当前角色） |
| `action.action` | string | `""` |
| `action.condition.expression` | string | `""`（**空表达式恒为真**） |
| `action.index` | int | `0` |
| `action.ensureCast` | bool | `false` |
| `action.morePriorities` | array | `[]` |

---

## 3. `info` 节点

### 3.1 `name`（string）

策略名称。**仅用于日志输出**（`"JSON 战斗策略加载完成：{Name}，共 {Count} 个动作"`），不参与任何逻辑判定。与文件名无关。

### 3.2 `author`（string）

作者，纯元数据，运行时完全不使用。

### 3.3 `config`（object）

模型中声明为 `Dictionary<string, object>?`，**但源码中没有任何位置读取它**（已全库检索确认）。写什么都不会生效，当前属于预留字段。

### 3.4 `preActions`（string[]）★ 有实际作用

战斗开始前按顺序执行的动作列表，**只执行一次**，在执行主循环之前。

**字符串格式**：`"<角色名> <指令串>"`，或者不含角色名时仅写指令串（此时使用"初始当前角色"，即队伍第 1 名角色）。

```
"preActions": [
  "芙宁娜 e,wait(0.3)",
  "wait(0.2)"
]
```

**执行语义**（`AutoFightJsonTask.RunPreActions`）：

1. 截图一次并设为条件求值缓存；
2. 对每条 preAction：分割角色名与指令串 → `ParseLineCommands` → 包装成 `CombatScript` → 由 `CombatScriptExecutor.ExecuteAsync` 执行；
3. 每条 preAction 之间强制 `Delay(300ms)`；
4. 若执行中抛出 `RetryException`（复活/恢复信号），会中断整场战斗向上抛出。

**与 `actions[].action` 的三点差异（重要）**：

| 特性 | `preActions` | `actions[].action` |
|---|---|---|
| 解析入口 | `ParseLineCommands` | `ParseLinePart` |
| `\|` 分隔与 `round(...)` 回合分组 | **支持** | **不支持**（`\|` 会导致"未知方法"报错） |
| 角色名分隔 | 取**第一个空格**切分 | 角色名来自 `character` 字段，不解析 |

> ⚠️ `preActions` 的角色名按**第一个空格**切分，因此指令串内部**不能包含空格**。`"walk(s, 0.2)"` 会被错误切成角色 `walk(s,` + 指令 `0.2)`。请写成 `"枫原万叶 walk(s,0.2)"`。

---

## 4. `actions` 节点

`actions` 是动作节点数组，**至少 1 个元素**，否则解析失败。

### 4.1 字段全表

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 否 | 动作名称。用于日志、`since/count/last-exec` 按名称引用。**受严格命名规则约束**（见 4.2） |
| `character` | string | 否 | 执行该动作的角色名。为空 = 通用动作，使用"当前角色" |
| `action` | string | 否 | 指令串，见第 6 章 |
| `condition.expression` | string | 否 | 触发条件表达式，见第 7、8 章。空串 = 恒真 |
| `index` | int | 否 | 动作序号。**同时作为默认优先级**（越小越先检查）。允许重复 |
| `ensureCast` | bool | 否 | 执行后校验 E 技能是否真的进入冷却，否则重试 |
| `morePriorities` | array | 否 | 额外优先级条目，见第 9 章 |

### 4.2 `name` 的合法性规则（解析期强校验）

动作名必须能作为条件表达式中的**单个标识符**被词法解析。`JsonCombatStrategyParser.ValidateActions` 会调用 `ConditionEvaluator.IsValidActionName` 逐个校验，不合法直接抛异常终止加载。

**合法**：
- 中文名：`芙芙e`、`奶奶开盾`
- 含连字符的多段名：`芙芙-e-开场`（只要完整名称与声明一致，中间段不需单独声明）
- 含数字：`e2`、`爆发1段`
- 大小写混合：`BurstA`

**非法**（会抛 `InvalidOperationException`）：
- 布尔字面量：`true`、`false`（`bool.TryParse` 判定，大小写不敏感）
- 纯数字：`1`、`20`
- 与 14 个内置函数同名：`t`、`since`、`count`、`min`、`max`、`q-ready`、`e-ready`、`e-cd`、`low-hp`、`battle-time`、`in-party`、`onfield`、`last-exec`、`last-check`
- 含空白、逗号、括号、运算符等：`芙芙 e`、`a,b`、`a+b`、`(x)`

**`index` 允许重复**：不同动作可以用同一个 `index`，此时按 `index` 查询执行历史会取最近一次匹配记录。

### 4.3 `character` 的匹配规则

- 战斗开始时收集**当前队伍角色名**（`combatScenes.GetAvatars()`），然后过滤：
  ```csharp
  actions.Where(a => string.IsNullOrEmpty(a.Character) || teamNames.Contains(a.Character))
  ```
- 比较使用 `OrdinalIgnoreCase`。
- **不在队伍中的角色的动作会被整体丢弃**（不参与优先级排序，也不会执行）。
- ⚠️ 建议使用**标准游戏内角色名**（与 `Assets/combat_avatar.json` 中的 `name` 一致）。别名（alias）在 JSON 路径下**不会**被转换为标准名（`ParseLinePart` 不做别名映射；只有 `.txt` 的 `ParseLine` 会），因此用别名会因队伍过滤失败而静默失效。
- `""` 或省略 = 通用动作，使用"当前角色"；"当前角色"初始为队伍第 1 名角色，之后被**上一个执行过的动作的角色**更新。

---

## 5. 运行模型（主循环时序）

```
Start(ct)
 ├─ 读取分辨率校验、CombatScenes.GetCombatScenesWithRetry()
 ├─ 收集队伍角色名 → 过滤 actions
 ├─ 展开：每个动作 → 1 个主条目 + N 个 morePriorities 条目
 ├─ 按 priority 升序稳定排序（LINQ OrderBy，同优先级保持声明顺序）
 ├─ 若排序后条目数为 0 → 警告并直接返回（跳过战斗）
 ├─ 创建 ConditionEvaluator(策略所有非空 name)
 ├─ RunPreActions()                                    ← info.preActions
 └─ 启动后台"持续索敌循环"（可选）
     └─ while (!取消 && !超时):
          ├─ 截图一次 → evaluator.SetCachedCapture(capture)   ← 本轮所有条件共用
          ├─ prevAvatarName = 当前角色
          ├─ foreach 条目 in 已排序条目:
          │    ├─ 求值 condition（传动作真实 Index / Character / Name）
          │    ├─ 不满足 → continue
          │    ├─ [战斗结束检测：切人前]（默认时机，可配置为切人后）
          │    ├─ 若 action.character 非空 → SelectAvatar 并 Switch()，更新当前角色
          │    ├─ [战斗结束检测：切人后]（开启 CheckAfterSwitchAvatar 时）
          │    ├─ ExecuteAction(action)      ← 执行指令串
          │    ├─ ensureCast 校验 / 重试
          │    ├─ evaluator.UpdateLastExecTime(action.Index, action.Name)   ← 记录执行事件
          │    └─ break                      ← 只执行"第一个命中"的动作
          └─ 若无任何动作命中 → Delay(200ms)
```

### 5.1 关键行为

| 行为 | 说明 |
|---|---|
| **每轮只执行一个动作** | `foreach` 中命中并执行后立即 `break`，重新截图、重新求值。这是"优先级调度"而非"顺序全部执行" |
| **每轮一次截图** | `q-ready` / `low-hp` 等视觉条件在本轮内共享同一截图并缓存结果（含 `onfield()` 的出战角色刷新） |
| **无命中则空转 200ms** | 所有条件都不满足时等待 200ms 再循环 |
| **超时** | `AutoFightParam.Timeout`（默认 120 秒）后强制结束并标记超时 |
| **执行历史** | 每次动作执行成功记录 `(Index, Name, 距开战秒数)`，供 `since` / `count` / `last-exec` 查询 |
| **条件求值异常** | 任何异常（语法错误、未知函数、未声明的动作名）都被 `Evaluate` 捕获 → **返回 false**，只记一条 Warning，不会中断战斗 |
| **结束时的按键释放** | 动作执行 `finally` 中 `Simulation.ReleaseAllKey()` |

### 5.2 `ensureCast` 的真实行为

动作执行完成后：

1. 取该动作的实际角色（`character` 为空则用当前角色），`SelectAvatar`；
2. 截图并调用 `AutoFightSkill.AvatarSkillAsync(..., skills: false, ...)` 检测 E 技能图标是否进入冷却态；
3. 若未进入冷却：`ReleaseAllKey()` → 普通攻击 → 下落 → 等 200ms → **重新执行整个动作** → 重新截图检测；
4. 重复上限为 **5 次**（`var retry = 5;`）。

> ⚠️ `JsonCombatStrategy.cs` 的注释写"至多重试3次"，与代码实际的 5 次不一致，以代码为准。

**适用场景**：E 技能因被打断、切人过快、纳塔飞天/爬墙等原因未真正释放时自动补发。对 `action` 中直接包含 `keypress(e)` 的动作（如示例中的"莉奈娅大锤""木偶e"）通常保持 `false`。

---

## 6. `action` 指令串语法

### 6.1 格式规则

- 指令之间用**英文逗号 `,`** 分隔，空项被忽略；
- 括号内可以包含逗号，解析器会自动把被逗号切开的括号重新拼接（如 `walk(s, 0.2)`）；
- **不支持的写法**（JSON 动作串中）：
  - `|` 分隔符 → 会被当作方法名的一部分 → `战斗策略脚本中出现未知的方法`
  - `round(...)` 回合分组 → 能被解析成 `Round` 方法但 `ActivatingRound` 不会被赋值，**等效空操作**
  - `;` 分号分隔 → 不生效（只有 `.txt` 的 `ParseContext` 才切分 `;`）
  - `//`、`#` 注释 → 不生效
  - **中文括号 `（）` 和中文逗号 `，`** → 不会被规范化（规范化只在 `ParseContext` 中做），会报错。**必须使用半角 `(` `)` `,`**
- 括号必须成对，否则报错。

### 6.2 指令全表

> 单位：以下"秒"参数在代码中通过 `TimeSpan.FromSeconds` 换算为毫秒。
> 「别名」列中所有写法等价。

| 指令 | 别名 | 参数 | 行为 |
|---|---|---|---|
| `attack` | `普攻`、`普通攻击` | `[秒数]` | 循环发送普通攻击（左键），每次间隔 200ms。秒数换算 ms 后按 `while(ms>=0){攻击; ms-=200; 等待200ms}` 执行，即次数 = `floor(ms/200)+1`；省略参数 = 攻击 1 次。|
| `charge` | `重击` | `[秒数]` | 按住左键蓄力重击，默认 **1000ms**；部分角色有特化实现 |
| `skill` | `e` | `[hold]` `[wait]` `[fast]` | 元素战技。`hold`=长按；`wait`=先同步等待 E 冷却结束再释放；`fast`=若 E 未就绪则**直接跳过**（不发按键）。可组合，如 `e(hold)` 或 `skill(wait)` |
| `burst` | `q` | 无 | 元素爆发 |
| `wait` | `after`、`等待` | `秒数` | 纯等待。**设计上不被取消令牌打断**（为了宏操作的完整性） |
| `ready` | `完成` | 无 | 等待角色可操作状态：轮询侧边栏角色编号块出现，最多 20 次 × 150ms |
| `check` | `检测` | 无 | **空操作指令**。由 JSON 主循环识别到该指令时触发一次"战斗结束检测"（需开启战斗结束检测功能）。指令串中它之前的部分会先执行完 |
| `walk` | `行走` | `方向, 秒数` | 方向为 `w`/`a`/`s`/`d`，按住对应方向键指定时长 |
| `w` `a` `s` `d` | — | `秒数` | `walk` 的简写，如 `w(0.05)` |
| `dash` | `冲刺` | `[秒数]` | 冲刺，默认 200ms |
| `jump` | `j`、`跳跃` | 无 | 跳跃 |
| `mousedown` | — | `[left\|right\|middle]` | 按下鼠标键，默认 `left` |
| `mouseup` | — | `[left\|right\|middle]` | 抬起鼠标键，默认 `left` |
| `click` | — | `[left\|right\|middle]` | 单击鼠标键，默认 `left` |
| `moveby` | — | `x, y` | 相对移动摄像机（像素），负数为左/上 |
| `keydown` | — | `虚拟键名` | 按下按键，如 `keydown(E)`、`keydown(VK_LBUTTON)` |
| `keyup` | — | `虚拟键名` | 抬起按键。**当键为 E 时额外触发一次 E 技能 CD 的 OCR 检测** |
| `keypress` | — | `虚拟键名` | 单击按键。**当键为 E 时同样触发 CD 检测** |
| `scroll` | `verticalscroll` | `整数` | 鼠标滚轮格数（正/负方向由系统滚轮约定决定，`scroll(10)` / `scroll(-1)`） |
| `round` | — | — | 回合分组标记，**JSON 中无效** |
| `aim` / `r` / `瞄准` | — | — | **实际不可用**：`Method.Values` 中该项被注释掉，使用会抛"未知的方法" |

**参数校验**（构造 `CombatCommand` 时立即执行，不合法直接抛异常）：

- `walk` 必须有 2 个参数且行走时间 > 0；
- `w`/`a`/`s`/`d` 必须恰好 1 个参数；
- `moveby` 必须有 2 个参数；
- `keydown`/`keyup`/`keypress` 的参数必须能通过 `User32Helper.ToVk` 解析：该函数会**转大写并补 `VK_` 前缀**，所以 `e`、`E`、`VK_E` 等价，`space`、`SPACE`、`VK_SPACE` 等价；
- `scroll` 的参数必须是整数。

> ⚠️ **鼠标键的写法陷阱**：`keydown`/`keyup`/`keypress` 内部用一个**区分大小写的** `switch (key)` 判断鼠标键，只匹配字符串 `VK_LBUTTON` / `VK_RBUTTON` / `VK_MBUTTON` / `VK_XBUTTON1` / `VK_XBUTTON2`。写 `keydown(lbutton)` 虽然能通过参数校验，但不会走鼠标分支，会退化成"发送一个键盘按键"，通常无效。**要用鼠标键时请写全大写的 `VK_LBUTTON`**，或直接使用更清晰的 `mousedown` / `mouseup` / `click`。

### 6.3 角色绑定与自动切人

指令串以 `character` 字段的角色名解析（为空则用当前角色名）。执行时：

- 若该角色已在场上 → 直接执行；
- 否则 → `avatar.Switch()` 切人后执行；但 `wait`/`mousedown`/`mouseup`/`click`/`moveby`/`keydown`/`keyup`/`keypress`/`scroll`/`ready` 这些宏/等待类指令**不触发切人**。

一次动作内的多条指令是**同步顺序执行**的，中间不会被打断（除取消令牌）。

---

## 7. 条件表达式语法

### 7.1 词法

| 元素 | 规则 |
|---|---|
| 空白 | 任意，被忽略 |
| 数字 | `[0-9.]`，如 `1`、`1.5`、`.5` |
| 标识符 | 由 `char.IsLetter` / `char.IsLetterOrDigit` 组成的串（**支持中文**），如 `E-READY`、`芙芙e` |
| 布尔字面量 | **仅小写 `true` / `false`**（见 7.5 陷阱） |
| 运算符 | `&&` `\|\|` `!` `>` `<` `=` `+` `-` `*` `/` `(` `)` `,` |
| 其他字符 | 抛"无法识别的字符" |

**连字符合并规则**：标识符中出现 `-` 时，解析器先尝试向后取最长的「字母数字+连字符」候选串，若该串属于**已知标识符集合**（= 14 个内置函数名 ∪ 策略中声明的所有动作名），则整体作为**一个标识符**；否则 `-` 退化为减号。

- `e-ready`、`low-hp`、`last-exec`、`芙芙-e-开场` → 整体识别为一个标识符；
- `since-5` → `since`（函数）`-`（减号）`5`，即 `since() - 5`；
- `t-5` → `t() - 5`。

函数名与动作名的**已知集合匹配是大小写不敏感的**。

### 7.2 运算符与优先级

从低到高：

```
1. ||                     逻辑或（短路）
2. &&                     逻辑与（短路）
3. >  <  =                比较（数值）
4. +  -                   加减
5. *  /                   乘除
6. !  -（一元负号）        一元
7. ( )  函数调用  字面量    基本
```

- **没有** `==`、`!=`、`>=`、`<=`、`%`、`**`；
- `=` 是**相等比较**（不是赋值），采用浮点容差 `|a-b| < 0.0001`；
- 没有字符串字面量；
- 不支持一元 `+`（写 `+5` 会报"意外的 token"）；
- 除法：除数为 0 时结果为 `0`（不报错、不为 ∞）；
- 比较运算左结合，`a<b<c` 会被解析为 `(a<b)<c`，无实际意义，请用括号明确。

**等价写法参考**：

| 想表达 | 写法 |
|---|---|
| `a >= b` | `!(a<b)` 或 `a>b \|\| a=b` |
| `a <= b` | `!(a>b)` 或 `a<b \|\| a=b` |
| `a != b` | `!(a=b)` |

### 7.3 类型与隐式转换

求值中间结果为 `double` 或 `bool` 两种。转换规则：

- **→ bool**：`bool` 原样；`double` 视作 `d > 0`；其他为 `false`；
- **→ double**：`double` 原样；`bool` → `1` / `0`；其他为 `0`。

因此：

- 顶层表达式的最终结果会被转成 bool，**数值大于 0 即为真**。所以 `e-cd` 单独作为条件意味着"E 技能冷却 > 0 秒"，即 **E 未就绪**；想表达"就绪"请用 `e-ready` 或 `e-cd=0`；
- 布尔可以参与算术，如 `low-hp*2`（低血时为 2）。

### 7.4 目标动作引用（`since` / `count` / `last-exec` 的最后一个参数）

三种写法：

| 写法 | 含义 |
|---|---|
| 省略 | **严格指代当前动作**：`Index` 与 `Name` 必须同时匹配 |
| 数字（或数值表达式） | 按 `index` 匹配，如 `since(41)` |
| 裸标识符 | 按**动作名**匹配，如 `since(芙芙e)`。必须是策略中已声明的 `name`，否则抛"未知动作名称"→ 条件恒为 false |

> ⚠️ 动作名**不是布尔变量**。写 `芙芙e` 单独作条件会被当成零参数函数调用 → "未知条件函数" → 恒 false。必须通过 `since`/`count`/`last-exec`/`q-ready` 等函数引用。

### 7.5 条件求值的失败模式

`Evaluate` 捕获所有异常并返回 **false**（不是 true，也不是中断战斗）。会走这条路的典型情况：

- 语法错误（括号不配对、非法字符、一元 `+`）；
- 未知函数名（拼错 `q-redy`）；
- 动作名未声明（`since(不存在的名字)`）；
- 大写布尔字面量 `True` / `False`（会被当成零参数函数 → 恒 false，**静默失效**）。

因此**条件写错不会报错，只会让动作永不触发**。排查时请关注日志中的 `条件表达式求值失败：{Expr}，{Msg}` 警告。

---

## 8. 条件函数详解（14 个）

### 8.0 速查表

| 函数 | 返回 | 参数 | 一句话 |
|---|---|---|---|
| `t()` | 数值(秒) | 无 | 距开战时间 |
| `battle-time(秒[,bool])` | 布尔 | 阈值,[是否大于] | 开战时间比较（等同 `t()>秒`） |
| `since([目标])` | 数值(秒) | 目标动作 | 距目标上次执行的时间 |
| `count([目标][,start][,end])` | 数值(次) | 目标,时间区间 | 目标在区间内执行次数 |
| `last-exec(秒[,bool][,目标])` | 布尔 | 阈值,[是否大于],目标 | `since` 的布尔版 |
| `last-check()` | 数值(秒) | 无 | 距上次战斗结束检查的时间 |
| `q-ready([角色])` | 布尔 | 角色名 | Q 是否就绪（OCR） |
| `e-ready([角色])` | 布尔 | 角色名 | E 是否就绪（CD 记录） |
| `e-cd([角色])` | 数值(秒) | 角色名 | E 剩余冷却 |
| `low-hp()` | 布尔 | 无 | 当前角色是否低血（OCR） |
| `onfield()` | 布尔 | 无 | 动作归属角色是否在场上 |
| `in-party(角色)` | 布尔 | 角色名 | 角色是否在队伍中 |
| `min(表达式...)` | 数值 | 多项 | 最小值 |
| `max(表达式...)` | 数值 | 多项 | 最大值 |

---

### 8.1 `t()` — 开战计时器

- **签名**：`t()`（可省略括号写作 `t`）
- **返回**：`double`，距**本次战斗开始**的秒数。计时基准是 `ConditionEvaluator` 构造时的时间（即 `Start` 进入主循环前），不是"进入副本"的时间。
- **注意**：作为独立条件时按 `> 0` 判真，恒真，所以几乎总是配合比较使用。
- **示例**：`t>1.5`、`t<30 && q-ready`、`min(t, 10)`

### 8.2 `battle-time(秒[, 是否大于])` — 开战时间比较

- **签名**：`battle-time(阈值秒)` / `battle-time(阈值秒, true|false)`
- **返回**：`bool`。第二个参数省略时默认 `true`（比较"大于"）。
- **语义**：`battle-time(X)` ⇔ `t() > X`；`battle-time(X, false)` ⇔ `t() < X`。
- **⚠️ 代码注释写"单位为毫秒"，但实现使用 `TotalSeconds`，实际单位是秒。**
- **与 `t()` 的关系**：功能完全等价，属于旧函数保留。新策略建议统一用 `t()`。
- **示例**：`battle-time(5)`（开战 5 秒后）、`battle-time(2, false)`（前 2 秒内）

### 8.3 `since([目标])` — 距目标上次执行的时间 ★ 最常用

- **签名**：`since()` / `since(序号)` / `since(动作名)`
- **返回**：`double`，秒。
- **语义**：反向扫描执行历史，找**最新一条**匹配目标的事件，返回 `当前时间 - 该事件时间`。
- **边界**：**从未执行过 → 返回 `double.PositiveInfinity`（+∞）**。这是最重要的边界行为 —— 因为 `+∞ > 任意数` 为真，所以 `since>28` 这类条件在**战斗刚开始、该动作还没执行过时就是真的**，这通常正是作者想要的"开场立刻放一次"。
- **缺省目标**：严格指代当前动作（`index` 与 `name` 同时匹配）。因此 `since>8` 的含义是"我这个动作距上次执行超过 8 秒"，是**自引用限流**的标准写法。
- **示例**：
  - `since>28 && e-ready` — 本动作超过 28 秒没放且 E 就绪
  - `since(41)<3` — 41 号动作在 3 秒内执行过
  - `since(38)>since(44)` — 38 号动作比 44 号动作更久没执行（即 44 更"新鲜"时为真）
  - `since(芙芙q)` — 按名称引用

### 8.4 `count([目标][, start][, end])` — 区间执行次数

- **签名**：`count()` / `count(目标)` / `count(目标, start)` / `count(目标, start, end)`
- **返回**：`double`，次数（整数语义）。
- **默认值**：`start` 默认 `0`（战斗开始），`end` 默认当前 `t()`。
- **缺省目标**：严格指代当前动作。
- **语义**：统计执行时间落在 `[start, end]` 闭区间内的目标事件条数。
- **典型用法**：`count=0` —— "本动作从未执行过"（战斗开始时为真）。也常用于限制某个爆发在一场战斗中只放 N 次。
- **示例**：
  - `count=0 || since(38)>since(44)` — 从未执行，或比 44 号更新鲜
  - `count<2` — 最多执行 2 次
  - `count(41)>0` — 41 号动作至少执行过 1 次
- **注意**：`count` 返回数值，`count=0` 使用浮点容差比较；不要写成 `count==0`（`==` 不存在）。

### 8.5 `last-exec(秒[, 是否大于][, 目标])` — `since` 的布尔封装

- **签名**：`last-exec(阈值秒)` / `last-exec(阈值秒, true|false)` / `last-exec(阈值秒, true|false, 目标)`
- **返回**：`bool`。
- **默认值**：第二个参数默认 `true`（大于）；第三个参数缺省时严格指代当前动作。
- **语义**：`last-exec(X)` ⇔ `since() > X`；`last-exec(X, false)` ⇔ `since() < X`。
- **⚠️ 关键边界**：**从未执行时直接返回第二个参数的值**（默认 `true`）。所以 `last-exec(5)` 在开场为真，`last-exec(5,false)` 在开场为假。
- **⚠️ 参数 2 必须是字面量 `true`/`false`**：代码用 `args[1] is BoolNode` 判断。若传其他表达式（如大写 `True`、或 `1`），判断失败并**静默回退为默认值 `true`**。
- **示例**：`last-exec(3)`、`last-exec(2,true,3)`（3 号动作距上次执行超过 2 秒）、`last-exec(2,true,香菱)`
- **建议**：语义更清晰的 `since` 更适合手写策略；`last-exec` 主要用于兼容旧写法。

### 8.6 `last-check()` — 距上次战斗结束检查的时间

- **签名**：`last-check()`
- **返回**：`double`，秒。
- **数据来源**：`AutoFightTask.LastFightFinishCheckTime`，由**战斗结束检测**（`CheckFightFinish`）以及策略中的 `check` 指令更新；战斗开始时在 `AutoFightJsonTask` 中被重置为当前时间。
- **用途**：编排"战斗结束检查"的节奏。例如让检查动作与 `check` 指令解耦，用条件控制检查间隔。
- **典型写法**：`last-check() > 3` —— 距上次检查超过 3 秒。
- **注意**：未开启战斗结束检测时该时间戳基本不更新，可用 `last-check > t - [时间]` 来检查这种不更新的情况。但由于时间戳初始化的时间与自动战斗任务开始的时间不一定一致，`last-check = t` 在这种情况下不一定成立。

### 8.7 `q-ready([角色名])` — 元素爆发是否就绪（OCR）

- **签名**：`q-ready()` / `q-ready(角色名)`
- **返回**：`bool`。
- **目标解析**：
  - 传裸标识符角色名（如 `q-ready(芙宁娜)`）→ 检查该角色；
  - 不传参 / 传空括号 → 检查**当前动作的 `character`**；
  - 若当前动作 `character` 为空 → `targetName` 为 `null` → **退化为"队伍中任意一名角色的 Q 就绪即返回 true"**（这是隐式行为，务必注意）。
- **实现**：使用本轮缓存截图做**两路检测后取 OR**：
  1. 侧边栏 4 名角色的 Q 图标（主要覆盖后台角色）；
  2. 场上角色的**中央** Q 图标区域。
  检测结果按角色编号缓存（`HashSet<int>`），**每轮主循环只做一次**，本循环内所有 `q-ready` 复用。
- **异常**：检测内部抛异常时记 Warning 并返回 `false`。
- **示例**：`q-ready`、`q-ready()`、`q-ready && since>18`、`q-ready(芙宁娜)`
- **陷阱**：OCR 依赖截图清晰度与 1920×1080 基准的图标区域；分辨率异常会整体失效。

### 8.8 `e-ready([角色名])` — 元素战技是否就绪

- **签名**：`e-ready()` / `e-ready(角色名)`
- **返回**：`bool`。
- **数据来源**：`ESkillCdTracker` —— 一个**跨战斗、跨地图追踪节点持久化**的静态 E 技能冷却表。不是实时 OCR，而是"记录制的推算"：
  - 释放 E 时（`skill`/`e` 指令、或 `keyup(e)`/`keypress(e)`）通过 OCR 读取冷取秒数并写入 `就绪时刻 = now + cd`；
  - 少数角色有兜底表（`莉奈娅` = 读不到就按完整 CD；`玛薇卡`、`法尔伽` = 取 `min(剩余, 完整CD)`），兜底 CD 来自 `Assets/combat_avatar.json` 的 `skillCd` / `skillHoldCd`；
  - 查询时 `剩余 = 就绪时刻 - now`，`剩余 <= 0` 即就绪。
- **目标解析**：同 `q-ready`，但**当前动作为通用动作（`character` 为空）时直接返回 `false`**（不是"任意角色"）。
- **注意**：因为是记录制，**从未释放过的角色视为就绪**；如果 E 实际未放出且未被兜底覆盖，会出现"一直就绪"的误判。这正是 `ensureCast` 存在的原因。
- **示例**：`e-ready`、`e-ready && since>15`、`e-ready(尼可)`

### 8.9 `e-cd([角色名])` — E 技能剩余冷却秒数

- **签名**：`e-cd()` / `e-cd(角色名)`
- **返回**：`double`，秒；`0` 表示就绪或无需冷却。
- **目标解析**：与 `e-ready` 相同；角色为空时返回 `0`。
- **典型用法**：`e-cd<2` —— 快好了，可以衔接；`e-cd>0` —— 冷却中。
- **注意**：把 `e-cd` 单独当条件使用等于 `e-cd>0`（未就绪），容易写反，建议显式比较。

### 8.10 `low-hp()` — 当前角色是否低血量 ★ 危险时刻判据

- **签名**：`low-hp()`（可写作 `low-hp`）
- **返回**：`bool`。
- **语义**：对**当前出战角色**做血量识别（`Bv.CurrentAvatarIsLowHp`），使用**本轮缓存截图**，每轮只检测一次并缓存。
- **用途**：低血量时优先开治疗/护盾/爆发，是策略"保命逻辑"的核心。示例中 `草神q` 的 `morePriorities` 把 `low-hp` 提到 `priority: 0`（最高优先级），`莉奈娅q` 用 `low-hp&&q-ready` 提到 20。
- **异常**：识别异常时记 Warning 并返回 `false`。
- **注意**：它只判断"当前场上角色"，不判断后台角色。

### 8.11 `onfield()` — 动作归属角色是否在场上

- **签名**：`onfield()`
- **返回**：`bool`。
- **语义**：比较"当前动作的 `character` 对应的队伍编号"与"当前出战角色编号"是否一致。
- **边界**：
  - 动作 `character` 为空 → **返回 `false`**（无归属角色）；
  - 角色不在队伍中 → `false`；
  - 首次求值时若出战角色编号尚未初始化（`<= 0`），会用缓存截图尝试刷新一次；仍失败则返回 `false`（避免开战第一轮误判）。
- **用途**：需要"必须已经站在场上"才执行的动作，避免多余切人；配合 `ensureCast` 可确保连段不被打断。
- **示例**：`onfield() && e-ready`

### 8.12 `in-party(角色名)` — 角色是否在队伍中

- **签名**：`in-party(角色名)`
- **返回**：`bool`。
- **语义**：`_combatScenes.SelectAvatar(角色名) != null`。
- **⚠️ 参数必须是裸标识符**：代码要求 `args[0]` 是零参数函数调用节点。传数字、表达式或其他形式一律返回 `false`。
- **注意**：`character` 字段本身已经过队伍过滤，所以对**自己**用 `in-party` 意义不大；主要用途是**跨角色判断**——例如"如果队里有芙宁娜，才让万叶走某条分支"。
- **示例**：`in-party(芙宁娜) && q-ready`

### 8.13 `min(...)` / `max(...)` — 多值取最小 / 最大

- **签名**：`min(表达式, 表达式, ...)` / `max(...)`
- **返回**：`double`。
- **语义**：各项求值后转数值，取最小/最大。无参数时返回 `0`。
- **用途**：合并多个"距上次执行时间"做统一限流，或对时间做夹取。
- **示例**：
  - `min(since(), 5)` — 把自引用间隔夹到最多 5 秒（用于"至少等 5 秒"的语义反转）
  - `max(since(1), since(2))` — 两个动作中"更久没执行"的那个的间隔
  - `min(t, 10) > 3`
- **注意**：`min()/max()` 返回数值，**作为顶层条件时 `>0` 才为真**，通常应包在比较里。

---

## 9. 优先级机制

### 9.1 条目展开

每个 `action` 会被展开成 **1 + N 个"优先级条目"**：

```jsonc
{
  "name": "爱可菲q",
  "character": "爱可菲",
  "action": "q,wait(0.1),ready",
  "index": 20,                                  // → 主条目 priority = 20
  "condition": { "expression": "(low-hp || since(41)<3) && q-ready" },
  "morePriorities": [
    { "expression": "q-ready", "priority": 43 } // → 额外条目 priority = 43
  ]
}
```

展开结果：

| 条目来源 | 条件表达式 | priority |
|---|---|---|
| 主条目（`condition`） | `(low-hp \|\| since(41)<3) && q-ready` | `index` = 20 |
| `morePriorities[0]` | `q-ready` | 43 |

**核心要点：每个条目只携带一个条件表达式。** 主条目携带 `condition.expression`，每个 `morePriorities` 条目携带自己那一项的 `expression`；展开后的条目彼此**平级、独立**，不存在包含或门禁关系。

### 9.2 三个常见疑问

#### 9.2.1 命中 `morePriorities` 条目时，还会再检查 `condition.expression` 吗？

**不会。** 展开后每条条目只绑定一个表达式（源码中 `PrioritizedAction` 的 `Expression` 是单值字段）：

```csharp
validActions.Add(new PrioritizedAction
{
    Action = action,
    Expression = action.Condition.Expression,   // 主条目：带的是 condition.expression
    Priority = action.Index
});

foreach (var morePriority in action.MorePriorities)
{
    validActions.Add(new PrioritizedAction
    {
        Action = action,
        Expression = morePriority.Expression,   // 额外条目：带的是自己那一项
        Priority = morePriority.Priority
    });
}
```

主循环求值时用的就是该条目自己的 `Expression`：

```csharp
var conditionMet = evaluator.Evaluate(
    prioritizedAction.Expression, action.Index, action.Character, action.Name);
if (!conditionMet) continue;
// ……命中后：战斗结束检查 → 切人 → 执行动作
break;
```

所以结论是：**`morePriorities` 的条件成立、且该条目被轮到，就直接执行这个动作，不会再去看 `condition.expression`。**
`condition.expression` 只属于主条目那一条，它成立与否只决定主条目自己是否命中。

#### 9.2.2 支持多个 `morePriorities` 条目吗？

**支持，数量不限。** 它是数组（`List<JsonMorePriority>`），0 个也合法——写 `"morePriorities": []` 与省略该字段完全等价。

**语法**：数组元素固定为 `expression` + `priority` 两个字段。

```jsonc
{
  "name": "爱可菲q",
  "character": "爱可菲",
  "action": "q,wait(0.1),ready",
  "index": 20,
  "condition": { "expression": "(low-hp || since(41)<3) && q-ready" },
  "morePriorities": [
    { "expression": "low-hp",         "priority": 0  },   // 低血：抢到最前
    { "expression": "t<10 && q-ready","priority": 5  },   // 开场 10 秒内：提前
    { "expression": "q-ready",        "priority": 43 }    // 平时：靠后兜底
  ]
}
```

展开后共 **4 条**候选，全部指向同一个动作：

| 条目 | 条件 | priority |
|---|---|---|
| 主条目 | `(low-hp \|\| since(41)<3) && q-ready` | 20 |
| `morePriorities[0]` | `low-hp` | 0 |
| `morePriorities[1]` | `t<10 && q-ready` | 5 |
| `morePriorities[2]` | `q-ready` | 43 |

**执行时的表现**：

1. **共用同一个动作体**——所有条目共享同一个 `JsonAction`，即完全相同的 `name` / `character` / `action` / `ensureCast`。命中任一条目，执行的都是这段一模一样的指令串，不存在"每个条目执行一部分"的说法。
2. **一轮循环只执行一次**——主循环每轮按 priority 顺序找到**第一个命中**的条目就执行并 `break`。即使同一动作的多条条目同时成立，本轮也只执行 1 次；下一轮重新从最小 priority 开始扫描。
3. **共享同一份执行历史**——每次执行只记一条事件 `UpdateLastExecTime(action.Index, action.Name)`。因此不带参数的 `since` / `count` / `last-exec` 在这些条目里含义一致（都指"这个动作上次执行"），不会因为走了哪条条目而不同。
4. **`priority` 数值无约束**——允许重复（并列时按声明顺序取先者）；允许负数（比 0 更靠前）；与 `index` 是两套互不影响的数值。
5. **队伍过滤是动作级的**——`character` 不在当前队伍时，整个动作连同它的**全部** `morePriorities` 条目一起被丢弃，不存在"只保留额外条目"的情况。
6. **日志可核对**——开战时会输出一条 `JSON 策略：共 {Total} 个动作，展开为 {Expanded} 个优先级条目`。其中 `Expanded` 是**队伍过滤之后**保留下来的动作的 `Σ(1 + morePriorities 数量)`；而 `Total` 用的是未过滤的动作总数，所以队伍里缺人时这两个数字不能直接对应。

#### 9.2.3 命中 `morePriorities` 时，`condition.expression` 还参与优先级排序吗？

**不参与。** 排序是**静态的、在战斗开始前一次性完成**的，只看数值 `priority`：

```csharp
validActions = validActions.OrderBy(p => p.Priority).ToList();
```

具体来说：

- 排序阶段**不对任何条件求值**，所以 `condition.expression` 的内容不可能影响任何条目的排序位置；
- 条件求值发生在排序**之后**的主循环里，是逐条惰性判断；
- `condition.expression` 也不是 `morePriorities` 条目的门禁（见 9.2.1）；
- 唯一与主条件有关的排序事实是：**主条目永远存在**，它按 `index` 固定占据一个位置。若不想让动作在 `index` 这个位置被触发，把 `condition.expression` 写成恒假的 `false` 即可——主条目仍然占位、每轮仍会被判一次（开销可忽略），但永不命中，而 `morePriorities` 各条目**完全不受影响**。

> 一句话总结三者的分工：
> `index` 决定"主条目排在哪"，`morePriorities[].priority` 决定"额外条目排在哪"，`condition.expression` 只决定"主条目是否触发"。三者互不干涉。

### 9.3 调度语义

主循环每轮从 priority 最小开始依次求值条件，**第一个为真的条目被执行，然后 break**。因此：

- `priority` 越小 → 越优先被考虑（**更"紧急"**）；
- `morePriorities` 的用途是：**同一个动作，在不同情境下占据不同的优先级位置**。例如"芙芙e"平时在 21 位，当间隔超过 20 秒时提前到 30 位；"爱可菲q"平时在 20 位，纯 `q-ready` 时降到 43 位让位给其他动作。
- 同一动作被多个条目命中时，只有一个会执行（执行后 break）。

### 9.4 排序细节与并列优先级

所有条目（来自所有动作）统一按 `priority` **升序稳定排序**（LINQ `OrderBy` 是稳定排序）。并列时保持**声明顺序**：

1. 先比 `actions` 数组中的先后；
2. 同一动作内部，主条目排在 `morePriorities` 各条目之前，`morePriorities` 之间按数组顺序。

因此在优先级并列时，"谁先被检查"是可预测的：**先声明者先检查**。若两条并列条目同时成立，执行的是声明靠前的那一条。

### 9.5 排序与自引用的关系（重要）

求值时传给 `Evaluate` 的是**动作真实的 `index`**，而不是排序用的 `priority`：

```csharp
evaluator.Evaluate(prioritizedAction.Expression, action.Index, action.Character, action.Name);
```

因此 `morePriorities` 中的 `since` / `count` 缺省引用仍然正确指向该动作本身，不受 `priority` 数值影响。

### 9.6 编号约定建议（经验）

这里提到的编号分配经验，**仅适合包含角色数量在个位数的小型战斗策略**。一旦**动作数量超过30+**，使用该编号方式会导致**整个战斗策略不可避免的陷入复杂性爆炸的问题！**

| 区间 | 建议用途 |
|---|---|
| `0 ~ 9` | 紧急：低血保命、开盾、检查战斗结束 |
| `10 ~ 19` | 起手 / 常规 E 技能 |
| `20 ~ 39` | 主要输出循环（E、重击、技能连段） |
| `40 ~ 59` | 爆发（Q）、次要补位 |
| `900+` | 兜底动作（如无条件 `wait` 的"空转"动作） |

示例文件即采用此风格（`1` 检查、`10~13` 开盾、`20~27` 循环、`38~51` 输出与爆发、`999` 兜底等待）。

---

## 10. 校验规则与错误处理

### 10.1 加载期（会直接终止，抛出异常）

| 检查 | 异常信息 |
|---|---|
| 文件不存在 | `JSON 战斗策略文件不存在`（`FileNotFoundException`） |
| JSON 语法错误 | `JSON 战斗策略格式错误：{Msg}` |
| 反序列化结果为 null | `JSON 战斗策略反序列化失败` |
| `info` 显式为 `null` | `JSON 战斗策略缺少 Info 节点` |
| `actions` 缺失 / 为 null / 空数组 | `JSON 战斗策略中未定义任何动作` |
| 动作名不合法（见 4.2） | `JSON 战斗策略中动作名称无法作为条件标识符解析：{Name}` |

### 10.2 运行期（不终止战斗）

| 情况 | 行为 |
|---|---|
| 条件表达式语法错误 / 未知函数 / 未声明动作名 | 记 Warning `条件表达式求值失败：{Expr}，{Msg}`，该条目判定为 **false** |
| 动作执行抛异常（非 `RetryException`） | 记 Error `自动战斗：{Name} 执行失败：{Msg}`，继续下一轮 |
| 动作执行抛 `RetryException` | **向上抛出**，交回路径执行器重跑当前路径段（复活/恢复） |
| 队伍中无该角色 | 动作在开战前被过滤掉，不执行 |
| 展开后条目数为 0 | 记 Warning，直接跳过战斗 |

### 10.3 日志节奏

- 动作执行日志有**防刷**：同一动作名 1 秒内最多输出 1 条 `自动战斗：{Name}`；
- E 技能冷却记录成功会输出 `{角色} 元素战技，cd:{秒} 秒`，兜底会标注"（兜底设置）"，读取失败会输出 `{角色} 战技cd未更新`。

---

## 11. 陷阱清单（Checklist）

写策略前建议逐条确认：

1. **`info` 可以省略，`actions` 不能为空。**
2. **`actions` 里的动作串不能用中文括号 `（）` 与中文逗号 `，`**，必须半角。
3. **动作串里不能用 `|`、`;`、`//` 注释**（只有 `.txt` 策略和 `preActions` 的部分语法支持）。
4. **`round(...)` 在 JSON 中无效**，不是回合分隔符。
5. **布尔字面量必须小写 `true`/`false`**，`True` 会静默变成 false。
6. **没有 `==`、`!=`、`>=`、`<=`**，用 `=`、`!(a=b)`、`!(a<b)` 替代。
7. **条件写错不报错**，只让动作永不触发；注意日志 Warning。
8. **`since` 从未执行返回 +∞**，所以 `since>X` 开场即为真；这也是"开场必放一次"的实现方式。
9. **`last-exec` 从未执行时返回第二个参数（默认 true）**。
10. **通用动作（`character` 为空）下 `q-ready` 会退化为"任意角色 Q 就绪"**，而 `e-ready` 恒为 `false`。
11. **动作名不能与 14 个内置函数同名，不能是 `true`/`false`/纯数字**，否则加载直接失败。
12. **引用动作名必须用策略中已声明的 `name`**，拼错会让条件恒 false。
13. **`character` 必须用标准角色名**（别名不会转换），否则动作被静默过滤。
14. **`preActions` 的角色名按第一个空格切分**，指令串内不要写空格。
15. **`ensureCast` 实际重试 5 次**（注释写的 3 次已过期），且会**重新执行整个动作**，对含长连段的动作可能造成明显的重复释放，慎用。
16. **`e-ready` 是 OCR 记录推算，不是实时状态**；E 没真正放出时可能出现误判。
17. **`info.config` 当前完全不生效**（保留字段）。
18. **`index` 决定默认优先级**，不是执行顺序；每轮只执行一个动作。
19. **`morePriorities[].priority` 与 `index` 是两套数值**，缺省引用（`since` 不带参）始终指向动作真实 `index`。
20. **动作 `character` 为空时，`while` 起点是队伍第 1 名角色**，并随后续执行动态变化。
21. **鼠标键在 `keydown`/`keyup`/`keypress` 中必须写全大写 `VK_LBUTTON`**（内部 `switch` 区分大小写），否则静默退化；建议改用 `mousedown`/`mouseup`/`click`。
22. **`attack(秒)` 是"按 200ms 一拍连打"，不是"打一击然后等这么久"**；`attack(1.2)` 约为 7 次普攻。

---

## 12. 附录：完整示例逐行解读

以下逐行解读一份可用的老版本的锄地策略（惨遭过度修复的）。为便于对照，各小节按需截取该策略的片段。

### 12.1 元信息

```json
"info": {
  "name": "公式化锄地",
  "author": "mno",
  "description": "配队公式：芙+盾位（茜/机/尼/莱）+其他（火/万/莉/爱/少/偶）用于普通精英/小怪锄地",
  "config": {},
  "preActions": []
}
```

- `name`、`author`：仅日志/元数据；
- `description`：**模型无此字段，被静默忽略**；
- `config`：空对象，运行时不读取；
- `preActions`：空，不执行战斗前动作。

### 12.2 结束检查动作（priority 1，最高）

```json
{
  "name": "检查战斗结束",
  "character": "",
  "action": "check,w(0.05),click(middle),scroll(10)",
  "condition": { "expression": "t>1.5 && since>0.7" },
  "index": 1
}
```

逐项：

- `character: ""` → 通用动作，使用当前角色；
- `action`：先执行 `check`（**空操作，但触发一次战斗结束检测**）→ 前进 0.05 秒 → 中键单击（重置镜头/索敌）→ 滚轮上滚 10 格（拉近/调整视角）；
- `condition`：`t>1.5`（开战 1.5 秒后）**且** `since>0.7`（**本动作**距上次执行超过 0.7 秒；开场为 +∞ 所以立即成立）；
- `index: 1` → 优先级最高，每轮循环第一个被检查。效果：开战 1.5 秒后先做一次结束检查，之后每 0.7 秒复查一次。

### 12.3 开盾组（priority 10~13）

```json
{ "name": "奶奶开盾", "character": "茜特菈莉", "action": "attack,e",       "condition": "e-ready", "index": 10, "ensureCast": true  }
{ "name": "伊涅芙开盾","character": "伊涅芙",   "action": "e",              "condition": "e-ready", "index": 11, "ensureCast": true  }
{ "name": "尼可开盾", "character": "尼可",     "action": "e",              "condition": "e-ready", "index": 12, "ensureCast": false }
{ "name": "莱依拉开盾","character": "莱依拉",   "action": "e",              "condition": "e-ready", "index": 13, "ensureCast": false }
```

- 条件均为 `e-ready`，即"该动作所属角色的 E 就绪"；因为每轮只执行一个，优先级 10→13 决定了**开盾顺序**（茜特菈莉 → 伊涅芙 → 尼可 → 莱依拉）；
- 同一动作的 `e-ready` 由于 `character` 已指定，只会检测对应角色；
- `attack,e` 表示先普攻一击再放 E（`attack` 无参数 = 1 次普攻），常用于取消前摇；
- 前两个开启 `ensureCast: true`，确保 E 真的进冷却；后两个不开启以节省时间。
- 不在队伍中的角色，对应动作会被整体过滤（例如队伍里没有尼可，则 12 号动作直接消失，不影响其它动作）。

### 12.4 带多优先级的爆发

```json
{
  "name": "爱可菲q",
  "character": "爱可菲",
  "action": "q,wait(0.1),ready",
  "condition": { "expression": "(low-hp || since(41)<3) && q-ready" },
  "index": 20,
  "morePriorities": [ { "expression": "q-ready", "priority": 43 } ]
}
```

- **主条目（priority 20）**：当"低血"或"41 号动作（芙芙q）在 3 秒内执行过"**且** Q 就绪时，插队到 20 位释放 → 这是**连携**逻辑（芙宁娜 Q 之后接爱可菲 Q）；
- **额外条目（priority 43）**：只要 `q-ready` 就放在 43 位 → 兜底的常规释放；
- `action`：放 Q → 等 0.1 秒 → `ready` 等待角色恢复可操作（避免后摇期间被切人被吞）。

### 12.5 自引用限流 + 双触发点

```json
{
  "name": "芙芙e",
  "character": "芙宁娜",
  "action": "e,wait(0.3)",
  "condition": { "expression": "since>28 && e-ready" },
  "index": 21,
  "morePriorities": [ { "expression": "since>20 && e-ready", "priority": 30 } ]
}
```

- `since>28`：**本动作**距上次执行超过 28 秒（开场 +∞ 立即成立）；
- `since>20`：20 秒版本，priority 30（较靠后）；
- 两段合计形成"至少 20 秒冷却、优先按 28 秒节奏"的弹性调度。

### 12.6 低血最高优先级

```json
{
  "name": "草神q",
  "character": "纳西妲",
  "action": "q,wait(0.1),ready",
  "condition": { "expression": "q-ready" },
  "index": 40,
  "morePriorities": [ { "expression": "low-hp", "priority": 0 } ]
}
```

- 常规情况：priority 40；
- **低血量时：priority 0（全局最高）**，且条件只需 `low-hp`（不要求 Q 就绪 —— 这是一个可议点：`low-hp` 为真时会尝试放 Q，即使 Q 未就绪，此时 `q` 指令可能空放或被打断；更严谨可写 `low-hp && q-ready`）。

### 12.7 计数限流与相互比较

```json
{
  "name": "木偶喷冰4秒",
  "character": "桑多涅",
  "action": "charge(4.15)",
  "condition": { "expression": "count=0 || since(38)>since(44)" },
  "index": 38
}
```

- `count=0`：本动作（38 号）从未执行过 → 开场立即执行一次；
- `since(38)>since(44)`：38 号距上次执行的时间 **大于** 44 号（木偶e）的距离 → 即"木偶e 更新鲜"时，允许喷冰。两者配合实现"先 E 后蓄力喷冰"的循环；
- `charge(4.15)`：按住左键 4.15 秒的重击。

```json
{
  "name": "万叶中e",
  "character": "枫原万叶",
  "action": "attack,keydown(E),wait(0.48),keyup(E),attack(0.3),wait(0.2)",
  "condition": { "expression": "since>8 || since>since(45)" },
  "index": 43
}
```

- `since>8`：自引用 8 秒节奏；
- `since>since(45)`：**本动作**距上次执行的时间 > **45 号动作（万叶q）**距上次执行的时间 → "万叶q 比万叶中e 更新鲜"时补一个中 E；
- `action` 展示了长按技巧：`keydown(E)` → 等 0.48 秒 → `keyup(E)`。注意 `keyup(E)` 会**额外触发一次 E 技能 CD 的 OCR 检测**，从而让后续 `e-ready` 判定准确。

### 12.8 禁用动作与兜底动作

```json
{
  "name": "满芙普攻",
  "character": "芙宁娜",
  "action": "keydown(w),wait(0.05),keyup(w),wait(0.05),click,...,keyup(s)",
  "condition": { "expression": "false" },
  "index": 27
}
```

- `"expression": "false"` → **恒假**，动作被永久禁用但保留在文件中（便于随时改回 `true` 或替换条件启用）。这是推荐的"停用而非删除"写法。

```json
{
  "name": "等待",
  "character": "",
  "action": "wait(0.2)",
  "condition": { "expression": "" },
  "index": 999
}
```

- **空表达式恒为真**（`Evaluate` 对空白表达式直接返回 true）；
- priority 999 最低 → 只有当前面所有动作都不满足时才执行；
- 效果：兜底空转 0.2 秒。

> 说明：主循环在"无任何动作命中"时本身也会 `Delay(200ms)`，所以这个兜底动作**并不会减少截图次数**（截图是每轮循环开头固定做一次）。它的实际价值是：把"空闲等待"变成一条**显式可观测的动作**（日志、执行历史），并可被 `since(999)` / `count(999)` 引用，当作一个"空转节拍计时器"使用。

---

## 附：最小可用模板

下面这份模板由一个"单体主 C 循环输出"型策略精简而来，保留了真实策略的结构与调度思路。

```json
{
  "info": {
    "name": "你的策略",
    "author": "你的名字",
    "preActions": []
  },
  "actions": [
    {
      "name": "检查战斗结束",
      "character": "",
      "action": "check",
      "condition": { "expression": "since>1 && t>1.5" },
      "index": 20
    },
    {
      "name": "龙王-喷水",
      "character": "那维莱特",
      "action": "click(middle),wait(0.05),keydown(VK_LBUTTON),wait(0.25),moveby(1800,0),wait(0.05),moveby(1800,-1100),wait(0.05),click(middle),j,wait(0.05),keyup(VK_LBUTTON),wait(0.4)",
      "condition": { "expression": "count(31, t-15, t) + count(100, t-15, t) * 2 - count(30, t-15, t)>0" },
      "index": 30
    },
    {
      "name": "龙王-e",
      "character": "那维莱特",
      "action": "e,e",
      "condition": { "expression": "e-ready && since>15" },
      "index": 31,
      "ensureCast": true
    },
    {
      "name": "龙王-q",
      "character": "那维莱特",
      "action": "q,wait(0.1),ready",
      "condition": { "expression": "q-ready && since>18" },
      "index": 100
    },
    {
      "name": "龙王蓄力喷水",
      "character": "那维莱特",
      "action": "click(middle),wait(0.05),keydown(VK_LBUTTON),wait(4),moveby(1800,0),wait(0.05),moveby(1800,-1100),wait(0.05),click(middle),j,wait(0.05),keyup(VK_LBUTTON),wait(0.4)",
      "condition": { "expression": "" },
      "index": 101
    },
    {
      "name": "等待",
      "character": "",
      "action": "wait(0.2)",
      "condition": { "expression": "" },
      "index": 999
    }
  ]
}
```

**精简说明**

1. 原策略 `action` 中含数十段连续的 `moveby` 镜头微调，此处只保留骨架：`click(middle)` 锁定视角 → `keydown(VK_LBUTTON)` 按住普攻 → `moveby` 转动镜头 → `click(middle)` / `j` 取消后摇 → `keyup(VK_LBUTTON)` 收招。实际使用时按需补足镜头段数即可，不影响语法。
2. 省略了 `description`、`config` 等运行时无效字段（`config` 目前不被读取，未知字段一律静默忽略）。
3. 省略了取默认值的 `"ensureCast": false`，只保留真正需要开启的 `龙王-e`。
4. 本模板未使用 `morePriorities`；需要给同一个动作增加多个触发点时，按第 9 章的写法追加即可。

**调度解读**

| 动作 | index | 作用 |
|---|---|---|
| 检查战斗结束 | 20 | `check` 指令触发战斗结束检测；`since>1` 是自引用限流，`t>1.5` 保证开战 1.5 秒后才开始查 |
| 龙王-喷水 | 30 | 主力输出。条件 `count(31,t-15,t) + count(100,t-15,t)*2 - count(30,t-15,t) > 0` 表示"近 15 秒内 E 的释放次数 + Q 的释放次数×2 多于喷水次数"时才喷——也就是**先把技能铺出去，攒够了再输出**；`count(30,…)` 是按 index 自引用 |
| 龙王-e | 31 | 资源动作，`e-ready && since>15` 保证 15 秒节奏，`ensureCast: true` 确保 E 真的进了冷却 |
| 龙王-q | 100 | 爆发，`q-ready && since>18`；放在 100 位是为了让前面 20~31 的循环优先跑 |
| 龙王蓄力喷水 | 101 | 无条件兜底输出（空表达式恒真），只在前面的条目都不满足时才轮到 |
| 等待 | 999 | 兜底空转节拍。主循环在无任何条目命中时本来也会等 200ms，这里把空闲等待显式化为一个可观测、可被 `since(999)` / `count(999)` 引用的动作 |

