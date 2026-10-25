/**
 * Design Tokens System (T5.4 Round 1)
 *
 * Centralized design tokens for theming and consistent styling
 * Zero global state - exports configuration objects only
 */

export const colorTokens = {
  // Light theme colors
  light: {
    bgPrimary: '#ffffff',
    bgSecondary: '#f8fafc',
    bgTertiary: '#f1f5f9',
    textPrimary: '#1e293b',
    textSecondary: '#475569',
    textMuted: '#94a3b8',
    borderPrimary: '#e2e8f0',
    borderFocus: '#3b82f6',
    accentPrimary: '#3b82f6',
    accentHover: '#2563eb',
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    info: '#3b82f6',
    shadow: 'rgba(0, 0, 0, 0.1)',
  },

  // Dark theme colors
  dark: {
    bgPrimary: '#0f172a',
    bgSecondary: '#1e293b',
    bgTertiary: '#334155',
    textPrimary: '#f1f5f9',
    textSecondary: '#cbd5e1',
    textMuted: '#94a3b8',
    borderPrimary: '#334155',
    borderFocus: '#60a5fa',
    accentPrimary: '#60a5fa',
    accentHover: '#3b82f6',
    success: '#4ade80',
    warning: '#fbbf24',
    error: '#f87171',
    info: '#60a5fa',
    shadow: 'rgba(0, 0, 0, 0.3)',
  },
};

export const spacingTokens = {
  xs: '0.25rem', // 4px
  sm: '0.5rem', // 8px
  md: '1rem', // 16px
  lg: '1.5rem', // 24px
  xl: '2rem', // 32px
  xxl: '3rem', // 48px
  xxxl: '4rem', // 64px
};

export const typographyTokens = {
  fontSizes: {
    xs: '0.75rem', // 12px
    sm: '0.875rem', // 14px
    base: '1rem', // 16px
    lg: '1.125rem', // 18px
    xl: '1.25rem', // 20px
    xxl: '1.5rem', // 24px
    xxxl: '2rem', // 32px
  },
  lineHeights: {
    tight: 1.25,
    snug: 1.375,
    normal: 1.5,
    loose: 1.625,
  },
  fontWeight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
};

export const borderRadiusTokens = {
  none: '0',
  sm: '0.125rem', // 2px
  md: '0.25rem', // 4px
  lg: '0.375rem', // 6px
  xl: '0.5rem', // 8px
  xxl: '0.75rem', // 12px
  full: '9999px',
};

export const zIndexTokens = {
  dropdown: 1000,
  sticky: 1020,
  modalBackdrop: 1040,
  modal: 1050,
  popover: 1060,
  tooltip: 1070,
};

// Theme switching utilities
let currentTheme = 'light';

export function setTheme(theme) {
  if (theme !== 'light' && theme !== 'dark') {
    throw new Error(`Invalid theme: ${theme}. Must be 'light' or 'dark'.`);
  }
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme-preference', theme);
  console.log(`[tokens] Theme changed to: ${theme}`);
}

export function getTheme() {
  return currentTheme;
}

export function toggleTheme() {
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  setTheme(newTheme);
  return newTheme;
}

export default {
  colorTokens,
  spacingTokens,
  typographyTokens,
  borderRadiusTokens,
  zIndexTokens,
  setTheme,
  getTheme,
  toggleTheme,
};
