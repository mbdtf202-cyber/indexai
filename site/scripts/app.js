/* 主逻辑（从 index.html 内联脚本外置，T5.8 · S10.1）。
 *
 * 外置的原因：CSP 的 script-src 只允许 'self'，内联会触发 violation。 */

import { safeUrl } from '/lib/url.js';
import {
  effectiveCost as costOf,
  profileOf,
  FORMULA as COST_FORMULA,
  FORMULA_ZH,
} from '/lib/effective-cost.js';
import { quotaLabel, sortByQuotaValue } from '/lib/offers.js';

/* ══════ motion（独立于主 IIFE，主流程可以随时调 MOTION.arm()） ══════ */
const MOTION = (() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ease = (t) => 1 - (1 - t) ** 3;
  const vh = () => innerHeight || 800;

  function countUp(el, to, opt = {}) {
    const { dur = 1000, dec = 0, pre = '', suf = '' } = opt;
    if (reduced) {
      el.textContent = pre + to.toFixed(dec) + suf;
      return;
    }
    const t0 = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      el.textContent = pre + (to * ease(t)).toFixed(dec) + suf;
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  const io = new IntersectionObserver(
    (es) => {
      es.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.04, rootMargin: '0px 0px -3% 0px' },
  );

  const inView = (el) => {
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.top < vh() * 0.95 && r.bottom > 0;
  };

  function tag() {
    const put = (el, mode, i) => {
      if (!el || el.hasAttribute('data-reveal')) return;
      el.setAttribute('data-reveal', mode);
      if (i != null && !el.style.getPropertyValue('--i'))
        el.style.setProperty('--i', Math.min(i, 6));
    };
    const hero = document.querySelector('.hero:not(.is-hidden)');
    if (hero) {
      put(hero.querySelector('h1'), 'mask', 0);
      [...hero.querySelectorAll('p, .kpi')].forEach((el, i) => put(el, '', i + 1));
    }
    // 总览页的大标题是 h2.home-h，同样走揭开动画
    const homeH = document.querySelector('#view .home-h');
    if (homeH) {
      homeH.setAttribute('data-reveal', 'mask');
      if (!homeH.style.getPropertyValue('--i')) homeH.style.setProperty('--i', 0);
    }
    const puts = document.querySelectorAll(
      '#view .shead, #view .home-h, #view .home-sub, #view .home-facts, #view .newsrow, #view .ncard, #view .threeways, #view .tway, #view .entries, #view .ecard, #view .controls, #view table, #view .card, #view .tcard, #view .irow, #view .evcard, #view .relay-card, #view .region-card, #view .subrow',
    );
    puts.forEach((el, i) => {
      const fresh = !el.hasAttribute('data-reveal');
      put(el, '', i % 12);
      // 首屏就在视口里的元素立即显示，不等两帧后的 rAF：入场动画只属于「滚下来才看到」的内容。
      if (fresh && inView(el)) el.classList.add('in');
    });
  }

  function arm(root = document) {
    tag();
    const scope = root === document ? document : root;
    scope.querySelectorAll('[data-reveal]').forEach((el) => {
      if (!el.classList.contains('in') && inView(el)) el.classList.add('in');
    });
    scope.querySelectorAll('[data-reveal]').forEach((el, i) => {
      if (el.classList.contains('in')) return;
      if (!el.style.getPropertyValue('--i')) el.style.setProperty('--i', Math.min(i, 6));
      if (inView(el))
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
      else io.observe(el);
    });
    document.querySelectorAll('.kpi .n').forEach((el) => {
      if (el.dataset.moved) return;
      const raw = el.textContent.trim();
      const m = raw.match(/^([^\d\-+]*)([\d.]+)(.*)$/);
      if (!m) return;
      const to = Number(m[2]);
      if (Number.isNaN(to) || to > 999999) return;
      el.dataset.moved = '1';
      if (inView(el) && !reduced) {
        const dec = (m[2].split('.')[1] || '').length;
        el.textContent = m[1] + (0).toFixed(dec) + m[3];
        countUp(el, to, { dec, pre: m[1], suf: m[3] });
      }
    });
  }

  function progress() {
    const bar = document.createElement('div');
    bar.className = 'progress';
    document.body.appendChild(bar);
    let tick = false;
    const paint = () => {
      tick = false;
      const h = document.documentElement.scrollHeight - innerHeight;
      bar.style.width = `${h > 0 ? (scrollY / h) * 100 : 0}%`;
    };
    const on = () => {
      if (!tick) {
        tick = true;
        requestAnimationFrame(paint);
      }
    };
    addEventListener('scroll', on, { passive: true });
    paint();
  }

  return { arm, progress, reduced };
})();

