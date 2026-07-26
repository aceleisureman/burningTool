const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(root, 'renderer', 'src', 'views', 'FlashView.vue'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'renderer', 'src', 'styles', 'tools', 'flash.css'), 'utf8');

test('top flash commands use one fixed square size at wrapper and button levels', () => {
  assert.equal((viewSource.match(/class="command-button command-(?:build|flash|primary)"/g) || []).length, 3);
  assert.equal((viewSource.match(/class="command-glyph command-glyph-(?:build|flash|primary)"/g) || []).length, 3);
  assert.match(styles, /\.action-group-main > \*\s*\{[^}]*flex:\s*0 0 48px[^}]*width:\s*48px[^}]*height:\s*48px/s);
  assert.match(styles, /\.action-group-main \.command-button\.el-button\s*\{[^}]*flex:\s*0 0 48px[^}]*width:\s*48px[^}]*height:\s*48px/s);
  assert.match(styles, /\.action-group-main > \* > \.command-button\.el-button\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/s);
  assert.match(styles, /\.command-glyph-flash svg\s*\{[^}]*scale\(1\.167\)/s);
  assert.match(styles, /\.command-glyph-primary svg\s*\{[^}]*scaleX\(2\.333\)[^}]*scaleY\(1\.4\)/s);
});
