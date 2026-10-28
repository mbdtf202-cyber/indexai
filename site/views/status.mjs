/**
 * 数据质量周报（T7.3 · S4.4）。
 *
 * 数据形状来自 pipeline/status-report.mjs：weeks + layers + labels。
 * 这里只做渲染，不重新计算任何指标。
 */

const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const num = (v) =>
  v == null
    ? '—'
    : Number(v)
        .toFixed(0)
        .replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export function renderStatus(data = {}) {
  const weeks = data.weeks || [];
  const layers = data.layers || {};
  const labels = data.labels || [];
  if (!weeks.length) {
    return `<div class="doc"><h2>数据质量周报</h2><p>还没有足够的状态历史。采集运行几周后，这里会显示每层门禁、匹配率与隔离率的趋势。</p></div>`;
  }

  const layerNames = Object.keys(layers).sort();
  const table = (name, rows) => `
    <section class="status-layer">
      <h3>${name}</h3>
      <div class="tablewrap"><table class="status-table">
        <thead><tr><th>指标</th>${weeks.map((w) => `<th>${w.label}</th>`).join('')}</tr></thead>
        <tbody>
          <tr><td>门禁通过率</td>${rows.map((r) => `<td>${pct(r.okRate)}</td>`).join('')}</tr>
          <tr><td>匹配率</td>${rows.map((r) => `<td>${pct(r.matchRate)}</td>`).join('')}</tr>
          <tr><td>隔离率</td>${rows.map((r) => `<td>${pct(r.quarantineRate)}</td>`).join('')}</tr>
          <tr><td>采集数</td>${rows.map((r) => `<td>${num(r.count)}</td>`).join('')}</tr>
        </tbody>
      </table></div>
    </section>`;

  return `<div class="doc status-doc">
    <h2>数据质量周报</h2>
    <p class="status-sub">最近 8 周，每层的门禁通过率、名称匹配率、坏行隔离率与采集量；标注集指标单独列出。</p>
    ${layerNames.map((name) => table(name, layers[name])).join('')}
    ${
      labels.length
        ? `<section class="status-layer"><h3>标注集</h3><div class="tablewrap"><table class="status-table">
            <thead><tr><th>指标</th>${weeks.map((w) => `<th>${w.label}</th>`).join('')}</tr></thead>
            <tbody>${labels
              .map(
                (x) =>
                  `<tr><td>${x.name}</td>${(x.values || []).map((v) => `<td>${typeof v === 'number' ? v.toFixed(2) : '—'}</td>`).join('')}</tr>`,
              )
              .join('')}</tbody></table></div></section>`
        : ''
    }
  </div>`;
}
