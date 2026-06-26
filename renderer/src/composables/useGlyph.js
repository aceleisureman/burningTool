import { reactive, watch, nextTick, onMounted } from 'vue';
import { bytesFromGrid, fmtByte, copyText } from '../util.js';

// 字模生成（PCtoLCD 风格）：光栅化 → 取模打包 → 预览/导出
export function useGlyph() {
  const gl = reactive({
    text: '', font: 'SimSun', size: 16, bold: false, threshold: 150,
    offX: 0, offY: 0, negative: true, scan: 'col', msb: true, radix: 'hex',
    perLine: 16, comment: true, output: '', glyphs: []
  });

  // 把单个字符光栅化成 size×size 的布尔点阵（true=笔画像素）
  function rasterChar(ch, size, font, bold, threshold, offX, offY) {
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx || !ctx.getImageData) return null;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.font = (bold ? 'bold ' : '') + size + 'px "' + font + '"';
    ctx.fillText(ch, offX, Math.round(size * 0.84) + offY);
    const data = ctx.getImageData(0, 0, size, size).data;
    const grid = [];
    for (let y = 0; y < size; y++) {
      const row = [];
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        row.push(data[i + 3] > 16 && lum < threshold);
      }
      grid.push(row);
    }
    return grid;
  }
  function genGlyph() {
    const chars = Array.from(gl.text || '');
    const glyphs = [], blocks = [];
    chars.forEach((ch) => {
      if (ch === '\n' || ch === '\r') return;
      let grid; try { grid = rasterChar(ch, gl.size, gl.font, gl.bold, gl.threshold, gl.offX, gl.offY); } catch (e) { grid = null; }
      if (!grid) return;
      const bytes = bytesFromGrid(grid, gl.size, gl.scan, gl.msb, gl.negative);
      glyphs.push({ ch, grid, bytes });
      const strs = bytes.map((b) => fmtByte(b, gl.radix));
      const per = Math.max(1, Number(gl.perLine) || 16);
      const lines = [];
      for (let i = 0; i < strs.length; i += per) lines.push('{' + strs.slice(i, i + per).join(',') + '},');
      if (gl.comment) lines[lines.length - 1] += '/*"' + ch + '",' + (glyphs.length - 1) + '*/';
      blocks.push(lines.join('\n'));
    });
    gl.glyphs = glyphs;
    gl.output = blocks.join('\n\n');
    nextTick(drawGlyphPreviews);
  }
  function drawGlyphPreviews() {
    const size = gl.size;
    const scale = Math.max(3, Math.floor(176 / size));
    document.querySelectorAll('canvas.gl-canvas').forEach((cv) => {
      const gi = Number(cv.getAttribute('data-gi'));
      const g = gl.glyphs[gi];
      if (!g) return;
      cv.width = size * scale; cv.height = size * scale;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#0b1220'; ctx.fillRect(0, 0, cv.width, cv.height);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (g.grid[y][x]) { ctx.fillStyle = '#46d39a'; ctx.fillRect(x * scale, y * scale, scale, scale); }
      }
      ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1;
      for (let i = 0; i <= size; i++) {
        ctx.beginPath(); ctx.moveTo(i * scale + .5, 0); ctx.lineTo(i * scale + .5, cv.height); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * scale + .5); ctx.lineTo(cv.width, i * scale + .5); ctx.stroke();
      }
    });
  }
  async function copyGlyph() {
    if (!gl.output) return;
    try { await copyText(gl.output); ElMessage.success('已复制字模代码'); }
    catch (e) { ElMessage.error('复制失败'); }
  }
  function downloadGlyph() {
    if (!gl.output) return;
    const header = '/* 字模数据 · ' + gl.size + 'x' + gl.size + ' · ' +
      (gl.negative ? '阴码' : '阳码') + ' · ' +
      ({ col: '逐列式', row: '逐行式', colrow: '列行式', rowcol: '行列式' }[gl.scan]) + ' · ' +
      (gl.msb ? '高位在前' : '低位在前') + ' */\n\n';
    const blob = new Blob([header + gl.output + '\n'], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'font.h';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
  }

  onMounted(() => {
    watch(() => [gl.text, gl.font, gl.size, gl.bold, gl.threshold, gl.offX, gl.offY, gl.negative, gl.scan, gl.msb, gl.radix, gl.perLine, gl.comment], genGlyph, { immediate: true });
  });

  return { gl, copyGlyph, downloadGlyph };
}
