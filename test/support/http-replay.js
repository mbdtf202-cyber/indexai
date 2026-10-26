/**
 * HTTP 回放的预加载薄壳（T3.2）。
 *
 * 实现已并入 `lib/http-replay.js`——回放是 HTTP 客户端的一种模式，
 * 不该只活在测试目录里。这里保留薄壳是为了让既有的
 * `--import ./test/support/http-replay.js` 调用点不用改。
 *
 * 预加载这个文件就会安装回放（幂等）：`npm test` 与 golden 都靠它。
 */

import { installReplay } from '../../lib/http-replay.js';

export {
  fixtureRoot,
  INLINE_LIMIT,
  requestKey,
  fixturePath,
  readFixture,
  decodeRecord,
  setFaults,
  addFault,
  clearFaults,
  replayFetch,
  installReplay,
} from '../../lib/http-replay.js';

/* 预加载即安装。lib 侧只在 INDEXAI_HTTP=replay 时自动装；
 * 用 --import 显式加载本文件本身就是「我要回放」的声明，所以这里无条件装。 */
installReplay();
