/**
 * HTTP 录制的预加载薄壳（T3.2）。
 *
 * 实现已并入 `lib/http-record.js`——与回放同理，录制是 HTTP 客户端的一种模式。
 * 这里保留薄壳，让 `--import ./test/support/http-record.js` 的调用点不用改。
 */

import { installRecorder } from '../../lib/http-record.js';

export {
  fixtureRoot,
  saveRecord,
  recordFetch,
  installRecorder,
} from '../../lib/http-record.js';

installRecorder();
