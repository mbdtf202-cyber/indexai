/**
 * 数据页（T5.10 · S9.9）。
 *
 * 回答三个问题：有哪些文件、什么结构、谁给的（许可与署名）。
 *
 * 这一页的存在本身就是对读者的承诺：任何数字都可以顺着走到原始文件。
 */

import { SITE_LICENSE } from '../../pipeline/datasets.mjs';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 字节数转可读体积。 */
function size(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** 一层：公开文件清单。 */
function renderFiles(datasets) {
  if (!datasets.length) {
    return '<p class="dim">本次构建没有产出数据文件清单。</p>';
  }

  const rows = datasets
    .map(
      (d) => `
      <tr>
        <td><a href="${esc(d.path)}"><code>${esc(d.name)}</code></a></td>
        <td>${esc(d.title)}</td>
        <td><code>${esc(d.schema)}</code></td>
        <td class="num">${d.bytes ? size(d.bytes) : '—'}</td>
      </tr>`,
    )
    .join('');

  return `
    <table>
      <caption class="sr">公开数据文件</caption>
      <thead><tr><th>文件</th><th>内容</th><th>schema</th><th class="num">大小</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** 一层：上游署名。 */
function renderUpstreams(upstreams) {
  const items = upstreams
    .map((u) => {
      const lic = u.licenseUrl
        ? `<a href="${esc(u.licenseUrl)}">${esc(u.license)}</a>`
        : esc(u.license);
      return `
      <li class="dsrc">
        <div class="dsrc-head">
          <a href="${esc(u.url)}" rel="noopener">${esc(u.name)}</a>
          <span class="dsrc-layers">${u.layers.map((l) => `<code>${esc(l)}</code>`).join(' ')}</span>
        </div>
        <p class="dsrc-req">${esc(u.requirement)}</p>
        <p class="dsrc-note dim">${esc(u.note)} · 许可：${lic}</p>
      </li>`;
    })
    .join('');

  return `<ul class="dsrc-list">${items}</ul>`;
}

/**
 * 渲染数据页。
 *
 * @param {object} data
 * @param {object[]} [data.datasets]
 * @param {object[]} [data.upstreams]
 * @returns {string}
 */
export function renderData(data = {}) {
  const datasets = data.datasets || [];
  const upstreams = data.upstreams || [];

  return `
  <div id="data" class="page">
    <h1>数据</h1>
    <p class="lede">
      本站的每个数字都来自这些文件。文件带 schema，可以直接取用；
      引用时请遵守本站许可与上游各自的署名要求。
    </p>

    <section>
      <h2>公开文件</h2>
      ${renderFiles(datasets)}
      <p class="dim">
        主数据许可 <a href="${esc(SITE_LICENSE.url)}" rel="noopener">${esc(SITE_LICENSE.name)}</a>；
        上游数据的版权与署名要求见下一节。
      </p>
    </section>

    <section>
      <h2>上游与署名</h2>
      <p class="dim">${upstreams.length} 个上游源。每条写明它进哪一层、对方要求怎么署名。</p>
      ${renderUpstreams(upstreams)}
    </section>

    <section>
      <h2>采集与门禁</h2>
      <p>
        每日采集一次，每层独立判定。某一层不可信时只让这一层沿用上一版，
        其它层照常更新——单层故障不会冻结整站。
      </p>
      <p class="dim">
        每层的门禁结论（<code>ok</code> / <code>warn</code> / <code>stale</code>）
        与采集时点都写在 <a href="/data/manifest.json"><code>manifest.json</code></a> 里。
      </p>
    </section>
  </div>`;
}
