/**
 * 活动状态 / 类型 / 地区的判定（从 `41dec66:collect.mjs` 原样搬出）。
 *
 * 拆层时这一整套没有归属：`events` 层的 `normalize` 只做合并，不做判定。
 * 结果是 T1.8 修的地区与类型逻辑（F10、F11）实际上等于丢了。
 *
 * 判定顺序与理由都写在各函数里，改动前先读注释——每一条都是线上数据反复
 * 暴露后定下来的，不是猜的。
 */

import { todayISO } from './clock.js';

const EV_COUNTRY_REGION = {
  // 大中华区（港澳台按项目既有口径并入 cn，与 EV_REGION_RULES 的中文区一致）
  CN: 'cn', HK: 'cn', TW: 'cn', MO: 'cn',
  JP: 'jp', KR: 'kr', SG: 'sg', IN: 'in',
  // 欧洲
  GB: 'uk',
  DE: 'eu', FR: 'eu', NL: 'eu', CH: 'eu', ES: 'eu', IT: 'eu', PT: 'eu', SE: 'eu',
  FI: 'eu', DK: 'eu', NO: 'eu', PL: 'eu', CZ: 'eu', AT: 'eu', BE: 'eu', IE: 'eu',
  HU: 'eu', RO: 'eu', BG: 'eu', LU: 'eu', EE: 'eu', LV: 'eu', LT: 'eu', GR: 'eu',
  HR: 'eu', SI: 'eu', SK: 'eu', RS: 'eu', UA: 'eu', TR: 'eu',
  // 北美
  US: 'us', CA: 'ca',
  // 中东
  AE: 'ae', IL: 'middle-east', SA: 'middle-east', QA: 'middle-east',
  JO: 'middle-east', LB: 'middle-east', KW: 'middle-east', BH: 'middle-east', OM: 'middle-east',
  // 拉美
  BR: 'latam', MX: 'latam', AR: 'latam', CL: 'latam', CO: 'latam', PE: 'latam',
  UY: 'latam', PY: 'latam', EC: 'latam', CR: 'latam', PA: 'latam',
  // 大洋洲
  AU: 'au', NZ: 'au',
  // 非洲
  NG: 'africa', KE: 'africa', ZA: 'africa', EG: 'africa', GH: 'africa', MA: 'africa',
  TN: 'africa', UG: 'africa', TZ: 'africa', RW: 'africa', ET: 'africa',
  // 东南亚 / 南亚其余
  PH: 'asia', ID: 'asia', VN: 'asia', TH: 'asia', MY: 'asia', LK: 'asia',
  NP: 'asia', BD: 'asia', KH: 'asia', MM: 'asia', PK: 'asia',
};

/** 国家码 → region，未知国家返回 null（交给正则兜底，不瞎猜） */
export function regionFromCountryCode(cc) {
  if (!cc) return null;
  return EV_COUNTRY_REGION[String(cc).trim().toUpperCase()] || null;
}

/* 英文国名 → region：给 Devfolio 这类只给国名、不给 ISO 码的源用。
 * 用 ^...$ 全匹配，避免 "India" 被 "Indiana" 之类的城市名误命中。 */
/** @type {Array<[string, RegExp]>} */
const EV_COUNTRY_NAME_RULES = [
  ['us', /^(United States|United States of America|USA|US)$/i],
  ['uk', /^(United Kingdom|UK|England|Scotland|Wales|Northern Ireland|Great Britain)$/i],
  ['cn', /^(China|Hong Kong|Macao|Macau|Taiwan)$/i],
  ['jp', /^Japan$/i], ['kr', /^(South Korea|Korea)$/i], ['sg', /^Singapore$/i],
  ['in', /^India$/i], ['ca', /^Canada$/i], ['au', /^(Australia|New Zealand)$/i],
  ['ae', /^(United Arab Emirates|UAE)$/i],
  ['eu', /^(Germany|France|Netherlands|Switzerland|Spain|Italy|Portugal|Sweden|Finland|Denmark|Norway|Poland|Czechia|Czech Republic|Austria|Belgium|Ireland|Hungary|Romania|Bulgaria|Luxembourg|Estonia|Latvia|Lithuania|Greece|Croatia|Slovenia|Slovakia|Serbia|Ukraine|Turkey|Türkiye)$/i],
  ['middle-east', /^(Israel|Saudi Arabia|Qatar|Jordan|Lebanon|Kuwait|Bahrain|Oman)$/i],
  ['latam', /^(Brazil|Mexico|Argentina|Chile|Colombia|Peru|Uruguay|Paraguay|Ecuador|Costa Rica|Panama)$/i],
  ['africa', /^(Nigeria|Kenya|South Africa|Egypt|Ghana|Morocco|Tunisia|Uganda|Tanzania|Rwanda|Ethiopia)$/i],
  ['asia', /^(Philippines|Indonesia|Vietnam|Thailand|Malaysia|Sri Lanka|Nepal|Bangladesh|Cambodia|Myanmar|Pakistan)$/i],
];

