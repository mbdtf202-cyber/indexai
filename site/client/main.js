/**
 * 客户端入口（T5.2 · S9.3）。
 *
 * ## 只做交互增强
 *
 * 首屏内容已经在 HTML 里（预渲染），所以这个模块**不负责渲染**。
 * 它的三件事：
 *
 * 1. 读页面内嵌的数据（`#__data`），不做第二次请求；
 * 2. 处理客户端导航（点击站内链接时不整页刷新）；
 * 3. 逐步接管需要交互的部分（排序、筛选、计算器）。
 *
 * 如果这个文件加载失败，页面**仍然可读**——那是这里每个分支都要守住的前提。
 */

const dataEl = document.getElementById('__data');

/** 页面内嵌的数据摘要。读不到就是空对象，不抛错。 */
export const pageData = (() => {
  try {
    return dataEl ? JSON.parse(dataEl.textContent || '{}') : {};
  } catch {
    return {};
  }
})();

/** 当前路由（从 `<main data-route>` 读，构建期写入）。 */
export function currentRoute() {
  const el = document.getElementById('view');
  return el?.dataset?.route || '/';
}

/**
 * 站内链接改走客户端导航（增强，不阻断）。
 *
 * 只在支持 `fetch` 且不是跨域时接管；任何异常都退回浏览器默认行为——
 * 整页跳转是可接受的降级。
 */
export function enhanceLinks() {
  if (typeof document === 'undefined') return;

  document.addEventListener('click', async (ev) => {
    const a = ev.target?.closest?.('a');
    if (!a) return;

    const href = a.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:'))
      return;
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;

    ev.preventDefault();
    try {
      const res = await fetch(href, { headers: { Accept: 'text/html' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const next = doc.getElementById('view');
      const cur = document.getElementById('view');
      if (!next || !cur) throw new Error('缺少 #view');

      cur.replaceWith(next);
      document.title = doc.title;
      history.pushState({}, '', href);

      // 新页面带自己的内嵌数据：换掉旧的
      const nextData = doc.getElementById('__data');
      if (nextData && dataEl) dataEl.textContent = nextData.textContent;
    } catch {
      /* 失败就整页跳转：这是可接受的降级，不是错误。 */
      window.location.href = href;
    }
  });

  window.addEventListener('popstate', () => {
    window.location.reload();
  });
}

/* 自动启用：只在浏览器里，且 DOM 已就绪。 */
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhanceLinks, { once: true });
  } else {
    enhanceLinks();
  }
}
