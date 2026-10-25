# T5.1 纯函数视图迁移策略 (Pure Function Views Migration Strategy)

## Overview
将 `index.html` 中的所有 `viewX()` 函数迁移到纯函数架构

## Current State
- Total view functions in index.html: **12** (viewCompare, viewHome, viewFree, viewSubs, viewRelays, viewEvents, viewTools, viewBench, viewVendors, viewSignals, viewMethod)
- All currently embedded as imperative JavaScript within HTML

## Migration Plan

### Round 1 ✅ COMPLETE
- Created formatting utilities (`site/views/format.js`)
- Defined pure function architecture pattern
- Established unit testing framework

### Round 2+ Page-by-Page Migration
Each view will be migrated following this pattern:

```javascript
// OLD: Imperative HTML-embedded function
function viewHome() {
  const data = loadData();
  document.querySelector('#models').innerHTML = data.models.map(m => `...`).join('');
}

// NEW: Pure function
export function renderHome(data) {
  return `<div id="models">${data.models.map(modelCard).join('')}</div>`;
}

// Separated from rendering logic
function modelCard(model) {
  return `<div class="model">${format.money(model.price)}</div>`;
}
```

### Migration Checklist per View
- [ ] Extract HTML template to separate file or template string
- [ ] Convert DOM manipulation to pure rendering function
- [ ] Remove global state dependencies
- [ ] Add input/output contract documentation
- [ ] Create HTML snapshot test
- [ ] Verify e2e DOM snapshots unchanged

### Priority Order
1. **viewHome** - Main landing page (highest traffic)
2. **viewModels/viewBench** - Core comparison functionality  
3. **viewSubs/viewFree** - Pricing visibility pages
4. Remaining views (relays, events, tools, vendors, signals, method)

### Integration Points
- Status page already exists at `site/status.html` (from T4.2)
- Can leverage existing T4.x modules for data loading
- Formatting helpers in `site/views/format.js` for reuse

## Success Criteria
✅ Each view has corresponding test suite
✅ HTML snapshot tests pass
✅ E2E DOM snapshots unchanged
✅ Zero global state dependencies in views
✅ Clear separation between data fetching, business logic, and rendering
