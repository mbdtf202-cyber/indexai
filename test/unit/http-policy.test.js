/**
 * 主机策略表与排队闸（T3.2 · S2.1 · INV-8）。
 *
 * 这一层的验收有三条：
 * 1. **层代码里不再出现 `sleep(` / `setTimeout(`** —— 排队与限速都归 http.js；
 * 2. 策略表的数字与线上实测一致（Luma 并发 1 / 900ms / 冷却上限 6 分钟，
 *    中转站单站 1、全局 5），改错了就是「被封」；
 * 3. 排队闸真的生效：同一主机并发不超过上限，最小间隔也被遵守。
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_POLICY,
  HOST_POLICY,
  RELAY_POLICY,
  policyFor,
  registerRelayHosts,
  knownHosts,
} from '../../lib/http-policy.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

describe('层代码里不该有 sleep（T3.2 验收条 1）', () => {
  test('pipeline/layers 下检索不到 sleep( 与 setTimeout(', () => {
    const dir = join(ROOT, 'pipeline', 'layers');
    const offenders = [];
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) {
          walk(p);
          continue;
        }
        if (!e.name.endsWith('.js')) continue;
        const text = readFileSync(p, 'utf8');
        // 注释里提到 sleep 是允许的（说明为什么不用它），只查真实调用
        const code = text
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '')
          .replace(/\s*\/\/.*$/gm, '');
        if (/\bsleep\s*\(/.test(code)) offenders.push(`${p}: sleep(`);
        if (/setTimeout\s*\(/.test(code)) offenders.push(`${p}: setTimeout(`);
      }
    };
    walk(dir);
    assert.deepEqual(offenders, [], '层里不该自己睡，交给 lib/http-policy.js');
  });
});

describe('策略表（T3.2 验收条 2）', () => {
  test('Luma：并发 1、间隔 900ms、冷却 180s、上限 6 分钟', () => {
    const p = policyFor('api.lu.ma');
    assert.equal(p.concurrency, 1, 'Luma 并发就会被封');
    assert.equal(p.minGapMs, 900, '实测间隔 900ms 稳定');
    assert.equal(p.cooldownMs, 180_000, '封禁约 3 分钟才解');
    assert.equal(p.cooldownCapMs, 360_000, '冷却累计超过 6 分钟就停手（F04）');
  });

  test('Devpost / Devfolio / HF：并发 2', () => {
    for (const h of ['devpost.com', 'api.devfolio.co', 'huggingface.co']) {
      assert.equal(policyFor(h).concurrency, 2, `${h} 并发上限应为 2`);
    }
  });

  test('GitHub：并发 4', () => {
    assert.equal(policyFor('api.github.com').concurrency, 4);
  });

  test('AIHOT / HN：间隔 250 / 120 ms', () => {
    assert.equal(policyFor('aihot.news').minGapMs, 250);
    assert.equal(policyFor('hn.algolia.com').minGapMs, 120);
  });

  test('中转站：单站 1 并发（全局 5 由层控制）', () => {
    assert.equal(RELAY_POLICY.concurrency, 1, '同一个站不能连着打两个请求');
  });

  test('未登记的主机走默认值', () => {
    assert.deepEqual(policyFor('example.com'), DEFAULT_POLICY);
  });

  test('注册过的中转站域名走 RELAY_POLICY', () => {
    registerRelayHosts(['packyapi.com', 'https://nova.example/path']);
    assert.equal(policyFor('packyapi.com').concurrency, 1);
    assert.equal(policyFor('nova.example').concurrency, 1, '注册时会剥掉协议与路径');
    assert.ok(knownHosts().includes('packyapi.com'));
  });

  test('已登记的策略优先于中转站判定', () => {
    // api.github.com 在表里，即便被误注册成中转站也仍走自己的策略
    registerRelayHosts(['api.github.com']);
    assert.equal(policyFor('api.github.com').concurrency, 4);
  });
});

describe('排队闸（T3.2 验收条 3）', () => {
  /**
   * 闸门的两个性质必须在**独立进程**里测。
   *
   * 原因：排队状态（hostQueue）是模块级的，而 node --test 会并行跑多个测试文件，
   * 同一进程里别的用例打同一个主机就会污染时间戳，测出来的间隔永远是 0。
   * 子进程拿一份干净的模块实例，测的才是闸门本身。
   */
  function runInChild(source) {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
        cwd: ROOT,
        env: { ...process.env, INDEXAI_HTTP: 'live' },
      });
      let out = '';
      child.stdout.on('data', (c) => {
        out += c;
      });
      child.on('close', (code) => resolve({ code, out }));
    });
  }

  test('并发不超过策略上限', async () => {
    const { code, out } = await runInChild(`
      import * as http from './lib/http.js';
      let inFlight = 0, peak = 0;
      const real = globalThis.fetch;
      globalThis.fetch = async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight -= 1;
        return new Response('ok', { status: 200 });
      };
      await Promise.all(Array.from({ length: 12 }, (_, i) =>
        http.httpText('https://concurrency.test/x' + i, { tries: 1 }).catch(() => {})));
      globalThis.fetch = real;
      console.log(peak);
    `);
    assert.equal(code, 0, `子进程失败：${out}`);
    const peak = Number(out.trim().split('\n').pop());
    assert.ok(
      peak <= DEFAULT_POLICY.concurrency,
      `并发峰值 ${peak} 超过上限 ${DEFAULT_POLICY.concurrency}`,
    );
  });

  test('最小间隔被遵守', async () => {
    const { code, out } = await runInChild(`
      import * as http from './lib/http.js';
      const stamps = [];
      globalThis.fetch = async () => {
        stamps.push(Date.now());
        return new Response('ok', { status: 200 });
      };
      await http.httpText('https://aihot.news/a', { tries: 1 });
      await http.httpText('https://aihot.news/b', { tries: 1 });
      await http.httpText('https://aihot.news/c', { tries: 1 });
      console.log(JSON.stringify(stamps));
    `);
    assert.equal(code, 0, `子进程失败：${out}`);
    const line = out.trim().split('\n').pop();
    const stamps = JSON.parse(line);
    assert.equal(stamps.length, 3, `三个请求都该发出，实际 ${stamps.length} 次`);
    const gaps = stamps.slice(1).map((t, i) => t - stamps[i]);
    for (const g of gaps) {
      assert.ok(g >= 240, `间隔 ${g}ms 小于策略的 250ms`);
    }
  });
});
