/* 首帧就要定下「有没有 JS」：淡入动画只在 html.js 下生效（F01）。
 *
 * 这个文件必须**同步、阻塞**地在样式表之前执行——否则 body 会先透明、
 * 再被 .nojs 救回来，读者看到一次闪烁。
 *
 * 之所以是外部文件而不是内联：S10.1 的 CSP 是 script-src 'self'，
 * 任何内联脚本都会触发 violation。外置 + 同步加载两者可以兼得。
 */
document.documentElement.classList.add('js');

(() => {
  try {
    const h = document.documentElement;
    const saved = localStorage.getItem('idx.theme');
    if (saved === 'light' || saved === 'dark') h.dataset.theme = saved;
    if (localStorage.getItem('idx.density') === 'compact') h.dataset.density = 'compact';
  } catch {
    /* 隐私模式下 localStorage 会抛错：用默认外观，不阻断页面 */
  }
})();
