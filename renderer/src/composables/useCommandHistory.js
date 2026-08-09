import { ref } from 'vue';

export function useCommandHistory(limit = 30) {
  const items = ref([]);

  function record(text, hex = false) {
    const value = String(text || '');
    if (!value) return;
    const previous = items.value[0];
    if (previous && previous.text === value && previous.hex === hex) return;
    items.value.unshift({ text: value, hex, time: Date.now() });
    if (items.value.length > limit) items.value.length = limit;
  }

  function clear() { items.value = []; }

  return { items, record, clear };
}
