/**
 * 来源登记表（F16）。
 *
 * 站点的「可信度」有一半来自「每个数字都能点回来源」，方法页会按引用次数列出全部地址。
 * 这里把各层实际用到的地址收拢去重——以前订阅行用 `buy` 字段、登记时读 `url`，
 * 于是订阅来源从来没进过表。
 */

/* 来源登记表（F16）：所有实际用到的地址去重计数，方法页按引用次数列出来。
 * 以前订阅行用 buy 字段、登记时读 url，于是订阅来源从未入表。 */
export function buildSources(out) {
  const srcMap = new Map();
  const addSrc = (url, type, label) => {
    if (!url || typeof url !== 'string') return;
    const e = srcMap.get(url) || { url, type, label, refs: 0 };
    e.refs += 1;
    srcMap.set(url, e);
  };
  for (const m of out.models || []) addSrc(m.src, m.srcType || 'api', m.channel);
  for (const o of out.offers || []) {
    for (const u of o.sources?.length ? o.sources : [o.source]) {
      addSrc(u, o.srcType || 'official', o.product);
    }
  }
  for (const s of out.subs || []) addSrc(s.buy || s.source, 'official', s.product);
  if ((out.subsThird || []).length) addSrc('https://aibijia.org/', 'marketplace', '第三方挂单价');
  for (const r of out.relays || []) addSrc(`https://${r.domain}/api/pricing`, 'relay', r.name);
  if ((out.events || []).length) {
    addSrc('https://devpost.com/api/hackathons', 'events', 'Devpost');
    addSrc('https://api.lu.ma/discover/get-paginated-events', 'events', 'Luma');
    addSrc('https://api.devfolio.co/api/hackathons', 'events', 'Devfolio');
  }
  if ((out.news || []).length) {
    addSrc('https://data.aibijia.org/news-frontline.yaml', 'news', 'AI 要闻精选');
    addSrc('https://aihot.news/api/v1/items', 'news', 'AIHOT 全量流');
  }
  for (const src of out.bench?.sources || []) {
    if (src.ok === false) continue;
    addSrc(src.home, 'bench', src.name);
  }
  return [...srcMap.values()].sort((a, b) => b.refs - a.refs);
}
