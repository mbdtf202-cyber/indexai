/**
 * Theme Toggle Component (T5.4 Round 1)
 */

import { getTheme, toggleTheme } from '../styles/tokens.mjs';

export function renderThemeToggle() {
  const current = getTheme();

  return `
    <button id="theme-toggle" class="theme-toggle-btn ${current === 'dark' ? 'active' : ''}" data-theme="${current}">
      ${getToggleIcon(current)}
      <span class="visually-hidden">${current === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}</span>
    </button>
  `;
}

export function getToggleIcon(theme) {
  return theme === 'light'
    ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
    : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
}

export function bindThemeToggle() {
  const button = document.getElementById('theme-toggle');
  if (!button) return;

  button.addEventListener('click', () => {
    const newTheme = toggleTheme();
    button.setAttribute('data-theme', newTheme);

    if (newTheme === 'dark') {
      button.classList.add('active');
    } else {
      button.classList.remove('active');
    }

    console.log(`[theme] Switched to ${newTheme} mode`);
  });
}

export default { renderThemeToggle, bindThemeToggle };
