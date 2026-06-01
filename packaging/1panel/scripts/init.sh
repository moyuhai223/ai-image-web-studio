#!/usr/bin/env bash
set -euo pipefail

# 创建数据目录。容器内应用以非 root 用户 nextjs(uid 1001)运行,而这里(1Panel
# 安装阶段,root)创建的宿主目录默认归 root,bind mount 进容器后会导致保存图片时
# 报 "EACCES: permission denied, mkdir '/app/storage/images'"。因此把 storage 归属
# 调整为 uid 1001(非 root 环境 chown 失败则回退 0777),保证容器内可写。
mkdir -p ./storage/images ./storage/references
chown -R 1001:1001 ./storage 2>/dev/null || chmod -R 0777 ./storage 2>/dev/null || true
