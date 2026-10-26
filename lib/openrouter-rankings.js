/**
 * OpenRouter 公开排名页解析（从 `41dec66:collect.mjs` 原样搬出）。
 *
 * 页面里内嵌了一段 JSON，`app_id` / `total_tokens` / `model_permaslug` 都在其中。
 * 解析器对 html 做两层宽松处理：先剥掉反斜杠转义，再按 `"day":[` 定位当天窗口
 * （跨窗口的 token 不可比，只能取同一窗口）。
 *
 * 输出：`{ apps: [{id,title,slug,rank,tokens,categories,desc}], models: [{slug,tokens}] }`
 */



export function parseOpenRouter(html) {
  const h = html.replace(/\\+"/g, '"').replace(/\\n/g, ' ');

  // 应用（谁在用哪个工具）——只取 day 窗口，跨窗口的 token 不可比
  const dayAt = h.indexOf('"day":[');
  const scope = dayAt >= 0 ? h.slice(dayAt, dayAt + 30000) : h;
  const apps = [];
  for (const p of scope.split('"app_id":').slice(1)) {
    const id = p.match(/^(\d+)/);
    const tok = p.match(/"total_tokens":"?(\d+)"?/);
    const rk = p.match(/"rank":(\d+)/);
    const ttl = p.match(/"title":"((?:[^"\\]|\\.)*)"/);
    const slug = p.match(/"slug":"((?:[^"\\]|\\.)*)"/);
    const cats = p.match(/"categories":\[([^\]]*)\]/);
    const desc = p.match(/"description":"((?:[^"\\]|\\.)*)"/);
    if (!id || !ttl || !rk) continue;
    apps.push({
      id: +id[1],
      title: ttl[1],
      slug: slug ? slug[1] : '',
      rank: +rk[1],
      tokens: tok ? +tok[1] : 0,
      categories: cats ? cats[1].replace(/"/g, '').split(',').filter(Boolean) : [],
      desc: desc ? desc[1].slice(0, 240) : '',
    });
  }
  const appMap = new Map();
  for (const a of apps) {
    if (!appMap.has(a.title)) appMap.set(a.title, a);
  }

  // 模型调用量（真实选择）
  const models = [];
  const reM = /\{"date":"([^"]+)","model_permaslug":"([^"]+)","variant":"([^"]*)","total_completion_tokens":(\d+),"total_prompt_tokens":(\d+)/g;
  let m;
  while ((m = reM.exec(h))) models.push({ slug: m[2], tokens: +m[4] + +m[5] });
  const modelMap = new Map();
  for (const r of models) modelMap.set(r.slug, (modelMap.get(r.slug) || 0) + r.tokens);

  return {
    apps: [...appMap.values()].sort((a, b) => b.tokens - a.tokens).map((a, i) => ({ ...a, rank: i + 1 })),
    models: [...modelMap.entries()]
      .map(([slug, tokens]) => ({ slug, tokens }))
      .sort((a, b) => b.tokens - a.tokens),
  };
}
