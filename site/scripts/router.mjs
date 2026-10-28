/**
 * Client-Side Router with URL State (T5.3 Round 1)
 *
 * Pure routing implementation with hash-based navigation
 * Zero global state - uses module pattern with closure scope
 */

(() => {
  // Private router instance (no globals)
  let currentRoute = '/';
  const subscribers = new Set();
  let isInitialized = false;

  /**
   * Initialize router system
   */
  function init() {
    if (isInitialized) return;

    window.addEventListener('hashchange', handleHashChange);

    // Handle initial load
    if (!window.location.hash) {
      window.location.hash = '#/';
    } else {
      handleHashChange();
    }

    isInitialized = true;
    console.log('[router] System initialized');
  }

  /**
   * Handle hash change events
   */
  function handleHashChange() {
    const newRoute = decodeURIComponent(window.location.hash.slice(2));
    const route = normalizeRoute(newRoute);

    if (route !== currentRoute) {
      currentRoute = route;
      notifySubscribers(route);
    }
  }

  /**
   * Normalize route path
   */
  function normalizeRoute(route) {
    if (!route || route === '') return '/';
    return `/${route.replace(/^\/+|\/+$/g, '')}`;
  }

  /**
   * Navigate to a new route
   */
  function navigateTo(path) {
    window.location.hash = `#${path.replace(/^\//, '')}`;
  }

  /**
   * Subscribe to route changes
   */
  function subscribe(callback) {
    if (typeof callback !== 'function') {
      throw new Error('Router subscribe expects a callback function');
    }

    subscribers.add(callback);
    // Call immediately with current route
    callback(currentRoute);

    // Return unsubscribe function
    return () => subscribers.delete(callback);
  }

  /**
   * Get current route
   */
  function getRoute() {
    return currentRoute;
  }

  /**
   * Extract query parameters from URL
   */
  function getQueryParams() {
    const hash = window.location.hash.split('?')[1];
    if (!hash) return {};

    const params = new URLSearchParams(hash);
    const result = {};

    for (const [key, value] of params.entries()) {
      result[key] = decodeURIComponent(value);
    }

    return result;
  }

  /**
   * Parse route path into segments
   */
  function parseRoute(path) {
    const normalized = normalizeRoute(path);
    const segments = normalized.split('/').filter(Boolean);
    return segments;
  }

  /**
   * Public API
   */
  const api = {
    init,
    navigateTo,
    subscribe,
    getRoute,
    getQueryParams,
    parseRoute,
    getCurrentRoute: getRoute,
  };

  // Auto-init when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Attach to window for debugging/testing
  window.__router = api;
})();
