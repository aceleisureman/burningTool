import { ref, onMounted } from 'vue';

// 主题（亮/暗）：写 html.className + localStorage 持久化
export function useTheme() {
  const theme = ref('light');
  function applyTheme(t) {
    theme.value = (t === 'dark') ? 'dark' : 'light';
    document.documentElement.className = theme.value;
    try { localStorage.setItem('ui-theme', theme.value); } catch (e) {}
  }
  function toggleTheme() { applyTheme(theme.value === 'dark' ? 'light' : 'dark'); }

  onMounted(() => {
    try { applyTheme(localStorage.getItem('ui-theme')); } catch (e) { applyTheme('light'); }
  });

  return { theme, applyTheme, toggleTheme };
}
