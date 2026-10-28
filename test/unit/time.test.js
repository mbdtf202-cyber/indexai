/**
 * 时间口径（T3.4 · F13 · S2.2）。
 *
 * 各源的时间到底是不是 UTC，是这一条的核心。回放数据实测结论（2026-10-26）：
 *
 * | 源 | 字段 | 格式 |
 * |---|---|---|
 * | Luma | `start_at` / `end_at` + `timezone` | UTC ISO + IANA 时区名 |
 * | Devfolio | `starts_at` / `ends_at` | UTC ISO，无时区字段 |
 * | AIHOT | `publishedAt` | UTC ISO |
 * | Devpost | `submission_period_dates` | 纯文本日期，无时区 |
 *
 * 三条验收：
 * 1. 东京 19:00 的场次在 `Asia/Tokyo` 下日期正确；
 * 2. 北京时间凌晨发布的新闻归入当天（不是前一天）；
 * 3. 时区缺失时退回 UTC 并明确标记，不编造。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { localDate, localDateTime, daysBetween, SITE_TZ } from '../../lib/time.js';

describe('localDate：按活动所在时区算日期（T3.4 验收 1）', () => {
  test('东京 19:00 的场次，在 Asia/Tokyo 下是当天', () => {
    // 东京 2026-11-05 19:00 = UTC 2026-11-05T10:00Z
    const utc = '2026-11-05T10:00:00.000Z';
    assert.equal(localDate(utc, 'Asia/Tokyo'), '2026-11-05');
    // 同一个时刻在 UTC 下也是 11-05，但悉尼、洛杉矶会不同
    assert.equal(localDate(utc, 'UTC'), '2026-11-05');
  });

  test('悉尼 09:00 的场次，UTC 是前一天 —— 取前 10 位会错', () => {
    // 悉尼 2026-11-05 09:00（UTC+11 夏令时）= UTC 2026-11-04T22:00Z
    const utc = '2026-11-04T22:00:00.000Z';
    assert.equal(localDate(utc, 'Australia/Sydney'), '2026-11-05', '本地日期应为 11-05');
    assert.equal(utc.slice(0, 10), '2026-11-04', '而直接切前 10 位得到的是 11-04（错的）');
  });

  test('洛杉矶 23:00 的场次，UTC 是次日', () => {
    // 洛杉矶 2026-11-05 23:00（PST, UTC-8）= UTC 2026-11-06T07:00Z
    const utc = '2026-11-06T07:00:00.000Z';
    assert.equal(localDate(utc, 'America/Los_Angeles'), '2026-11-05');
    assert.equal(utc.slice(0, 10), '2026-11-06', '而直接切前 10 位得到的是 11-06（错的）');
  });

  test('缺时区时按 UTC，不猜也不编造', () => {
    const utc = '2026-11-05T10:00:00.000Z';
    assert.equal(localDate(utc, null), '2026-11-05');
    assert.equal(localDate(utc, undefined), '2026-11-05');
  });

  test('非法时区名退回 UTC，不抛错', () => {
    assert.equal(localDate('2026-11-05T10:00:00.000Z', 'Mars/Olympus'), '2026-11-05');
  });

  test('纯日期字符串原样返回（Devpost 那种）', () => {
    assert.equal(localDate('2026-10-23', 'Asia/Tokyo'), '2026-10-23');
  });

  test('无法解析返回 null，不编造日期', () => {
    assert.equal(localDate(null, 'UTC'), null);
    assert.equal(localDate('', 'UTC'), null);
    assert.equal(localDate('not-a-date', 'UTC'), null);
  });
});

describe('北京时间凌晨的新闻归入当天（T3.4 验收 2）', () => {
  test('UTC 16:30 = 北京次日 00:30，按 Shanghai 归到次日', () => {
    // 北京 2026-10-24 00:30（UTC+8）= UTC 2026-10-23T16:30Z
    const utc = '2026-10-23T16:30:00.000Z';
    assert.equal(localDate(utc, SITE_TZ), '2026-10-24', '按东八区应归入 10-24');
    assert.equal(utc.slice(0, 10), '2026-10-23', '直接切前 10 位会归到前一天');
  });

  test('UTC 23:59 = 北京次日 07:59', () => {
    const utc = '2026-10-23T23:59:00.000Z';
    assert.equal(localDate(utc, SITE_TZ), '2026-10-24');
  });

  test('UTC 15:59 = 北京当日 23:59，仍在当天', () => {
    const utc = '2026-10-23T15:59:00.000Z';
    assert.equal(localDate(utc, SITE_TZ), '2026-10-23');
  });
});

describe('localDateTime：给页面显示用', () => {
  test('拆出本地日期与时刻', () => {
    const r = localDateTime('2026-11-05T10:00:00.000Z', 'Asia/Tokyo');
    assert.equal(r.date, '2026-11-05');
    assert.equal(r.time, '19:00');
  });

  test('空值返回 null', () => {
    assert.equal(localDateTime(null, 'UTC'), null);
  });
});

describe('daysBetween', () => {
  test('同年同日为 0', () => {
    assert.equal(daysBetween('2026-10-24', '2026-10-24'), 0);
  });

  test('跨月正确', () => {
    assert.equal(daysBetween('2026-10-24', '2026-11-05'), 12);
  });

  test('跨夏令时仍按日期算（不差一小时）', () => {
    // 美国 2026 夏令时结束于 11-01；只按日期减，不该出现 0.958 天这种
    assert.equal(daysBetween('2026-10-31', '2026-11-02'), 2);
  });

  test('非法输入返回 null', () => {
    assert.equal(daysBetween('bad', '2026-10-24'), null);
  });
});