(() => {
  /** 情报密度带的分桶缓存：渲染时写入，点击处理器按索引读取（F35：不再挂 window）。 */
  let newsBuckets = null;

  const TABS = [
    { id: 'home', label: '总览', hint: '一站看全' },
    { id: 'free', label: '免费额度', hint: '还能免费用什么' },
    { id: 'compare', label: '比价', hint: 'token 挂牌价与缓存成本' },
    { id: 'subs', label: '订阅', hint: '旗舰订阅官方价与路子' },
    { id: 'relays', label: '中转站', hint: '第三方 API 报价与状态' },
    { id: 'events', label: 'AI活动', hint: '黑客松、会议、meetup，按类型细分' },
    { id: 'tools', label: '工具箱', hint: '精选 skill / MCP / CLI' },
    { id: 'bench', label: '评测', hint: '同一批题目的公开分数' },
    { id: 'signals', label: '情报', hint: 'AI 圈要闻与 X 一手信号' },
    { id: 'method', label: '方法', hint: '口径、去重与来源' },
  ];
  const HERO = {
    home: {
      k: 'INDEX AI',
      t: 'AI 的价、量、场，<br>一个入口看完。',
      s: '免费额度、token 单价、订阅区价、中转站报价、活动、评测与要闻——同一套口径，每天自动采集。',
    },
    free: {
      k: 'FREE TIERS',
      t: '免费的先用完，<br>再谈花钱。',
      s: '还在送额度的产品与服务：额度多少、能用哪些模型、门槛是什么、什么时候结束。每条都附官方页面，能自己点开核。',
    },
    compare: {
      k: 'PRICES',
      t: '同一个模型，<br>不同渠道不同价。',
      s: '官方直连、聚合平台、中转站分开列；缓存命中、缓存写入、分时价都摊在表里，不合并成一个「最低价」。',
    },
    subs: {
      k: 'SUBSCRIPTIONS',
      t: '订阅价，官网上写多少<br>就是多少。',
      s: '各产品官方档位月费，按当日汇率折人民币；第三方挂单只当行情看，不推荐。',
    },
    relays: {
      k: 'RELAYS',
      t: '中转站的公开价目，<br>每天探一遍。',
      s: '读 OneAPI / NewAPI 的价目接口，按倍率换算成每百万 token。需要登录才能看的价格不采，也不替它猜。',
    },
    events: {
      k: 'AI EVENTS',
      t: '能报名、有奖、<br>给额度的 AI 活动。',
      s: 'Devpost 开放中的黑客松 + Luma 的 AI 场次，加上本地 AIOS 收录的活动，按截止日期排；过期的单独归档。',
    },
    tools: {
      k: 'TOOLKIT',
      t: '好用的东西，<br>不堆。',
      s: '只收稀缺的：解决具体问题、别处不好找、作者在维护。人尽皆知的（Playwright、GitHub MCP 这类）不收。星数只作参考，排序按使用价值。',
    },
    // 数字全部来自数据（c.bench / c.benchRows），HERE 通过 renderHero 里的占位替换注入
    bench: {
      k: 'BENCHMARKS',
      t: '同一批题目，<br>各自跑一遍。',
      s: '__BENCH_SOURCES__ 个公开权威榜单、__BENCH_ROWS__ 个细分维度，同一模型放在一张表里横向对照；口径与更新日期都写在表头。',
    },
    signals: {
      k: 'INTELLIGENCE',
      t: 'AI 圈在发生什么，<br>挑过再给你。',
      s: '每日要闻按价格、模型、融资、政策、安全分类打分精选；下面是 X 与官方的价格一手信号，只收抓到正文的。',
    },
    method: {
      k: 'METHOD',
      t: '每个数字，<br>怎么来的。',
      s: '每一层数据的来源、去重规则、有效成本公式、汇率与评测口径，全写在页面上，可自行复核。',
    },
  };
  /* 厂商顺序由采集端下发（meta.vendorOrder，来自 registry/vendors.json）。
   * 曾经这里写死一份 13 条的数组，与采集侧的映射各自维护——
   * 两处一旦不一致，同一个厂在比价表与厂商分组里就成了两个。
   * 拿不到时退回空数组：排序按 99，功能不受影响，但不会假装知道顺序。 */
  function vendorOrder() {
    const list = state.data?.meta?.vendorOrder;
    return Array.isArray(list) ? list : [];
  }
  function vendorRankMap() {
    return new Map(vendorOrder().map((v, i) => [v, i]));
  }
  const rankOf = (v) => {
    const m = vendorRankMap();
    return m.has(v) ? m.get(v) : 99;
  };
  const focusSet = () => new Set(vendorOrder());
  const CAT_LABEL = {
    'coding-agent': '编程 Agent',
    'api-credit': '赠送金',
    'api-free-models': '免费模型',
    chat: '对话',
    ide: 'IDE',
    cli: 'CLI',
  };
  const REGION_LABEL = { GLOBAL: '国际', CN: '国内', BOTH: '双区' };
  const TOPIC_LABEL = {
    'free-tier': '免费额度',
    'price-cut': '降价',
    'new-model': '新模型',
    'cache-pricing': '缓存定价',
    'agent-launch': 'Agent 发布',
  };
  const SRC_LABEL = { x: 'X', blog: '官方博客', newsroom: '新闻稿' };
  /* 活动层的两个字典只负责「把已知的值翻成中文」，值本身一律从 data.events 里取。
     新增来源/类型/地区会在筛选行里自己长出来，不用改这里；未收录的键原样显示。 */
  const EV_KIND = {
    hackathon: '黑客松',
    conference: '会议 / 峰会',
    meetup: 'Meetup',
    workshop: '工作坊',
    demo: 'Demo Day',
    award: '评选 / 影展',
    other: '其他',
  };
  const EV_REGION = {
    online: '线上',
    cn: '国内',
    jp: '日本',
    us: '美国',
    eu: '欧洲',
    asia: '亚洲',
    other: '其他',
    uk: '英国',
    ca: '加拿大',
    au: '澳洲',
    sg: '新加坡',
    latam: '拉美',
    in: '印度',
    'middle-east': '中东',
    africa: '非洲',
    kr: '韩国',
    ae: '阿联酋',
  };
  const EV_SRC = { Devpost: 'Devpost', Luma: 'Luma', AIOS: 'AIOS' };
  const EV_LABEL = (dict, k) => dict[k] || String(k || '');
  const catLabel = (c) => CAT_LABEL[c] || c;

  const state = {
    tab: (location.hash || '#home').slice(1),
    q: '',
    vendor: 'all',
    band: 'all',
    channel: 'all',
    evKind: 'all',
    evSrc: 'all',
    evRegion: 'all',
    newsTopic: 'all',
    newsRange: 'all',
    newsImp: 'all',
    newsScale: 'm',
    newsLimit: 12,
    benchView: 'table',
    benchGroup: 'all',
    benchPicks: null,
    benchLimit: 60,
    benchFull: null,
    benchLoading: null,
    benchError: null,
    newsFull: null,
    newsLoading: null,
    newsError: null,
    ms: null,
    msLoading: null,
    msErr: null,
    msSel: null,
    newsWin: 'all',
    evLimit: 18,
    evPastLimit: 30,
    toolKind: 'all',
    freeOnly: false,
    paidOnly: false,
    cacheOnly: false,
    sortKey: 'focus',
    sortDir: 1,
    // 比价表默认画像来自 lib/cost.js（F36：不再在这里写死数字）
    hit: profileOf('compare').h,
    outShare: profileOf('compare').s,
    region: 'all',
    cat: 'all',
    offerSort: 'default',
    sigSrc: 'all',
    limit: 80,
    cmpView: 'models',
    relayFlag: 'sonnet55',
    fx: null,
    data: null,
  };
  if (!TABS.some((t) => t.id === state.tab)) state.tab = 'home';

  const $ = (s, r = document) => r.querySelector(s);
  const _$$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) =>
    String(s == null ? '' : s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );

  /*
   * 情报层在 2026-10 改成了「索引 + 归档」：
   *   data.json.news  = {n, days, span, first, last, major, per, bytes}  ← 只有统计
   *   news-archive.json = 全部条目（按需拉）
   * 旧版把完整条目直接塞在 data.news 里。下面这层把两种形态抹平，
   * 否则页面会在 news.map(...) 上抛「is not a function」并整页白屏。
   */
  function newsItems() {
    const n = state.data?.news;
    if (Array.isArray(n)) return n; // 旧形态
    return Array.isArray(state.newsFull) ? state.newsFull : [];
  }
  function newsIndex() {
    const n = state.data?.news;
    if (Array.isArray(n)) return { n: n.length };
    return n || {};
  }
  /** 归档还没到手时需要去拉一次（data.json 只带索引）。 */
  function needsNewsArchive() {
    return !Array.isArray(state.data?.news) && !Array.isArray(state.newsFull);
  }

  /** 归档里首尾日期的跨度（天）。用于 data.json 索引没带 span 的形态；空归档返回 0。 */
  function newsSpanDays(items) {
    if (!Array.isArray(items) || !items.length) return 0;
    const dates = items
      .map((x) => (x.date || '').slice(0, 10))
      .filter(Boolean)
      .sort();
    if (!dates.length) return 0;
    const from = Date.parse(`${dates[0]}T00:00:00Z`);
    const to = Date.parse(`${dates[dates.length - 1]}T00:00:00Z`);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
    return Math.max(0, Math.round((to - from) / 86400000));
  }
  async function loadNews() {
    if (Array.isArray(state.data?.news)) return state.data.news;
    if (Array.isArray(state.newsFull)) return state.newsFull;
    if (state.newsLoading) return state.newsLoading;
    state.newsLoading = (async () => {
      try {
        /* 情报归档自 T4.1 起在 data 分支的 news/<YYYY-MM>.json 月度分片里，
         * main 上已不再有单文件归档。先从 manifest 找分片清单，
         * 找不到就退回旧的单文件路径（本地开发可能还留着）。
         *
         * 拿不到不是错误：首页与情报页会退化成「只有 data.json 里的索引」，
         * 那种情况下页面仍可用，只是条目少。 */
        let raw = [];
        try {
          const man = await fetch('data/manifest.json').then((r) => (r.ok ? r.json() : null));
          const shards = (man?.newsShards || []).map((m) => `news/${m}.json`);
          if (shards.length) {
            const lists = await Promise.all(
              shards.map((p) => fetch(p).then((r) => (r.ok ? r.json() : []))),
            );
            for (const l of lists) if (Array.isArray(l)) raw.push(...l);
          }
        } catch {
          /* manifest 或分片不可用：走下面的单文件兜底 */
        }

        if (!raw.length) {
          const res = await fetch('news-archive.json');
          if (!res.ok) {
            /* 单文件也没有：接受降级，不抛错——首页只要能显示索引就够了。 */
            state.newsFull = [];
            return state.newsFull;
          }
          const j = await res.json();
          raw = Array.isArray(j) ? j : j.items || j.news || [];
        }
        // 归档用短字段省体积（u/d/tm/t/tp/s/sc/im），tp 是 NEWS_TOPICS 的下标。
        // 老的 data.news 是长字段形态，两者都认。
        const CODE_TOPIC = [
          'price',
          'funding',
          'policy',
          'safety',
          'model',
          'product',
          'research',
          'other',
        ];
        const LABEL = {
          price: '价格与额度',
          funding: '融资并购',
          policy: '政策监管',
          safety: '安全对齐',
          model: '模型发布',
          product: '产品更新',
          research: '研究评测',
          other: '其他',
        };
        state.newsFull = raw.map((x) => {
          if (x.date || x.title) return x; // 已是长字段形态
          const topic = CODE_TOPIC[x.tp] || 'other';
          return {
            key: x.u,
            url: x.u,
            date: x.d,
            time: x.tm,
            title: x.t,
            summary: x.s || '',
            topic,
            topicLabel: LABEL[topic],
            score: x.sc,
            importance: x.im || 'daily',
            via: x.v || '',
            sourceCount: x.ns || 1,
          };
        });
      } catch (e) {
        state.newsError = e.message;
        state.newsFull = [];
      }
      return state.newsFull;
    })();
    return state.newsLoading;
  }

  /* 超级大事件：一份手写、逐条核过出处的里程碑清单（2022-11-30 起）。
     它跟自动归档是两套东西——归档是「今天发生了什么」，里程碑是「什么改变了行业」，
     后者不该被日更流冲掉，所以放在时间轴上方，单独加载。 */
  async function loadMilestones() {
    // 注意别用 `Array.isArray(state.ms)` 当「已加载」的判据：失败时它被赋成 []，
    // 之后每次都会直接 return，永远等不到重试，页面就卡在「正在加载大事件…」。
    if (state.ms !== null) return state.ms;
    if (state.msLoading) return state.msLoading;
    state.msLoading = (async () => {
      try {
        const res = await fetch('news-milestones.json');
        if (!res.ok) throw new Error(res.status);
        const j = await res.json();
        state.ms = Array.isArray(j.events) ? j.events : [];
        state.msMeta = j.epochs || [];
      } catch (e) {
        state.msErr = e.message;
        state.ms = [];
      }
      state.msLoading = null;
      return state.ms;
    })();
    return state.msLoading;
  }

  function money(n) {
    if (n == null) return '—';
    if (n === 0) return '0';
    if (n >= 100) return n.toFixed(0);
    if (n >= 1) return n.toFixed(2);
    return n.toFixed(4);
  }
  function ctx(n) {
    if (!n) return '—';
    if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 ? 2 : 0)}M`;
    if (n >= 1000) return `${Math.round(n / 1000)}K`;
    return String(n);
  }
  const pct = (x) => `${Math.round(x * 100)}%`;
  const confTitle = {
    high: '高置信：实时 API 或官方定价页',
    med: '中置信：需换算或页面不完整',
    low: '低置信：未取到原始页面',
  };
  const hostOf = (u) =>
    String(u || '')
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .replace(/^www\./, '');

  /** 区价实际覆盖多少个国家/地区：数 subsRegions 里出现过的国家码。 */
  function subsCountryCount() {
    const codes = new Set();
    for (const g of state.data?.subsRegions || []) {
      for (const r of g.rows || []) if (r.c) codes.add(r.c);
    }
    return codes.size;
  }
  /**
   * 外部链接（F46 · INV-14）。
   *
   * 所有第三方 URL 都必须从这里出去：安全地址渲染成带 rel="noopener" 的链接，
   * 不安全地址（javascript: / data: / 相对路径……）**渲染成纯文本**。
   * 只做 HTML 转义是不够的——转义管的是引号逃逸，而 javascript: 根本不需要引号就能执行。
   * 判定集中在 lib/url.js，采集端与页面共用同一份规则。
   */
  function extLink(url, inner, attrs = '') {
    const safe = safeUrl(url);
    if (!safe)
      return `<span class="unsafe-url" title="链接地址不可用，已按纯文本显示">${inner}</span>`;
    return `<a href="${esc(safe)}" target="_blank" rel="noopener"${attrs}>${inner}</a>`;
  }

  /* ── 报错入口（T6.10） ── */
  const REPO_URL = 'https://github.com/mbdtf202-cyber/indexai';
  function reportUrl(kind, id, source = '') {
    const params = new URLSearchParams({
      template: 'report.yml',
      title: `[报错] ${kind} ${id || ''}`.trim(),
      record_id: String(id || ''),
      source: String(source || ''),
    });
    return `${REPO_URL}/issues/new?${params.toString()}`;
  }
  function reportLink(kind, id, source, label = '报错') {
    return `<a class="rep" href="${esc(reportUrl(kind, id, source))}" target="_blank" rel="noopener">${label}</a>`;
  }

  /* ── 全站搜索（T6.10） ── */
  let paletteOpen = false;
  let paletteResults = [];
  let paletteIndex = 0;
  let paletteCache = null;
  const PALETTE_KIND = { model: '模型', vendor: '厂商', offer: '免费额度', tool: '工具' };

  function paletteIndexAll() {
    if (paletteCache) return paletteCache;
    const d = state.data || {};
    const out = [];
    for (const m of d.models || []) {
      out.push({ kind: 'model', name: m.name, sub: `${m.vendor || ''} · ${m.id || ''}`, id: m.id, vendor: m.vendor });
    }
    const vendors = [...new Set((d.models || []).map((m) => m.vendor).filter(Boolean))];
    for (const v of vendors) out.push({ kind: 'vendor', name: v, sub: '厂商' });
    for (const o of d.offers || []) {
      out.push({ kind: 'offer', name: o.product || o.vendor || '免费额度', sub: o.vendor || o.category || '', id: o.id || o.product });
    }
    for (const t of d.resources || []) {
      out.push({ kind: 'tool', name: t.title || t.repo || '工具', sub: t.repo || t.useLabel || '', id: t.id || t.repo });
    }
    paletteCache = out;
    return out;
  }

  function paletteSearch(query) {
    const q = String(query || '').trim().toLowerCase();
    const all = paletteIndexAll();
    if (!q) return all.slice(0, 12);
    const scored = [];
    for (const item of all) {
      const name = String(item.name || '').toLowerCase();
      const sub = String(item.sub || '').toLowerCase();
      const pos = name.indexOf(q);
      if (pos < 0 && !sub.includes(q)) continue;
      scored.push({ item, rank: pos === 0 ? 0 : pos > 0 ? 1 : 2 });
    }
    return scored.sort((a, b) => a.rank - b.rank).slice(0, 20).map((x) => x.item);
  }

  function paintPalette() {
    paletteResults = paletteSearch($('#paletteInput')?.value || '');
    if (paletteIndex >= paletteResults.length) paletteIndex = Math.max(0, paletteResults.length - 1);
    const box = $('#paletteResults');
    if (!box) return;
    box.innerHTML = paletteResults.length
      ? paletteResults
          .map(
            (item, i) =>
              `<button type="button" class="palette-item" role="option" data-palette-i="${i}" aria-selected="${i === paletteIndex}">
                <span class="palette-kind">${esc(PALETTE_KIND[item.kind] || item.kind)}</span>
                <span class="palette-name">${esc(item.name)}</span>
                <span class="palette-sub">${esc(item.sub || '')}</span>
              </button>`,
          )
          .join('')
      : '<div class="empty" style="padding:18px;font-size:12px">没有匹配的记录。</div>';
  }

  function openPalette() {
    if (paletteOpen) return;
    paletteOpen = true;
    paletteIndex = 0;
    const box = $('#palette');
    const overlay = $('#paletteOverlay');
    if (!box) return;
    box.hidden = false;
    box.setAttribute('aria-hidden', 'false');
    if (overlay) {
      overlay.hidden = false;
      overlay.dataset.open = '1';
    }
    const input = $('#paletteInput');
    if (input) {
      input.value = '';
      input.focus();
    }
    paintPalette();
  }

  function closePalette({ restore = true } = {}) {
    if (!paletteOpen) return;
    paletteOpen = false;
    const box = $('#palette');
    const overlay = $('#paletteOverlay');
    if (box) {
      box.hidden = true;
      box.setAttribute('aria-hidden', 'true');
    }
    if (overlay) {
      overlay.hidden = true;
      overlay.dataset.open = '0';
    }
    if (restore) $('#paletteInput')?.blur();
  }

  function paletteJump(item) {
    if (!item) return;
    closePalette({ restore: false });
    if (item.kind === 'model') {
      state.tab = 'compare';
      state.cmpView = 'models';
      state.q = item.name;
      render();
      if (item.id) setTimeout(() => openDrawer(item.id), 0);
      return;
    }
    if (item.kind === 'vendor') {
      state.tab = 'compare';
      state.cmpView = 'vendors';
      state.q = '';
      render();
      setTimeout(() => {
        const row = [...document.querySelectorAll('tr[data-vendor]')].find(
          (tr) => tr.dataset.vendor === item.name,
        );
        row?.scrollIntoView({ block: 'center' });
      }, 0);
      return;
    }
    if (item.kind === 'offer') {
      state.tab = 'free';
      state.region = 'all';
      state.cat = 'all';
      render();
      return;
    }
    if (item.kind === 'tool') {
      state.tab = 'tools';
      state.toolKind = 'all';
      render();
    }
  }

  function movePalette(delta) {
    if (!paletteResults.length) return;
    paletteIndex = (paletteIndex + delta + paletteResults.length) % paletteResults.length;
    paintPalette();
    const active = document.querySelector('.palette-item[aria-selected="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }

  /* 「NEW」判定（T5.9）。
   *
   * 旧实现用 Date.now()：违反 INV-7（同一输入两次运行结论可能不同），
   * 而且 fixtures 的 created 都是近期值，于是 481 行全标 NEW —— 徽标失去意义。
   *
   * 现在用**数据的采集日期**当参照，而不是当前时刻：
   * 「过去 14 天内新增」相对的是这批数据的时点，不是读者看页面的时点。
   * 这样同一份数据无论什么时候看，徽标都一样。 */
  /** 这批数据的采集时刻（毫秒）。没有就用 0，调用方据此降级。 */
  const dataMoment = () => {
    const g = Date.parse(state.data?.meta?.generated_at || '');
    if (Number.isFinite(g)) return g;
    const d = state.data?.meta?.date;
    const t = d ? Date.parse(d + 'T00:00:00Z') : NaN;
    return Number.isFinite(t) ? t : 0;
  };

  const dataDay = () => {
    const d = state.data?.meta?.date || state.data?.meta?.generated_at?.slice(0, 10);
    const t = d ? Date.parse(d + 'T00:00:00Z') : NaN;
    return Number.isFinite(t) ? t / 1000 : null;
  };

  const isNew = (m) => {
    if (!m.created) return false;
    const day = dataDay();
    if (day == null) return false;
    return day - m.created < 14 * 86400 && day - m.created >= 0;
  };

  /* 有效成本：公式与画像都在 lib/cost.js（F36）。这里只负责把滑杆的值揉成画像。 */
  function effort(m) {
    if (m.input == null) return null;
    return costOf(
      { kind: 'per_1m', input: m.input, output: m.output, cacheRead: m.cache_read },
      { h: state.hit, s: state.outShare, w: 0 },
    );
  }

  /* ── chrome ── */
  function renderNav() {
    const c = state.data.meta.counts;
    // 情报这一格的数字以前是「要闻 + 信号」的条数之和，归档扩到 2000+ 之后会把导航撑爆，
    // 而且条数本来也不是这一页的重点——换成跨度天数，和页面右上角的口径一致。
    const newsIdx = Array.isArray(state.data?.news) ? null : state.data?.news || {};
    const counts = {
      free: c.offers,
      /* 导航上每个数字都要有来源（T5.9 · S9.10）。
       * 曾经这几项对不上：c.bench 不存在（真名是 benchBoards）、
       * c.subsRegions 只在订阅层成功时才有。
       * 现在一律「有就用，没有就退回一个真实存在过的量，都没有就不显示」。 */
      compare: c.models,
      subs: c.subsRegions ?? c.subs,
      relays: c.relaysLive ?? c.relays,
      events: c.eventsOpen ?? c.events,
      bench: c.benchBoards,
      tools: c.resources,
      signals: newsIdx ? `${newsIdx.span || 0}天` : (c.news ?? 0) + (c.signals ?? 0),
    };
    /* 只渲染有数字的项：拿不到数字就不显示，而不是显示空白（S9.10）。 */
    const el = $('#nav');
    el.innerHTML = TABS.map(
      (t) => `
      <button class="nav" role="tab" data-tab="${t.id}" aria-selected="${state.tab === t.id}" title="${esc(t.hint)}">
        ${esc(t.label)}${counts[t.id] != null ? `<sup>${esc(counts[t.id])}</sup>` : ''}
      </button>`,
    ).join('');
    // 只有当前 tab 真的超出可视区才滚，避免把左边项顶出去
    const on = el.querySelector('[aria-selected="true"]');
    if (on && el.scrollWidth > el.clientWidth) {
      const l = on.offsetLeft,
        r = l + on.offsetWidth;
      const viewL = el.scrollLeft,
        viewR = viewL + el.clientWidth;
      if (l < viewL || r > viewR) {
        el.scrollLeft = l - (el.clientWidth - on.offsetWidth) / 2;
      }
    }
  }

  function renderKpis() {
    const d = state.data,
      c = d.meta.counts;
    const offers = d.offers || [];
    const evKind = evBy('kind');
    const res = d.resources || [];
    const useCount = {};
    for (const r of res) useCount[r.use] = (useCount[r.use] || 0) + 1;
    // 情报层现在是索引（条数/天数/跨度/重大），完整条目不在 data.json 里
    const ni = Array.isArray(d.news)
      ? { n: d.news.length, days: 0, span: 0, major: 0 }
      : d.news || {};
    const sig = d.signals || [];
    const live = (d.relays || []).filter((r) => r.status === 'ok');
    const best = d.meta.bestCacheDiscount;
    // 最低价取「代表分组价」与「最低可达分组价」中更低的那个，并记下是哪种，
    // 否则首页会显示 $1.60 却不说它要特定分组权限。
    const cheapestSonnet = live
      .map((r) => {
        const p = r.prices?.sonnet55;
        if (!p || p.kind !== 'per_1m' || p.anomaly) return null;
        const floor = p.floor?.input;
        const low = floor != null && floor < p.input ? floor : p.input;
        return { r, p, low, viaFloor: low !== p.input, grp: p.floor?.group };
      })
      .filter(Boolean)
      .sort((a, b) => a.low - b.low)[0];
    const paid = (d.models || []).filter((m) => !m.free && m.input != null);
    const _minIn = paid.reduce((a, b) => (a && a.input <= b.input ? a : b), null);
    // 评测层已升级成多榜结构（catalog + stats），不再有单一 rows
    const benchRows = d.bench?.rows || [];
    const benchStats = d.bench?.stats || {};
    const benchCat = d.bench?.catalog || [];
    const benchSources = d.bench?.sources || [];

    // 每个页面只挂跟自己相关的数字，不再全局重复同一组
    const cellsByTab = {
      // 总览页的四个关键事实：文案与 viewHome 的 .home-facts 逐字一致，
      // 这样首屏可以先出 KPI，入口卡在数据到达后补（T1.1 的 CLS）。
      home: [
        [
          '今日最低 Sonnet',
          cheapestSonnet ? `$${cheapestSonnet.low.toFixed(2)}` : '—',
          cheapestSonnet ? `${esc(cheapestSonnet.r.name)} · /1M 输入` : '',
        ],
        ['缓存最狠', best ? `${best.pct}%` : '—', best ? esc(best.id) : ''],
        ['能白嫖', c.offers, `个渠道 · 国内 ${offers.filter((o) => o.region === 'CN').length}`],
        ['开放活动', c.eventsOpen, `共收录 ${c.events} 条`],
      ],
      free: [
        [
          '免费额度',
          c.offers,
          `${offers.filter((o) => o.region === 'GLOBAL').length} 国际 · ${offers.filter((o) => o.region === 'CN').length} 国内`,
        ],
        ['赠送金', offers.filter((o) => o.category === 'api-credit').length, '注册即送额度'],
        ['免费模型', offers.filter((o) => o.category === 'api-free-models').length, '可直接调 API'],
        [
          '长期有效',
          offers.filter((o) => String(o.free_scope || '').includes('长期')).length,
          '不靠限时活动',
        ],
      ],
      compare: [
        ['可计价模型', c.models, `${c.vendors} 家厂商`],
        ['官方直连', c.direct, '人工核实定价页'],
        ['带缓存价', c.withCache, '命中/写入分开列'],
        ['最大缓存折扣', best ? `${best.pct}%` : '—', best ? best.id : ''],
      ],
      subs: [
        ['官方档位', c.subs, '官网能直接读到的月费'],
        ['区价套餐', c.subsRegions, `${c.subsRegionsRaw} 条国家价`],
        ['第三方挂单', c.subsThird, '只给区间'],
        [
          '最低区价',
          (d.subsRegions || []).length
            ? `¥${Math.min(...d.subsRegions.map((g) => g.cheapest))}`
            : '—',
          'App Store 折人民币',
        ],
      ],
      relays: [
        ['在册站点', c.relays, '公开价目接口'],
        ['有价目', c.relaysLive, '其余需登录，不猜'],
        ['可比单价', c.relayComparable || 0, '能折成同一口径的站'],
        [
          'Sonnet 5.5 最低',
          cheapestSonnet
            ? '$' +
              (cheapestSonnet.low >= 100
                ? cheapestSonnet.low.toFixed(0)
                : cheapestSonnet.low.toFixed(2))
            : '—',
          cheapestSonnet
            ? `${cheapestSonnet.r.name}${cheapestSonnet.viaFloor ? ` · ${cheapestSonnet.grp || '特殊分组'}` : ''}`
            : '',
        ],
      ],
      // 类型分布跟着真实数据走：某一类归零就不占位，新增的类型自己出现
      events: [
        ['开放中', c.eventsOpen, `共收录 ${c.events} 条`],
        ...[...new Set([...Object.keys(EV_KIND), ...Object.keys(evKind)])]
          .filter((k) => evKind[k])
          .sort((a, b) => (evKind[b] || 0) - (evKind[a] || 0) || String(a).localeCompare(String(b)))
          .slice(0, 3)
          .map((k) => [EV_LABEL(EV_KIND, k), evKind[k], '']),
      ],
      tools: [
        ['收录', c.resources || 0, '人工精选，非按星数'],
        ['设计', useCount.design || 0, '视觉与排版'],
        ['工程', useCount.engineering || 0, '安全与构建'],
        ['调研', useCount.research || 0, '情报与 OSINT'],
      ],
      bench: [
        [
          '收录模型',
          benchStats.models || benchRows.length,
          benchStats.boards ? `${benchStats.boards} 个榜` : 'Vals Index 公开分',
        ],
        [
          '分数条目',
          benchStats.rows ? kfmt(benchStats.rows) : benchRows.length ? benchRows.length : '—',
          `${benchSources.filter((x) => x.ok).length}/${benchSources.length || 0} 源正常`,
        ],
        ['数据日期', d.bench?.as_of || '—', '每次采集存快照'],
        ['榜单', benchStats.boards || benchCat.length, '9 个公开源'],
      ],
      signals: [
        ['归档', ni.n || 0, `跨度 ${ni.span || 0} 天`],
        [
          '有内容的日子',
          ni.days || 0,
          `平均每天 ${ni.days ? Math.round((ni.n || 0) / ni.days) : 0} 条`,
        ],
        ['重大', ni.major || 0, `共 ${ni.n || 0} 条`],
        ['一手信号', sig.length, 'X 与官方博客'],
        ['最近', (ni.last || '').slice(5) || '—', '归档最近一天'],
        ['最早', (ni.first || '').slice(5) || '—', '归档起点'],
      ],
      method: [
        ['登记来源', c.sources, '每条数据可回溯'],
        ['数据层', 8, '额度 / 价 / 订阅 / 中转 / 活动 / 工具箱 / 评测 / 情报'],
        ['去重丢弃', d.meta.dedupe?.unpriced_dropped ?? 0, '无价条目直接剔'],
        ['更新频率', '每日', 'UTC 01:00'],
      ],
    };

    const cells = cellsByTab[state.tab] || cellsByTab.free;
    const el = $('#kpis');
    el.innerHTML = cells
      .map(
        ([k, n, s]) => `
      <div class="kpi"><div class="k">${esc(k)}</div><div class="n">${esc(n)}</div><div class="s"${s ? ` title="${esc(s)}"` : ''}>${esc(s || '')}</div></div>`,
      )
      .join('');
    el.style.display = cells.length ? '' : 'none';
    // 情报页要的是「一条横条 + 一大段列表」，KPI 摊成两行会白吃掉半屏
    el.classList.toggle('is-tight', state.tab === 'signals');
  }

  function renderHero() {
    const h = HERO[state.tab] || HERO.free;
    $('#heroKicker').textContent = h.k;
    $('#heroTitle').innerHTML = h.t;
    // 文案里的统计数字一律来自数据（INV-5）：把手写的数字换成当前快照的计数
    const subs = String(h.s || '')
      .replace('__BENCH_SOURCES__', String(state.data?.meta?.counts?.benchSources ?? '—'))
      .replace('__BENCH_ROWS__', String(state.data?.meta?.counts?.benchRows ?? '—'));
    $('#heroSub').textContent = subs;
    $('#stamp').textContent =
      '更新 ' +
      new Date(state.data.meta.generated_at).toLocaleString('zh-CN', { hour12: false }).slice(5);
    const hero = $('#hero');
    hero.classList.remove('home-hero-skel');
    hero.removeAttribute('aria-busy');
    hero.classList.toggle('compact', state.tab !== 'free');
    hero.classList.toggle('is-hidden', state.tab === 'home');
  }

  /* ── compare ── */
  function vendorOptions() {
    return (
      `<option value="all">全部厂商</option>` +
      state.data.meta.vendors
        .map(
          (v) =>
            `<option value="${esc(v)}"${state.vendor === v ? ' selected' : ''}>${esc(v)}</option>`,
        )
        .join('')
    );
  }

  function filteredModels() {
    const q = state.q.trim().toLowerCase();
    const rows = state.data.models.filter((m) => {
      if (state.vendor !== 'all' && m.vendor !== state.vendor) return false;
      if (state.band !== 'all' && m.band !== state.band) return false;
      if (state.channel !== 'all' && m.channelKind !== state.channel) return false;
      if (state.freeOnly && !m.free) return false;
      if (state.paidOnly && m.free) return false;
      if (state.cacheOnly && m.cache_read == null) return false;
      if (q && !`${m.id} ${m.name} ${m.vendor}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const dir = state.sortDir,
      key = state.sortKey;
    const val = (m) => {
      if (key === 'eff') {
        const e = effort(m);
        return e == null ? Infinity : e;
      }
      // 折扣 = 缓存读相对输入价的百分比；缓存读列本身就是价格，两者不能共用一个键（F18）
      if (key === 'cache')
        return m.cache_read == null || !m.input ? Infinity : m.cache_read / m.input;
      if (key === 'cache_read') return m.cache_read == null ? Infinity : m.cache_read;
      if (key === 'name') return m.name.toLowerCase();
      if (key === 'vendor') return m.vendor.toLowerCase();
      return m[key] == null ? Infinity : m[key];
    };
    rows.sort((a, b) => {
      if (key === 'focus') {
        const ra = rankOf(a.vendor),
          rb = rankOf(b.vendor);
        if (ra !== rb) return ra - rb;
        const ca = a.created || 0,
          cb = b.created || 0;
        if (ca !== cb) return cb - ca;
        return (a.input ?? 9e9) - (b.input ?? 9e9);
      }
      const va = val(a),
        vb = val(b);
      if (typeof va === 'string') return va.localeCompare(vb) * dir;
      return (va - vb) * dir;
    });
    return rows;
  }

  function th(key, label, num, mob) {
    const active = state.sortKey === key;
    return `<th class="${num ? 'num' : ''}${key === 'ctx' || key === 'cache_write' || mob ? ' hidesm' : ''}"
      data-sort="${key}" tabindex="0"
      aria-sort="${active ? (state.sortDir === 1 ? 'ascending' : 'descending') : 'none'}"
      aria-label="按${esc(label)}排序">${esc(label)}${active ? `<i>${state.sortDir === 1 ? '▲' : '▼'}</i>` : ''}</th>`;
  }

  function modelRows() {
    const rows = filteredModels();
    const bestByFamily = new Map(),
      bestIdOfFamily = new Map(),
      familySize = new Map(),
      secondByFamily = new Map();
    for (const m of rows) familySize.set(m.family, (familySize.get(m.family) || 0) + 1);
    for (const m of rows) {
      if (m.free) continue;
      const e = effort(m);
      if (e == null) continue;
      const cur = bestByFamily.get(m.family);
      if (cur == null || e < cur) {
        if (cur != null) secondByFamily.set(m.family, cur);
        bestByFamily.set(m.family, e);
        bestIdOfFamily.set(m.family, m.id);
      } else if (e > cur) {
        const s2 = secondByFamily.get(m.family);
        if (s2 == null || e < s2) secondByFamily.set(m.family, e);
      }
    }
    const betterFamily = new Set();
    for (const [k, v] of bestByFamily) {
      const s2 = secondByFamily.get(k);
      if (s2 != null && v < s2 * 0.98) betterFamily.add(k);
    }
    const shown = rows.slice(0, state.limit);
    const tbody =
      rows.length === 0
        ? `<tr><td colspan="10" class="empty"><b>没有匹配的模型</b>换个关键词，或把价格带切回「全部」。</td></tr>`
        : shown
            .map((m) => {
              const e = effort(m);
              const isBest =
                !m.free && betterFamily.has(m.family) && bestIdOfFamily.get(m.family) === m.id;
              const disc = m.cache_read != null && m.input ? 1 - m.cache_read / m.input : null;
              return `<tr data-id="${esc(m.id)}" tabindex="0">
            <td><div class="mname">${m.free ? '<span class="tag free">免费</span>' : ''}${isNew(m) ? '<span class="tag new">NEW</span>' : ''}
              <span class="txt">${esc(m.name)}</span><span class="id hidesm">${esc(m.id)}</span>${isBest ? '<span class="tag direct">最低</span>' : ''}</div></td>
            <td class="vend hidesm">${esc(m.vendor)}</td>
            <td class="num hidesm">${ctx(m.ctx)}</td>
            <td class="num">${m.free ? '<span class="best">0</span>' : money(m.input)}</td>
            <td class="num hidesm">${m.cache_read == null ? '<span class="dim">—</span>' : money(m.cache_read)}</td>
            <td class="num hidesm">${m.cache_write == null ? '<span class="dim">—</span>' : money(m.cache_write)}</td>
            <td class="num">${m.free ? '<span class="best">0</span>' : money(m.output)}</td>
            <td class="num hidesm">${disc == null ? '<span class="dim">—</span>' : `<span class="${disc > 0.5 ? 'best' : ''}">${pct(disc)}</span>`}</td>
            <td class="num">${e == null ? '—' : money(e)}</td>
            <td class="src hidesm">${extLink(m.url, `<span class="conf ${esc(m.conf)}" title="${esc(confTitle[m.conf] || '')}"></span>${m.channelKind === 'direct' ? '官方' : '聚合'} ↗`)}</td>
          </tr>`;
            })
            .join('');
    const tfoot = `<span>显示 ${shown.length} / ${rows.length} 条 · ${state.sortKey === 'focus' ? '主流优先（大厂在前、新模型在前）' : `按所选列${state.sortDir === 1 ? '升序' : '降序'}`}</span>
      ${rows.length > shown.length ? `<button class="more" id="moreBtn" type="button">再加载 ${Math.min(120, rows.length - shown.length)} 条</button>` : ''}
      <span class="spacer"></span><span>单位 $ / 1M tokens</span>`;
    return { rows, tbody, tfoot };
  }

  const cmpSwitch = () => `<div class="controls" style="padding-bottom:0">
      <div class="chips" role="group" aria-label="视图">
        <button class="chip" data-cmpview="models" aria-pressed="${state.cmpView === 'models'}">按模型</button>
        <button class="chip" data-cmpview="vendors" aria-pressed="${state.cmpView === 'vendors'}">按厂商</button>
      </div>
      <span class="spacer"></span>
      <span class="eyebrow">${state.cmpView === 'models' ? `${state.data.meta.counts.models} 个可计价模型` : `${state.data.meta.counts.vendors} 家厂商`}</span>
    </div>`;

  function viewCompare() {
    if (state.cmpView === 'vendors') return cmpSwitch() + viewVendors();
    const { tbody, tfoot } = modelRows();
    return (
      cmpSwitch() +
      `

      <div class="controls">
        <label class="search"><span class="eyebrow">FIND</span>
          <input id="q" type="search" placeholder="模型 / 厂商 / id，例如 claude、deepseek、free" value="${esc(state.q)}" autocomplete="off">
          <kbd>/</kbd>
        </label>
        <select class="sel" id="vendor" aria-label="厂商">${vendorOptions()}</select>
        <div class="chips" role="group" aria-label="价格带">
          ${[
            ['all', '全部'],
            ['free', '免费'],
            ['budget', '≤$0.25'],
            ['standard', '$0.25–1.5'],
            ['premium', '>$1.5'],
          ]
            .map(
              ([k, l]) =>
                `<button class="chip" data-band="${k}" aria-pressed="${state.band === k}">${l}</button>`,
            )
            .join('')}
        </div>
        <div class="chips">
          <button class="chip" data-sortkey="focus" aria-pressed="${state.sortKey === 'focus'}">主流优先</button>
          <button class="chip" data-sortkey="eff" aria-pressed="${state.sortKey === 'eff'}">按有效成本</button>
          <button class="chip" data-sortkey="input" aria-pressed="${state.sortKey === 'input'}">按输入价</button>
        </div>
        <div class="chips">
          <button class="chip" data-channel="all" aria-pressed="${state.channel === 'all'}">全部渠道</button>
          <button class="chip" data-channel="aggregator" aria-pressed="${state.channel === 'aggregator'}">聚合</button>
          <button class="chip" data-channel="direct" aria-pressed="${state.channel === 'direct'}">官方直连</button>
          <button class="chip" data-toggle="freeOnly" aria-pressed="${state.freeOnly}">仅免费</button>
          <button class="chip" data-toggle="paidOnly" aria-pressed="${state.paidOnly}">仅付费</button>
          <button class="chip" data-toggle="cacheOnly" aria-pressed="${state.cacheOnly}">有缓存价</button>
        </div>
      </div>
      <div class="sliders">
        <div class="slider"><div class="row"><span class="eyebrow">缓存命中率</span><output id="hitOut">${pct(state.hit)}</output></div>
          <input type="range" id="hit" min="0" max="100" step="5" value="${Math.round(state.hit * 100)}" aria-label="缓存命中率"></div>
        <div class="slider"><div class="row"><span class="eyebrow">输出 token 占比</span><output id="outOut">${pct(state.outShare)}</output></div>
          <input type="range" id="outShare" min="5" max="80" step="5" value="${Math.round(state.outShare * 100)}" aria-label="输出占比"></div>
        <div class="formula">有效成本 = <b>${esc(FORMULA_ZH)}</b> / 1M tokens
          <span class="dim">· 比价口径 ${esc(profileOf('compare').label)}（h=${pct(profileOf('compare').h)}，s=${pct(profileOf('compare').s)}）</span></div>
      </div>
      <div class="tablewrap" tabindex="0" role="region" aria-label="数据表，可横向滚动">
        <table><caption class="sr">模型 token 价格对比</caption>
          <thead><tr>
            ${th('name', '模型')}${th('vendor', '厂商', false, true)}${th('ctx', '上下文', true)}${th('input', '输入', true)}
            ${th('cache_read', '缓存读', true, true)}${th('cache_write', '缓存写', true)}${th('output', '输出', true)}
            ${th('cache', '折扣', true, true)}${th('eff', '有效成本', true)}<th class="hidesm">来源</th>
          </tr></thead>
          <tbody id="tbody">${tbody}</tbody>
        </table>
      </div>
      <div class="tfoot" id="tfoot">${tfoot}</div>`
    );
  }

  function paintRows() {
    const { tbody, tfoot } = modelRows();
    const tb = $('#tbody');
    if (tb) tb.innerHTML = tbody;
    const tf = $('#tfoot');
    if (tf) tf.innerHTML = tfoot;
  }

  /* ── home ── */
  function viewHome() {
    const d = state.data,
      c = d.meta.counts,
      _fx = state.fx?.rate || d.meta.fx.USDCNY;
    const pricedArr = (d.models || [])
      .filter((m) => m.input > 0)
      .map((m) => m.input)
      .sort((a, b) => a - b);
    const priced = pricedArr.length;
    const q25 = pricedArr[Math.floor(priced * 0.25)] || 0;
    const _q75 = pricedArr[Math.floor(priced * 0.75)] || 0;
    const q50 = pricedArr[Math.floor(priced * 0.5)] || 0;
    const q90 = pricedArr[Math.floor(priced * 0.9)] || 0;
    const pmin = pricedArr[0] || 0;
    const pmax = pricedArr[priced - 1] || 1;
    const spread = pmin > 0 ? Math.round(pmax / pmin) : 1;
    // 首页要闻现在是「跨天挑选的重大条目」，不再只取今天那四条：
    // data.json 只带索引，所以首屏先按索引出占位，归档拉到后自动补成真标题。
    const newsTop = Array.isArray(state.newsFull)
      ? state.newsFull
          .filter((n) => n.importance === 'major')
          .sort((a, b) => b.date.localeCompare(a.date) || (b.score ?? 0) - (a.score ?? 0))
          .slice(0, 4)
      : [];
    const news = newsTop.length ? newsTop : (Array.isArray(d.news) ? d.news : []).slice(0, 4);
    const ni0 = Array.isArray(d.news) ? { n: d.news.length } : d.news || {};
    // 「近期重大」的数量与跨度首屏就要看见，不能等归档（约 2.3k 条）到达后才排版：
    // 那是 F21 的布局跳动来源，也是归档失败时整块消失的原因。
    // 归档到了用归档的头部（n / span），没到用 data.json 索引；两者都没有就退回 major 计数。
    const nHead =
      Array.isArray(state.newsFull) && state.newsFull.length
        ? { n: state.newsFull.length, span: null }
        : { n: ni0.n || c.news || news.length, span: ni0.span || 0 };
    // 索引里没有 span（归档形态），就按日期跨度现算；归档没到时不编数字，留空。
    const nSpan = nHead.span != null ? nHead.span : newsSpanDays(state.newsFull);

    const live = (d.relays || []).filter((r) => r.status === 'ok');
    const best = live
      .map((r) => ({ r, p: r.prices?.sonnet55 }))
      .filter((x) => x.p && x.p.kind === 'per_1m' && !x.p.anomaly)
      .sort((a, b) => a.p.input - b.p.input)[0];
    const cache = d.meta.bestCacheDiscount;
    const _openEvents = (d.events || []).filter((e) => e.status !== 'past');
    const _cheapestModel = (d.models || [])
      .filter((m) => m.input > 0)
      .sort((a, b) => a.input - b.input)[0];

    const entries = [
      { id: 'free', n: c.offers, u: '个渠道', t: '免费额度', d: '还在送额度的产品' },
      { id: 'compare', n: c.models, u: '个模型', t: '比价', d: '官方 / 聚合 / 中转' },
      { id: 'subs', n: c.subsRegionsRaw, u: '条区价', t: '订阅', d: '官方 + 各区 + 挂单' },
      {
        id: 'relays',
        n: c.relaysLive,
        u: '站有价目',
        t: '中转站',
        d: '接口能读到价才算',
      } /* 见 viewRelays 的 chips */,
      { id: 'events', n: c.eventsOpen, u: '个开放', t: 'AI 活动', d: '黑客松 / 会议 / meetup' },
      { id: 'tools', n: c.resources || 0, u: '个精选', t: '工具箱', d: '稀缺 skill / CLI' },
      { id: 'bench', n: c.bench, u: '个榜', t: '评测', d: '同一批题目的分数' },
      { id: 'signals', n: (c.news || 0) + c.signals, u: '条信息', t: '情报', d: '要闻 + X 一手' },
    ];

    return `
      <section class="home-top">
        <div class="home-lead">
          <h2 class="home-h">AI 的价、量、场，<br>一个入口看完。</h2>
          <p class="home-sub">白嫖额度、token 单价、订阅区价、中转报价、活动、工具箱与评测——八层数据同一套口径，每天自动重采一遍。</p>
          <div class="home-facts">
            <div><span class="fk">今日最低 Sonnet</span><span class="fv">${best ? `$${best.p.input.toFixed(2)}` : '—'}</span><span class="fd">${best ? `${esc(best.r.name)} · /1M 输入` : ''}</span></div>
            <div><span class="fk">缓存最狠</span><span class="fv">${cache ? `${cache.pct}%` : '—'}</span><span class="fd">${cache ? esc(cache.id) : ''}</span></div>
            <div><span class="fk">能白嫖</span><span class="fv">${c.offers}</span><span class="fd">个渠道 · 国内 ${(d.offers || []).filter((o) => o.region === 'CN').length}</span></div>
            <div><span class="fk">开放活动</span><span class="fv">${c.eventsOpen}</span><span class="fd">共收录 ${c.events} 条</span></div>
          </div>
        </div>

      </section>

      <section class="story" id="story">
        <div class="story-track">
          <div class="story-pin">
            <div class="story-cap">
              <h2>${priced} 个有价模型，价格相差 <em>${spread >= 10000 ? `${(spread / 10000).toFixed(1)} 万倍` : `${spread} 倍`}</em>。</h2>
              <p class="story-line" data-step="0">从 $${money(pmin)} 到 $${money(pmax)}，每一点是一个模型的官方输入价。</p>
              <p class="story-line" data-step="1">四分之一的模型，输入价低于 <b>$${money(q25)}</b>。</p>
              <p class="story-line" data-step="2">一半低于 <b>$${money(q50)}</b>。</p>
              <p class="story-line" data-step="3">最贵的 10% 都在 <b>$${money(q90)}</b> 以上。</p>
            </div>
            <svg id="priceAxis" viewBox="0 0 1200 260" preserveAspectRatio="xMidYMid meet" role="img" aria-label="模型价格分布"></svg>
            <div class="story-rail"><i id="storyRail"></i></div>
            <div class="axfoot"><span>每 1M 输入 token · USD</span><span>向下滚动</span></div>
          </div>
        </div>
      </section>

      <div class="shead"><h2>近期重大</h2><span class="right"><a href="#signals" style="color:var(--dim);text-decoration:underline">全部 ${nHead.n} 条${nSpan ? ` · 跨度 ${nSpan} 天` : ''} ↗</a></span></div>
      ${
        news.length
          ? `<div class="newsrow">
        ${news
          .map(
            (n) => `
          <article class="ncard">
            <div class="nmeta"><span class="ntopic">${esc(n.topicLabel || '其他')}</span><span class="ndate">${esc((n.date || '').slice(5))}${n.time ? ` ${esc(n.time)}` : ''}</span></div>
            <h3>${extLink(n.url, esc(n.title))}</h3>
            ${n.summary ? `<p class="nclamp">${esc(n.summary)}</p>` : ''}
          </article>`,
          )
          .join('')}
      </div>`
          : `<div class="newsrow newsrow-skel" aria-hidden="true">
        ${[0, 1, 2, 3].map(() => `<article class="ncard ncard-skel"></article>`).join('')}
      </div>`
      }

      <div class="shead"><h2>三条结论</h2></div>
      <div class="threeways">
        <a class="tway" href="#free"><h4>先把免费的用完</h4><p>${c.offers} 个渠道在送额度，其中 ${(d.offers || []).filter((o) => o.region === 'CN').length} 个国内可直接注册；按额度大小和期限排序，别只看广告词。</p><span class="tl">看免费额度</span></a>
        <a class="tway" href="#compare"><h4>再挑最便宜那条价</h4><p>${c.models} 个模型里 ${c.withCache} 个带缓存价；把命中率拉满，${cache ? `${esc(cache.id)} 能省 ${cache.pct}%` : '缓存价能再压一截'}。</p><span class="tl">进比价表</span></a>
        <a class="tway" href="#relays"><h4>官方太贵就走中转</h4><p>${c.relaysLive} 个站能读到公开价目，${c.relayComparable || 0} 家能折成同一口径。同一模型最高比官方贵 ${(() => {
          const v = (state.data.relays || [])
            .filter((r) => r.status === 'ok')
            .map((r) => r.prices?.sonnet55?.vsOfficial)
            .filter((x) => x && x > 1.05);
          return v.length ? `${v.sort((a, b) => b - a)[0].toFixed(1)} 倍` : '—';
        })()}；接口披露价，不含充值折扣。</p><span class="tl">看中转行情</span></a>
      </div>

      <div class="shead"><h2>八层入口</h2></div>
      <div class="entries">
        ${entries
          .map(
            (e) => `
          <a class="ecard" href="#${e.id}">
            <div class="ecard-top"><span class="et">${esc(e.t)}</span><span class="eu">${e.n}<em>${esc(e.u)}</em></span></div>
            <p>${esc(e.d)}</p>
            <span class="earrow">↗</span>
          </a>`,
          )
          .join('')}
      </div>

      <div class="home-foot">
        <span>${c.vendors} 家厂商 · ${c.models} 个模型 · ${c.relays} 个中转站在册 · ${c.sources} 个来源</span>
        <span>每天 09:00 自动采集 · <a href="#method" style="color:var(--dim);text-decoration:underline">口径说明 ↗</a></span>
      </div>`;
  }

  /* ── free ── */
  function viewFree() {
    const offers = state.data.offers;
    if (!offers.length)
      return `<div class="empty"><b>免费额度这一层还没入库</b>运行 <code>node collect.mjs</code>。</div>`;
    const active = offers.filter((o) => o.status !== 'archived');
    const archived = offers.filter((o) => o.status === 'archived');
    const cats = [...new Set(active.map((o) => o.category))];
    const filtered = active.filter(
      (o) =>
        (state.region === 'all' || o.region === state.region || o.region === 'BOTH') &&
        (state.cat === 'all' || o.category === state.cat),
    );
    const list = state.offerSort === 'value' ? sortByQuotaValue(filtered) : filtered;
    return `
      <div class="controls">
        <div class="chips" role="group" aria-label="地区">
          ${[
            ['all', '全部'],
            ['GLOBAL', '国际'],
            ['CN', '国内'],
          ]
            .map(
              ([k, l]) =>
                `<button class="chip" data-region="${k}" aria-pressed="${state.region === k}">${l}</button>`,
            )
            .join('')}
        </div>
        <div class="chips" role="group" aria-label="类型">
          <button class="chip" data-cat="all" aria-pressed="${state.cat === 'all'}">全部类型</button>
          ${cats.map((c) => `<button class="chip" data-cat="${esc(c)}" aria-pressed="${state.cat === c}">${esc(catLabel(c))}</button>`).join('')}
        </div>
        <div class="chips" role="group" aria-label="额度排序">
          <button class="chip" data-offersort="default" aria-pressed="${state.offerSort === 'default'}">默认顺序</button>
          <button class="chip" data-offersort="value" aria-pressed="${state.offerSort === 'value'}">按额度价值</button>
        </div>
        <span class="spacer"></span><span class="eyebrow">${list.length} 条在架${archived.length ? ` · ${archived.length} 条已结束` : ''}</span>
      </div>
      ${
        list.length === 0
          ? `<div class="empty">这个组合下没有渠道。</div>`
          : `
      <div class="grid">
        ${list
          .map(
            (o) => `
          <article class="card">
            <div class="hd">
              <div style="flex:1;min-width:0">
                <h3>${esc(o.product)}</h3>
                <div class="sub">${esc(o.vendor || '')} · ${esc(catLabel(o.category))}</div>
              </div>
              <span class="tag ${o.region === 'GLOBAL' ? 'direct' : ''}">${esc(REGION_LABEL[o.region] || o.region || '—')}</span>
            </div>
            <p>${esc(o.claim)}</p>
            <dl>
              <dt>额度</dt><dd class="mono" style="font-size:12px" title="${esc(o.quota_raw || '')}">${esc(quotaLabel(o.quota) || o.quota_raw || '未公开')}</dd>
              <dt>期限</dt><dd>${esc(o.free_scope || '—')}</dd>
              ${(o.models || []).length ? `<dt>模型</dt><dd><div class="mchips">${o.models.map((m) => `<span class="mchip">${esc(m)}</span>`).join('')}</div></dd>` : ''}
              ${o.requirements ? `<dt>门槛</dt><dd>${esc(o.requirements)}</dd>` : ''}
              ${o.price_after && o.price_after !== '未公开' ? `<dt>之后</dt><dd class="mono" style="font-size:11.5px">${esc(o.price_after)}</dd>` : ''}
            </dl>
            <div class="foot">
              ${(o.sources?.length ? o.sources : [o.source])
                .slice(0, 3)
                .map(
                  (u, i) =>
                    `<a href="${esc(u)}" target="_blank" rel="noopener">${i === 0 ? '来源' : esc(hostOf(u))} ↗</a>`,
                )
                .join('')}
              ${(o.entries || []).map((e) => `<span class="tag">${esc(e)}</span>`).join('')}
              ${o.conf && o.conf !== 'high' ? `<span class="tag ${o.conf === 'low' ? 'warn' : ''}" title="信源置信度">${o.conf === 'low' ? '待核实' : '部分核实'}</span>` : ''}
              ${reportLink('offer', o.id || o.product, o.source, '报错')}
            </div>
          </article>`,
          )
          .join('')}
      </div>`
      }
      ${archived.length ? `<div class="shead" style="padding-top:26px"><h2>已结束</h2><span class="right">${archived.length} 条</span></div><div class="grid">${archived.map((o) => `<article class="card"><div class="hd"><div style="flex:1;min-width:0"><h3>${esc(o.product)}</h3><div class="sub">${esc(o.vendor || '')} · ${esc(o.expires_at || '已结束')}</div></div></div><p>${esc(o.claim || '')}</p></article>`).join('')}</div>` : ''}`;
  }

  /* ── subs ── */
  const fmtTokens = (n) =>
    n >= 1e9
      ? `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`
      : n >= 1e6
        ? `${(n / 1e6).toFixed(0)}M`
        : `${(n / 1e3).toFixed(0)}K`;

  function viewSubs() {
    const subs = state.data.subs;
    const byProduct = new Map();
    for (const s of subs) {
      const k = s.product;
      if (!byProduct.has(k)) byProduct.set(k, []);
      byProduct.get(k).push(s);
    }
    const routes = [
      ['官方直订', '官网绑卡自付，稳定、可开发票；国区常需外卡或海外号。', '无额外风险，价格最高'],
      [
        '低价区订阅',
        '土耳其 / 尼日利亚 / 印度等区定价更低，需要当地支付方式与账号一致性。',
        '封号与补差价风险',
      ],
      [
        '合租 / 拼车',
        '多人共享一个 Team 或 Pro 席位，按人头分摊；通常有设备与并发限制。',
        '隐私与稳定性风险',
      ],
      [
        '发卡 / 代充',
        '第三方平台按次卖账号、兑换码或代充，价格最杂，质量参差。',
        '跑路、封号、售后风险',
      ],
    ];
    // 官方标价 = 各套餐在美国区的价格（App Store 公开内购页），一档一行
    const officialByProductTier = new Map();
    const officialByProduct = new Map();
    for (const r of subs) {
      if (!r.official) continue;
      officialByProductTier.set(`${r.product}|${r.tier}`, r.official);
      if (!officialByProduct.has(r.product)) officialByProduct.set(r.product, []);
      officialByProduct.get(r.product).push(r.official);
    }
    const planRows = [];
    for (const g of state.data.subsRegions || []) {
      const us = (g.rows || []).find((r) => r.c === 'US');
      const usd = us ? Number(String(us.p).replace(/[^0-9.]/g, '')) : null;
      const tier = (String(g.plan).startsWith(g.app)
        ? String(g.plan).slice(g.app.length).trim() || g.plan
        : g.plan
      )
        .replace(/^(Google AI|SuperGrok|ChatGPT|Claude)\s+/i, '')
        .replace(/（/g, ' ')
        .replace(/）/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      planRows.push({
        product: g.app,
        vendor: '',
        tier,
        usd,
        duration: g.duration,
        lowestCny: g.cheapest,
        buy: us?.url || '',
        official: (() => {
          const exact = officialByProductTier.get(`${g.app}|${tier}`);
          if (exact) return exact;
          const list = officialByProduct.get(g.app) || [];
          return list.length === 1 ? list[0] : null;
        })(),
      });
    }
    const seenProducts = new Set(planRows.map((x) => x.product));
    for (const r of subs) {
      if (seenProducts.has(r.product)) continue; // 有区价数据的产品整族以区价为准
      planRows.push({
        product: r.product,
        vendor: r.vendor,
        tier: r.tier,
        usd: r.price,
        duration: r.period,
        lowestCny: null,
        buy: r.buy,
        note: r.note,
        quota: r.quota,
        official: r.official || null,
      });
    }
    // 等效 token：月费 ÷ 全站中位输入价，说明「这笔钱按 API 中位价能换多少 token」
    const allIn = (state.data.models || [])
      .filter((m) => m.input > 0)
      .map((m) => m.input)
      .sort((a, b) => a - b);
    const medianIn = allIn.length ? allIn[Math.floor(allIn.length / 2)] : 0;
    for (const r of planRows) {
      r.tokens =
        r.usd != null && medianIn > 0 && /月|month/i.test(r.duration || '月')
          ? (r.usd / medianIn) * 1e6
          : null;
    }

    const planByProduct = new Map();
    for (const r of planRows) {
      if (!planByProduct.has(r.product)) planByProduct.set(r.product, []);
      planByProduct.get(r.product).push(r);
    }

    return `
      <div class="shead"><h2>同一订阅，换个区多少钱</h2></div>
      <div class="sbars" id="subBars"></div>

      <div class="shead"><h2>官方标价</h2><span class="right">${planRows.length} 个档位</span></div>
      <div class="shop">
        ${[...planByProduct.entries()]
          .map(
            ([product, rows]) => `
          <section class="plan">
            <div class="ph"><h3>${esc(product)}</h3><span>${esc(rows[0].vendor || '')}</span></div>
            <div class="rows">
              ${rows
                .sort((a, b) => (a.usd ?? 9e9) - (b.usd ?? 9e9))
                .map(
                  (r) => `
                <div class="prow">
                  <span class="tier">${esc(r.tier)}</span>
                  <span class="quota" title="等效 ${r.tokens ? fmtTokens(r.tokens) : '—'} tokens（按全站中位输入价 $${money(medianIn)} / 1M 折算）">${r.tokens ? `${fmtTokens(r.tokens)} tokens` : '—'}</span>
                  <span class="p" title="${r.lowestCny ? `最低区价 ¥${Math.round(r.lowestCny)}` : ''}">${r.usd == null ? '<span class="dim">—</span>' : r.buy ? `<a href="${esc(r.buy)}" target="_blank" rel="noopener" style="text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--line2)">$${money(r.usd)}</a>` : `$${money(r.usd)}`}<small>${r.duration ? ` /${esc(r.duration)}` : ''}</small></span>
                  ${r.official ? `<span class="off">官网 ${r.official.price === r.usd ? '同价' : `$${money(r.official.price)}`} /${esc(r.official.period || '月')} <a href="${esc(safeUrl(r.official.url) || '#')}" target="_blank" rel="noopener">证据 ↗</a></span>` : ''}

                </div>`,
                )
                .join('')}
            </div>
          </section>`,
          )
          .join('')}
      </div>

      ${
        (state.data.subsRegions || []).length
          ? `
      <div class="shead"><h2>各区官方订阅价</h2><span class="desc">点任意一行直达对应区商店页。</span><span class="right">${state.data.meta.counts.subsRegions} 个套餐 · ${state.data.meta.counts.subsRegionsRaw} 条区价</span></div>
      <div class="regions">
        ${state.data.subsRegions
          .map(
            (g) => `
          <section class="region-card">
            <div class="rh"><h3>${esc(g.plan.startsWith(g.app) ? g.plan : g.app)}${g.plan.startsWith(g.app) ? '' : ` <em>${esc(g.plan)}</em>`}</h3><span>${esc(g.duration)} · ${g.total} 区</span></div>
            <div class="rrows">
              ${g.rows
                .slice(0, 6)
                .map(
                  (r, i) => `
                <a class="rrow${i === 0 ? ' low' : ''}" href="${esc(safeUrl(r.url) || '#')}"${safeUrl(r.url) ? ' target="_blank" rel="noopener"' : ''}>
                  <span class="idx">${i + 1}</span>
                  <span class="cty">${esc(r.n)}</span>
                  <span class="raw">${esc(r.p)}</span>
                  <span class="cny">¥${r.cny}</span>
                </a>`,
                )
                .join('')}
            </div>
            <div class="rfoot">最便宜 <b>¥${g.cheapest}</b> · 最贵 ¥${g.priciest}</div>
          </section>`,
          )
          .join('')}
      </div>`
          : ''
      }

      <div class="shead"><h2>买法（路子）</h2><span class="desc">价格之外的四个维度：门槛、稳定性、风险。第三方挂单价按下方的公开挂单页取样。</span></div>
      <div class="routes">
        ${routes.map(([name, desc, risk]) => `<div class="route"><h4>${esc(name)}</h4><p>${esc(desc)}</p><div class="risk">${esc(risk)}</div></div>`).join('')}
      </div>
      ${renderThirdStats()}`;
  }

  /**
   * 第三方挂单只呈现统计（D3 / F49）。
   *
   * 页面上不再出现任何发卡平台商品页链接——数据里也没有，
   * 所以这里没有「藏起来」的环节，是真的没有。
   * 区间比单条挂单更有用：读者要判断的是「行情在什么位置」，不是「买哪一条」。
   */
  function renderThirdStats() {
    const rows = state.data.subsThird || [];
    if (!rows.length) {
      return '<div class="empty"><b>这一版没有第三方挂单</b>上游挂单源本次没采到；官方档位与区价不受影响。</div>';
    }
    const totalListings = rows.reduce((n, x) => n + (x.listings || 0), 0);
    const totalStock = rows.reduce((n, x) => n + (x.inStock || 0), 0);
    const body = rows
      .map(
        (x) => `<tr>
      <td><b>${esc(x.product)}</b></td>
      <td class="num">${x.listings ?? '—'}</td>
      <td class="num">${x.inStock ?? '—'}</td>
      <td class="num hidesm">${x.platforms ?? '—'}</td>
      <td class="num">${x.min == null ? '—' : `¥${money(x.min)}`}</td>
      <td class="num">${x.median == null ? '—' : `¥${money(x.median)}`}</td>
      <td class="num">${x.max == null ? '—' : `¥${money(x.max)}`}</td>
    </tr>`,
      )
      .join('');
    return `<div class="shead"><h2>第三方挂单行情</h2><span class="desc">只给区间，不给链接。质保通常只有几小时，站点不推荐、不保证可用。</span><span class="right">${totalListings} 条挂单 · 在售 ${totalStock} · ${rows.length} 个产品</span></div>
      <div class="tablewrap" tabindex="0" role="region" aria-label="数据表，可横向滚动" style="max-height:620px">
        <table style="min-width:0"><caption class="sr">第三方订阅挂单的按产品统计</caption>
          <thead><tr><th style="cursor:default">产品</th><th class="num" style="cursor:default">挂单</th><th class="num" style="cursor:default">在售</th><th class="num hidesm" style="cursor:default">平台</th><th class="num" style="cursor:default">最低</th><th class="num" style="cursor:default">中位</th><th class="num" style="cursor:default">最高</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <div class="tfoot"><span>来源：data.aibijia.org 公开挂单 JSON（只取统计量）· 官方价核实于 ${esc(state.data.meta.date)}</span>
        <span class="spacer"></span><a href="#method" style="color:var(--dim);text-decoration:underline">口径说明 ↗</a></div>`;
  }

  /* ── relays ── */
  /*
   * 这一页要回答的唯一问题：同一模型，在哪家下单最便宜、贵多少。
   *
   * 数据侧的三件事决定了视图必须这么画：
   *  1) 各站「输入价」经常完全相同（都挂牌上游官方价），一维横条图必然等长，
   *     所以按「有效成本」排（含输出倍率与缓存命中），价差才会显形；
   *  2) completion_ratio 各站不同（1×–7.5×），输出贵不贵比输入更影响账单；
   *  3) 同一家站内部还有分组倍率（差 20–220 倍），「最低可达价」单列并标组名。
   */
  /* 旗舰清单由采集端下发（meta.flagships，见 collect.mjs 的 FLAGSHIP）。
   * 旧实现在这里手抄一份，再用「展示名拆词拼正则」去找官方价：
   * 拆 "DS V4.1 Flash" 得到 /DS/ 与 /Flash/，永远匹配不到 DeepSeek。
   * 现在只读数据，页面不可能再跟采集端口径不一致（INV-5、F19）。 */
  // 惰性读取：这段代码在模块顶层执行，那时 state.data 还没加载（T1.9 踩过）
  const relayFlags = () =>
    (state.data?.meta?.flagships || []).map((f) => ({
      key: f.key,
      label: f.label,
      input: f.input,
      output: f.output,
      cache_read: f.cache_read,
      officialEff: f.officialEff,
    }));

  /** 状态文案。沿用旧价的站额外带上「上次成功 MM-DD」（F20）。 */
  const relayStatus = (st, r) => {
    if (r?.stale && r?.checked_at) {
      return [`上次成功 ${String(r.checked_at).slice(5)}`, 'stale'];
    }
    return relayStatusRaw(st);
  };

  const relayStatusRaw = (st) =>
    st === 'ok'
      ? ['公开', 'ok']
      : st === 'no_pricing'
        ? ['无价目', 'stale']
        : st === 'http_403' || st === 'http_401'
          ? ['需登录', 'stale']
          : st === 'http_404'
            ? ['接口失效', 'stale']
            : st === 'timeout'
              ? ['超时', 'stale']
              : st === 'unreachable'
                ? ['未响应', 'stale']
                : ['未采集', 'stale'];

  function viewRelays() {
    const rs = state.data.relays || [];
    /* 有可比价格的站（F20）：探测成功，或者探测失败但仍在 14 天 TTL 内沿用旧价。
     * 旧实现只收 status === 'ok'，于是今天探测失败、昨天还有价的站从页面整体消失——
     * 读者看到的是「这家站没了」，而实际只是今天没连上。 */
    const hasPrices = (r) => r.prices && Object.keys(r.prices).length > 0;
    const live = rs.filter((r) => r.status === 'ok' || (r.stale && hasPrices(r)));
    // 旧快照可能没有 meta.flagships（换数据源的第一天）：这时不画图，直说缺什么
    const RELAY_FLAGS = relayFlags();
    if (!RELAY_FLAGS.length) {
      return `<div class="empty"><b>这一版数据没有旗舰清单</b>采集中未下发 meta.flagships（旧快照，或采集端早于 T1.9）。重新采集后这里会显示各站的旗舰对比。</div>`;
    }
    const flag = RELAY_FLAGS.find((f) => f.key === state.relayFlag) || RELAY_FLAGS[0];
    // 官方参考价直接来自 meta.flagships，不再用展示名拼正则（F19）
    const officialOf = (key) => {
      const f = RELAY_FLAGS.find((x) => x.key === key);
      if (!f || f.input == null) return null;
      return { input: f.input, output: f.output, cache: f.cache_read, eff: f.officialEff };
    };

    // 当前选中模型的全部报价点
    const pts = live
      .map((r) => {
        const p = r.prices?.[flag.key];
        if (!p || p.kind !== 'per_1m') return null;
        return {
          r,
          p,
          eff: p.eff != null ? p.eff : null,
          floor: p.floor?.input ?? null,
          name: r.name,
          domain: r.domain,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a.eff ?? 1e9) - (b.eff ?? 1e9));

    /*
     * 剔除「明显不可信」的报价再做价差：单站把 DeepSeek 缓存命中价当输入价卖、
     * 或把按次价写成每百万价，会让「N 倍价差」变成噪音。
     * 判据：与同模型中位输入价偏离 10 倍以上 —— 不是没有，而是不可比。
     */
    const median = (arr) => {
      if (!arr.length) return null;
      const a = [...arr].sort((x, y) => x - y);
      const m = a.length >> 1;
      return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
    };
    const medIn = median(pts.map((x) => x.p.input));
    const outlier = (x) =>
      medIn && x.p.input > 0 && (x.p.input / medIn > 10 || medIn / x.p.input > 10);
    const usable = pts.filter((x) => x.eff != null && !x.p.anomaly && !outlier(x));
    const dropped = pts.filter((x) => x.eff != null && !x.p.anomaly && outlier(x));
    const official = officialOf(flag.key);
    const bestPoint = usable[0] || null;
    const worstPoint = usable[usable.length - 1] || null;
    const spread =
      bestPoint && worstPoint && bestPoint.eff > 0 ? worstPoint.eff / bestPoint.eff : null;
    // 口径与采集端一致：agent 画像（F36：数字不再写在这一行里）
    const officialEff = official
      ? costOf(
          {
            kind: 'per_1m',
            input: official.input,
            output: official.output,
            cacheRead: official.cache ?? official.input,
          },
          profileOf('agent'),
        )
      : null;

    // ── 价差条形图（按有效成本，含最低可达价刻度）──
    const maxEff = usable.length ? Math.max(...usable.map((x) => x.eff)) : 0;
    const bars = usable.map((x, _i) => {
      const pctW = Math.max(3, (x.eff / maxEff) * 100);
      /*
       * 条长用有效成本排序（输出/缓存都算进去），但「比官方贵还是便宜」必须按
       * 同一口径的输入价比。用有效成本比会把「这家缓存价低」读成「这家整体便宜」，
       * 而缓存价本来就是各站自己标的，混进去就变成拿不同基准互相比较。
       */
      const vs = x.p.vsOfficial != null ? x.p.vsOfficial : null;
      const cls = vs == null ? '' : vs < 0.97 ? 'low' : vs > 1.05 ? 'high' : '';
      const tag =
        vs == null
          ? '—'
          : vs < 0.97
            ? `${Math.round((1 - vs) * 100)}% off`
            : vs > 1.05
              ? `${vs.toFixed(1)}× 官方`
              : '官方价';
      const floorMark =
        x.floor != null && x.eff > 0 ? Math.max(0, Math.min(100, (x.floor / maxEff) * 100)) : null;
      return {
        ...x,
        cls,
        tag,
        pctW,
        floorMark,
        vs,
        multi: x.p.comp && Math.abs(x.p.comp - 1) > 0.01,
      };
    });

    // ── 状态分组（在册未开放）──
    const notLive = rs.filter((r) => r.status !== 'ok' && !r.models);
    const byStatus = {};
    for (const r of notLive) {
      const [label] = relayStatus(r.status, r);
      (byStatus[label] = byStatus[label] || []).push(r);
    }

    const cover = live.reduce((n, r) => n + (r.models || 0), 0);

    // 有效成本/单价统一 2 位小数：money() 在 <1 时会给 4 位，混在小数里像乱码
    const cents = (v) => (v == null ? '—' : v >= 100 ? v.toFixed(0) : v.toFixed(2));

    return `
      <div class="controls" role="group" aria-label="对比哪个模型" style="margin-top:0">
        <div class="chips">
          ${RELAY_FLAGS.map((f) => {
            const n = live.filter((r) => {
              const p = r.prices?.[f.key];
              return p && p.kind === 'per_1m';
            }).length;
            return `<button class="chip" data-relayflag="${f.key}" aria-pressed="${state.relayFlag === f.key}">${f.label}${n ? ` <b style="font-weight:400">${n}</b>` : ''}</button>`;
          }).join('')}
        </div>
        <span class="spacer"></span>
        <span class="eyebrow">按 agent 编程口径折算 · 缓存命中 70% · 输出占 30%</span>
      </div>

      <section class="rax">
        <div class="raxhead">
          <h3>${esc(flag.label)}：${
            spread ? `${spread.toFixed(1).replace(/\.0$/, '')} 倍价差` : '可比价目不足'
          }</h3>
          <p>${usable.length} 家给出可比单价${(() => {
            const k = new Set(
              usable.map((x) => `${x.p.input}/${x.p.output}/${x.p.cacheRead ?? ''}`),
            ).size;
            return k < usable.length
              ? `，但只有 <strong>${k} 种不同价格</strong>——多数站挂同一个上游价，真正拉开差距的是分组倍率`
              : '';
          })()}。条长是按用量折算的<strong>有效成本</strong>（$ / 1M 有效 token）；
          竖线是官方直连的${officialEff != null ? ` $${cents(officialEff)}` : '参考值'}。${
            usable.some((b) => b.floorMark != null) ? '条上的短竖线是该站最便宜分组下的单价。' : ''
          }</p>
        </div>
        <div class="raxbars" id="relayBars">
          ${
            bars.length
              ? bars
                  .map(
                    (b, i) => `
            <a class="rb ${b.cls}" href="https://${esc(b.domain)}" target="_blank" rel="noopener" title="${esc(b.name)} · ${esc(b.domain)}">
              <span class="rb-n">${esc(b.name)}</span>
              <span class="rb-bar"><i style="--w:${b.pctW.toFixed(1)}%; --i:${i}"></i>
                ${b.floorMark != null ? `<u class="rb-floor" style="left:${b.floorMark.toFixed(1)}%"></u>` : ''}</span>
              <span class="rb-v">$${cents(b.eff)}</span>
              <span class="rb-x">${esc(b.tag)}</span>
            </a>`,
                  )
                  .join('')
              : `<div class="empty">这个模型目前没有可比单价。</div>`
          }
        </div>
        ${usable.some((b) => b.floorMark != null) ? `<p class="tnote" style="margin-top:10px">条上的短竖线 = 该站最便宜分组下的单价（需对应分组权限，不一定无门槛）。</p>` : ''}
        ${dropped.length ? `<p class="tnote">未计入价差：${dropped.map((d) => `${esc(d.name)}（$${cents(d.p.input)}）`).join('、')}——与同模型中位价偏离 10 倍以上，疑为错标或缓存价混入。</p>` : ''}
      </section>

      <p class="tnote">共 ${cover.toLocaleString()} 条模型报价 · ${live.length} 家能读到公开价目 · ${live.reduce(
        (n, r) => n + (r.groups?.count || 0),
        0,
      )} 个分组倍率</p>

      <!-- 桌面表格 -->
      <div class="tablewrap relay-table hidesm" tabindex="0" role="region" aria-label="中转站价目表">
        <table class="rtable"><caption class="sr">中转站公开价目</caption>
          <thead><tr>
            <th>站点</th>
            <th class="num">模型数</th>
            <th class="num">输入 / 输出</th>
            <th class="num">输出倍率</th>
            <th class="num">缓存读</th>
            <th class="num">最低可达</th>
            <th class="num">有效成本</th>
            <th>状态</th>
          </tr></thead>
          <tbody>
            ${live
              .slice()
              .sort((a, b) => {
                const ea = a.prices?.[flag.key]?.eff ?? 1e9,
                  eb = b.prices?.[flag.key]?.eff ?? 1e9;
                return ea - eb;
              })
              .map((r) => {
                const p = r.prices?.[flag.key];
                const eff = p?.kind === 'per_1m' ? p.eff : null;
                const vs = p?.vsOfficial ?? null;
                return `
              <tr>
                <td><div class="mname"><span class="txt">${esc(r.name)}</span><span class="id">${esc(r.domain)}</span></div></td>
                <td class="num">${(r.models || 0).toLocaleString()}</td>
                <td class="num">${p ? (p.kind === 'per_call' ? `<span class="mono">$${cents(p.usd)}/次</span>` : `<span class="mono">${cents(p.input)} / ${cents(p.output)}</span>`) : `<span class="dim">—</span>`}</td>
                <td class="num">${p && p.kind === 'per_1m' && p.comp ? `<span class="mono ${p.comp > 5 ? 'hi-comp' : ''}">×${p.comp}</span>` : `<span class="dim">—</span>`}</td>
                <td class="num">${p?.cacheRead != null ? `<span class="mono">${cents(p.cacheRead)}</span>` : `<span class="dim">—</span>`}</td>
                <td class="num">${p?.floor ? `<span class="mono">${cents(p.floor.input)}</span> <span class="grp">${esc(p.floor.group)}</span>` : `<span class="dim">—</span>`}</td>
                <td class="num">${eff != null ? `<span class="mono">$${cents(eff)}</span>${vs != null && (vs < 0.97 || vs > 1.05) ? `<span class="vs ${vs < 0.97 ? 'low' : 'high'}">${vs < 0.97 ? `${Math.round((1 - vs) * 100)}%↓` : `${Math.round((vs - 1) * 100)}%↑`}</span>` : ''}` : `<span class="dim">—</span>`}</td>
                <td>${(() => {
                  const [l, c] = relayStatus(r.status, r);
                  // 「公开价目」但这一列没有该模型 → 不是坏了，是这家没卖这个模型
                  const empty = r.status === 'ok' && !r.prices?.[flag.key];
                  return `<span class="status ${c}">${empty ? '无该模型' : l}</span>`;
                })()}${p?.variantOnly ? ` <span class="tag warn" title="该站只提供思考模式等变体，无基础版">变体</span>` : ''}${p?.anomaly ? ` <span class="tag warn" title="与官方价差异过大，可能是包月/按次/特殊口径">口径?</span>` : ''}
                  <a href="https://${esc(r.domain)}" target="_blank" rel="noopener" class="ext">↗</a></td>
              </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>

      <!-- 移动端卡片：不隐藏任何列，改成两行 -->
      <div class="relay-cards">
        ${live
          .slice()
          .sort((a, b) => {
            const ea = a.prices?.[flag.key]?.eff ?? 1e9,
              eb = b.prices?.[flag.key]?.eff ?? 1e9;
            return ea - eb;
          })
          .map((r) => {
            const p = r.prices?.[flag.key];
            const eff = p?.kind === 'per_1m' ? p.eff : null;
            return `
          <a class="relay-card" href="https://${esc(r.domain)}" target="_blank" rel="noopener">
            <div class="rc-top">
              <span class="rc-name">${esc(r.name)}</span>
              <span class="rc-eff">${eff != null ? `$${cents(eff)}` : p?.kind === 'per_call' ? `$${cents(p.usd)}/次` : '—'}</span>
            </div>
            <div class="rc-mid">
              ${p && p.kind === 'per_1m' ? `入 ${cents(p.input)} · 出 ${cents(p.output)}${p.comp ? ` ×${p.comp}` : ''}` : p?.kind === 'per_call' ? '按次计价' : '无可比单价'}
              ${p?.floor ? `<span class="rc-floor">最低 ${cents(p.floor.input)}</span>` : ''}
            </div>
            <div class="rc-bot">
              <span>${(r.models || 0).toLocaleString()} 模型</span>
              ${p?.cacheRead != null ? `<span>缓存 ${cents(p.cacheRead)}</span>` : ''}
              ${p?.anomaly ? `<span class="tag warn">口径?</span>` : ''}
              ${(() => {
                const [l, c] = relayStatus(r.status, r);
                return `<span class="status ${c}">${l}</span>`;
              })()}
            </div>
          </a>`;
          })
          .join('')}
      </div>

      <div class="shead"><h2>在册但未开放价目</h2><span class="desc">价目接口需要登录或不提供，只登记、不猜价。</span><span class="right">${notLive.length} 家</span></div>
      ${Object.entries(byStatus)
        .map(
          ([label, arr]) => `
        <details class="rgroup">
          <summary>${esc(label)} <span class="dim">${arr.length}</span></summary>
          <div class="cand">
            ${arr.map((r) => `<a href="https://${esc(r.domain)}" target="_blank" rel="noopener">${esc(r.name)} · ${esc(r.domain)}</a>`).join('')}
          </div>
        </details>`,
        )
        .join('')}

      <div class="tfoot">
        <span>有 billing_expr 的站点按表达式计价（真实挂牌价）；其余按 OneAPI 倍率 × 分组换算。均不含充值折扣。
        ${(() => {
          const gray = live.reduce((n, r) => n + (r.grayGroups || 0), 0);
          return gray
            ? `另有 ${gray} 个「逆向 / 特价」分组未计入代表价与最低可达价——那不是正常渠道能拿到的价。`
            : '';
        })()}</span>
        <span class="spacer"></span><a href="#method" style="color:var(--dim);text-decoration:underline">口径说明 ↗</a>
      </div>`;
  }

  /* ── events ── */
  const EV_D0 = 864e5;
  const evDay = (s) => (s ? Date.parse(`${s}T00:00:00Z`) : NaN);
  const evToday = () => Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const evDays = (e) => {
    const d = (evDay(e.end) - evToday()) / EV_D0;
    return Number.isFinite(d) ? Math.ceil(d) : null;
  };
  const evBy = (k) => {
    const m = {};
    for (const e of state.data.events || []) {
      const v = e[k] ?? '';
      m[v] = (m[v] || 0) + 1;
    }
    return m;
  };

  function viewEvents() {
    const all = state.data.events || [];
    // 每个筛选维度先只应用另外两个维度：按钮上的数字始终等于点下去能看到的条数。
    const pass = (e, skip) =>
      (skip === 'kind' || state.evKind === 'all' || e.kind === state.evKind) &&
      (skip === 'src' || state.evSrc === 'all' || e.source === state.evSrc) &&
      (skip === 'region' || state.evRegion === 'all' || e.region === state.evRegion);

    const pool = all.filter((e) => pass(e, null));
    const key = (e) => String(e.end || e.start || '');
    const open = pool
      .filter((e) => e.status === 'open')
      .sort((a, b) => key(a).localeCompare(key(b)));
    const upcoming = pool
      .filter((e) => e.status === 'upcoming')
      .sort((a, b) => key(a).localeCompare(key(b)));
    // 归档按时间倒序，最近的在前
    const past = pool
      .filter((e) => e.status === 'past')
      .sort((a, b) => key(b).localeCompare(key(a)));
    // 档期还没定的（status=unknown 或 start/end 缺失）单独一档，不并进上面任何一组，也不丢
    const undated = pool.filter((e) => !['open', 'upcoming', 'past'].includes(e.status));
    const live = open.length + upcoming.length;

    const cards = (arr) => `<div class="grid">${arr.map(card).join('')}</div>`;

    const card = (e) => {
      const d = e.status === 'open' ? evDays(e) : null;
      const urgent = d != null && d <= 3;
      const stamp =
        e.status === 'open'
          ? d == null
            ? '报名中'
            : d < 0
              ? '已过期'
              : d === 0
                ? '今天截止'
                : `剩 ${d} 天`
          : e.status === 'upcoming'
            ? '将开始'
            : e.status === 'past'
              ? '已结束'
              : '档期待定';
      const when = e.start
        ? `${esc(e.start)}${e.end && e.end !== e.start ? ` → ${esc(e.end)}` : ''}`
        : esc(e.dates || '—');
      const rows = [
        ['时间', `<span class="mono" style="font-size:12px">${when}</span>`],
        e.prize
          ? ['奖励', esc(e.prize) + (e.regs ? ` · ${e.regs.toLocaleString()} 人报名` : '')]
          : e.regs
            ? ['报名', `${e.regs.toLocaleString()} 人`]
            : null,
        // 推荐指数只显示数字（旧的四格 pips 没有样式，已经删掉）
        e.worth != null ? ['推荐', String(e.worth)] : null,
      ].filter(Boolean);
      const themes = (e.themes || []).slice(0, 4);
      return `
      <article class="card">
        <div class="hd">
          <div style="flex:1;min-width:0">
            <h3>${esc(e.title)}</h3>
            <div class="sub">${esc(EV_LABEL(EV_SRC, e.source))}${e.org ? ` · ${esc(e.org)}` : ''}${e.location ? ` · ${esc(e.location)}` : ''}</div>
          </div>
          ${stamp ? `<span class="tag ${e.status === 'open' ? (urgent ? 'hot' : 'free') : ''}">${stamp}</span>` : ''}
        </div>
        ${e.summary ? `<p class="ev-sum">${esc(e.summary)}</p>` : ''}
        <dl${rows.length ? '' : ' class="zero"'}>
          ${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}
          ${themes.length ? `<dt>主题</dt><dd><div class="mchips">${themes.map((t) => `<span class="mchip">${esc(t)}</span>`).join('')}</div></dd>` : ''}
        </dl>
        <div class="foot">
          ${extLink(e.url, '活动页 ↗')} ${reportLink('event', e.id, e.url)}
          <span class="evline"><span>${esc(EV_LABEL(EV_KIND, e.kind))}</span><span class="tag">${esc(EV_LABEL(EV_REGION, e.region))}</span></span>
        </div>
      </article>`;
    };

    const lane = (vals, dict, cur, attr, allLabel, cnt) => `
      <div class="chips" role="group" aria-label="${allLabel}">
        <button class="chip" data-${attr}="all" aria-pressed="${cur === 'all'}">${allLabel} <b style="font-weight:400">${cnt.all}</b></button>
        ${vals.map(([k, n]) => `<button class="chip" data-${attr}="${esc(k)}" aria-pressed="${cur === k}">${esc(EV_LABEL(dict, k))} <b style="font-weight:400">${n}</b></button>`).join('')}
      </div>`;

    // 来源按真实出现的值生成，AIOS / 以后新增的源都会自己出现
    // 来源按该源的全部条数算（含归档），否则全是 past 的源会显示成 0，点进去一片空
    const srcCount = {};
    for (const e of all.filter((e) => pass(e, 'src')))
      srcCount[e.source || ''] = (srcCount[e.source || ''] || 0) + 1;
    // 三个维度的数字都等于「点下去会看到的条数」，所以都不能再额外剔掉 past
    const kindCount = {};
    for (const e of all.filter((e) => pass(e, 'kind')))
      kindCount[e.kind || ''] = (kindCount[e.kind || ''] || 0) + 1;
    const regionCount = {};
    for (const e of all.filter((e) => pass(e, 'region')))
      regionCount[e.region || ''] = (regionCount[e.region || ''] || 0) + 1;
    const byN = (o) =>
      Object.entries(o).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
    const allSrc = all.filter((e) => pass(e, 'src')).length;
    const allCnt = { all: all.filter((e) => pass(e, 'kind')).length };

    // 时间轴每类只画前 EV_TL_CAP 条；真实的「画了多少 / 一共多少」由 renderTimeline 渲染后写进这一行
    const tlNote = `<div class="tl-more"><span data-tlnote></span></div>`;

    return `
      <section class="tlsec">
        <div class="tlhead">
          <h3>什么时候有活动</h3>
          <p>每条是一个活动的起止区间，按开始时间排。</p>
        </div>
        <svg id="eventTimeline" viewBox="0 0 1200 260" preserveAspectRatio="xMidYMid meet" role="img" aria-label="活动时间轴"></svg>
        <div class="tllegend">
          <span><i style="background:var(--kind-hackathon)"></i>黑客松</span>
          <span><i style="background:var(--kind-conference)"></i>会议</span>
          <span><i style="background:var(--kind-meetup)"></i>Meetup</span>
          <span><i style="background:var(--kind-other)"></i>其他</span>
        </div>
        <div id="tlNote">${tlNote}</div>
      </section>

      <div class="controls">
        ${lane(byN(kindCount), EV_KIND, state.evKind, 'evkind', '全部类型', allCnt)}
        ${lane(byN(srcCount), EV_SRC, state.evSrc, 'evsrc', '全部来源', { all: allSrc })}
        ${lane(byN(regionCount), EV_REGION, state.evRegion, 'evregion', '全部地区', { all: all.length })}
        <span class="spacer"></span><span class="eyebrow">${live + undated.length} 个在场 · ${past.length} 条归档</span>
      </div>

      <div class="shead" style="padding-top:18px"><h2>开放中</h2><span class="right">${open.length} 个</span></div>
      ${open.length ? cards(open.slice(0, state.evLimit)) : `<div class="empty">这个筛选组合下没有开放中的活动。</div>`}
      ${
        open.length > state.evLimit
          ? `<div class="tl-more"><button class="more" data-evmore="1" type="button">展开全部 ${open.length - state.evLimit} 个</button></div>`
          : ''
      }

      ${
        upcoming.length
          ? `<div class="shead"><h2>即将开始</h2><span class="right">${upcoming.length} 个</span></div>
        ${cards(upcoming.slice(0, state.evLimit))}
        ${
          upcoming.length > state.evLimit
            ? `<div class="tl-more"><button class="more" data-evmore="1" type="button">展开全部 ${upcoming.length - state.evLimit} 个</button></div>`
            : ''
        }`
          : ''
      }

      ${
        undated.length
          ? `<div class="shead"><h2>档期待定</h2><span class="desc">来源只给了日期串或还标着 unknown，照原样列，不做推断。</span><span class="right">${undated.length} 条</span></div>
        ${cards(undated.slice(0, state.evPastLimit))}
        ${
          undated.length > state.evPastLimit
            ? `<div class="tl-more"><button class="more" data-evpastmore="1" type="button">展开全部 ${undated.length} 条</button></div>`
            : ''
        }`
          : ''
      }

      ${
        past.length
          ? `<div class="shead"><h2>历史归档</h2><span class="desc">已结束的场次，只作来源对照，不混进「开放中」。</span><span class="right">${past.length} 条</span></div>
        <div class="cand">${cards(past.slice(0, state.evPastLimit))}</div>
        ${
          past.length > state.evPastLimit
            ? `<div class="tl-more"><button class="more" data-evpastmore="1" type="button">展开全部 ${past.length} 条</button></div>`
            : ''
        }`
          : ''
      }`;
  }

  /* ── tools ── */
  function kfmt(n) {
    if (n == null) return '—';
    if (n >= 100000) return `${Math.round(n / 1000)}k`;
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    return String(n);
  }

  function viewTools() {
    const all = state.data.resources || [];
    if (!all.length)
      return `<div class="empty"><b>工具箱还没入库</b>运行 <code>node collect.mjs</code>。</div>`;

    const uses = [...new Set(all.map((r) => r.use))];
    const list = all.filter((r) => state.toolKind === 'all' || r.use === state.toolKind);
    const useCount = {};
    for (const r of all) useCount[r.use] = (useCount[r.use] || 0) + 1;

    return `
      <div class="controls">
        <div class="chips" role="group" aria-label="类型">
          <button class="chip" data-toolkind="all" aria-pressed="${state.toolKind === 'all'}">全部 ${all.length}</button>
          ${uses.map((k) => `<button class="chip" data-toolkind="${k}" aria-pressed="${state.toolKind === k}">${esc(all.find((r) => r.use === k)?.useLabel || k)} <b style="font-weight:400">${useCount[k]}</b></button>`).join('')}
        </div>
        <span class="spacer"></span><span class="eyebrow">编辑排序 · 不是按星数</span>
      </div>

      <div class="tgrid">
        ${list
          .map(
            (r) => `
          <a class="tcard${r.archived ? ' stale' : ''}" href="${esc(safeUrl(r.url) || '#')}"${safeUrl(r.url) ? ' target="_blank" rel="noopener"' : ''}>
            <div class="th">
              <h3>${esc(r.title)}</h3>
              <span class="tstars">${kfmt(r.stars)}<em>★</em></span>
            </div>
            <p class="why">${esc(r.why)}</p>
            <div class="tm">
              <span class="tag free">${esc(r.useLabel)}</span>
              ${r.license && r.license !== 'NOASSERTION' ? `<span>${esc(r.license)}</span>` : ''}
              ${r.updated ? `<span>${esc(r.updated)} 更新</span>` : ''}
              ${r.archived ? `<span class="tag warn">已归档</span>` : ''}
              <span class="repoch">${esc(r.repo)}</span>
            </div>
          </a>`,
          )
          .join('')}
      </div>

      <div class="tfoot"><span>入选标准：解决的问题要具体、别处不好找、作者在认真维护。人尽皆知的不收——每个 agent 都内置的东西，放上来没有信息量。</span>
        <span class="spacer"></span><a href="https://github.com/mbdtf202-cyber/indexai" target="_blank" rel="noopener" style="color:var(--dim);text-decoration:underline">提一个 ↗</a></div>`;
  }

  /* 图形入场：条从 0 长到目标宽度 */

  /* ── 价格轴：453 个模型在对数刻度上的分布 ── */
  function renderAxis() {
    const svg = document.getElementById('priceAxis');
    if (!svg) return;
    const rows = (state.data.models || []).filter((m) => m.input > 0);
    if (!rows.length) return;

    const W = 1200,
      H = 260,
      padL = 8,
      padR = 8,
      axisY = H - 34;
    const vals = rows.map((m) => m.input);
    const lo = 10 ** Math.floor(Math.log10(Math.min(...vals)));
    const hi = 10 ** Math.ceil(Math.log10(Math.max(...vals)));
    const LX = (v) =>
      padL +
      ((Math.log10(Math.max(v, lo)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) *
        (W - padL - padR);

    // 对数桶密度 → 决定点云高度
    const BINS = 64;
    const bins = new Array(BINS).fill(0);
    const binOf = (v) =>
      Math.min(
        BINS - 1,
        Math.floor(((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * BINS),
      );
    rows.forEach((m) => bins[binOf(m.input)]++);
    const maxBin = Math.max(...bins);
    const topY = 12,
      usable = axisY - topY - 10;

    // 伪随机（保证每次渲染一致）
    const rnd = (i) => {
      const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
      return x - Math.floor(x);
    };

    const sorted = [...rows].sort((a, b) => a.input - b.input);
    const qOf = (i) => Math.round((i / Math.max(1, sorted.length - 1)) * 100);
    const dots = sorted.map((m, i) => {
      const x = LX(m.input);
      const dens = bins[binOf(m.input)] / maxBin;
      const h = usable * Math.sqrt(dens);
      const y = axisY - 8 - rnd(i) * Math.max(h, 3);
      const kind = m.free ? 'free' : m.channelKind === 'aggregator' ? 'agg' : '';
      return { x, y, name: m.name, vendor: m.vendor, price: m.input, kind, i, q: qOf(i) };
    });

    // 密度面积：桶中点 + 二次贝塞尔平滑
    const bp = bins.map((v, b) => ({
      x: padL + ((b + 0.5) / BINS) * (W - padL - padR),
      y: axisY - 8 - usable * Math.sqrt(v / maxBin),
    }));
    let den = `M${bp[0].x.toFixed(1)},${axisY - 8}`;
    den += ` L${bp[0].x.toFixed(1)},${bp[0].y.toFixed(1)}`;
    for (let i = 0; i < bp.length - 1; i++) {
      const a = bp[i],
        n = bp[i + 1];
      const mx = (a.x + n.x) / 2,
        my = (a.y + n.y) / 2;
      den += ` Q${a.x.toFixed(1)},${a.y.toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
    }
    const last = bp[bp.length - 1];
    den += ` L${last.x.toFixed(1)},${last.y.toFixed(1)} L${last.x.toFixed(1)},${axisY - 8} Z`;

    // 刻度
    const ticks = [];
    for (let p = Math.log10(lo); p <= Math.log10(hi) + 0.001; p++) {
      const v = 10 ** p;
      const x = LX(v);
      ticks.push(
        `<line class="tick-l" x1="${x.toFixed(1)}" y1="${axisY}" x2="${x.toFixed(1)}" y2="${axisY + 6}"/>`,
      );
      ticks.push(
        `<line class="grid-l" x1="${x.toFixed(1)}" y1="${topY}" x2="${x.toFixed(1)}" y2="${axisY}"/>`,
      );
      const lbl = v >= 1 ? `$${v}` : `$${v.toFixed(v < 0.01 ? 3 : 2)}`;
      ticks.push(
        `<text class="tick-t" x="${x.toFixed(1)}" y="${axisY + 20}" text-anchor="middle">${lbl}</text>`,
      );
    }

    // 关键标注
    const med = sorted[Math.floor(sorted.length / 2)];
    const marks = [
      { m: sorted[0], txt: '最便宜' },
      { m: med, txt: '中位' },
      { m: sorted[sorted.length - 1], txt: '最贵' },
    ]
      .map(({ m, txt }) => {
        const x = LX(m.input);
        return `<text class="axlabel" x="${x.toFixed(1)}" y="${topY - 2}" text-anchor="middle">${txt} <tspan font-family="IBM Plex Mono" font-size="11">$${money(m.input)}</tspan></text>`;
      })
      .join('');

    svg.innerHTML = `
      <path class="den" d="${den.trim()}"/>
      ${ticks.join('')}
      <line class="axline" x1="${padL}" y1="${axisY}" x2="${W - padR}" y2="${axisY}"/>
      ${marks}
      <g id="axDots">${dots
        .map(
          (d) =>
            `<circle class="dot ${d.kind}" cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="2.6" data-q="${d.q}" data-n="${esc(d.name)}" data-v="${esc(d.vendor || '')}" data-p="${d.price}"/>`,
        )
        .join('')}</g>
      <g id="axTip" style="display:none"><line class="axline" y1="${topY}" y2="${axisY}" stroke-dasharray="2 3"/>
        <text class="axlabel" y="${topY - 2}" text-anchor="middle"></text></g>`;

    // 入场：点按 x 依次淡入
    const dotsG = svg.querySelector('#axDots');
    dotsG.style.opacity = '0';
    requestAnimationFrame(() => {
      dotsG.style.transition = 'opacity .9s cubic-bezier(.16,1,.3,1)';
      dotsG.style.opacity = '1';
    });

    // 悬停
    const tip = svg.querySelector('#axTip');
    const tipLine = tip.querySelector('line');
    const tipText = tip.querySelector('text');
    svg.addEventListener('mousemove', (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      let best = null,
        bd = 1e9;
      for (const d of dots) {
        const dx = Math.abs(d.x - px);
        if (dx < bd) {
          bd = dx;
          best = d;
        }
      }
      dotsG.querySelectorAll('.dot.hot').forEach((el) => el.classList.remove('hot'));
      if (!best || bd > 26) {
        tip.style.display = 'none';
        return;
      }
      const el = dotsG.querySelector(`circle[data-p="${best.price}"][cx="${best.x.toFixed(1)}"]`);
      if (el) el.classList.add('hot');
      tip.style.display = '';
      tipLine.setAttribute('x1', best.x);
      tipLine.setAttribute('x2', best.x);
      tipText.setAttribute('x', best.x);
      tipText.textContent = `${best.name}  $${money(best.price)}`;
    });
    svg.addEventListener('mouseleave', () => {
      tip.style.display = 'none';
      dotsG.querySelectorAll('.dot.hot').forEach((el) => el.classList.remove('hot'));
    });

    storyDots = svg.querySelectorAll('.dot');
    bindStory();
  }

  /* ── 滚动叙事：轴随滚动收窄 ──
     注意：不能把 DOM 捕获进闭包 —— render() 会重建 #view，旧节点会脱离文档，
     滚动回调就在操作幽灵元素。每次回调都重新查询。 */
  let storyWired = false;
  let storyStage = -1;
  let storyDots = null; // renderAxis 时刷新，滚动回调不重复查询
  const STORY_CUTS = [100, 25, 50, 90];

  function updateStory() {
    const track = document.querySelector('.story-track');
    if (!track) return;
    const rail = document.getElementById('storyRail');
    if (!storyDots || !storyDots.length) storyDots = document.querySelectorAll('#priceAxis .dot');
    const dots = storyDots;
    const lines = document.querySelectorAll('.story-line');
    if (!dots.length) return;

    const r = track.getBoundingClientRect();
    const span = r.height - innerHeight;
    const prog = span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 0;
    if (rail) rail.style.width = `${(prog * 100).toFixed(1)}%`;

    const idx = Math.min(STORY_CUTS.length - 1, Math.floor(prog * STORY_CUTS.length));
    if (idx === storyStage) return;
    storyStage = idx;
    const cut = STORY_CUTS[idx];
    dots.forEach((d) => {
      const lit = Number(d.dataset.q) <= cut;
      d.style.opacity = lit ? '' : '0.08';
    });
    lines.forEach((l, i) => l.classList.toggle('on', i === idx));
  }

  let storyTick = false;
  function onStoryScroll() {
    if (storyTick) return;
    storyTick = true;
    requestAnimationFrame(() => {
      storyTick = false;
      updateStory();
    });
  }

  function bindStory() {
    if (!storyWired) {
      addEventListener('scroll', onStoryScroll, { passive: true });
      addEventListener('resize', onStoryScroll);
      storyWired = true;
    }
    storyStage = -1;
    updateStory();
  }

  function renderSubBars() {
    const host = document.getElementById('subBars');
    if (!host) return;
    const plans = (state.data.subsRegions || []).filter((p) => p.cheapest > 0 && p.priciest > 0);
    if (!plans.length) {
      host.style.display = 'none';
      return;
    }
    const gMin = Math.min(...plans.map((p) => p.cheapest));
    const gMax = Math.max(...plans.map((p) => p.priciest));
    const SPAN = Math.log10(gMax) - Math.log10(gMin) || 1;
    const pos = (v) => ((Math.log10(v) - Math.log10(gMin)) / SPAN) * 100;

    host.innerHTML = [...plans]
      .sort((a, b) => b.priciest / b.cheapest - a.priciest / a.cheapest)
      .map((p, i) => {
        const l = pos(p.cheapest),
          r = pos(p.priciest);
        const ratio = p.priciest / p.cheapest;
        return `<a class="sb" href="${esc(p.rows?.[0]?.url || '#')}" target="_blank" rel="noopener">
        <span class="sb-n">${esc(p.plan)}</span>
        <span class="sb-track"><i style="left:${l.toFixed(1)}%; --w:${Math.max(2, r - l).toFixed(1)}%; --i:${i}"></i></span>
        <span class="sb-v">¥${Math.round(p.cheapest)} → ¥${Math.round(p.priciest)}</span>
        <span class="sb-x">${ratio.toFixed(1).replace(/\.0$/, '')}×</span>
      </a>`;
      })
      .join('');
  }

  /* 时间轴：600+ 场活动不能硬塞进 260px 高的一张图里。
     按 kind 分泳道，每泳道最多画 EV_TL_CAP 条（最先到期的先画）；
     行数决定 viewBox 高度，其余明细交给下面的列表——超出的部分在图上明说，而不是压成糊。 */
  const EV_TL_CAP = 26;
  function renderTimeline() {
    const svg = document.getElementById('eventTimeline');
    const note = document.getElementById('tlNote');
    if (!svg) return;
    // 档期未定的没有区间可画，但也算进「未显示」里，靠下面的按钮明说去向
    const upcomingAll = (state.data.events || []).filter((e) => e.status !== 'past');
    const all = upcomingAll.filter((e) => e.start && e.end);
    if (!all.length) {
      svg.style.display = 'none';
      if (note) note.style.display = 'none';
      return;
    }

    const DAY = 864e5;
    const t = (s) => Date.parse(`${s}T00:00:00Z`);
    /* 时间轴右端 = 数据时刻（不是当前时刻）：同一份数据画出的轴永远一样。 */
    const now = dataMoment();
    // 从设计令牌取色，深浅色各自一套（F40：写死 #0a0a0a 在深色下等于隐身）
    const token = (name) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const colors = {
      hackathon: token('--kind-hackathon'),
      conference: token('--kind-conference'),
      meetup: token('--kind-meetup'),
      other: token('--kind-other'),
    };
    const order = ['hackathon', 'conference', 'meetup'];

    // 先按类型分泳道，未知类型排最后；每道内按结束日期升序（最紧的先画）
    const groups = {};
    for (const e of all) (groups[e.kind || 'other'] ||= []).push(e);
    const kinds = Object.keys(groups).sort((a, b) => {
      const ia = order.indexOf(a),
        ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || String(a).localeCompare(String(b));
    });

    let _total = 0;
    let drawn = 0;
    // 同类型活动可能全挤在同几天（实测 331 场 meetup 集中在 5 天里）。
    // 直接取前 N 条只会画出那两天，泳道成一条缝——改为沿时间轴等距抽样，覆盖整段。
    const sample = (list, n) => {
      if (list.length <= n) return list;
      const step = (list.length - 1) / (n - 1);
      const out = [];
      for (let i = 0; i < n; i++) out.push(list[Math.round(i * step)]);
      return out;
    };
    const lanes = kinds.map((k) => {
      const list = [...groups[k]].sort((a, b) => t(a.end) - t(b.end) || t(a.start) - t(b.start));
      const shown = sample(list, EV_TL_CAP);
      drawn += shown.length;
      _total += list.length;
      return { k, list, shown };
    });

    const W = 1200,
      padL = 64,
      padR = 4,
      top = 20,
      laneGap = 16,
      axisH = 26;
    const rowH = 9;
    // 行数由下面的区间贪心直接算出，行数 = 并发度
    const laneH = (n) => Math.max(14, n * rowH);
    let H = 0,
      bot = 0; // 真实行数要等 placed 算完，下面才能定高度

    const starts = all.map((e) => t(e.start) || now);
    const ends = all.map((e) => t(e.end) || now);
    // 右边界用分位数而不是绝对最大值：一个 2028 年结束的长尾活动会把 759 天全拉开，
    // 600 多场活动就挤成一根竖线。取 85% 分位，剩下的在图上标出来。
    const sortedEnds = [...ends].sort((a, b) => a - b);
    const p85 = sortedEnds[Math.min(sortedEnds.length - 1, Math.floor(sortedEnds.length * 0.85))];
    // 左边不画没有活动的月份：从「今天 - 7 天」与「最早一场」里更靠近今天的那个开始，
    // 避免半年的空白把 10 月那一簇挤到右边缘；右边同样用 85% 分位，长尾不拉开版面。
    const earliest = Math.min(...starts.filter((v) => v >= now - 30 * DAY).concat([now]));
    const minD = Math.min(now - 7 * DAY, earliest);
    const maxD = Math.max(now + 21 * DAY, p85);
    const tailN = ends.filter((v) => v > maxD).length;
    const X = (d) => padL + ((d - minD) / (maxD - minD)) * (W - padL - padR);

    let bars = '',
      y = top;
    for (const l of lanes) {
      const col = colors[l.k] || '#b9b9b9';
      // 区间贪心：能塞进已有行就复用，塞不下才新开一行——行数 = 并发度，不会互相盖住
      const rowEnds = [];
      const placed = l.shown.map((e) => {
        const a = Math.max(t(e.start), minD),
          b = Math.min(t(e.end), maxD);
        let r = rowEnds.findIndex((end) => a > end);
        if (r < 0) {
          r = rowEnds.length;
          rowEnds.push(b);
        } else {
          rowEnds[r] = b;
        }
        return { e, a, b, r };
      });
      const h = laneH(rowEnds.length);
      for (const { e, a, b, r } of placed) {
        const x1 = X(a),
          x2 = Math.max(X(b), x1 + 2);
        const yy = y + r * rowH;
        // 长活动（最长 300 天）会被窗口裁切：两端各留一个缺口，并且 title 里永远写完整区间
        const clipL = t(e.start) < minD,
          clipR = t(e.end) > maxD;
        bars += `<rect class="tl-bar" x="${x1.toFixed(1)}" y="${yy.toFixed(1)}" width="${Math.max(2, x2 - x1).toFixed(1)}"
          height="${(rowH - 2.5).toFixed(1)}" fill="${col}" opacity=".72" rx="1"${clipL || clipR ? ` stroke-dasharray="3 2" stroke="${col}" stroke-width="1"` : ''}><title>${esc(e.title)} · ${esc(e.dates || '')} · ${esc(EV_LABEL(EV_SRC, e.source))}${clipL || clipR ? ' · 超出图示范围' : ''}</title></rect>`;
      }
      const rest = l.list.length > l.shown.length ? ` +${l.list.length - l.shown.length}` : '';
      bars +=
        `<text class="tl-lane" x="0" y="${(y + Math.min(h, rowH) / 2 + 3.5).toFixed(1)}">${esc(EV_LABEL(EV_KIND, l.k))} ` +
        `<tspan style="opacity:.55">${l.list.length}${rest}</tspan></text>`;
      y += h + laneGap;
    }
    // 泳道画完才知道真实行数：高度按 y 定，图底不空一大截
    H = y - laneGap + axisH;
    bot = H - axisH;

    // 月份刻度
    let grid = '';
    const d0 = new Date(minD),
      _d1 = new Date(maxD);
    for (let yy0 = d0.getUTCFullYear(), m = d0.getUTCMonth(); ; ) {
      const cur = Date.UTC(yy0, m, 1);
      if (cur > maxD) break;
      if (cur >= minD) {
        const x = X(cur);
        grid += `<line class="tl-grid" x1="${x.toFixed(1)}" y1="${top - 6}" x2="${x.toFixed(1)}" y2="${bot}"/>`;
        grid += `<text class="tl-t" x="${(x + 4).toFixed(1)}" y="${H - 8}">${m + 1}月</text>`;
      }
      m++;
      if (m > 11) {
        m = 0;
        yy0++;
      }
    }

    const xn = X(now);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.style.aspectRatio = `${W} / ${H}`;
    svg.innerHTML = `${grid}${bars}
      <line class="tl-now" x1="${xn.toFixed(1)}" y1="${top - 8}" x2="${xn.toFixed(1)}" y2="${bot}"/>
      <text class="tl-nowt" x="${xn.toFixed(1)}" y="${top - 10}" text-anchor="middle">今天</text>`;

    // 图上画不下的（每道只画前 EV_TL_CAP 条）在图下明说，并指向下方完整列表
    if (note) {
      const line = note.querySelector('[data-tlnote]');
      const more = all.length - drawn;
      if (line)
        line.textContent = [
          more > 0
            ? `时间轴显示 ${drawn} 条，另有 ${more} 条在下方列表`
            : `时间轴显示全部 ${drawn} 条`,
          // 右边界是 85% 分位，尾巴上的远期场次不在图内——数字要能对得上
          tailN > 0 ? `${tailN} 场结束日在图示范围之外` : '',
        ]
          .filter(Boolean)
          .join(' · ');
      note.style.display = '';
    }
  }

  /* ── 工具箱：星数带（对数刻度） ── */

  /* ══════════ 评测页：一张总表 + 列切换 ══════════
   * 数据来自 bench.json（9 个公开源、160+ 个榜）。页面只做三件事：
   *   1. 选榜（按能力分组）
   *   2. 把多个榜并到同一张表里横向对比
   *   3. 分数 × 价格散点，看性价比
   */

  // 懒加载 bench.json：首屏 data.json 只有目录，明细按需拉
  async function loadBench() {
    if (state.benchFull) return state.benchFull;
    if (state.benchLoading) return state.benchLoading;
    state.benchLoading = (async () => {
      try {
        const res = await fetch(state.data.bench.file || 'bench.json');
        if (!res.ok) throw new Error(res.status);
        state.benchFull = await res.json();
      } catch (e) {
        state.benchError = e.message;
        state.benchFull = { boards: {}, catalog: state.data.bench.catalog || [] };
      }
      return state.benchFull;
    })();
    return state.benchLoading;
  }

  const benchCatalog = () => state.benchFull?.catalog || state.data?.bench?.catalog || [];
  const benchBoards = () => state.benchFull?.boards || {};

  // 当前选中的榜（单个）；总表模式下是多个
  function benchSelected() {
    const cat = benchCatalog();
    if (!cat.length) return [];
    const want = state.benchPicks;
    if (want?.length) return want.filter((id) => benchBoards()[id]);
    // 默认：综合智能打头，再按能力组各挑一个代表
    const picks = [];
    const seen = new Set();
    const lead =
      cat.find((c) => c.id === 'aa__intelligenceindex') ||
      cat.find((c) => /综合智能|intelligence/i.test(c.name) && !c.sub) ||
      cat.find((c) => c.group === 'general' && !c.sub);
    if (lead) {
      picks.push(lead.id);
      seen.add(lead.id);
    }
    for (const g of state.data.bench.groups || []) {
      const first = cat.find((c) => c.group === g.id && !c.sub && !seen.has(c.id));
      if (first) {
        picks.push(first.id);
        seen.add(first.id);
      }
    }
    return picks;
  }

  // 把一个榜的行索引成 model → row
  function indexBoard(id) {
    const b = benchBoards()[id];
    if (!b) return { board: null, map: new Map() };
    const map = new Map();
    for (const r of b.rows) map.set(r.model.toLowerCase(), r);
    return { board: b, map };
  }

  /* 模型名归一（与 lib/match.js 同口径）。
   *
   * 页面不能 import Node 模块，所以这里内联一份最小实现。两处口径必须一致——
   * test/unit/match.test.js 用同一组用例跑两边，不一致就挂。 */
  function normalizeModelName(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/^[^/]+\//, '')
      .replace(/[\s_.]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  const VARIANT_MARKERS = ['thinking', 'reasoning', 'reasoner', 'nothink', 'non-thinking'];

  /* 只切「最后一段是档位标记」的名字。中间的标记不动——
   * qwen3.8-max 的 max 是模型名，thinking-machines 是厂商名。 */
  function splitVariant(name) {
    const parts = normalizeModelName(name).split('-');
    const last = parts[parts.length - 1];
    if (parts.length > 1 && VARIANT_MARKERS.includes(last)) {
      return { parent: parts.slice(0, -1).join('-'), variant: last };
    }
    return null;
  }

  /* 三级匹配（S6.3）：精确别名 → 归一后精确相等 → 未匹配。
   * 别名表来自下发的 registry（meta.modelAliases），拿不到就只做前两级。 */
  function matchModel(name) {
    const raw = String(name || '').trim();
    if (!raw) return { matched: false, id: null, name: null, variant: null };

    const aliasMap = state.data?.meta?.modelAliases || {};
    const aliasHit = aliasMap[raw.toLowerCase()];
    if (aliasHit) return { matched: true, id: aliasHit, name: aliasHit, variant: null };

    const norm = normalizeModelName(raw);
    const v = splitVariant(raw);
    if (v) return { matched: false, id: null, name: null, variant: v.variant, parent: v.parent };

    return { matched: false, id: null, name: norm, variant: null };
  }

  /* 名称归一与匹配（T4.5 · S6.3）。
   *
   * 曾经这里有前缀匹配：`bnorm(m.name).startsWith(key)`。后果是
   * 「Claude Sonnet 5」会匹配到「Claude Sonnet 5.5」，「GPT-6」会匹配到
   * 「GPT-6.1 Sol」——图上那个点看着像对的，其实是另一个模型的数据（F24）。
   *
   * 现在只走 lib/match.js 的三级规则：精确别名 → 归一后精确相等 → 未匹配。
   * 不再有任何前缀或模糊匹配。
   */
  const isBatch = (n) => /\b(batch|batches)\b/i.test(String(n || ''));

  function modelFor(name, models) {
    if (!name) return null;
    const pool = (models || []).filter((m) => m.input > 0 && !isBatch(m.name));
    if (!pool.length) return null;

    const target = matchModel(name);
    if (target.matched) {
      const byId = pool.find((m) => m.id === target.id);
      if (byId) return byId;
      // 实体表里有但价格表里没有同名 id：退回按显示名精确比对（仍不做前缀）
      const byName = pool.filter(
        (m) => normalizeModelName(m.name) === normalizeModelName(target.name || ''),
      );
      if (byName.length)
        return byName.sort((a, b) => String(b.name).length - String(a.name).length)[0];
    }

    /* 实体表里没有这个名字：只做「归一后精确相等」，不做前缀。
     * 找不到就返回 null —— 页面显示「—」比显示一个错的数字好。 */
    const norm = normalizeModelName(name);
    const exact = pool.filter((m) => normalizeModelName(m.name) === norm);
    if (exact.length) return exact.sort((a, b) => String(b.name).length - String(a.name).length)[0];
    return null;
  }
  const priceFor = (name, models) => modelFor(name, models)?.input ?? null;

  // 总表：并集所有模型，按「上榜数 → 平均分位」排
  function buildBenchTable(ids) {
    const cols = ids.map((id) => ({ id, ...indexBoard(id) })).filter((c) => c.board);
    if (!cols.length) return { cols: [], rows: [] };

    const order = new Map();
    for (const c of cols) for (const r of c.board.rows) order.set(r.model.toLowerCase(), r.model);

    const rows = [...order.entries()]
      .map(([key, model]) => {
        const cells = cols.map((c) => c.map.get(key) || null);
        // 归一化分位：各榜量纲不同（Elo / 百分数 / 指数），用榜内名次百分比对齐
        const pcts = cells
          .map((cell, i) => {
            if (!cell) return null;
            const n = cols[i].board.rows.length;
            const rank = cols[i].board.rows.indexOf(cell) + 1;
            return n > 1 ? 1 - (rank - 1) / (n - 1) : 1;
          })
          .filter((v) => v != null);
        const avg = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : -1;
        const hits = cells.filter(Boolean).length;
        return { model, cells, avg, hits };
      })
      .filter((r) => r.hits > 0)
      .sort((a, b) => b.hits - a.hits || b.avg - a.avg)
      .map((r, i) => ({ ...r, rank: i + 1 }));

    return { cols, rows };
  }

  function fmtScore(v, unit) {
    if (v == null) return '<span class="dim">—</span>';
    const n = unit === 'elo' ? v.toFixed(0) : v >= 100 ? v.toFixed(0) : v.toFixed(1);
    return n;
  }

  /* ── 榜选择器 ── */
  function benchPicker(groups, cat) {
    const picks = new Set(benchSelected());
    const group = state.benchGroup || 'all';
    const list = group === 'all' ? cat : cat.filter((c) => c.group === group);

    // 同一 cfg 的细分太多，折叠起来；只显示主要榜 + 已选中的
    const main = list.filter((c) => !c.sub);
    const subs = list.filter((c) => c.sub);

    return `
      <div class="controls">
        <div class="chips" role="group" aria-label="维度">
          <button class="chip" data-benchgroup="all" aria-pressed="${group === 'all'}">全部 ${cat.length}</button>
          ${[...groups]
            .sort((a, b) => (a.id === 'general' ? -1 : b.id === 'general' ? 1 : 0))
            .map((g) => {
              const n = cat.filter((c) => c.group === g.id).length;
              return `<button class="chip" data-benchgroup="${g.id}" aria-pressed="${group === g.id}">${esc(g.name)} ${n}</button>`;
            })
            .join('')}
        </div>
        <span class="spacer"></span>
        <span class="eyebrow">点榜单加入对比 · 已选 ${picks.size}</span>
      </div>
      <div class="benchpick">
        ${main
          .map((c) => {
            const on = picks.has(c.id);
            return `<button class="bpick ${on ? 'on' : ''}" data-benchpick="${esc(c.id)}" aria-pressed="${on}" title="${esc(c.note || '')}">
            <b>${esc(c.name)}</b>
            <span class="bp-meta">${c.rows} 模型 · ${c.stale ? '沿用上次' : esc(c.updated || '—')}${c.outdated ? `<em class="bp-old">${c.ageMonths} 个月前</em>` : ''}</span>
          </button>`;
          })
          .join('')}
        ${
          subs.length
            ? `<details class="bpsub"><summary>细分维度 ${subs.length}</summary>
          <div class="bpsub-list">
            ${subs
              .map((c) => {
                const on = picks.has(c.id);
                return `<button class="bpick sm ${on ? 'on' : ''}" data-benchpick="${esc(c.id)}" aria-pressed="${on}">
                <b>${esc(c.name)}</b><span class="bp-meta">${c.rows}</span>
              </button>`;
              })
              .join('')}
          </div>
        </details>`
            : ''
        }
      </div>`;
  }

  /* ── 总表 ── */
  function benchTable(ids) {
    const { cols, rows } = buildBenchTable(ids);
    if (!cols.length) return `<div class="empty"><b>这些榜还没有数据</b>等下一轮采集。</div>`;
    const models = state.data.models || [];

    const show = rows.slice(0, state.benchLimit || 60);

    return `
      <div class="tablewrap" tabindex="0" role="region" aria-label="评测总表" style="max-height:640px">
        <table class="benchtbl">
          <caption class="sr">跨榜对照：同一模型在多个榜上的分数</caption>
          <thead><tr>
            <th style="width:38px">#</th>
            <th style="min-width:180px">模型</th>
            ${cols
              .map(
                (c) => `<th class="num bp-col" title="${esc(c.board.note || '')}">
              <b>${esc(c.board.name)}</b><span>${esc(c.board.updated || '')}</span>
            </th>`,
              )
              .join('')}
            <th class="num" style="width:70px">输入</th>
            <th class="num hidesm" style="width:70px">输出</th>
            <th class="num hidesm" style="width:70px">缓存读</th>
          </tr></thead>
          <tbody>
          ${show
            .map(
              (r) => `<tr>
            <td class="num" style="color:var(--faint)">${r.rank}</td>
            <td><b>${esc(r.model)}</b></td>
            ${r.cells
              .map((cell, i) => {
                const b = cols[i].board;
                if (!cell) return `<td class="num"><span class="dim">—</span></td>`;
                const pct = b.rows.length > 1 ? 1 - b.rows.indexOf(cell) / (b.rows.length - 1) : 1;
                return `<td class="num bcell" data-pct="${pct.toFixed(3)}">
                <span class="bval">${fmtScore(cell.score, b.unit)}</span>
                ${cell.rank ? `<span class="brank">#${cell.rank}</span>` : ''}
              </td>`;
              })
              .join('')}
            ${(() => {
              const m = modelFor(r.model, models);
              const cell = (v) =>
                v != null && v > 0 ? `$${money(v)}` : '<span class="dim">—</span>';
              return `<td class="num">${cell(m?.input)}</td>
                <td class="num hidesm">${cell(m?.output)}</td>
                <td class="num hidesm">${cell(m?.cache_read)}</td>`;
            })()}
          </tr>`,
            )
            .join('')}
          </tbody>
        </table>
      </div>
      ${rows.length > show.length ? `<div class="more"><button class="chip" data-benchmore="1">再看 ${Math.min(60, rows.length - show.length)} 个（共 ${rows.length}）</button></div>` : ''}`;
  }

  /* ── 团队在用：OpenRouter 实际用量 + Hacker News 公开讨论 ── */
  function benchAdopt() {
    const apps = state.data.orApps || [];
    const hn = state.data.hnSignals || [];
    if (!apps.length) return `<div class="empty"><b>还没有采纳数据</b>等下一轮采集。</div>`;
    const maxTok = Math.max(...apps.map((a) => a.tokens), 1);
    return `
      <p class="tnote">左列是按 OpenRouter 实际 token 消耗排的使用量；右列是 Hacker News 标题含该工具名的帖子数与评论数。</p>
      <div class="apphead"><span>工具</span><span>分类</span><span></span><span>用量</span><span>民间声量</span></div>
      <div class="applist">
        ${apps
          .map((a) => {
            const h = hn.find((x) => x.name.toLowerCase() === String(a.title).toLowerCase());
            return `<a class="approw" href="https://openrouter.ai/apps/${esc(a.slug || '')}" target="_blank" rel="noopener">
            <span class="ar-n">${esc(a.title)}</span>
            <span class="ar-c">${(a.categories || [])
              .slice(0, 2)
              .map((c) => `<i>${esc(c)}</i>`)
              .join('')}</span>
            <span class="ar-t"><i style="width:${Math.max(3, (Math.log10(Math.max(a.tokens, 1)) / Math.log10(maxTok * 1.2)) * 100).toFixed(1)}%"></i></span>
            <span class="ar-v">${(a.tokens / 1e12).toFixed(1)}T</span>
            <span class="ar-hn" title="${h ? esc(h.topTitle) : ''}">${h ? `${kfmt(h.mentions)} 帖 · ${kfmt(h.talk)} 评` : '—'}</span>
          </a>`;
          })
          .join('')}
      </div>`;
  }

  /* ── 单榜明细 ── */
  function benchSingle(id) {
    const b = benchBoards()[id];
    if (!b) return '';
    const models = state.data.models || [];
    const top = b.rows[0];
    const max = top?.score || 1;
    const min = Math.min(...b.rows.map((r) => r.score));

    return `
      <section class="bsc">
        <div class="bschead">
          <h3>${esc(b.name)}</h3>
          <p>${esc(b.note || '')}</p>
          ${(() => {
            const c = benchCatalog().find((x) => x.id === id);
            return c?.outdated
              ? `<p class="bwarn">这个榜最后一次更新是 ${esc(b.updated)}，已经 ${c.ageMonths} 个月没动。分数可以看，但别当成当前能力。</p>`
              : '';
          })()}
        </div>
        <div class="tablewrap" tabindex="0" role="region" aria-label="${esc(b.name)} 榜单" style="max-height:600px">
          <table>
            <caption class="sr">${esc(b.name)}</caption>
            <thead><tr>
              <th style="width:44px">#</th><th>模型</th>
              <th class="num">${b.unit === 'elo' ? 'Elo' : '分数'}</th>
              <th class="num hidesm" style="width:96px">分布</th>
              <th class="num hidesm">输入价</th>
              <th class="num hidesm">每美元分数</th>
            </tr></thead>
            <tbody>
            ${b.rows
              .slice(0, 80)
              .map((r) => {
                const p = priceFor(r.model, models);
                const span = r.lo != null && r.hi != null ? Math.max(0, r.hi - r.lo) : null;
                return `<tr>
                <td class="num" style="color:var(--faint)">${r.rank ?? '·'}</td>
                <td><b>${esc(r.model)}</b>${r.org ? `<span class="vend">${esc(r.org)}</span>` : ''}${r.human ? '<span class="tag-human">人类</span>' : ''}</td>
                <td class="num"><b>${fmtScore(r.score, b.unit)}</b></td>
                <td class="num hidesm">${
                  r.lo != null && r.hi != null
                    ? `<span class="ci" title="95% 置信区间 ${r.lo}–${r.hi}"><i style="left:${(((r.lo - min) / (max - min || 1)) * 100).toFixed(1)}%;width:${Math.max(3, (span / (max - min || 1)) * 100).toFixed(1)}%"></i></span>`
                    : '<span class="dim">—</span>'
                }</td>
                <td class="num hidesm">${p ? `$${money(p)}` : '<span class="dim">—</span>'}</td>
                <td class="num hidesm">${p && b.unit !== 'elo' ? `<span class="val">${(r.score / p).toFixed(1)}</span>` : '<span class="dim">—</span>'}</td>
              </tr>`;
              })
              .join('')}
            </tbody>
          </table>
        </div>
        ${b.rows.length > 80 ? `<p class="tnote">显示前 80 个，共 ${b.rows.length} 个。</p>` : ''}
        <p class="tnote">数据：${extLink(b.url, `${esc(b.name)} 原始榜`)}${b.updated ? ` · 更新于 ${esc(b.updated)}` : ''}</p>
      </section>`;
  }

  /* ── 主视图 ── */
  function viewBench() {
    if (!state.benchFull && !state.benchLoading) {
      loadBench().then(() => render());
      return `<div class="empty"><b>正在读取评测数据</b>bench.json 是单独文件，按需加载。</div>`;
    }
    if (!state.benchFull) return `<div class="empty"><b>正在读取评测数据</b>…</div>`;

    const cat = benchCatalog();
    const groups = state.data.bench.groups || [];
    if (!cat.length)
      return `<div class="empty"><b>评测层还没有数据</b>运行 <code>node collect.mjs</code> 重新采集。</div>`;

    const picks = benchSelected();
    const stats = state.data.bench.stats || {};
    const src = state.data.bench.sources || [];

    const view = state.benchView || 'table';

    return `
      <div class="bstat">
        <div><b>${stats.boards || cat.length}</b><span>个榜</span></div>
        <div><b>${kfmt(stats.rows || 0)}</b><span>条分数</span></div>
        <div><b>${kfmt(stats.models || 0)}</b><span>个模型</span></div>
        <div><b>${src.filter((s) => s.ok).length}/${src.length}</b><span>源正常</span></div>
        <div class="bstat-src">${src.map((s) => `${extLink(s.home, esc(s.name), ` class="${s.ok ? '' : 'bad'}" title="${esc(s.note || '')}${s.error ? ` · ${esc(s.error)}` : ''}"`)}`).join('')}</div>
      </div>

      ${benchPicker(groups, cat)}

      <div class="controls">
        <div class="chips" role="group" aria-label="视图">
          <button class="chip" data-benchview="table" aria-pressed="${view === 'table'}">对照表</button>
          <button class="chip" data-benchview="single" aria-pressed="${view === 'single'}">单榜明细</button>
          <button class="chip" data-benchview="value" aria-pressed="${view === 'value'}">分数 × 价格</button>
          <button class="chip" data-benchview="adopt" aria-pressed="${view === 'adopt'}">团队在用 ${(state.data.orApps || []).length}</button>
        </div>
        <span class="spacer"></span>
        ${view !== 'single' && picks.length > 1 ? `<button class="chip" data-benchclear="1">清空选择</button>` : ''}
      </div>

      <div id="benchBody">
        ${
          view === 'adopt'
            ? benchAdopt()
            : view === 'single'
              ? benchSingle(picks[0] || cat.find((c) => !c.sub)?.id || cat[0].id)
              : view === 'value'
                ? `<section class="bsc"><div class="bschead"><h3>贵的不一定强</h3>
                 <p>横轴是每百万输入 token 的价格（对数），纵轴是当前榜单分数。绿点是每美元买到最多分数的。</p></div>
               <svg id="benchScatter" viewBox="0 0 1200 340" preserveAspectRatio="xMidYMid meet" role="img" aria-label="分数与价格"></svg>
               <div class="bslegend"><span><i class="dot top"></i>分数最高</span><span><i class="dot val"></i>性价比最高</span></div></section>`
                : benchTable(picks)
        }
      </div>

      <div class="tfoot"><span>各榜量纲不同（Elo / 百分数 / 指数），对照表按榜内名次换算成相对位置，不直接相加；点列头标题可看该榜说明。同一模型的多个推理档位已合并，保留最强的一档。</span></div>`;
  }

  // 散点：用当前第一个选中榜的分数 × 价格
  function renderBenchScatter() {
    const svg = document.getElementById('benchScatter');
    if (!svg) return;
    const ids = benchSelected();
    const b = benchBoards()[ids[0]];
    if (!b) {
      svg.parentElement.style.display = 'none';
      return;
    }

    const models = state.data.models || [];
    const pts = b.rows
      .map((r) => ({ name: r.model, score: r.score, price: priceFor(r.model, models) }))
      .filter((p) => p.price != null && p.price > 0);
    if (pts.length < 3) {
      svg.parentElement.style.display = 'none';
      return;
    }
    svg.parentElement.style.display = '';

    const narrow = (svg.clientWidth || 1200) < 620;
    const W = 1200,
      H = narrow ? 620 : 340;
    const padL = 54,
      padR = narrow ? 40 : 150,
      padT = 26,
      padB = 48;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    const ps = pts.map((p) => p.price),
      sc = pts.map((p) => p.score);
    const lo = Math.min(...ps) * 0.7,
      hi = Math.max(...ps) * 1.4;
    const sMin = Math.min(...sc),
      sMax = Math.max(...sc);
    const span = sMax - sMin || 1;
    const sLo = sMin - span * 0.08,
      sHi = sMax + span * 0.08;
    const X = (v) =>
      padL +
      ((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo) || 1)) *
        (W - padL - padR);
    const Y = (v) => padT + (1 - (v - sLo) / (sHi - sLo)) * (H - padT - padB);

    let grid = '';
    for (let p = Math.floor(Math.log10(lo)); p <= Math.ceil(Math.log10(hi)); p++) {
      const v = 10 ** p;
      if (v < lo || v > hi) continue;
      const x = X(v);
      grid += `<line class="bs-grid" x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${H - padB}"/>`;
      grid += `<text class="bs-t" x="${x.toFixed(1)}" y="${H - padB + 20}" text-anchor="middle">$${v >= 1 ? v : v.toFixed(2)}</text>`;
    }
    for (let i = 0; i <= 4; i++) {
      const v = sLo + (sHi - sLo) * (i / 4);
      const y = Y(v);
      grid += `<line class="bs-grid" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}"/>`;
      grid += `<text class="bs-t" x="${padL - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end">${b.unit === 'elo' ? v.toFixed(0) : v.toFixed(1)}</text>`;
    }

    const bestScore = pts.reduce((a, b2) => (a.score >= b2.score ? a : b2));
    const bestValue = pts.reduce((a, b2) => (a.score / a.price >= b2.score / b2.price ? a : b2));

    const placed = [];
    const dots = pts
      .map((p) => {
        const x = X(p.price),
          y = Y(p.score);
        const isTop = p === bestScore,
          isVal = p === bestValue;
        let ty = y;
        for (const q of placed)
          if (Math.abs(q.y - ty) < 11 && Math.abs(q.x - x) < 160) ty = q.y + 12;
        placed.push({ x, y: ty });
        const showLabel = isTop || isVal || pts.length <= 22;
        return (
          `<circle class="bs-dot ${isTop ? 'top' : isVal ? 'val' : ''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${isTop || isVal ? 5 : 3.4}"><title>${esc(p.name)} · ${fmtScore(p.score, b.unit)} · $${money(p.price)}/1M</title></circle>` +
          (showLabel
            ? `<text class="bs-l" x="${(narrow ? x : x + 9).toFixed(1)}" y="${(ty + 4).toFixed(1)}" text-anchor="${narrow ? 'middle' : 'start'}">${esc(p.name.length > 22 ? `${p.name.slice(0, 21)}…` : p.name)}</text>`
            : '')
        );
      })
      .join('');

    svg.innerHTML = `${grid}${dots}`;
  }

  /* ── vendors ── */
  function viewVendors() {
    const by = new Map();
    for (const m of state.data.models) {
      const v = by.get(m.vendor) || {
        vendor: m.vendor,
        n: 0,
        minIn: null,
        minOut: null,
        bestDisc: null,
        free: 0,
        cheapest: null,
      };
      v.n++;
      if (m.free) v.free++;
      if (!m.free && m.input != null) {
        if (v.minIn == null || m.input < v.minIn) {
          v.minIn = m.input;
          v.cheapest = m;
        }
        if (v.minOut == null || m.output < v.minOut) v.minOut = m.output;
        if (m.cache_read != null) {
          const d = 1 - m.cache_read / m.input;
          if (v.bestDisc == null || d > v.bestDisc) v.bestDisc = d;
        }
      }
      by.set(m.vendor, v);
    }
    const offerCount = new Map();
    for (const o of state.data.offers) {
      for (const m of state.data.models) {
        if (
          o.vendor &&
          m.vendor &&
          (o.vendor === m.vendor || m.vendor.includes(o.vendor) || o.vendor.includes(m.vendor))
        ) {
          offerCount.set(m.vendor, (offerCount.get(m.vendor) || 0) + 1);
          break;
        }
      }
    }
    const rows = [...by.values()].sort((a, b) => {
      const fa = focusSet().has(a.vendor) ? 0 : 1,
        fb = focusSet().has(b.vendor) ? 0 : 1;
      if (fa !== fb) return fa - fb;
      return (a.minIn ?? Infinity) - (b.minIn ?? Infinity);
    });
    return `
      <div class="tablewrap" tabindex="0" role="region" aria-label="数据表，可横向滚动"><table><caption class="sr">按厂商聚合</caption>
        <thead><tr>
          <th style="cursor:default">厂商</th><th class="num" style="cursor:default">模型</th>
          <th class="num" style="cursor:default">最低输入</th><th class="num" style="cursor:default">最低输出</th>
          <th class="num hidesm" style="cursor:default">最大缓存折扣</th><th style="cursor:default">最便宜模型</th>
          <th class="num" style="cursor:default">免费模型</th><th class="num hidesm" style="cursor:default">免费渠道</th>
        </tr></thead>
        <tbody>
        ${rows
          .map(
            (v) => `<tr data-vendor="${esc(v.vendor)}">
          <td><b>${esc(v.vendor)}</b>${focusSet().has(v.vendor) ? ' <span class="tag">主流</span>' : ''}</td>
          <td class="num">${v.n}</td>
          <td class="num">${v.minIn == null ? '<span class="dim">免费</span>' : `$${money(v.minIn)}`}</td>
          <td class="num">${v.minOut == null ? '<span class="dim">—</span>' : `$${money(v.minOut)}`}</td>
          <td class="num hidesm">${v.bestDisc == null ? '<span class="dim">—</span>' : `<span class="${v.bestDisc > 0.5 ? 'best' : ''}">${pct(v.bestDisc)}</span>`}</td>
          <td class="vend">${esc(v.cheapest ? v.cheapest.name : '—')}</td>
          <td class="num">${v.free ? `<span class="best">${v.free}</span>` : '<span class="dim">—</span>'}</td>
          <td class="num hidesm">${offerCount.get(v.vendor) || 0}</td>
        </tr>`,
          )
          .join('')}
        </tbody></table>
      </div>
      <div class="tfoot"><span>主流厂商排前，其次按最低输入价升序 · 点一行跳到该厂商比价</span></div>`;
  }

  /* ── signals（情报）──
     「更大跨度 + 更省空间」的做法：
     · 数据侧：归档只增不删，短键压缩，185 天 × 平均 250B
     · 视图侧：先在日/周/月/季/年五个尺度上看「哪天有事」，再逐层下钻，
       全程只在屏幕上留一条密度带 + 一大截留白，而不是把 2000 条全部铺开 */
  // 尺度用「日历单位」而不是固定毫秒步长：月长 28~31 天不等，
  // 按 30.44 天切桶会把 10 月整段错位到 9 月的桶里，最后一个月格子凭空消失。
  const NEWS_SCALES = [
    { id: 'd', label: '日' },
    { id: 'w', label: '周' },
    { id: 'm', label: '月' },
    { id: 'q', label: '季' },
    { id: 'y', label: '年' },
  ];
  const NEWS_PRESETS = [
    { id: '7', label: '近 7 天', days: 7 },
    { id: '30', label: '30 天', days: 30 },
    { id: '90', label: '90 天', days: 90 },
    { id: 'all', label: '全部', days: 0 },
  ];
  const newsDay = (s) => Date.parse(`${s}T00:00:00+08:00`);
  const newsFmt = (ts, scale) => {
    const d = new Date(ts);
    if (scale === 'y') return String(d.getFullYear());
    if (scale === 'q') return `${d.getFullYear()}.Q${Math.floor(d.getMonth() / 3) + 1}`;
    if (scale === 'd')
      return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const NEWS_TOPIC_TONE = {
    price: 1,
    model: 2,
    funding: 3,
    policy: 4,
    safety: 5,
    product: 6,
    research: 7,
    other: 8,
  };

  function viewSignals() {
    const idx = newsIndex();
    const items = newsItems();
    const sig = state.data.signals || [];
    const sigList = sig.filter((x) => state.sigSrc === 'all' || x.source_type === state.sigSrc);
    const loading = !Array.isArray(state.data?.news) && !Array.isArray(state.newsFull);

    // 归档没拉到之前先出一版骨架，避免整页等一个 500KB 的请求
    if (loading || !items.length) {
      const span = idx.span || 0;
      return `
        <div class="controls">
          <span class="eyebrow">${idx.n || 0} 条 · ${idx.days || 0} 天有内容 · 跨度 ${span} 天</span>
        </div>
        <div class="empty">${state.newsError ? `归档没拉下来：${esc(state.newsError)}` : '正在拉归档…'}</div>`;
    }

    /* 时间窗：默认「全部」，跨度越长越省地方 */
    // 「当前时刻」用今天，不能只用归档里最新的一天：否则今天 0 条时最后一个格子会空掉，
    // 而它恰恰是用户最想看的那一格。
    const lastItem = Math.max(...items.map((n) => newsDay(n.date)).filter(Number.isFinite));
    const today = Math.max(lastItem, newsDay((state.data?.meta?.date || '').slice(0, 10)) || 0);
    const spanAll = (today - Math.min(...items.map((n) => newsDay(n.date)))) / 864e5;
    const presets = NEWS_PRESETS.filter((p) => p.days === 0 || spanAll >= p.days * 0.5);
    // 从密度带点进来的自定义窗口，单独给一个按钮，否则整排「时间范围」都是未选中态
    const custom = state.newsRange !== 'all' && !presets.some((p) => p.id === state.newsRange);
    const rangeDays = state.newsRange === 'all' ? Infinity : Number(state.newsRange);
    const inWin = (n) => {
      const t = newsDay(n.date);
      return Number.isFinite(t) ? (today - t) / 864e5 <= rangeDays : false;
    };

    const filtered = items.filter(
      (n) =>
        inWin(n) &&
        (state.newsTopic === 'all' || n.topic === state.newsTopic) &&
        (state.newsImp === 'all' || (n.importance || 'daily') === state.newsImp),
    );

    /* 一、密度带：每个格子 = 一个时间桶，颜色深浅 = 条数，点子 = 重大 */
    const scale = NEWS_SCALES.find((s) => s.id === state.newsScale) || NEWS_SCALES[0];
    const winStart =
      rangeDays === Infinity
        ? Math.min(...items.map((n) => newsDay(n.date)))
        : today - rangeDays * 864e5;
    // 日历桶：日/周/月/季/年各自按自然边界切，格子的数量 = 这段时间真的跨了几个周期
    const bucketOf = (ts) => {
      const d = new Date(ts);
      const y = d.getFullYear();
      const mo = d.getMonth();
      const day = d.getDate();
      if (scale.id === 'd') {
        const b = new Date(y, mo, day);
        return [b.getTime(), new Date(y, mo, day + 1).getTime()];
      }
      if (scale.id === 'w') {
        const dow = (d.getDay() + 6) % 7; // 周一为一周之始
        const b = new Date(y, mo, day - dow);
        return [b.getTime(), new Date(y, mo, day - dow + 7).getTime()];
      }
      if (scale.id === 'm') return [new Date(y, mo, 1).getTime(), new Date(y, mo + 1, 1).getTime()];
      if (scale.id === 'q') {
        const q0 = Math.floor(mo / 3) * 3;
        return [new Date(y, q0, 1).getTime(), new Date(y, q0 + 3, 1).getTime()];
      }
      return [new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime()];
    };
    const _bucketKey = (ts) => {
      const d = new Date(ts);
      if (scale.id === 'y') return String(d.getFullYear());
      if (scale.id === 'q') return `${d.getFullYear()}.Q${Math.floor(d.getMonth() / 3) + 1}`;
      return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
    };
    const buckets = [];
    const seenBucket = new Map();
    for (const n of filtered) {
      const t = newsDay(n.date);
      if (!Number.isFinite(t)) continue;
      const [b0, b1] = bucketOf(t);
      let b = seenBucket.get(b0);
      if (!b) {
        b = { t: b0, t1: b1, n: 0, major: 0, items: [] };
        seenBucket.set(b0, b);
        buckets.push(b);
      }
      b.n += 1;
      b.items.push(n);
      if (n.importance === 'major') b.major += 1;
    }
    // 密度带的起点要能装下「从 ChatGPT 起」的整段：把最左的桶向前补到 2022-11-30。
    // 这一段没有归档新闻，会显示成浅灰空窗——那正是诚实的样子。
    const EPOCH0 = Date.parse('2022-11-30T00:00:00+08:00');
    const lead = filtered.length ? Math.min(...filtered.map((n) => newsDay(n.date))) : today;
    const barStart = Math.min(lead, EPOCH0);
    // 中间没有新闻的周期也要占位，否则「空窗」看不出是缺数据还是真没新闻。
    // 逐桶的边界一律由 bucketOf 决定，保证与上面写数据时用的是同一套切法。
    if (buckets.length) {
      buckets.sort((a, b) => a.t - b.t);
      const filled = [];
      const [s0] = bucketOf(barStart);
      let cur = Math.min(s0, buckets[0].t);
      const lastEnd = Math.max(buckets[buckets.length - 1].t1, bucketOf(today)[0] + 1);
      let guardN = 0;
      while (cur < lastEnd && guardN++ < 5000) {
        const [b0, b1] = bucketOf(cur);
        filled.push(seenBucket.get(b0) || { t: b0, t1: b1, n: 0, major: 0, items: [] });
        cur = b1;
      }
      buckets.length = 0;
      buckets.push(...filled);
    }
    for (const b of buckets) {
      b.lead = b.items.slice().sort((a, c) => (c.score ?? 0) - (a.score ?? 0))[0] || null;
    }
    void winStart;
    const maxN = Math.max(1, ...buckets.map((b) => b.n));
    newsBuckets = buckets.map((b) => ({ t: b.t, t1: b.t1 }));
    const heat = (n) =>
      n === 0 ? 0 : Math.min(1, 0.18 + (0.82 * Math.log1p(n)) / Math.log1p(maxN));

    const activeCount = filtered.length;
    const topicCount = {};
    for (const n of filtered) topicCount[n.topic] = (topicCount[n.topic] || 0) + 1;
    const topicLabel = {};
    for (const n of filtered) topicLabel[n.topic] = n.topicLabel || n.topic;
    const majorCount = filtered.filter((n) => n.importance === 'major').length;
    const dailyCount = activeCount - majorCount;

    /* 二、时间轴：按当前尺度分段落，有内容的段才出现，空段合并成一行「空窗」 */
    const groups = [];
    for (let i = buckets.length - 1; i >= 0; i--) {
      const b = buckets[i];
      const key = newsFmt(b.t, scale.id);
      let g = groups[groups.length - 1];
      if (!g || g.key !== key) {
        g = { key, t: b.t, n: 0, empty: 0, items: [] };
        groups.push(g);
      }
      g.n += b.n;
      if (b.n === 0) g.empty += 1;
      if (b.n)
        g.items.push(...filtered.filter((n) => newsDay(n.date) >= b.t && newsDay(n.date) < b.t1));
    }
    // 展示密度：默认只把「有内容」的段摊开；空窗用一行字交代
    const shown = groups.filter((g) => g.n > 0).slice(0, state.newsLimit || 12);
    const hiddenGroups = groups.filter((g) => g.n > 0).length - shown.length;

    const dayOf = (n) => n.date.slice(5).replace('-', '/');

    /* ── 超级大事件：一条山脊 ──
       问题不是「缺装饰」，是这层要在一屏内回答三件事：
         1) 行业在哪几处拐了弯（时间位置）
         2) 每一段是什么气候（时代）
         3) 相邻事件的疏密差多少（节奏）
       所以用一条连续的脊线把事件串起来：脊的高度 = 事件严重度，脊上下的
       明暗 = 时代，节点是钉在脊上的刻度。全部按真实时间比例铺，不做等距。 */
    const winStartMs = Math.min(barStart, EPOCH0);
    const winEndMs = today;
    const spanMs = Math.max(1, winEndMs - winStartMs);
    const scaleX = (ts) => Math.max(0, Math.min(100, ((ts - winStartMs) / spanMs) * 100));
    const tsOf = (d) => Date.parse(`${d}T00:00:00+08:00`);
    const msAll = (Array.isArray(state.ms) ? state.ms : [])
      .slice()
      .sort((a, b) => a.d.localeCompare(b.d));
    const msIn = msAll.filter((e) => {
      const t = tsOf(e.d);
      return Number.isFinite(t) && t >= winStartMs && t <= winEndMs + 864e5;
    });
    const meta = state.msMeta || [];
    const eraOf = (id) => meta.find((x) => x.id === id) || { name: '—', full: '—', span: '' };

    /* 每个事件算一个「严重度」：转折点 2.4，关键节点 1，越近的略高一点（近期更值得注意） */
    const pts = msIn
      .map((e, i) => {
        const ts = tsOf(e.d);
        const x = scaleX(ts);
        const recency = (ts - winStartMs) / spanMs; // 0→1
        const h = (e.tier === 'era' ? 2.4 : 1) + recency * 0.5;
        return { ...e, ts, x, h, i };
      })
      .sort((a, b) => a.x - b.x);

    /* 月份标签只给「转折点」且互不压字：按 x 扫一遍，够远才显形。
       38 个节点全带标签会挤成一排乱码，等于没标。 */
    (() => {
      let cursor = -Infinity;
      pts.forEach((p) => {
        p.showMo = false;
        if (p.tier !== 'era') return;
        const labelPct = 3.4; // 5 个字符的月份标签约占 3.4% 宽
        if (p.x - cursor >= labelPct) {
          p.showMo = true;
          cursor = p.x;
        }
      });
    })();

    /* 脊线：每个事件是一个「峰」，峰的两侧用高斯衰减落到低谷（不是零基线）。
       低谷 = 安静的时期，峰 = 事件发生；这样曲线形状才和数据一一对应。
       两端不额外补点——补 0 会凭空长出一段下坠，是没依据的形状。 */
    const VW = 1000,
      VH = 150,
      BASE = VH - 26,
      _FLOOR = BASE - 8;
    const sx = (p) => (p / 100) * VW;
    const maxH = Math.max(1, ...pts.map((p) => p.h));
    const sy = (h) => BASE - (h / maxH) * (BASE - 16);
    /* 每个点的「影响半径」= 与左右邻居时间距离的一半，避免人挤的地方互相淹没 */
    const SIG = pts.map((p, i) => {
      const l = i > 0 ? p.x - pts[i - 1].x : pts[1] ? pts[1].x - p.x : 6;
      const r = i < pts.length - 1 ? pts[i + 1].x - p.x : l;
      return Math.max(1.1, Math.min(l, r) * 0.42);
    });
    const curveY = (x) => {
      let v = 0;
      for (let i = 0; i < pts.length; i += 1) {
        const dz = (x - pts[i].x) / SIG[i];
        const g = Math.exp(-dz * dz * 0.5);
        // 平台：离事件足够近时保持满高，脊线在事件处不会「被抹圆」
        const flat = Math.abs(x - pts[i].x) <= SIG[i] * 0.5 ? 1 : g;
        v += Math.max(g, flat) * pts[i].h;
      }
      return Math.min(maxH, v);
    };
    let ridge = '',
      area = '';
    if (pts.length) {
      const SAMP = 420;
      const xs = [];
      for (let k = 0; k <= SAMP; k += 1) xs.push((k / SAMP) * 100);
      // 采样点 + 精确落在每个事件 x 上，保证峰顶被点到
      const x0 = pts[0].x,
        x1 = pts[pts.length - 1].x;
      // 每个事件周围取一条「平台」（宽度 = 影响半径的一半），让峰顶是平的，
      // 钉点正好落在平台上——否则高斯平滑会把点抬到曲线上方，看起来点没落在线上。
      const plateau = pts.flatMap((p) => {
        const half = SIG[pts.indexOf(p)] * 0.5;
        return [p.x - half, p.x, p.x + half];
      });
      const allX = [...new Set([x0, x1, ...xs.filter((x) => x > x0 && x < x1), ...plateau])].sort(
        (a, b) => a - b,
      );
      const d = allX
        .map((x, i) => `${i ? 'L' : 'M'} ${sx(x).toFixed(1)} ${sy(curveY(x)).toFixed(1)}`)
        .join(' ');
      ridge = d;
      area = `${d} L ${sx(x1).toFixed(1)} ${BASE} L ${sx(x0).toFixed(1)} ${BASE} Z`;
    }

    /* 时代分段：用真实首末事件切，每一段画一条淡色底 */
    const eras = meta
      .map((m, i) => {
        const own = pts.filter((p) => p.e === m.id);
        if (!own.length) return null;
        let nextX = 100;
        for (let j = i + 1; j < meta.length; j += 1) {
          const nxt = pts.filter((p) => p.e === meta[j].id);
          if (nxt.length) {
            nextX = nxt[0].x;
            break;
          }
        }
        return { ...m, x0: own[0].x, x1: nextX, n: own.length };
      })
      .filter(Boolean);

    const keyOf = (e) => `${e.d}|${e.title}`;
    const pick = state.msSel && msAll.find((m) => keyOf(m) === state.msSel);
    const sel = pick || pts.find((p) => p.tier === 'era') || pts[0] || null;
    const VERIFY = {
      checked: { t: '已核实', cls: 'ok' },
      part: { t: '部分核实', cls: 'part' },
      unchecked: { t: '待核实', cls: 'no' },
    };
    const ver = (sel && VERIFY[sel.v]) || VERIFY.unchecked;
    const nearNews = sel
      ? newsItems()
          .filter((n) => {
            const t = newsDay(n.date);
            return Math.abs(t - sel.ts) <= 10 * 864e5;
          })
          .sort((a, b) => Math.abs(newsDay(a.date) - sel.ts) - Math.abs(newsDay(b.date) - sel.ts))
          .slice(0, 3)
      : [];
    const gaps = pts
      .slice(1)
      .map((p, i) => ({ days: Math.round((p.ts - pts[i].ts) / 864e5), from: pts[i], to: p }));
    const longest = gaps.slice().sort((a, b) => b.days - a.days)[0];

    const strip = msAll.length
      ? `
      <section class="rt" aria-label="超级大事件">
        <header class="rt-head">
          <p class="rt-eyebrow">TIMELINE · ${msAll.length} 个节点</p>
          <h2>从 ChatGPT 上线到今天<br><em>${meta.length} 个时代</em>　<em>${msAll.filter((e) => e.tier === 'era').length} 次改道</em></h2>
          <p class="rt-sub">${longest ? `<span title="${esc(`${longest.from.d} ${longest.from.title} → ${longest.to.d} ${longest.to.title}`)}">最长的静默 ${longest.days} 天 ${esc(longest.from.d.slice(2, 7))} → ${esc(longest.to.d.slice(2, 7))}</span>。` : ''}脊线按真实时间比例画，高度是分量；形状区分类别——<b class="rt-key k-price">■ 价格</b> <b class="rt-key k-use">▲ 用法</b> <b class="rt-key k-turn">◆ 转向</b> <span class="rt-key k-cap">● 能力</span>。</p>
        </header>

        <figure class="rt-fig">
          <svg class="rt-svg" viewBox="0 0 ${VW} ${VH}" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="rtFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--accent)" stop-opacity=".16"/>
                <stop offset="100%" stop-color="var(--accent)" stop-opacity=".01"/>
              </linearGradient>
            </defs>
            ${eras.map((m) => `<rect class="rt-era ${sel && sel.e === m.id ? 'on' : ''}" x="${sx(m.x0).toFixed(1)}" y="0" width="${Math.max(sx(m.x1) - sx(m.x0), 8).toFixed(1)}" height="${BASE}"></rect>`).join('')}
            <path class="rt-area" d="${area}"></path>
            <path class="rt-ridge" d="${ridge}"></path>
            <line class="rt-base" x1="0" y1="${BASE}" x2="${VW}" y2="${BASE}"></line>
            ${pts
              .map(
                (p) => `
              <line class="rt-stem ${p.tier === 'era' ? 'era' : ''} ${sel && keyOf(sel) === keyOf(p) ? 'on' : ''}"
                x1="${sx(p.x).toFixed(1)}" y1="${sy(curveY(p.x)).toFixed(1)}" x2="${sx(p.x).toFixed(1)}" y2="${BASE}"></line>
              ${(() => {
                const cx = sx(p.x).toFixed(1),
                  cy = sy(curveY(p.x)).toFixed(1);
                const on = sel && keyOf(sel) === keyOf(p) ? ' on' : '';
                const era = p.tier === 'era' ? ' era' : '';
                const r = p.tier === 'era' ? 4.6 : 2.9;
                // 形状即语义：不同类的事不该长成同一个点
                if (p.kind === 'price')
                  return `<rect class="rt-dot${era}${on}" x="${(+cx - r).toFixed(1)}" y="${(+cy - r).toFixed(1)}" width="${r * 2}" height="${r * 2}"></rect>`;
                if (p.kind === 'use')
                  return `<polygon class="rt-dot${era}${on}" points="${cx},${(+cy - r - 1).toFixed(1)} ${(+cx + r + 1).toFixed(1)},${(+cy + r).toFixed(1)} ${(+cx - r - 1).toFixed(1)},${(+cy + r).toFixed(1)}"></polygon>`;
                if (p.kind === 'turn')
                  return `<polygon class="rt-dot${era}${on}" points="${cx},${(+cy - r - 1).toFixed(1)} ${(+cx + r + 1).toFixed(1)},${cy} ${cx},${(+cy + r + 1).toFixed(1)} ${(+cx - r - 1).toFixed(1)},${cy}"></polygon>`;
                return `<circle class="rt-dot${era}${on}" cx="${cx}" cy="${cy}" r="${r}"></circle>`;
              })()}`,
              )
              .join('')}
            ${pts
              .map(
                (
                  p,
                ) => `<rect class="rt-grab" x="${(sx(p.x) - 7).toFixed(1)}" y="0" width="14" height="${BASE}"
                data-ms="${esc(keyOf(p))}"></rect>`,
              )
              .join('')}
          </svg>
          <div class="rt-origin"><span>起点</span></div>
          <div class="rt-hit">
            ${pts
              .map(
                (p) => `
              <button class="rt-node ${p.showMo ? 'era' : ''} ${sel && keyOf(sel) === keyOf(p) ? 'on' : ''}${p.x > 94 ? ' edge' : ''}"
                style="--x:${p.x}%" data-ms="${esc(keyOf(p))}" aria-label="${esc(`${p.d.slice(2, 7).replace('-', '.')} · ${p.d} ${p.title}`)}">
                <span class="rt-mo">${esc(p.d.slice(2, 7).replace('-', '.'))}</span>
              </button>`,
              )
              .join('')}
          </div>
          <div class="rt-eraLegend">
            ${eras
              .map((m) => {
                const own = pts.filter((p) => p.e === m.id);
                const c = (ks) => own.filter((p) => p.kind === ks).length;
                const tally = [
                  ['price', '■'],
                  ['use', '▲'],
                  ['turn', '◆'],
                ]
                  .filter(([k]) => c(k))
                  .map(([k, g]) => `<u class="k-${k}">${g}${c(k)}</u>`)
                  .join('');
                return `<button class="rt-chip ${sel && sel.e === m.id ? 'on' : ''}" data-msepoch="${esc(m.id)}" title="${esc(m.desc || '')}">
                <b>${esc(m.name)}<em class="rt-tally">${tally}</em></b><i>${esc(m.span || '')}　${own.length} 件</i></button>`;
              })
              .join('')}
          </div>
          <figcaption>左 ${esc(newsFmt(winStartMs, 'm'))}　·　按日等宽　·　右 ${esc(newsFmt(winEndMs, 'm'))}</figcaption>
        </figure>

        ${
          sel
            ? `
        <article class="rt-card">
          <div class="rt-when">
            <time>${esc(sel.d)}</time>
            <p class="rt-era">${esc(eraOf(sel.e).full)}</p>
            <div class="rt-flags">
              <span class="rt-kind k-${sel.kind}">${{ cap: '能力', price: '价格', use: '用法', turn: '转向' }[sel.kind] || '能力'}</span>
              <span class="rt-tier ${sel.tier === 'era' ? 'era' : ''}">${sel.tier === 'era' ? '改道' : '铺垫'}</span>
              <span class="rt-ver ${ver.cls}">${ver.t}</span>
            </div>
          </div>
          <div class="rt-body">
            <h3>${esc(sel.title)}</h3>
            ${sel.note ? `<p class="rt-note">${esc(sel.note)}</p>` : ''}
            <dl class="rt-meta">
              ${sel.update ? `<div><dt>之后</dt><dd>${esc(sel.update.d)}　${esc(sel.update.text)}</dd></div>` : ''}
              <div><dt>出处</dt><dd><a href="${esc(sel.src)}" target="_blank" rel="noopener">${esc(sel.srcNote || '打开原始来源')} ↗</a></dd></div>
              ${
                nearNews.length
                  ? `<div><dt>同期</dt><dd class="rt-near">${nearNews
                      .map(
                        (n) =>
                          `<a href="${esc(n.url)}" target="_blank" rel="noopener" title="${esc(n.summary || n.title)}">${esc(n.title.length > 24 ? `${n.title.slice(0, 23)}…` : n.title)}</a>`,
                      )
                      .join('')}</dd></div>`
                  : ''
              }
            </dl>
          </div>
        </article>`
            : ''
        }
      </section>`
      : `
      <div class="empty">${state.msErr ? `大事件清单没拉下来：${esc(state.msErr)}` : '正在加载大事件…'}</div>`;

    return `
      ${strip}
      <div class="controls">
        <div class="chips" role="group" aria-label="时间范围">
          ${presets.map((p) => `<button class="chip" data-newsrange="${p.id}" aria-pressed="${state.newsRange === p.id}">${p.label}</button>`).join('')}
          ${custom ? `<button class="chip" data-newsrange="all" aria-pressed="false" title="点一下回到全部">这 ${Math.round(Number(state.newsRange))} 天 ✕</button>` : ''}
        </div>
        <span class="spacer"></span>
        <span class="eyebrow">${activeCount} 条 · ${idx.days || '—'} 天有内容 · 跨度 ${idx.span || 0} 天</span>
      </div>

      <div class="controls">
        <div class="chips" role="group" aria-label="时间粒度">
          ${NEWS_SCALES.map((s) => `<button class="chip" data-newsscale="${s.id}" aria-pressed="${state.newsScale === s.id}">${s.label}</button>`).join('')}
        </div>
        <span class="spacer"></span>
        <div class="chips" role="group" aria-label="重要程度">
          <button class="chip" data-newsimp="all" aria-pressed="${state.newsImp === 'all'}">全部 ${activeCount}</button>
          <button class="chip" data-newsimp="major" aria-pressed="${state.newsImp === 'major'}">重大 ${majorCount}</button>
          <button class="chip" data-newsimp="daily" aria-pressed="${state.newsImp === 'daily'}">日常 ${dailyCount}</button>
        </div>
      </div>

      <div class="controls">
        <div class="chips" role="group" aria-label="要闻分类">
          <button class="chip" data-newstopic="all" aria-pressed="${state.newsTopic === 'all'}">全部主题</button>
          ${Object.entries(topicCount)
            .sort((a, b) => b[1] - a[1])
            .map(
              ([k, n]) =>
                `<button class="chip" data-newstopic="${k}" aria-pressed="${state.newsTopic === k}">${esc(topicLabel[k] || k)} <b style="font-weight:400">${n}</b></button>`,
            )
            .join('')}
        </div>
      </div>

      <div class="nheat" role="group" aria-label="按${scale.label}聚合的情报密度">
        ${buckets
          .map((b, i) =>
            b.n
              ? `<button class="nb" style="--h:${heat(b.n).toFixed(2)}" data-newsbucket="${i}" data-bad="${b.major > 0 ? 1 : 0}"
               title="${esc(newsFmt(b.t, scale.id))} · ${b.n} 条${b.lead ? ` · ${esc(b.lead.title.slice(0, 46))}` : ''}"></button>`
              : `<span class="nb is-empty" title="${esc(newsFmt(b.t, scale.id))} · 无记录"></span>`,
          )
          .join('')}
      </div>
      <div class="nheat-scale">
        <span>${esc(newsFmt(buckets[0].t, scale.id))}</span>
        <span class="nhk"><i style="--h:.18"></i><i style="--h:.45"></i><i style="--h:.75"></i><i style="--h:1"></i> 每格 ${esc(scale.label)} · 越深越多 · 带点 = 有重大</span>
        <span>${esc(newsFmt(today, scale.id))}</span>
      </div>

      ${
        activeCount === 0
          ? `<div class="empty">这个筛选下暂时没有情报。</div>`
          : `
      <div class="newsfld">
        ${shown
          .map(
            (g) => `
          <section class="nday">
            <div class="nday-h"><b>${esc(g.key)}</b><span>${g.n} 条${g.empty ? ` · ${g.empty} ${esc(scale.label)}空窗` : ''}</span></div>
            <div class="nlist">
              ${g.items
                .sort((a, b) => b.date.localeCompare(a.date) || (b.score ?? 0) - (a.score ?? 0))
                .map(
                  (n) => `
                <a class="nitem ${n.importance === 'major' ? 'is-major' : ''}" href="${esc(n.url)}" target="_blank" rel="noopener" title="${esc(n.summary || n.title)}">
                  <span class="nkind t${NEWS_TOPIC_TONE[n.topic] || 8}">${esc(n.topicLabel || '其他')}</span>
                  <div class="nmain">
                    <h4>${esc(n.title)}</h4>
                    ${n.summary ? `<p>${esc(n.summary)}</p>` : ''}
                  </div>
                  <span class="ntime">${n.sourceCount > 1 ? `<b class="nsrc">${n.sourceCount} 源</b>` : ''}${scale.id === 'd' ? esc(n.time || '—') : esc(dayOf(n))}</span>
                </a>`,
                )
                .join('')}
            </div>
          </section>`,
          )
          .join('')}
        ${hiddenGroups > 0 ? `<button class="chip nmore" data-newsmore="1">再看 ${hiddenGroups} 段</button>` : ''}
      </div>`
      }

      <div class="shead" style="padding-top:26px"><h2>X 与官方一手信号</h2><span class="desc">价格、额度、缓存定价的原始出处；只有抓到正文的才收录。</span><span class="right">${sigList.length} 条</span></div>
      <div class="controls" style="padding-top:0">
        <div class="chips" role="group" aria-label="信号来源">
          ${[
            ['all', '全部'],
            ['x', 'X 一手'],
            ['blog', '官方博客'],
            ['newsroom', '新闻稿'],
          ]
            .map(
              ([k, l]) =>
                `<button class="chip" data-sigsrc="${k}" aria-pressed="${state.sigSrc === k}">${l}</button>`,
            )
            .join('')}
        </div>
      </div>
      ${
        sigList.length === 0
          ? `<div class="empty">这个来源下还没有情报。</div>`
          : `<div class="timeline">${sigList
              .map(
                (x) => `
        <article class="sig">
          <div class="when"><b>${esc(x.date || '—')}</b>${esc(x.handle || '')}</div>
          <div>
            <h4>${esc(TOPIC_LABEL[x.topic] || x.topic || 'signal')} <span class="tag">${esc(SRC_LABEL[x.source_type] || x.source_type || 'X')}</span>${x.confidence === 'medium' ? ' <span class="tag warn">部分核实</span>' : ''}</h4>
            <blockquote>${esc(x.quote)}</blockquote>
            <div class="links"><a href="${esc(x.url)}" target="_blank" rel="noopener">原帖 ↗</a>
              ${(x.affects || []).map((a) => `<span class="mchip">${esc(a)}</span>`).join('')}</div>
          </div>
        </article>`,
              )
              .join('')}</div>`
      }`;
  }

  /* ── method ── */
  function viewMethod() {
    const d = state.data,
      c = d.meta.counts;
    const directVendors = [
      ...new Set(d.models.filter((m) => m.channelKind === 'direct').map((m) => m.vendor)),
    ];
    return `<div class="doc">
      <h2>这份数据是什么</h2>
      <p>八层数据：<strong>免费额度</strong>、<strong>比价</strong>、<strong>订阅</strong>、<strong>中转站</strong>、<strong>AI 活动</strong>、<strong>工具箱</strong>、<strong>评测</strong>、<strong>情报</strong>。单位统一 <code>USD / 1M tokens</code>；人民币按 <strong>${d.meta.fx.USDCNY}</strong> 折算（${esc(d.meta.fx.source)}，${esc(d.meta.fx.as_of || '')}，站点每 8 小时自动刷新一次）。</p>
      <ul>
        <li><strong>聚合层</strong>（${c.aggregator} 条）：OpenRouter 实时目录，含缓存读写价。</li>
        <li><strong>官方直连层</strong>（${c.direct} 条 / ${directVendors.length} 家）：官方定价页人工核实，保留原币数字。</li>
        <li><strong>免费层</strong>（${c.offers} 条）：免费额度、免费模型、赠送金，标注门槛与期限。</li>
        <li><strong>订阅层</strong>（${c.subs} 档官方 / ${c.subsRegions} 组区价 / ${c.subsThird} 条挂单）：官方档位取 App Store 美国区的公开内购明码，一档一行、带购买链接；区价覆盖 ${subsCountryCount()} 个国家/地区；挂单来自公开平台，只作行情，不推荐。</li>
        <li><strong>中转层</strong>（${c.relays} 站在册 / ${c.relaysLive} 站公开价目）：读取 OneAPI/NewAPI 的价目接口。有 <code>billing_expr</code> 的站点按表达式取真实挂牌价，其余按 <code>model_ratio × 分组倍率</code> 换算，再按固定用量画像折成有效成本。</li>
        <li><strong>活动层</strong>（${c.eventsOpen} 个开放中 / ${c.eventsPast} 条已结束 / ${c.events} 条收录）：Devpost 公开接口（按 open / upcoming 分别翻页至收满）+ Devfolio 公开接口 + Luma 公开发现流（AI 关键词过滤）+ 本地 AIOS 活动库。状态一律按截止日期判定，不照抄数据源的 status 字段。</li>
        <li><strong>工具箱</strong>（${c.resources || 0} 个）：人工精选的 skill / MCP / CLI，星数、更新时间、许可每天从 GitHub API 校准；归档的会被标出来。</li>
        <li><strong>评测层</strong>（${c.bench} 个模型）：Vals Index 的公开分数，每次采集存一份用于对比。</li>
        <li><strong>情报层</strong>（${(d.news?.n) || c.news || 0} 条 / ${d.news?.days || 0} 天有内容 / 跨度 ${d.news?.span || 0} 天，另有 ${c.signals} 条一手信号）：AIHOT 全量流（7 天窗口，按分类翻页去重）+ 官方精选 + 存档回填，按 URL 归档、<strong>只增不删</strong>；条目用短键落盘，摘要只留标题里没有的信息。页面先给密度带，再按日/周/月/季/年下钻，默认只摊开最近 12 段。</li>
      </ul>

      <h2>排序：主流优先，新模型优先</h2>
      <p>比价表默认不是按价格排，而是按<strong>厂商主流度 + 模型发布时间</strong>：OpenAI、Anthropic、Google、DeepSeek、通义、Kimi、智谱、MiniMax、xAI、Mistral、Meta 等排前，同厂商内新发布在前；点任意表头可换成价格排序。</p>

      <h2>有效成本怎么算</h2>
      <div class="code" tabindex="0">${esc(COST_FORMULA)}
h = 缓存命中率       s = 输出 token 占比
cache_read 缺失时按 h = 0 处理，并标 "—"，不假装有缓存优惠</div>
      <p>比价表默认 <code>h=${pct(profileOf('compare').h)}</code>、<code>s=${pct(profileOf('compare').s)}</code>（${esc(profileOf('compare').label)}）；
      中转站页用 <code>h=${pct(profileOf('agent').h)}</code>、<code>s=${pct(profileOf('agent').s)}</code>（${esc(profileOf('agent').label)}）。滑块只影响比价表。</p>

      <h2>中转站口径</h2>
      <p>OneAPI / NewAPI 有两套并存的价目写法，<strong>表达式优先</strong>：</p>
      <div class="code" tabindex="0">① billing_expr（真实挂牌价）
   tier("base", p * 2 + c * 10 + cr * 0.1 + cc * 2.5)
   p=输入 c=输出 cr=缓存读 cc=缓存写，单位就是 $ / 1M

② model_ratio 倍率（老式）
   输入 = model_ratio × 分组倍率 × $2 / 1M
   输出 = 上式 × completion_ratio
   缓存读 = 上式 × cache_ratio

${esc(COST_FORMULA)}</div>
      <p><strong>为什么必须表达式优先：</strong>同时给出两种写法的站点里，<code>model_ratio</code> 是废弃占位值——例如某站 <code>model_ratio=37.5</code> 算出 $75，而其 <code>billing_expr</code> 写着 <code>p*2+c*10</code>，真实价是 $2 / $10。只认倍率会把一批正常站点误标成「异常」。</p>
      <p><strong>分组倍率（group_ratio）</strong>才是中转站的定价核心，跨站差 20–220 倍。页面上的价格取<strong>代表分组</strong>（default，或组名里声明倍率最接近 1 的公开组），用于横向比较；另单列<strong>最低可达价</strong>并标出组名，因为那通常要求特定分组权限（会员、Claude Code 专属等）。</p>
      <p>名称里带「<strong>逆向</strong>」「<strong>特价</strong>」「reverse」的分组<strong>不参与</strong>代表价与最低可达价：那类通道要么破解客户端协议，要么是低于成本的引流价，都不代表正常渠道能拿到的价格。它们仍计入「这家有多个分组」的总数，页面上会写明被排除了几个。</p>
      <p>有效成本按固定画像折算：<code>h=${pct(profileOf('agent').h)}</code> 缓存命中、<code>s=${pct(profileOf('agent').s)}</code> 输出占比（${esc(profileOf('agent').label)}）。<strong>输入价常常各家相同</strong>，差价主要来自输出倍率与缓存折扣，所以排序用有效成本。</p>
      <p><code>model_price > 0</code> 或表达式 <code>fixed(...)</code> 的按次计价不参与每百万 token 比较；与同口径官方价差 2.5 倍以上（便宜模型放宽到 8 倍，避免小模型被绝对差价误判）才标「口径?」。</p>

      <h2>订阅与第三方挂单</h2>
      <p>官方订阅只收 App Store 公开内购页能直接读到的月费，按产品分档、一档一行。第三方挂单只呈现<strong>按产品的统计量</strong>——挂单数、在售数、平台数、价格最低 / 中位 / 最高——<strong>不给任何商品页链接</strong>：质保通常 1–3 小时，成品号与镜像站的稳定性差别很大，站点不做推荐、不保证可用，因此也不提供购买入口。数据源是 data.aibijia.org 的公开挂单 JSON。</p>

      <h2>活动与评测口径</h2>
      <p>活动只收<strong>公开可报名</strong>的：Devpost 的 open 状态黑客松、Luma 公开发现流里含 AI/LLM/Agent 关键词的场次，按截止日期排。类型（黑客松 / 会议 / Meetup / 工作坊 / 评选）和地区都由标题、主题与场地推断，可交叉筛选；本地 AIOS 项目的活动库全部已结束，单独归档，只作来源对照，不混进「开放中」。</p>
      <p>评测层直接读各家公布的公开数据，共 ${(state.data.bench?.sources || []).length} 个源、${state.data.bench?.stats?.boards || 0} 个榜：<a href="https://lmarena.ai/" target="_blank" rel="noopener" style="color:var(--accent)">LMArena</a> 走它在 HuggingFace 公开的榜单数据集（24 个榜，含中文、编程、Agent、多模态，带 95% 置信区间与票数）；<a href="https://www.swebench.com/" target="_blank" rel="noopener" style="color:var(--accent)">SWE-bench</a>、<a href="https://aider.chat/docs/leaderboards/" target="_blank" rel="noopener" style="color:var(--accent)">Aider</a>、<a href="https://www.tbench.ai/" target="_blank" rel="noopener" style="color:var(--accent)">Terminal-Bench</a>、<a href="https://taubench.com/" target="_blank" rel="noopener" style="color:var(--accent)">τ-bench</a> 取官方榜；<a href="https://arcprize.org/" target="_blank" rel="noopener" style="color:var(--accent)">ARC-AGI</a>、<a href="https://simple-bench.com/" target="_blank" rel="noopener" style="color:var(--accent)">SimpleBench</a>、<a href="https://www.vals.ai/" target="_blank" rel="noopener" style="color:var(--accent)">Vals</a>、<a href="https://artificialanalysis.ai/" target="_blank" rel="noopener" style="color:var(--accent)">Artificial Analysis</a> 取各自公布的榜单。</p>
      <p><strong>口径</strong>：各榜量纲不同（Elo / 百分数 / 0–1 比率 / 指数分），采集时按源各自的口径统一成百分数或保留指数，<strong>绝不全局乘 100</strong>；对照表并排时用的是<strong>榜内名次换算的相对位置</strong>，不是把分数直接相加。同一模型的多个推理档位（High / Max / xHigh）合并成一条，保留最强档。同一份数据集里混着几代快照时只取最新一批。超过 6 个月没更新的榜会标出「N 个月前」——分数能看，但不代表当前能力。</p>
      <p><strong>不采的</strong>：Open LLM Leaderboard v2（2025-03 起停止打分）、HarmBench（站上无榜）、C-Eval（证书过期）、CMMLU（2024-12 停更）、SuperCLUE（只有 PDF 报告）、MMLU-Pro 与 GPQA（只有数据集，没有官方榜）。这类停更榜上页面会误导人，宁可空着。</p>

      <h2>去重规则</h2>
      <ol>
        <li><strong>R1</strong> 聚合层以 OpenRouter model id 为唯一键。</li>
        <li><strong>R2</strong> 官方直连层以 <code>厂商 + 模型</code> 为唯一键，冲突保留高置信。</li>
        <li><strong>R3</strong> 两层不合并：渠道是指纹的一部分，只通过 <code>family</code> 做「同族最低」提示。</li>
        <li><strong>R4</strong> 免费层以产品名为唯一键，多入口合并进 <code>entries</code>。</li>
        <li><strong>R5</strong> 情报以 URL 为唯一键；同 URL 撞车时保留更早的日期与更长的摘要，永不被新抓到的短版覆盖。中转站以域名唯一。</li>
      </ol>
      <p>本次运行：剔除 ${d.meta.dedupe.unpriced_dropped || 0} 条不计价的路由产品、${d.meta.dedupe.aggregator_dropped} 条重复 id；白嫖层合并 ${d.meta.dedupe.offers_merged} 条。</p>

      <h2>已知偏差</h2>
      <ul>
        <li>聚合层标价可能与厂商直连价不同步；两个渠道两个价是正常的，站点不替你选边。</li>
        <li>Batch / 分时 / 优先档是独立 SKU，各自成行，不折叠成「该模型最低价」。</li>
        <li>中转站价目是<strong>接口披露价</strong>，不等于你充值后的实际单价；未公开价目的站点只登记不猜价。</li>
        <li>免费额度随时会变，卡片上的日期是核实日期，链接指向官方页。</li>
      </ul>

      <h2>采集可靠性</h2>
      <p>每次采集结束都会跑一遍<strong>分层健康检查</strong>：任一数据层为空、或相对上次缩水超过阈值，采集直接失败、不写 <code>data.json</code>，绝不用残缺数据覆盖线上。单项数据源临时挂掉时，沿用上一版并在页面顶部标出来。</p>
      <p class="mono" style="color:var(--faint);font-size:11.5px">本次采集：${(d.meta.collect || []).map((x) => `${esc(x.layer)}=${esc(x.status)}`).join(' · ') || '—'}${d.meta.health?.warn?.length ? `<br>警告：${d.meta.health.warn.map(esc).join('；')}` : ''}</p>

      <h2>来源（${c.sources}）</h2>
      <table class="srcs"><tbody>${d.sources.map((s) => `<tr><td class="u"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a></td><td style="width:64px">${esc(s.type)}</td><td style="width:40px;text-align:right">${s.refs}</td></tr>`).join('')}</tbody></table>
    </div>`;
  }

  /* ── drawer ── */
  let drawerReturnFocus = null;
  function openDrawer(id) {
    const m = state.data.models.find((x) => x.id === id);
    if (!m) return;
    const e = effort(m);
    const disc = m.cache_read != null && m.input ? 1 - m.cache_read / m.input : null;
    const peak = m.peak
      ? `<dt>分时价</dt><dd>${esc(m.peak.note)}（倍率 ${m.peak.ratio}×）</dd>`
      : '';
    const cny = m.cny
      ? `<dt>原币</dt><dd class="mono">${esc(m.cny.currency)} ${esc(m.cny.input)} / ${esc(m.cny.output)}${m.cny.cache_read != null ? ` · 缓存 ${esc(m.cny.cache_read)}` : ''} 每 1M</dd>`
      : '';
    $('#drawer').innerHTML = `
      <button class="close" type="button" data-close aria-label="关闭">✕</button>
      <div class="eyebrow">${esc(m.vendor)} · ${esc(m.channel)}</div>
      <h2>${esc(m.name)}</h2>
      <div class="sub">${esc(m.id)}</div>
      <div class="pricegrid">
        <div class="pcell"><div class="k">输入 /1M</div><div class="v">${m.free ? '0' : `$${money(m.input)}`}</div></div>
        <div class="pcell"><div class="k">输出 /1M</div><div class="v">${m.free ? '0' : `$${money(m.output)}`}</div></div>
        <div class="pcell"><div class="k">缓存读 /1M</div><div class="v">${m.cache_read == null ? '—' : `$${money(m.cache_read)}`}</div></div>
        <div class="pcell"><div class="k">缓存写 /1M</div><div class="v">${m.cache_write == null ? '—' : `$${money(m.cache_write)}`}</div></div>
      </div>
      <dl>
        <dt>有效成本</dt><dd class="mono">$${e == null ? '—' : money(e)} /1M <span class="dim">（命中 ${pct(state.hit)}，输出 ${pct(state.outShare)}）</span></dd>
        <dt>缓存折扣</dt><dd>${disc == null ? '<span class="dim">该渠道未公布缓存价</span>' : `${pct(disc)}（命中后输入价降到 ${pct(m.cache_read / m.input)}）`}</dd>
        <dt>上下文</dt><dd class="mono">${ctx(m.ctx)} tokens</dd>
        <dt>模态</dt><dd class="mono">${esc(m.modality || '—')}</dd>
        <dt>免费</dt><dd>${m.free ? '<span class="tag free">是</span> 挂牌 0 元' : '否'}</dd>
        ${cny}${peak}
        <dt>缓存机制</dt><dd>${esc(m.cm || '—')}</dd>
        <dt>置信度</dt><dd>${esc(m.conf)} <span class="dim">· ${esc(confTitle[m.conf] || '')}</span></dd>
        <dt>采集日</dt><dd class="mono">${esc(m.seen || '—')}</dd>
      </dl>
      <p class="note">${reportLink('model', m.id, m.src)} · <a href="${esc(m.src)}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:underline;text-underline-offset:3px">查看原始来源 ↗</a></p>`;
    drawerReturnFocus = document.activeElement;
    $('#drawer').dataset.open = '1';
    $('#drawer').setAttribute('aria-hidden', 'false');
    $('#overlay').dataset.open = '1';
    $('#drawer .close')?.focus();
  }

  function closeDrawer() {
    const open = $('#drawer')?.dataset.open === '1';
    $('#drawer').dataset.open = '0';
    $('#drawer').setAttribute('aria-hidden', 'true');
    $('#overlay').dataset.open = '0';
    if (open && drawerReturnFocus?.isConnected) drawerReturnFocus.focus();
  }

  /** 局部重绘：保住当前滚动位置，用于异步数据到达后原地补内容（F21）。 */
  function rerenderInPlace() {
    state.keepScroll = scrollY;
    render();
  }

  /* ── render ── */
  // 首屏渲染前不要动滚动位置：新加载时地址栏被补成 #home，
  // 浏览器会拿它去恢复滚动，首页就落在叙事中间了。首帧之后的切页照常回顶。
  let firstRender = true;
  function render() {
    const keepScroll = firstRender || state.keepScroll;
    firstRender = false;
    state.keepScroll = false;
    renderNav();
    renderHero();
    renderKpis();
    renderHealth();
    const v = $('#view');
    /* T5.5：重绘前记住 #view 内被聚焦控件的 data-* 标识，重绘后把焦点放回去。
       筛选按钮点一次就整块重绘，不恢复的话键盘用户会被丢回文档开头。 */
    const focusSel = (() => {
      const el = document.activeElement;
      if (!el || !v.contains(el) || !el.dataset) return null;
      for (const k of Object.keys(el.dataset)) {
        const val = el.dataset[k];
        if (val != null && /^[A-Za-z0-9_-]+$/.test(k)) {
          return `[data-${k}="${CSS.escape(val)}"]`;
        }
      }
      return null;
    })();
    if (state.tab === 'home') {
      v.innerHTML = viewHome();
      // 归档只填充要闻区：priceAxis 与要闻的标题/数量都已经在首屏里了，
      // 所以这次重绘要保住滚动位置，不能把人弹回首页顶部（F21）。
      if (needsNewsArchive()) {
        loadNews()
          .then((items) => {
            if (items.length && state.tab === 'home') rerenderInPlace();
          })
          .catch(() => {});
      }
    } else if (state.tab === 'free') v.innerHTML = viewFree();
    else if (state.tab === 'compare') v.innerHTML = viewCompare();
    else if (state.tab === 'subs') v.innerHTML = viewSubs();
    else if (state.tab === 'relays') v.innerHTML = viewRelays();
    else if (state.tab === 'events') v.innerHTML = viewEvents();
    else if (state.tab === 'tools') v.innerHTML = viewTools();
    else if (state.tab === 'bench') v.innerHTML = viewBench();
    else if (state.tab === 'vendors') v.innerHTML = viewVendors();
    else if (state.tab === 'signals') {
      v.innerHTML = viewSignals();
      // 归档不在 data.json 里，进这一页时才拉；拉到后重绘一次
      if (needsNewsArchive()) {
        loadNews().then(() => {
          if (state.tab === 'signals') rerenderInPlace(); // 空也重绘，把错误说出来
        });
      }
    } else v.innerHTML = viewMethod();
    // 首屏不改地址栏：加载时地址里是 / 或 #home，替换成 #home 会触发一次不必要的导航，
    // 还会和浏览器的滚动恢复打架。之后每次切页照旧。
    if (!keepScroll) history.replaceState(null, '', `#${state.tab}`);
    queueMicrotask(() => {
      MOTION.arm();
      if (state.tab === 'home') renderAxis();
      if (state.tab === 'subs') renderSubBars();
      if (state.tab === 'events') renderTimeline();
      if (state.tab === 'bench' && state.benchView === 'value') renderBenchScatter();
      if (focusSel) v.querySelector(focusSel)?.focus({ preventScroll: true });
      // 局部重绘后把滚动位置放回去：归档到达只填充要闻区，不该把人弹回顶部
      if (keepScroll) scrollTo({ top: keepScroll, behavior: 'auto' });
    });
  }

  /* ── events ── */
  function bind() {
    document.addEventListener('click', (ev) => {
      const paletteItem = ev.target.closest('[data-palette-i]');
      if (paletteItem) {
        ev.preventDefault();
        paletteJump(paletteResults[Number(paletteItem.dataset.paletteI)]);
        return;
      }
      if (ev.target.id === 'paletteOverlay') {
        closePalette();
        return;
      }
      const t = ev.target.closest(
        '[data-tab],[data-relayflag],[data-band],[data-toggle],[data-channel],[data-sort],[data-sortkey],[data-id],[data-cmpview],[data-region],[data-cat],[data-offersort],[data-vendor],[data-sigsrc],[data-evkind],[data-evsrc],[data-evregion],[data-newstopic],[data-newsrange],[data-newsimp],[data-newsscale],[data-newsbucket],[data-newsmore],[data-ms],[data-msepoch],[data-benchtab],[data-benchview],[data-benchgroup],[data-benchpick],[data-benchclear],[data-benchmore],[data-toolkind],[data-evmore],[data-evpastmore],[data-close],#moreBtn,#overlay,.iconbtn',
      );
      if (!t) return;
      if (t.dataset.tab) {
        if (t.dataset.tab === state.tab) return;
        state.tab = t.dataset.tab;
        state.limit = 80;
        const v = $('#view');
        v.classList.add('swapping');
        setTimeout(() => {
          render();
          scrollTo({ top: 0, behavior: 'auto' });
          requestAnimationFrame(() => v.classList.remove('swapping'));
        }, 150);
        return;
      }
      if (t.dataset.relayflag) {
        state.relayFlag = t.dataset.relayflag;
        render();
        return;
      }
      if (t.dataset.band) {
        state.band = t.dataset.band;
        render();
        return;
      }
      if (t.dataset.toggle) {
        const k = t.dataset.toggle;
        state[k] = !state[k];
        if (k === 'freeOnly' && state.freeOnly) state.paidOnly = false;
        if (k === 'paidOnly' && state.paidOnly) state.freeOnly = false;
        render();
        return;
      }
      if (t.dataset.cmpview) {
        state.cmpView = t.dataset.cmpview;
        render();
        return;
      }
      if (t.dataset.evmore) {
        state.evLimit = 100000;
        render();
        return;
      }
      if (t.dataset.evpastmore) {
        state.evPastLimit = 100000;
        render();
        return;
      }
      if (t.dataset.evkind) {
        state.evKind = t.dataset.evkind;
        state.evLimit = 18;
        render();
        return;
      }
      if (t.dataset.evsrc) {
        state.evSrc = t.dataset.evsrc;
        state.evLimit = 18;
        render();
        return;
      }
      if (t.dataset.evregion) {
        state.evRegion = t.dataset.evregion;
        state.evLimit = 18;
        render();
        return;
      }
      if (t.dataset.newstopic) {
        state.newsTopic = t.dataset.newstopic;
        render();
        return;
      }
      if (t.dataset.newsrange) {
        state.newsRange = t.dataset.newsrange;
        state.newsLimit = 12;
        render();
        return;
      }
      if (t.dataset.newsimp) {
        state.newsImp = t.dataset.newsimp;
        render();
        return;
      }
      if (t.dataset.newsscale) {
        state.newsScale = t.dataset.newsscale;
        state.newsLimit = 12;
        render();
        return;
      }
      if (t.dataset.newsmore) {
        state.newsLimit = (state.newsLimit || 12) + 12;
        render();
        return;
      }
      if (t.dataset.ms) {
        state.msSel = t.dataset.ms;
        // 点大事件 = 把下层的日更窗口收到那前后 60 天，看当时真实发生了什么
        const ev = (state.ms || []).find((m) => m.d + m.title === t.dataset.ms);
        if (ev) {
          const age =
            (Date.parse(`${state.data?.meta?.date || ev.d}T00:00:00+08:00`) -
              Date.parse(`${ev.d}T00:00:00+08:00`)) /
            864e5;
          if (age > 0) {
            state.newsRange = String(Math.min(3650, Math.max(14, Math.round(age))));
            state.newsLimit = 12;
          }
        }
        render();
        return;
      }
      if (t.dataset.msepoch) {
        // 再点一次同一分组 = 取消筛选（之前点了没反应，因为每次都重选最近那件）
        const list = (state.ms || [])
          .filter((m) => m.e === t.dataset.msepoch)
          .sort((a, b) => a.d.localeCompare(b.d));
        const last = list[list.length - 1];
        const same = last && state.msSel === last.d + last.title;
        state.msSel = same ? null : last ? last.d + last.title : null;
        render();
        return;
      }
      if (t.dataset.newsbucket) {
        // 点密度格 = 把时间窗收到这一格所在的范围，回到「日」尺度看细节
        const b = newsBuckets?.[Number(t.dataset.newsbucket)];
        if (b) {
          state.newsRange = String(Math.max(1, Math.ceil((b.t1 - b.t) / 864e5)));
          state.newsScale = 'd';
          state.newsLimit = 12;
          render();
        }
        return;
      }
      if (t.dataset.benchview) {
        state.benchView = t.dataset.benchview;
        render();
        return;
      }
      if (t.dataset.benchgroup) {
        state.benchGroup = t.dataset.benchgroup;
        render();
        return;
      }
      if (t.dataset.benchpick) {
        const id = t.dataset.benchpick;
        const cur = new Set(benchSelected());
        const single = state.benchView === 'single';
        if (single) {
          state.benchPicks = [id];
        } else if (cur.has(id)) {
          cur.delete(id);
          state.benchPicks = [...cur];
        } else {
          cur.add(id);
          state.benchPicks = [...cur];
        }
        if (state.benchPicks && !state.benchPicks.length) state.benchPicks = null;
        render();
        return;
      }
      if (t.dataset.benchclear) {
        state.benchPicks = null;
        render();
        return;
      }
      if (t.dataset.benchmore) {
        state.benchLimit = (state.benchLimit || 60) + 60;
        render();
        return;
      }
      if (t.dataset.toolkind) {
        state.toolKind = t.dataset.toolkind;
        render();
        return;
      }
      if (t.dataset.sortkey) {
        state.sortKey = t.dataset.sortkey;
        state.sortDir = 1;
        render();
        return;
      }
      if (t.dataset.channel) {
        state.channel = t.dataset.channel;
        render();
        return;
      }
      if (t.dataset.sort) {
        if (state.sortKey === t.dataset.sort) state.sortDir *= -1;
        else {
          state.sortKey = t.dataset.sort;
          state.sortDir = 1;
        }
        render();
        return;
      }
      if (t.dataset.id) {
        openDrawer(t.dataset.id);
        return;
      }
      if (t.dataset.region) {
        state.region = t.dataset.region;
        render();
        return;
      }
      if (t.dataset.cat) {
        state.cat = t.dataset.cat;
        render();
        return;
      }
      if (t.dataset.offersort) {
        state.offerSort = t.dataset.offersort;
        render();
        return;
      }
      if (t.dataset.sigsrc) {
        state.sigSrc = t.dataset.sigsrc;
        render();
        return;
      }
      if (t.dataset.vendor) {
        state.tab = 'compare';
        state.vendor = t.dataset.vendor;
        state.q = '';
        state.band = 'all';
        render();
        scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      if (t.id === 'moreBtn') {
        state.limit += 120;
        paintRows();
        return;
      }
      if (t.id === 'themeBtn') {
        const light = document.documentElement.dataset.theme === 'light';
        document.documentElement.dataset.theme = light ? 'dark' : 'light';
        t.setAttribute('aria-pressed', String(!light));
        t.textContent = light ? 'LIGHT' : 'DARK';
        localStorage.setItem('idx.theme', light ? 'dark' : 'light');
        // 时间轴的颜色是从令牌读出来的，换主题后要重画一次才跟着变
        if (state.tab === 'events') renderTimeline();
        return;
      }
      if (t.id === 'densBtn') {
        const compact = document.documentElement.dataset.density === 'compact';
        document.documentElement.dataset.density = compact ? 'cozy' : 'compact';
        t.setAttribute('aria-pressed', String(!compact));
        localStorage.setItem('idx.density', compact ? 'cozy' : 'compact');
        return;
      }
      if (t.dataset.close !== undefined && t.dataset.close === '') {
        closeDrawer();
        return;
      }
      if (t.id === 'overlay') {
        closeDrawer();
        return;
      }
    });

    document.addEventListener('input', (ev) => {
      const el = ev.target;
      if (el.id === 'paletteInput') {
        paletteIndex = 0;
        paintPalette();
        return;
      }
      if (el.id === 'q') {
        state.q = el.value;
        state.limit = 80;
        paintRows();
        return;
      }
      if (el.id === 'hit') {
        state.hit = Number(el.value) / 100;
        $('#hitOut').textContent = pct(state.hit);
        paintRows();
        return;
      }
      if (el.id === 'outShare') {
        state.outShare = Number(el.value) / 100;
        $('#outOut').textContent = pct(state.outShare);
        paintRows();
        return;
      }
    });
    document.addEventListener('change', (ev) => {
      if (ev.target.id === 'vendor') {
        state.vendor = ev.target.value;
        render();
      }
    });
    document.addEventListener('keydown', (ev) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') {
        ev.preventDefault();
        openPalette();
        return;
      }
      if (paletteOpen) {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          closePalette();
          return;
        }
        if (ev.key === 'ArrowDown') {
          ev.preventDefault();
          movePalette(1);
          return;
        }
        if (ev.key === 'ArrowUp') {
          ev.preventDefault();
          movePalette(-1);
          return;
        }
        if (ev.key === 'Enter' && paletteResults[paletteIndex]) {
          ev.preventDefault();
          paletteJump(paletteResults[paletteIndex]);
          return;
        }
        return;
      }
      if (ev.key === 'Escape') closeDrawer();
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches?.('th[data-sort], tr[data-id]')) {
        ev.preventDefault();
        ev.target.click();
      }
      if (ev.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) {
        ev.preventDefault();
        $('#q')?.focus();
      }
    });
    window.addEventListener('hashchange', () => {
      const id = location.hash.slice(1);
      if (id && TABS.some((t) => t.id === id) && id !== state.tab) {
        state.tab = id;
        state.limit = 80;
        render();
        scrollTo({ top: 0, behavior: 'auto' });
      }
    });
  }

  function renderFxStamp() {
    const f = state.fx;
    if (!f) return;
    const t = new Date(f.ts).toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });
    $('#fxStamp').textContent = `汇率 ${f.rate.toFixed(4)} · ${t}`;
    $('#fxStamp').title = `USD/CNY ${f.rate} · ${f.asof || ''} · 每 8 小时刷新`;
  }

  /* ── boot ── */
  /* 数据健康横幅：只在「数据旧了 / 某层缺了」时出现。
     以前站点无论数据多旧、某一层空没空，看起来都一模一样，用户没法判断这份数据还算不算数。 */
  function renderHealth() {
    const el = $('#healthbar');
    if (!el) return;
    const meta = state.data.meta || {};
    const c = meta.counts || {};
    const issues = [];
    const gen = Date.parse(meta.generated_at || '');
    if (Number.isFinite(gen)) {
      /* 相对数据自己的采集时刻算新鲜度：这样「48 小时未更新」的判定
       * 与读者什么时候打开页面无关。 */
      const h = (dataMoment() - gen) / 3600000;
      if (h > 48)
        issues.push({
          bad: true,
          t: `数据已 ${Math.floor(h / 24)} 天未更新（最后采集 ${meta.date || '?'}）`,
        });
      else if (h > 30)
        issues.push({ bad: false, t: `数据 ${Math.round(h)} 小时未更新，接近日更上限` });
    } else {
      issues.push({ bad: true, t: '生成时间缺失，无法判断数据新鲜度' });
    }
    // 某层空掉：只在真的空时提，不重复 health.mjs 的全部阈值
    if (!(c.subs > 0)) issues.push({ bad: true, t: '官方订阅档位为空，订阅页只有第三方挂单' });
    if (!(c.orApps > 0)) issues.push({ bad: false, t: 'OpenRouter 应用榜本次没采到' });
    if ((meta.collect || []).some((x) => x.status === 'stale')) {
      const layers = meta.collect.filter((x) => x.status === 'stale').map((x) => x.layer);
      issues.push({ bad: false, t: `${layers.join(' / ')} 沿用了上一次的数据` });
    }
    if (!issues.length) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    const bad = issues.some((i) => i.bad);
    el.hidden = false;
    el.dataset.level = bad ? 'bad' : 'warn';
    el.innerHTML =
      `<b>${bad ? '这份数据需要留意' : '数据说明'}</b>` +
      (issues.length === 1
        ? `：${esc(issues[0].t)}`
        : `<ul>${issues.map((i) => `<li>${esc(i.t)}</li>`).join('')}</ul>`);
  }

  async function boot() {
    // 首页会往地址栏补 #home（见 render），新加载时浏览器会去恢复那个滚动位置，
    // 结果首页一打开就落在价格叙事的中间。这次不做滚动恢复。
    try {
      history.scrollRestoration = 'manual';
    } catch {}
    // 旧品牌时期的键（T2.3）：改名后不再读写，清掉免得一直留在用户机器上
    try {
      localStorage.removeItem('fr.theme');
      localStorage.removeItem('fr.density');
    } catch {}
    // 旧版浏览器端汇率缓存（F45）：已经不用了，清掉免得留在用户机器上
    try {
      localStorage.removeItem('idx.fx');
    } catch {}
    const theme = localStorage.getItem('idx.theme');
    if (theme === 'dark') {
      document.documentElement.dataset.theme = 'dark';
      $('#themeBtn').setAttribute('aria-pressed', 'true');
      $('#themeBtn').textContent = 'LIGHT';
    }
    if (localStorage.getItem('idx.density') === 'compact') {
      document.documentElement.dataset.density = 'compact';
      $('#densBtn').setAttribute('aria-pressed', 'true');
    }
    try {
      const res = await fetch('data.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.data = await res.json();
    } catch (e) {
      // F01：任何失败路径都要让错误文案真的可见，不能停在 opacity:0
      document.body.classList.add('ready');
      $('#kpis').innerHTML = '';
      $('#view').innerHTML =
        `<div class="empty"><b>读不到 data.json</b>${esc(e.message || String(e))}。请用本地服务器打开：<code>npx serve dist</code><br>或先运行 <code>npm run collect</code> 生成数据。</div>`;
      return;
    }
    const base = state.data.meta.fx || { USDCNY: 7.1, as_of: '', fetched_at: '' };
    state.fx = {
      rate: base.USDCNY,
      ts: Date.parse(base.fetched_at) || dataMoment(),
      asof: base.as_of,
    };
    renderKpis();
    bind();
    render();
    renderFxStamp();
    MOTION.progress();
    requestAnimationFrame(() => {
      document.body.classList.add('ready');
      MOTION.arm();
    });
    // 大事件清单很小（~8KB），开机就取，避免情报页先闪一下「正在加载」
    loadMilestones()
      .then(() => {
        if (state.tab === 'signals') render();
      })
      .catch(() => {
        if (state.tab === 'signals') render();
      });
    $('#footSrc').textContent =
      `${state.data.meta.counts.sources} 个来源 · 去重丢弃 ${state.data.meta.dedupe.aggregator_dropped + state.data.meta.dedupe.unpriced_dropped} 条`;
  }

  // F01 的最后一道保险：任何未捕获错误都不能把页面留在透明状态
  addEventListener('error', () => document.body.classList.add('ready'));
  addEventListener('unhandledrejection', () => document.body.classList.add('ready'));

  boot();
})();