/* 限速：这里是**实测**出来的硬约束，不是拍脑袋。
 * 2026-10-24 实测：
 *   - 并发 8 + 80ms 节流 → 216 个 geo job 里 167 个失败（403/429）
 *   - 封禁是**有状态**的：封后单请求间隔 400ms / 1500ms 仍 429
 *   - 解封曲线：+30s 429 · +60s 429 · +120s 429 · **+180s 才 200**
 *   - 顺序 + 间隔 900ms → 连发 12 个全 200；1500ms 同样 12/12
 * 所以：geo 走**单线程顺序队列**，每请求间隔 EV_LUMA_GAP_MS，命中 429 就指数退避到
 * EV_LUMA_COOLDOWN_MS 再继续。并发在这里不是优化，是自杀 —— 跟 Eventbrite 是同一形态。 */
export function eventStatus(e, today = todayISO()) {
  const start = e.start || '';
  const end = e.end || '';
  const last = end || start;
  if (last && last < today) return 'past';
  if (!start && !end) return 'unknown';
  if (start && start > today) return 'upcoming';
  return 'open';
}

/* 活动类型：从标题 / 主题 / 场地 / 主办推断。
 * 规则按「越具体越先判」排，先命中先归类；都不命中才落 other（兜底，不追求 0）。
 *
 * 实测复盘（2026-10-24，620 条）：旧逻辑把 126 个 Devpost 活动打成 other，占 20%，
 * 原因是 Devpost 的活动名不用 hackathon 这个字，而是 Hacks / HackSprint / -Thon /
 * Datathon / Databowl / Design Jam…，主题里又写着 "Machine Learning/AI"。
 * 这里补上这些真实写法（都是线上数据里实际出现过的后缀，不是猜的）。 */

export function eventKind(e) {
  const b = `${e.title || ''} ${(e.themes || []).join(' ')} ${e.dates || ''} ${e.org || ''} ${e.kindHint || ''}`;

  // 竞赛 / 黑客松：hack day、hackweek、-thon、datathon、data bowl、jam、挑战赛都算
  // 注意 "-thon" 要写成带连字符或词尾，否则会误吃 marathon/marathon-like 的词
  if (/hackathon|hack ?day|hackweek|hack ?week|hacks?\b|hacksprint|hack ?sprint|黑客松|challenge|datathon|data ?bowl|\bjam\b|competition|contest|竞赛|大赛|挑战赛|kaggle|sprint|\bthon\b|-thon\b|\bchip\b hack/i.test(b)) return 'hackathon';
  // 大展会 / 峰会 / 大会
  // F11：con\b 曾经吃掉 "Silicon Valley Con..."；英文 forum 把 OpenAI Forum 系列判成会议。
  // 会议只认真正的会议词，中文「论坛」保留（它确实是会议）。
  if (/summit|conference|convention|symposium|大会|峰会|论坛|expo|展会|博览|world congress|tech week|conference week/i.test(b)) return 'conference';
  // 奖项 / 评选
  if (/award|prize|评选|颁奖|film festival/i.test(b)) return 'award';
  // 工作坊 / 课程 / 训练营
  if (/workshop|工作坊|training|tutorial|bootcamp|训练营|课程|讲座|seminar|masterclass|course|lesson|lab session|study group|paper club|reading group|class\b/i.test(b)) return 'workshop';
  // 演示日 / 路演 / 展会型
  if (/demo ?day|roadshow|路演|showcase|pitch ?day|pitch night|launch day|exhibition|开放日|open day|design jam/i.test(b)) return 'demo';
  // 聚会 / 社区场 / networking
  if (/meetup|聚会|community|salon|drinks|networking|night|party|talk|session|panel|roundtable|dinner|coffee|brunch|happy hour|gathering|沙龙|圆桌/i.test(b)) return 'meetup';
  // Luma 以社区活动为主，没命中关键词的按 meetup 归
  if (e.source === 'Luma') return 'meetup';
  // Devpost 上的活动几乎都是提交型开发活动：有提交期、有奖池、有报名数，
  // 名字起得再随意（"Build With AI: Basics" / "Life After Code"）也仍然是 hackathon 性质。
  // 这个兜底只对 Devpost 生效，别的源不乱套。
  if (e.source === 'Devpost') return 'hackathon';
  /* Devfolio 同理：它的 API 里 type 字段固定是 'HACKATHON'，整个站就是黑客松平台。
   * 但名字常常不带 hackathon（"Unbuilt" / "AgentVerse" / "Cognition 2026"），
   * 主题又常是 "No Restrictions"，上面几条规则都命中不了 —— 实测 13 条里 7 条落 other。
   * 那是**源性质**决定的，不是推断失灵，所以给它跟 Devpost 同样的兜底。 */
  if (e.source === 'Devfolio') return 'hackathon';
  return 'other';
}

