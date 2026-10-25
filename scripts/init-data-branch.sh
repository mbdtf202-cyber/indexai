#!/bin/bash
# T4.1: Data 分支初始化脚本
# 在 CI 首次运行时调用此脚本创建 orphan 分支

set -e

echo "[init-data] 检查 data 分支是否存在..."

if git rev-parse --verify data >/dev/null 2>&1; then
  echo "[init-data] data 分支已存在，跳过"
  exit 0
fi

echo "[init-data] 创建 orphan branch 'data'..."
git checkout --orphan data
git rm -rf . || true
git commit -m "Initial data structure (T4.1)" --allow-empty
git checkout main

echo "[init-data] Data branch initialized successfully"
