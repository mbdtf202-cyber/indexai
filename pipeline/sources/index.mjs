/**
 * 逐源 fetcher 的统一出口。
 *
 * 这些是「一个源怎么抓」的实现，与「层怎么调度」分开：
 * - 层（`pipeline/layers/*`）负责并发、单源失败收敛、契约形状；
 * - 这里负责真实请求与解析。
 *
 * 全部从 `41dec66:collect.mjs` 原样搬出——那是被生产验证过的实现，
 * 拆层时没有归属，导致采集管线一直空转（见 DIAGNOSIS.md）。
 */

export { fetchDevpost } from './devpost.mjs';
export { fetchLuma, getLumaBlockState, resetLumaState } from './luma.mjs';
export { fetchDevfolio, devfolioPrize } from './devfolio.mjs';
export { fetchAios } from './aios.mjs';
export { probeRelay } from './probe-relay.mjs';
