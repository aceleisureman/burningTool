import { ref, computed, onMounted } from 'vue';

// 完整配色方案：每套独立 CSS 变量（data-theme），并附带 light/dark 供 Element Plus 暗色变量
export const THEME_PRESETS = [
  {
    id: 'mint',
    name: '清爽薄荷',
    mode: 'light',
    desc: '浅底 + 薄荷绿，白天办公默认',
    swatches: ['#eef3ee', '#ffffff', '#22a06b', '#0ea5a3']
  },
  {
    id: 'paper',
    name: '宣纸暖白',
    mode: 'light',
    desc: '暖灰纸感，低对比护眼',
    swatches: ['#f4efe6', '#fffaf3', '#b45309', '#c2410c']
  },
  {
    id: 'sky',
    name: '晴空蓝',
    mode: 'light',
    desc: '明亮天蓝，清爽利落',
    swatches: ['#eef4fb', '#ffffff', '#2563eb', '#0ea5e9']
  },
  {
    id: 'lavender',
    name: '浅紫丁香',
    mode: 'light',
    desc: '淡紫底 + 紫罗兰强调',
    swatches: ['#f3f0fb', '#ffffff', '#7c3aed', '#a855f7']
  },
  {
    id: 'cyan',
    name: '深空青',
    mode: 'dark',
    desc: '深板岩 + 青色高亮，夜间默认',
    swatches: ['#0a0e17', '#111726', '#22d3ee', '#34d399']
  },
  {
    id: 'ocean',
    name: '深海蓝',
    mode: 'dark',
    desc: '海军蓝底 + 亮蓝强调',
    swatches: ['#07111f', '#0d1b2e', '#38bdf8', '#60a5fa']
  },
  {
    id: 'violet',
    name: '紫晶夜',
    mode: 'dark',
    desc: '深紫夜空 + 品红点缀',
    swatches: ['#0d0a14', '#161022', '#a78bfa', '#f472b6']
  },
  {
    id: 'ember',
    name: '余烬暖夜',
    mode: 'dark',
    desc: '暖炭黑 + 琥珀金',
    swatches: ['#120d0a', '#1c1410', '#f59e0b', '#fb7185']
  },
  {
    id: 'nord',
    name: '北欧极光',
    mode: 'dark',
    desc: 'Nord 冷灰 + 淡青',
    swatches: ['#2e3440', '#3b4252', '#88c0d0', '#a3be8c']
  },
  {
    id: 'graphite',
    name: '石墨专业',
    mode: 'dark',
    desc: '中性灰专业风，低饱和',
    swatches: ['#121417', '#1a1d22', '#94a3b8', '#64748b']
  }
];

const LEGACY_MAP = {
  light: 'mint',
  dark: 'cyan'
};

function normalizeThemeId(raw) {
  const id = String(raw || '').trim();
  if (LEGACY_MAP[id]) return LEGACY_MAP[id];
  if (THEME_PRESETS.some((t) => t.id === id)) return id;
  return 'mint';
}

function findPreset(id) {
  const nid = normalizeThemeId(id);
  return THEME_PRESETS.find((t) => t.id === nid) || THEME_PRESETS[0];
}

// 主题：data-theme 切换完整配色 + html.light/dark 兼容 Element Plus
export function useTheme() {
  const theme = ref('mint');
  const themePickerVisible = ref(false);

  const currentPreset = computed(() => findPreset(theme.value));
  const themeMode = computed(() => currentPreset.value.mode || 'light');
  const isDark = computed(() => themeMode.value === 'dark');

  function applyTheme(id) {
    const preset = findPreset(id);
    theme.value = preset.id;
    document.documentElement.className = preset.mode;
    document.documentElement.setAttribute('data-theme', preset.id);
    try { localStorage.setItem('ui-theme', preset.id); } catch (e) {}
  }

  function toggleTheme() {
    // 在亮/暗两组内循环：亮色组 ↔ 暗色组的对应默认项，便于侧栏快速切换
    const next = isDark.value ? 'mint' : 'cyan';
    applyTheme(next);
  }

  function cycleTheme() {
    const idx = THEME_PRESETS.findIndex((t) => t.id === theme.value);
    const next = THEME_PRESETS[(idx + 1 + THEME_PRESETS.length) % THEME_PRESETS.length];
    applyTheme(next.id);
  }

  function selectTheme(id) {
    applyTheme(id);
    themePickerVisible.value = false;
  }

  function openThemePicker() { themePickerVisible.value = true; }
  function closeThemePicker() { themePickerVisible.value = false; }

  onMounted(() => {
    try { applyTheme(localStorage.getItem('ui-theme')); }
    catch (e) { applyTheme('mint'); }
  });

  return {
    theme,
    themeMode,
    isDark,
    currentPreset,
    themePresets: THEME_PRESETS,
    themePickerVisible,
    applyTheme,
    toggleTheme,
    cycleTheme,
    selectTheme,
    openThemePicker,
    closeThemePicker
  };
}