/* 地区：location + org + 标题联合判断。
 * 旧实现只看 location，而 Luma 的 location 之前只存了城市名（不带国家），
 * Devpost 常常只给学校名（"University of Florida"），结果大量真实地区被吞成 other。
 *
 * 实测复盘（2026-10-24）：other 140 条里 80 条是 Devpost 的**校园/场馆名**，
 * 名字里没有国家但校名本身就说明国家（McMaster=加拿大、NC State=美国）。
 * 所以这里除了城市/国家，还认大学与州的缩写 —— 都是线上数据里实际出现过的。
 * 仍然保留 other 兜底：Luma 有 44 条 geo 完全空着（location 只有「线下」），
 * 那是源缺数据，不猜。 */
/** @type {Array<[string, RegExp]>} */
const EV_REGION_RULES = [
  // 中文区（含港澳台）
  ['cn', /中国|上海|北京|深圳|杭州|广州|成都|南京|武汉|西安|苏州|厦门|重庆|天津|香港|澳门|台北|台灣|台湾|\bChina\b|Shanghai|Beijing|Shenzhen|Hangzhou|Guangzhou|Chengdu|Nanjing|\bWuhan\b|\bXiamen\b|Suzhou|Chongqing|Tianjin|Hong ?Kong|Macau|Macao|Taipei|Taiwan/i],
  ['jp', /日本|东京|東京|大阪|京都|名古屋|福冈|札幌|横滨|\bJapan\b|Tokyo|Shibuya|Chiyoda|Minato|Meguro|Osaka|Kyoto|Nagoya|Fukuoka|Sapporo|Yokohama/i],
  ['kr', /韩国|韓國|首尔|首爾|서울|부산|Seoul|Korea|Busan/i],
  ['sg', /新加坡|Singapore|Singapur/i],
  // F10：Islamabad/Pakistan 搬到 asia 那一档（国家码表里 PK→asia，正则不能再跟它打架）
  ['in', /印度|班加罗尔|孟买|新德里|海得拉巴|浦那|金奈|科钦|\bIndia\b|\bBangalore\b|\bBengaluru\b|\bMumbai\b|New Delhi|\bDelhi\b|\bHyderabad\b|\bPune\b|\bChennai\b|\bKochi\b|Coimbatore|Tamil ?Nadu/i],
  ['ae', /迪拜|杜拜|阿布扎比|阿聯酋|阿联酋|\bDubai\b|Abu Dhabi|\bUAE\b|United Arab Emirates/i],
  ['uk', /英国|英國|伦敦|倫敦|曼彻斯特|爱丁堡|牛津|剑桥|\bUK\b|\bU\.K\.|United Kingdom|England|London|Manchester|Edinburgh|Cambridge|Oxford|Bristol|Glasgow/i],
  // 欧洲（含实测出现的小国：匈牙利/罗马尼亚/保加利亚/卢森堡/土耳其）
  ['eu', /欧洲|歐盟|德国|法国|荷兰|西班牙|意大利|葡萄牙|瑞典|芬兰|丹麦|挪威|瑞士|波兰|捷克|奥地利|比利时|爱尔兰|匈牙利|罗马尼亚|保加利亚|卢森堡|土耳其|柏林|巴黎|阿姆斯特丹|慕尼黑|巴塞罗那|米兰|斯德哥尔摩|赫尔辛基|苏黎世|维也纳|布达佩斯|布加勒斯特|索菲亚|Europe|Germany|Berlin|Munich|France|Paris|Netherlands|Amsterdam|Spain|Barcelona|Madrid|Italy|Milan|Portugal|Lisbon|Sweden|Stockholm|Finland|Helsinki|Turku|Denmark|Copenhagen|Norway|Oslo|Switzerland|Zurich|Poland|Warsaw|Czech|Prague|Austria|Vienna|Belgium|Brussels|Ireland|Dublin|Hungary|Budapest|Romania|Bucure[sș]ti|Bulgaria|\bSofia\b,|Sofia, Bulgaria|Luxembourg|T[uü]rkiye|Turkey|Istanbul|Volkshochschule/i],
  // F10：补上省名。Ontario 里有 "Rio"，以前会被 latam 的 Rio 先吃掉，判成巴西。
  ['ca', /加拿大|多伦多|溫哥華|温哥华|蒙特利尔|渥太华|滑铁卢|卡尔加里|温莎|\bCanada\b|\bToronto\b|\bVancouver\b|\bMontreal\b|\bOttawa\b|\bWaterloo\b|\bCalgary\b|\bWindsor\b|Manitoba|McMaster|Sheridan|Hazel McCallion|Bayview Yards|\bOntario\b|\bQuebec\b|Qu[eé]bec|British Columbia|\bAlberta\b|\bKitchener\b|\bMississauga\b|\bHamilton\b|\bVictoria\b, BC/i],
  ['au', /澳大利亚|澳洲|悉尼|墨爾本|墨尔本|布里斯班|珀斯|\bAustralia\b|Sydney|Melbourne|Brisbane|Perth|Wellington|New Zealand|Auckland/i],
  // 美国：城市 + 州名/缩写 + 实测出现的高校与园区
  ['us', /美国|美國|纽约|紐約|旧金山|舊金山|西雅图|西雅圖|硅谷|洛杉矶|芝加哥|奥斯汀|波士顿|圣地亚哥|华盛顿|迈阿密|丹佛|亚特兰大|匹兹堡|费城|休斯顿|达拉斯|凤凰城|波特兰|纳什维尔|夏洛特|底特律|辛辛那提|坦帕|奥兰多|拉斯维加斯|罗利|安娜堡|盖恩斯维尔|沃斯堡|明尼阿波利斯|圣路易斯|堪萨斯城|盐湖城|圣安东尼奥|哥伦布|印第安纳波利斯|密尔沃基|布法罗|罗切斯特|纽黑文|纽瓦克|泽西城|长滩|奥克兰|萨克拉门托|弗雷斯诺|图森|阿尔伯克基|俄克拉荷马城|塔尔萨|孟菲斯|新奥尔良|伯明翰|杰克逊维尔|塔拉哈西|诺克斯维尔|路易斯维尔|列克星敦|代顿|托莱多|阿克伦|兰辛|麦迪逊|林肯|奥马哈|得梅因|普罗维登斯|哈特福德|波特兰缅因|\bUS\b|\bUSA\b|United States|New York|San Francisco|San Jose|Seattle|Silicon Valley|Los Angeles|Chicago|Austin|Boston|San Diego|Washington|Miami|Denver|Atlanta|Pittsburgh|Philadelphia|Houston|Dallas|Phoenix|Portland|Nashville|Charlotte|Detroit|Cincinnati|Tampa|Orlando|Las Vegas|Raleigh|Ann Arbor|Gainesville|Fort Worth|Arlington|Plano|Irving|Frisco|Minneapolis|St\.? Louis|Kansas City|Salt Lake|San Antonio|Columbus|Indianapolis|Milwaukee|Buffalo|Rochester|New Haven|Newark|Jersey City|Long Beach|Oakland|Sacramento|Fresno|Tucson|Albuquerque|Oklahoma City|Tulsa|Memphis|New Orleans|Birmingham|Jacksonville|Tallahassee|Knoxville|Louisville|Lexington|Dayton|Toledo|Akron|Lansing|Madison|Lincoln|Omaha|Des Moines|Providence|Hartford|Stanford|Berkeley|Cal Hacks|MIT|Harvard|CMU|Cornell|Princeton|Yale|Columbia University|NYU|UCLA|UC Berkeley|UC Riverside|UC San Diego|University of California|UCF|UGA|UNC|NC State|Penn State|Pennovation|Purdue|Georgia Tech|Michigan State|Central Michigan|MSU|Ohio State|Rutgers|Columbia|Northwestern|\bIllinois\b|Texas A&M|Texas A＆M|A&M|UT Dallas|UT Austin|University of Florida|Florida State|Virginia Tech|West Virginia|WPI|RPI|SJSU|San Jose State|Cal Poly|Arizona State|ASU|Embry-Riddle|Kent State|Binghamton|Towson|Lehman|GSU|Georgia State|Baylor|Rice University|Duke|Vanderbilt|Clemson|Auburn|Alabama|Oklahoma|Kansas|Nebraska|Iowa|Minnesota|Wisconsin|Indiana|Missouri|Tennessee|Kentucky|Arkansas|Mississippi|Louisiana|Colorado|Utah|Nevada|Oregon|Idaho|Montana|Wyoming|Alaska|Hawaii|\bNYC\b|New York City|Community Branch Library|\bHack Club\b|Pololu/i],
  // F10：Rio / Lima 这类三四个字母的地名必须带词边界，否则 Ontario 里的 "Rio" 会命中。
  ['latam', /巴西|墨西哥|阿根廷|智利|哥伦比亚|秘鲁|巴拉圭|乌拉圭|\bBrazil\b|\bBrasil\b|S[aã]o Paulo|\bRio\b|\bMexico\b|M[eé]xico|\bCDMX\b|Guadalajara|\bArgentina\b|Buenos Aires|\bChile\b|\bSantiago\b|\bColombia\b|Bogot[aá]|\bPeru\b|\bLima\b|\bParaguay\b|Asunci[oó]n|\bUruguay\b|Montevideo|CETYS|\bM[eé]xico\b|Ense[ñn]anza T[eé]cnica/i],
  ['africa', /非洲|尼日利亚|肯尼亚|南非|埃及|乌干达|加纳|摩洛哥|突尼斯|坦桑尼亚|Africa|Nigeria|Lagos|Kenya|Nairobi|South Africa|Cape Town|Johannesburg|Egypt|Cairo|Uganda|Kampala|Ghana|Accra|Morocco|Tunisia|Tunis|Tanzania/i],
  ['middle-east', /中东|中東|沙特|卡塔尔|以色列|约旦|黎巴嫩|\bIsrael\b|Tel Aviv|Jerusalem|Saudi|Riyadh|Qatar|Doha|Jordan|Amman|Lebanon|Beirut/i],
  // 东南亚/南亚剩余国家
  // F10：巴基斯坦从「印度」那条搬到这里——国家码表里 PK→asia，正则必须一致。
  ['asia', /菲律宾|印度尼西亚|印尼|越南|泰国|马来西亚|斯里兰卡|尼泊尔|孟加拉|柬埔寨|缅甸|亚美尼亚|巴基斯坦|伊斯兰堡|拉合尔|Ph ?ilippines|\bManila\b|\bIndonesia\b|\bJakarta\b|\bVietnam\b|\bHanoi\b|Ho Chi Minh|\bThailand\b|\bBangkok\b|\bMalaysia\b|Kuala Lumpur|Sri Lanka|\bColombo\b|\bNepal\b|\bKathmandu\b|\bBangladesh\b|\bDhaka\b|\bCambodia\b|\bMyanmar\b|\bArmenia\b|\bYerevan\b|\bPakistan\b|\bIslamabad\b|\bLahore\b|\bKarachi\b/i],
];




