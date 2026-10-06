// 构建单文件 HTML：node tools/build.mjs
// 把 src/js/*.js 按顺序内联进 src/index.html 的占位注释，输出到工作区根目录
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 工作区根目录（编辑器目录的上一级）：示例策略等文件放在这里
export const workspaceRoot = path.resolve(root, '..');
// 交付物文件名（就是双击打开的那份单文件网页）
export const OUT_NAME = '面向角色的JSON战斗策略编辑器.html';
export const JS_ORDER = ['data_avatars.js', 'data_commands.js', 'cond.js', 'core.js', 'ui_common.js', 'ui_info.js', 'ui_actions.js', 'ui_preview.js', 'main.js'];

/** 找到工作区里的示例策略（编辑器目录里没有就往上找一级） */
export function findSampleJson(name = '公式化锄地（已修复）.json') {
  const cands = [path.join(root, name), path.join(workspaceRoot, name)];
  return cands.find(p => fs.existsSync(p)) || cands[0];
}

export function readSources({ skipMissing = false } = {}) {
  const out = [];
  for (const f of JS_ORDER) {
    const p = path.join(root, 'src', 'js', f);
    if (skipMissing && !fs.existsSync(p)) continue;
    out.push({ file: f, code: fs.readFileSync(p, 'utf8') });
  }
  return out;
}

function main() {
  const tplPath = path.join(root, 'src', 'index.html');
  const tpl = fs.readFileSync(tplPath, 'utf8');
  const parts = readSources().map(s => `/* ==================== ${s.file} ==================== */\n${s.code}`);
  const bundle = parts.join('\n\n');
  const marker = '<!--__BUNDLE__-->';
  if (!tpl.includes(marker)) throw new Error('src/index.html 缺少 ' + marker + ' 占位');
  const out = tpl.replace(marker, () => bundle);
  const outPath = path.join(root, OUT_NAME);
  fs.writeFileSync(outPath, out, 'utf8');
  const kb = (Buffer.byteLength(out, 'utf8') / 1024).toFixed(1);
  console.log(`已生成 ${path.relative(root, outPath)}（${kb} KB，内联 ${JS_ORDER.length} 个脚本）`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
