/**
 * Application Initialization (T5.3 Round 1)
 *
 * Coordinates router, lazy loading, and view mounting
 * Zero global state - uses module pattern
 */

(function () {
  'use strict';

  let appInitialized = false;

  /**
   * Initialize the entire application
   */
  async function initApp() {
    if (appInitialized) return;

    console.log('[app] Starting initialization...');

    // 1. Initialize router first (sets up hash routing)
    window.__router.init();
    console.log('[app] ✓ Router initialized');

    // 2. Set up lazy loading
    window.__lazyLoadSystem?.init();
    console.log('[app] ✓ Lazy loader initialized');

    // 3. Mount initial view
    const currentRoute = window.__router.getCurrentRoute();
    await mountView(currentRoute);
    console.log(`[app] ✓ Initial view mounted: ${currentRoute}`);

    // 4. Subscribe to route changes
    subscribeToRoutes();

    appInitialized = true;
    console.log('[app] Application fully initialized!');
  }

  /**
   * Subscribe to route changes and update views
   */
  function subscribeToRoutes() {
    window.__router.subscribe(async (route) => {
      console.log(`[app] Route changed to: ${route}`);

      // Mark script as loaded
      if (!window.lazyLoadedScripts) {
        window.lazyLoadedScripts = new Set();
      }
      window.lazyLoadedScripts.add(route);

      await mountView(route);
    });
  }

  /**
   * Mount view for current route
   */
  async function mountView(route) {
    try {
      // Clean previous content
      const appContainer = document.getElementById('app');
      if (appContainer) {
        appContainer.innerHTML = '<div class="loading">Loading...</div>';
      }

      // Import and render view based on route
      const viewComponent = getViewById(route);
      if (viewComponent && viewComponent.render) {
        const mockData = generateMockDataForRoute(route);
        const html = viewComponent.render(mockData);

        if (appContainer) {
          appContainer.innerHTML = html;
        }

        // Run post-mount hooks
        runPostMountHooks(route);

        console.log(`[app] ✓ Mounted: ${route}`);
      } else {
        showErrorRoute(route);
      }
    } catch (e) {
      console.error('[app] Failed to mount view:', e.message);
      showErrorRoute(route);
    }
  }

  /**
   * Get view component by route name
   */
  function getViewById(route) {
    // Convert route to view name (e.g., /models → Models)
    const routeName = route.replace(/^\//, '') || 'home';
    const capitalizedName = capitalizeFirst(routeName);

    // Try to import view dynamically
    return window[`views${capitalizedName}`];
  }

  /**
   * Generate mock data for specific route
   */
  function generateMockDataForRoute(route) {
    switch (route) {
      case '/':
      case '/home':
        return {
          stats: { modelsCount: 150, gateways: 51, lastUpdated: new Date().toISOString() },
          latestNews: [],
          recentChanges: [],
          topModels: [],
          benchmarks: [],
        };
      case '/models':
        return {
          models: Array.from({ length: 10 }, (_, i) => ({
            id: `model-${i}`,
            name: `Model ${String.fromCharCode(65 + i)}`,
            vendor: ['openai', 'anthropic', 'google'][i % 3],
            input: 0.5 + Math.random(),
            output: 1.5 + Math.random() * 2,
            free: null,
          })),
          filters: {},
          sortBy: 'input',
          sortOrder: 'asc',
        };
      case '/benchmarks':
        return {
          boards: [{ id: 'swe-bench-lite', name: 'SWE-bench Lite', avgScore: 0.8 }],
          rankings: {},
        };
      case '/subscriptions':
        return { products: [], selectedVendor: null };
      case '/free':
        return { offerings: [] };
      case '/relays':
        return { gateways: [] };
      case '/events':
        return { events: [], filterType: 'all', searchQuery: '' };
      case '/tools':
        return { tools: [], categoryFilter: 'all', sortBy: 'stars' };
      case '/vendors':
        return { vendors: [], searchQuery: '' };
      case '/signals':
        return { signals: [], categoryFilter: 'all', searchQuery: '' };
      case '/methodology':
        return { methods: [], glossaryTerms: [] };
      default:
        return { test: true };
    }
  }

  /**
   * Run post-mount hooks after view is mounted
   */
  function runPostMountHooks(route) {
    // Trigger any route-specific initialization
    if (window.__postMountHooks?.[route]) {
      window.__postMountHooks[route]();
    }
  }

  /**
   * Show error route for 404
   */
  function showErrorRoute(route) {
    const appContainer = document.getElementById('app');
    if (appContainer) {
      appContainer.innerHTML = `
        <section class="error-page">
          <h1>🙈 Page Not Found</h1>
          <p>The page you're looking for (${route}) doesn't exist.</p>
          <a href="/" class="cta-button">← Back Home</a>
        </section>
      `;
    }
    console.warn(`[app] 404: ${route} not found`);
  }

  /**
   * Helper: Capitalize first letter
   */
  function capitalizeFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Public API
   */
  const api = {
    init: initApp,
    navigateTo: window.__router?.navigateTo,
    getCurrentRoute: window.__router?.getRoute,
  };

  // Auto-init when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

  // Attach to window for debugging/testing
  window.__app = api;
})();
