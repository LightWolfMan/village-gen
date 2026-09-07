const preferenceKey = 'village-theme';
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const select = document.querySelector('#theme-input');
let preference = 'system';
try {
  const saved = localStorage.getItem(preferenceKey);
  if (['system', 'light', 'dark'].includes(saved)) preference = saved;
} catch { /* Browsers may disable storage; the selector still works. */ }

function applyTheme() {
  const theme = preference === 'system' ? (systemTheme.matches ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#19191d' : '#f3f3f5';
  select.value = preference;
}
select.addEventListener('change', () => {
  preference = select.value;
  try { localStorage.setItem(preferenceKey, preference); } catch { /* Optional persistence. */ }
  applyTheme();
});
systemTheme.addEventListener('change', applyTheme);
applyTheme();
