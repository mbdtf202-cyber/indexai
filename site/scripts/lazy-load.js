/**
 * Lazy Loading Infrastructure (T5.2 Round 1)
 *
 * Implements Intersection Observer-based lazy loading for routes
 * Zero global state - uses module pattern with closure scope
 */

(() => {
  let intersectionObserver = null;
  let isInitialized = false;

  function init() {
    if (isInitialized) return;

    if ('IntersectionObserver' in window) {
      intersectionObserver = new IntersectionObserver(handleIntersection, {
        rootMargin: '200px 0px',
        threshold: 0.01,
      });

      setupLazyLoadTriggers();
      isInitialized = true;
      console.log('[lazy-load] System initialized');
    } else {
      console.warn('[lazy-load] IntersectionObserver not supported');
      loadAllScriptsImmediately();
    }
  }

  function setupLazyLoadTriggers() {
    const lazyElements = document.querySelectorAll('[data-lazy-load]');

    lazyElements.forEach((el) => {
      const route = el.dataset.lazyLoad;

      if (route && !window.lazyLoadedRoutes?.includes(route)) {
        intersectionObserver.observe(el);

        if (!window.lazyLoadedRoutes) {
          window.lazyLoadedRoutes = [];
        }
        window.lazyLoadedRoutes.push(route);
      }
    });
  }

  function handleIntersection(entries) {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const route = entry.target.dataset.lazyLoad;

        if (route && !window.lazyLoadedRoutes?.includes(route)) {
          loadScriptForRoute(route);

          if (!window.lazyLoadedRoutes) {
            window.lazyLoadedRoutes = [];
          }
          window.lazyLoadedRoutes.push(route);

          intersectionObserver.unobserve(entry.target);
        }
      }
    });
  }

  function loadScriptForRoute(route) {
    if (!window.lazyLoadedScripts) {
      window.lazyLoadedScripts = new Set();
    }

    if (window.lazyLoadedScripts.has(route)) return;

    const scriptUrl = `/scripts/routes/${route.replace(/^\//, '') || 'home'}.js`;
    const script = document.createElement('script');
    script.src = scriptUrl;
    script.async = true;
    script.onload = () => {
      console.log(`[lazy-load] ✓ Loaded: ${scriptUrl}`);
      window.lazyLoadedScripts.add(route);
    };
    script.onerror = () => {
      console.error(`[lazy-load] ✗ Failed: ${scriptUrl}`);
    };

    document.head.appendChild(script);
  }

  function loadAllScriptsImmediately() {
    const routes = [
      'home',
      'models',
      'bench',
      'subs',
      'free',
      'relays',
      'events',
      'tools',
      'vendors',
      'signals',
      'method',
    ];
    routes.forEach((route) => {
      loadScriptForRoute(`/${route}`);
    });
  }

  const api = {
    init,
    retriggerLazyLoad: setupLazyLoadTriggers,
    getLoadedRoutes: () => window.lazyLoadedRoutes || [],
    isInitialized: () => isInitialized,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.__lazyLoadSystem = api;
})();
