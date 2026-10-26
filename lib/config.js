/**
 * 站点地址的单一来源（F52 · INV-5）。
 *
 * 站点地址**只写在 `package.json` 的 `homepage` 一处**（S9.9）。
 * UA、Atom 的 `self` 链接、iCal 的 UID、canonical 全部从它现读——
 * 换域名时只改一处，不会有地方忘改而指向旧域。
 *
 * 这里不提供第二份手抄常量：以前这里还写死过一份 BASE_URL、与 package.json 各存一份，换域名必错。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 站点根地址，无尾斜杠。读 package.json：`homepage`。 */
export const BASE_URL = (() => {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    return String(pkg.homepage || '').replace(/\/+$/, '');
  } catch {
    return '';
  }
})();

/** 站点的 host（不带协议），给 iCal UID、Atom tag 这类场景用。 */
export const HOST = BASE_URL.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

export const SITE = {
  BASE_URL,
  HOST,
  FEED_PATH: 'feeds/changes.xml',
  CANONICAL: () => `${BASE_URL}/`,
  CHANGE_FEED: () => `${BASE_URL}/${SITE.FEED_PATH}`,
};

export default { SITE, BASE_URL, HOST };
