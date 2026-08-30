'use strict';

// CI「校验 CRLF」步骤的本地镜像与护栏。
// 背景：GNU grep（Git Bash）读文本文件时会剥离 CR，`grep -q $'\r'` 对 CRLF 文件恒不命中，
// 导致 CI run 33250380974 在校验步骤误报失败。校验必须走字节统计，本文件固定这一约定。

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.join(__dirname, '..');
const scriptsDir = path.join(repoRoot, 'scripts');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'build-win.yml');

// 与 workflow 校验步骤同一规则：每个换行必须是 CRLF（允许末行无换行），
// 即纯 LF 行数 = LF 总数 - CR 总数，大于 0 即不合格。
function countBareLfLines(bytes) {
  let cr = 0;
  let lf = 0;
  for (const byte of bytes) {
    if (byte === 0x0d) cr += 1;
    else if (byte === 0x0a) lf += 1;
  }
  return Math.max(lf - cr, 0);
}

test('scripts/*.cmd 行尾全部为 CRLF（CI CRLF 校验的本地镜像）', () => {
  const cmdFiles = fs.readdirSync(scriptsDir).filter((name) => name.endsWith('.cmd'));
  assert.ok(cmdFiles.length > 0, 'expected at least one .cmd file under scripts/');
  for (const name of cmdFiles) {
    const bytes = fs.readFileSync(path.join(scriptsDir, name));
    const bare = countBareLfLines(bytes);
    assert.equal(bare, 0, `${name} 有 ${bare} 个纯 LF 行，CI CRLF 校验会失败，请转换为 CRLF`);
  }
});

test('workflow CRLF 校验使用字节统计而非 grep $\'\\r\'', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const checkStep = workflow.match(/-\s+name: 校验 CRLF[^\n]*\n[\s\S]*?(?=\n      - name: )/);
  assert.ok(checkStep, 'CRLF check step is missing from build-win.yml');
  assert.match(checkStep[0], /tr -cd '\\r' < "\$f" \| wc -c/, 'CRLF check must count CR bytes, grep cannot see them in Git Bash');
  // 注意：JS 的 ^ 在 /m 下会把 \r 也当行首（与 grep 不同），且字符类不排除 \r\n，
  // 因此这里必须显式排除 \r\n，否则 CRLF 文件会滑进注释行造成误报。
  assert.doesNotMatch(checkStep[0], /^[ \t]*[^ \t#\r\n][^\r\n]*grep[^\r\n]*\$'\\r'/m, 'GNU grep in Git Bash strips CR before matching, so grep $\'\\r\' always fails');
});

test('CRLF 判定规则能区分纯 CRLF、纯 LF 与混合行尾', () => {
  assert.equal(countBareLfLines(Buffer.from('a\r\nb\r\n', 'utf8')), 0, 'all-CRLF content passes');
  assert.equal(countBareLfLines(Buffer.from('a\r\nb', 'utf8')), 0, 'missing trailing newline still passes');
  assert.equal(countBareLfLines(Buffer.from('a\nb\n', 'utf8')), 2, 'all-LF content fails');
  assert.equal(countBareLfLines(Buffer.from('a\r\nb\n', 'utf8')), 1, 'mixed content fails');
});
