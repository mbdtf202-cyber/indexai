// 采集 + 发布到 Cloudflare Pages
// 用 node 驱动而不是 bash：launchd 下 /bin/bash 会被 macOS TCC 拦住读不到桌面文件，
// node 没有这个问题。
// 用法: node deploy.mjs [--skip-collect]
import { spawn } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const ROOT = "/Users/raki/Desktop/IndexAI";
const DIST = "/tmp/indexai-dist";
const WRANGLER = "/Users/raki/.npm-global/bin/wrangler";
const PROJECT = "indexai";
const skipCollect = process.argv.includes("--skip-collect");

const ENV = {
  ...process.env,
  PATH: "/Users/raki/.local/node/current/bin:/Users/raki/.npm-global/bin:/usr/local/bin:/usr/bin:/bin",
  HOME: process.env.HOME || "/Users/raki",
};

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env: ENV, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) return resolve(out);
      reject(new Error(`${cmd} ${args.join(" ")} exited ${code}\n${out.slice(-800)}`));
    });
  });
}

const started = new Date();
console.log(`── ${started.toISOString()} deploy start ──`);

try {
  if (!skipCollect) {
    await run(process.execPath, ["collect.mjs"], ROOT);
    console.log("collect ok");
  }

  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  const files = ["index.html", "data.json", "bench.json", "favicon.svg", "logo-preview.html", "directions.html", "_headers"];
  for (const f of files) {
    try {
      await cp(join(ROOT, f), join(DIST, f));
    } catch {
      // 可选文件缺失就跳过
    }
  }

  const out = await run(
    WRANGLER,
    ["pages", "deploy", DIST, "--project-name", PROJECT, "--branch", "main", "--commit-dirty=true"],
    ROOT,
  );
  const line = out.split("\n").reverse().find((l) => l.includes("pages.dev")) || "";
  console.log(`deploy ok ${line.trim()}`);
  console.log(`── ${new Date().toISOString()} deploy done (${Math.round((Date.now() - started) / 1000)}s) ──`);
} catch (e) {
  console.error(`deploy FAILED: ${e.message}`);
  process.exit(1);
}
