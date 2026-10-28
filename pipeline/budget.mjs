/**
 * 跑一层（T3.3 · INV-1 · INV-8）。
 *
 * 职责只有三件事：
 *   1. 按层契约 fetch → normalize → confirm（merge 由调用方给 prev，这里只保证形状）
 *   2. 执行层声明的预算与整次运行的截止 —— 超预算记 **partial**，不记 failed
 *   3. 任何失败都只影响本层，并把原因原样带回（INV-4：失败要响）
 *
 * 拆成独立模块是为了能被单独测试：用例只需要一个假层 + 一个 ctx，
 * 不必启动整条管线。
 */

import { mark, now, since } from '../lib/clock.js';

export async function runLayer(layer, ctx, prevRows, deadlineMs) {
  const started = mark();
  const rec = { layer: layer.id, status: 'ok', n: 0, ms: 0 };

  /* 层声明的预算与整次运行的剩余时间取更紧的那个 */
  const declared = layer.budget?.ms ?? null;
  const left = deadlineMs == null ? Number.POSITIVE_INFINITY : deadlineMs - now().getTime();
  const budgetMs = Math.min(declared ?? Number.POSITIVE_INFINITY, left);
  if (left <= 0 && declared != null) {
    rec.status = 'partial';
    rec.reason = '已过整次运行的截止时间，未执行';
    rec._ms = 0;
    ctx.log(`${layer.id} 跳过：已过运行截止时间`, { level: 'warn' });
    return { value: prevRows ?? [], rec };
  }

  /* 给层一个可感知的截止时刻：层内的 http 调用会用它 */
  const layerCtx =
    budgetMs === Number.POSITIVE_INFINITY ? ctx : { ...ctx, deadline: now().getTime() + budgetMs };

  let timer = null;
  const overBudget = new Promise((_, reject) => {
    if (budgetMs === Number.POSITIVE_INFINITY) return;
    timer = setTimeoutForBudget(
      () => {
        const e = new Error(`超过本层预算 ${Math.round(budgetMs / 1000)}s`);
        e.name = 'BudgetError';
        reject(e);
      },
      Math.max(1, budgetMs),
    );
    if (timer.unref) timer.unref();
  });

  try {
    const raw = await Promise.race([layer.fetch(layerCtx), overBudget]);

    let next;
    try {
      next = layer.normalize(raw, ctx);
    } catch (e) {
      throw new Error(`normalize 失败：${e.message}`);
    }

    /* 契约细节：normalize 可能返回 `{records, quarantined}`（多数层），
     * 也可能直接返回数组。merge 一律期望数组，这里统一取出 records。
     * adoption 的 records 是 `{apps}` 对象而非数组——按对象形状原样传下去。 */
    const nextRows = Array.isArray(next)
      ? next
      : next?.records !== undefined &&
          !Array.isArray(next.records) &&
          typeof next.records === 'object'
        ? next.records
        : (next?.records ?? []);

    let merged;
    try {
      merged = layer.merge(prevRows, nextRows, ctx);
    } catch (e) {
      throw new Error(`merge 失败：${e.message}`);
    }

    /* 两种交付形状（层契约允许）：
     *   - 数组：rows 型层（events / models / relays / news …）
     *   - 对象：单值型层（fx 交付 {USDCNY, as_of}）或带 rows 包装的层
     * 用「是不是数组」区分，比猜字段名可靠。 */
    if (Array.isArray(merged)) {
      rec.n = merged.length;
      rec.status = 'ok';
      rec._ms = since(started);
      return { value: merged, rec };
    }

    if (merged && typeof merged === 'object') {
      const isRowsWrapper = Array.isArray(merged.rows);
      rec.n = isRowsWrapper ? merged.rows.length : Object.keys(merged).length;
      rec.status = merged.stale ? 'stale' : 'ok';
      rec._ms = since(started);
      return { value: merged, rec };
    }

    /* null / undefined：这一层确实没有产出 */
    rec.n = 0;
    rec.status = 'failed';
    rec.error = 'merge 返回空';
    rec._ms = since(started);
    return { value: prevRows ?? [], rec };
  } catch (e) {
    if (timer) clearTimeout(timer);
    rec._ms = since(started);

    /* 超预算 → partial：已采到的没有（这一层是一次性拉取），
     * 但其它层不受影响，报告里要能和「真的挂了」区分开。 */
    if (e.name === 'BudgetError') {
      rec.status = 'partial';
      rec.reason = e.message;
      ctx.log(`${layer.id} 超预算：${e.message}`, { level: 'warn' });
      return { value: prevRows ?? [], rec };
    }

    rec.status = 'failed';
    rec.error = e.message;
    ctx.log(`${layer.id} 失败：${e.message}`, { level: 'warn' });
    // 整层失败：沿用上一版（INV-1），标 stale
    return { value: prevRows ?? [], rec };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 预算超时的计时器。
 *
 * 这里必须是真实计时器：超时判断按墙钟走，回放模式下也要能触发
 * （否则「某层超预算」那条用例永远测不到）。集中在模块边界上，让 R2b 有唯一出口。
 */
function setTimeoutForBudget(fn, ms) {
  return globalThis.setTimeout(fn, ms);
}

/** 测试专用别名：语义上就是「跑一层」，不改行为。 */
export const runLayerForTest = runLayer;