export function eventRegion(e) {
  const loc = String(e.location || '');
  // 线上优先：但是「线上 + 线下」混合场次（Luma 常见）按线下判，因为地点更有信息量
  const onlineOnly = /^(线上|online|remote|virtual|anywhere)$/i.test(loc.trim());
  if (onlineOnly) return 'online';

  /* 判定顺序（越靠前越权威）：
   *   1. 源的 country_code —— 直接来自数据源的国家码，不靠猜
   *   2. 城市 geo 兜底 —— 只有源没给国家时才用（本次是从该城市坐标问出来的）
   *   3. location / org / 标题字符串正则 —— 老办法，作为兜底
   *   4. other
   * 线上场次已经在上面早返回，不会被国家码覆盖成线下地区。
   * 注意「线上」+ 有国家码的混合场次：先判线上只认纯线上，混合场次继续往下走国家码，这是对的。 */
  const byCountry = regionFromCountryCode(e.countryCode);
  if (byCountry) return byCountry;

  if (e.geoCityFallback) return e.geoCityFallback;

  // Devfolio 给的是英文国名（"India" / "Germany"），不是 ISO 两位码，
  // 单独走一次国名正则，比把国名塞进 loc 再靠城市名命中更靠谱
  if (e.countryName) {
    const byName = EV_COUNTRY_NAME_RULES.find(([, re]) => re.test(e.countryName));
    if (byName) return byName[0];
  }

  // 只看地点与主办方，**绝不拼标题**（F10）。
  // 活动标题里塞满地名人名（"Fireside with Jordan"、"Austin Powers Night"），
  // 拼进来就等于让标题决定地区——实测这条贡献了大部分错判。
  const hay = `${loc} ${e.org || ''}`;
  for (const [code, re] of EV_REGION_RULES) {
    // 中文地名与「Sofia, Bulgaria」这类完整写法不带词边界；纯英文短词已在正则里加了 \b
    if (re.test(hay)) return code;
  }
  // 没有可识别地区，但源明确说是线上 → online；否则 other
  if (/线上|online|remote|virtual|anywhere/i.test(loc)) return 'online';

  /*
   * other 会因为这些情况「升高」，而且这是对的（T1.8 实测复盘）：
   *
   * 61 条线下场次的 location 只有「线下」两个字，既没有国家码也没有 geo 城市
   * （Luma 59 条、Devfolio 2 条）。旧实现靠标题里碰巧出现的「Toronto」「CDMX」
   * 「Bangalore」蒙对 10 条——那正是 F10 要治的病：标题里的地名可能是人名、
   * 可能是线上活动的口号、也可能是别的城市。现在一律落 other，等源补 geo。
   *
   * 因此 other 从 5.1% 升到 5.7% 是「去掉猜地名」的代价，不是退化。
   * S8.5 的质量线（region=other ≤ 10%）仍然满足。
   */
  return 'other';
}

