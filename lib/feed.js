/**
 * RSS / Atom 解析（T6.4 · S8.7）。
 *
 * 官方博客与 GitHub releases 只提供 feed，没有统一 JSON；这里用保守的正则
 * 解析最小字段集（title / link / date / summary），不引入 XML 依赖。
 * 只服务于「标题 + 链接 + 时间 + 摘要」四件事，复杂命名空间交给对应 tag 兜底。
 */

const XML_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** 解码 XML / HTML 实体（数字实体一并处理）。 */
export function decodeXmlEntities(text) {
  return String(text || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name) => {
    const lower = name.toLowerCase();
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return XML_ENTITIES[lower] ?? whole;
  });
}

/** 去掉标签与多余空白，得到纯文本摘要。 */
export function stripHtml(text) {
  return decodeXmlEntities(String(text || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function tagText(block, names) {
  for (const name of names) {
    const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
    const m = block.match(re);
    if (m) {
      const raw = m[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, '$1');
      return stripHtml(raw);
    }
  }
  return '';
}

function tagLink(block) {
  // Atom: <link href="..." rel="alternate"/>；RSS: <link>...</link>
  const atom = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i);
  if (atom) return decodeXmlEntities(atom[1]).trim();
  const rss = block.match(/<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i);
  if (rss) return stripHtml(rss[1]);
  const guid = block.match(/<guid(?:\s[^>]*)?>([\s\S]*?)<\/guid>/i);
  if (guid && /^https?:/i.test(stripHtml(guid[1]))) return stripHtml(guid[1]);
  return '';
}

function toIsoDate(raw) {
  const text = stripHtml(raw);
  if (!text) return '';
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/**
 * 解析一个 RSS 2.0 / Atom 1.0 feed。
 * @param {string} xml
 * @returns {{title:string,url:string,date:string,time:string,summary:string}[]}
 */
export function parseFeed(xml) {
  const text = String(xml || '');
  const blocks = [...text.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
  const out = [];
  for (const [, , block] of blocks) {
    const title = tagText(block, ['title']);
    const url = tagLink(block);
    if (!title || !url) continue;
    const iso = toIsoDate(tagText(block, ['pubDate', 'published', 'updated', 'dc:date']));
    const summary = tagText(block, ['description', 'summary', 'content:encoded', 'content']);
    out.push({
      title,
      url,
      date: iso.slice(0, 10),
      time: iso.slice(11, 16),
      summary,
    });
  }
  return out;
}
