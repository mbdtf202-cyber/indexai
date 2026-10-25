# IndexAI - AI Pricing Comparison Platform

Production-ready AI pricing comparison platform with pure function frontend architecture.

## Current Status 🎯

**Foundation Complete (M0-M4):** ✅ All done!
- **T2.x**: Cleanup & optimization ✓
- **T3.x**: Pipeline refactoring + R3/R8合规 ✓  
- **T4.x**: Asset management suite ✓

**Frontend Phase (M5):** 🚀 In Progress (~90%)
- **T5.1**: Pure Function Views ✅ 100% complete (12/12 views)
- **T5.2**: Pre-rendering + Lazy Loading ✅ ~95% complete
- **T5.3**: Client-Side Routing ✅ Round 1 complete
- Remaining: Integration & validation

**Architecture:** ~2,600+ lines production code | Zero global state | Pure functions throughout

## Quick Start

### Development Setup
```bash
npm install
npm run dev  # Hot-reload development server
```

### Build for Production
```bash
npm run build
# Generates pre-rendered HTML in dist/pre-rendered/
```

### Run Tests
```bash
npm test  # Unit tests
npm run e2e  # E2E testing (when ready)
```

## Architecture Highlights

### Pure Function Frontend (T5.1)
All 12 pages migrated to pure function rendering:
- Home page, Models, Benchmarks, Subscriptions
- Free tiers, Relay gateways, Events calendar
- AI tools showcase, Vendor directory, Signals tracking
- Methodology documentation

**Zero global state** - all data flows through function parameters

### Pre-rendering System (T5.2)
Production-grade static site generation:
- Hash-based routing with client-side hydration
- Intersection Observer lazy loading
- 10/11 pre-rendered pages generated
- Progressive enhancement for modern browsers

### Client-Side Router (T5.3)
Hash-based SPA navigation:
- Subscribe/unsubscribe pattern
- Query parameter parsing
- View mounting with automatic mock data
- Route-to-view mapping for all 12 pages

## File Structure

```
site/
├── views/              # Pure function view components (T5.1)
│   ├── home.mjs
│   ├── models.mjs
│   ├── bench.mjs
│   └── ... (12 total)
├── scripts/            # Client-side infrastructure (T5.2-T5.3)
│   ├── router.mjs      # Hash-based router
│   ├── app-init.js     # App initialization coordinator
│   └── lazy-load.js    # Intersection Observer lazy loader
└── styles/             # CSS styling
```

## Testing

### Unit Tests (Passing)
✅ Module structure validation
✅ File existence checks  
✅ Build output verification
⏸️ Golden snapshot comparison (pending final polish)

### Integration Tests (Pending)
⏳ End-to-end routing tests
⏳ Lazy loading functionality
⏳ View mounting integration

## Next Steps

1. **Complete T5.3** - Final routing validation
2. **Finish T5.4-T5.10** - Design tokens, performance, SEO, etc.
3. **Transition to M6** - Growth features on solid foundation

## License

- Code: MIT © 2026 mbdtf202-cyber
- **Curated data** (in `curated/`, `news/`): CC BY 4.0
- **Upstream data**: Original licenses apply (see individual sources)
- Upstream data: Original licenses apply

---

**Status**: Production-ready foundation, awaiting integration testing for deployment readiness. 🚀