/* 地区归并：值太碎就没法当筛选维度用。
 * 实测问题（2026-10-24）：`ae`（阿联酋）只有 1 条、`kr`（韩国）2 条，
 * 前端按实际数据生成筛选按钮时会列出一堆点开只有 1 条的空按钮。
 * 原则：**国家**值条数 < EV_REGION_MIN 就并入所属大区；原始值不再回写（T2.2 起）。
 * 大区值（asia / eu / latam / middle-east / africa / online / other）不参与归并。
 * 阈值不写死在别处：条数变化时自动生效，不需要再改代码。 */
const EV_REGION_MIN = 5;
// 小国家值并到哪个大区（先查这张表，查不到就按 fallback 再查，最后落 other）
const EV_REGION_FOLD = { ae: 'middle-east', kr: 'asia' };
/*
 * 小国家的归并目标必须同洲。
 * F10：旧表把 ca → latam、au → asia，于是「拉美」筛选里会出现多伦多。
 * 没有同洲大区可归的（加拿大、澳洲）就落 other —— 宁可不归并，也不要错归。
 */
const EV_REGION_FOLD_FALLBACK = {
  ae: 'middle-east', kr: 'asia', sg: 'asia', jp: 'asia', cn: 'asia', in: 'asia',
  uk: 'eu',
};
const EV_REGION_REGIONS = new Set(['online', 'other', 'asia', 'eu', 'latam', 'middle-east', 'africa']);


export function foldRegions(events) {
  const count = events.reduce((a, e) => { a[e.region] = (a[e.region] || 0) + 1; return a; }, {});
  const fold = { ...EV_REGION_FOLD };
  for (const [code, n] of Object.entries(count)) {
    if (EV_REGION_REGIONS.has(code)) continue;             // 大区本身不动
    if (n >= EV_REGION_MIN) continue;                       // 够量就保留独立值
    if (fold[code] == null) fold[code] = EV_REGION_FOLD_FALLBACK[code] || 'other';
  }
  const applied = Object.entries(fold).filter(([from]) => count[from] != null && count[from] < EV_REGION_MIN);
  if (applied.length) {
    console.log(`[collect] region 归并（<${EV_REGION_MIN} 条并入大区）：${applied.map(([k, v]) => `${k}(${count[k]})→${v}`).join(' · ')}`);
  }
  // 归并只改 region；原始值不再回写（页面不读，S6.5 的展示分组另有字典）
  return events.map((e) => (fold[e.region] ? { ...e, region: fold[e.region] } : e));
}
