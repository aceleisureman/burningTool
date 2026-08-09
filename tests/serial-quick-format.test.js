const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const view = fs.readFileSync(path.join(root, 'renderer', 'src', 'views', 'SerialView.vue'), 'utf8');
const composable = fs.readFileSync(path.join(root, 'renderer', 'src', 'composables', 'useSerial.js'), 'utf8');

test('quick command toolbar exposes JSON format documentation', () => {
  assert.match(view, />JSON 格式</);
  assert.match(view, /title="快捷指令 JSON 格式"/);
  for (const tab of ['参数说明', 'JSON 示例', 'AI 提示词']) assert.match(view, new RegExp(tab));
  assert.match(view, /copyQuickCommandExample/);
  assert.match(view, /copyQuickCommandAiPrompt/);
});

test('recommended quick command example is valid importable JSON', () => {
  const match = composable.match(/const QUICK_COMMAND_JSON_EXAMPLE = `([\s\S]*?)`;/);
  assert.ok(match, 'missing QUICK_COMMAND_JSON_EXAMPLE');
  const groups = JSON.parse(match[1]);
  assert.ok(Array.isArray(groups) && groups.length > 0);
  assert.equal(typeof groups[0].name, 'string');
  assert.ok(Array.isArray(groups[0].cmds) && groups[0].cmds.length > 0);
  for (const cmd of groups[0].cmds) {
    assert.equal(typeof cmd.name, 'string');
    assert.equal(typeof cmd.content, 'string');
    assert.ok(['ms', 's', 'min'].includes(cmd.unit));
  }
});

test('AI prompt documents every supported import field', () => {
  for (const field of ['name', 'cmds', 'content', 'enabled', 'hex', 'interval', 'unit']) {
    assert.match(composable, new RegExp(`name: '${field}'|${field}`));
  }
  assert.match(composable, /不要生成 id 字段/);
  assert.match(composable, /只输出合法 JSON/);
});
