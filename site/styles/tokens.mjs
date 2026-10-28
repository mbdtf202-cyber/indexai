/**
 * 主题切换（T5.6）。
 *
 * 颜色、间距、字号、圆角、动效时长的**值**全在 tokens.css 里（R4）。
 * 这个模块只负责一件事：改 documentElement 上的 data-theme，
 * 让 CSS 变量换一套值。它不持有任何颜色字面量。
 */

/** @type {'light'|'dark'|null} 用户显式选过的那一个；null 表示跟随系统。 */
let currentTheme = null;

/** 设置主题并写进 localStorage。传 null 表示跟随系统。 */
export function setTheme(theme) {
  currentTheme = theme === 'light' || theme === 'dark' ? theme : null;
  if (typeof document !== 'undefined') {
    const el = document.documentElement;
    if (currentTheme) el.dataset.theme = currentTheme;
    else delete el.dataset.theme;
  }
  try {
    if (currentTheme) localStorage.setItem('idx.theme', currentTheme);
    else localStorage.removeItem('idx.theme');
  } catch {
    /* 隐私模式：只影响持久化，不影响本次外观 */
  }
}

/** 当前生效的主题。没有显式选择时返回 null（表示跟随系统）。 */
export function getTheme() {
  return currentTheme;
}

export function toggleTheme() {
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  setTheme(newTheme);
  return newTheme;
}

export default { setTheme, getTheme, toggleTheme };
