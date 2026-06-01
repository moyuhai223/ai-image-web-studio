#!/usr/bin/env bash
#
# AI Image Web Studio —— 1Panel 本地部署「一键更新」脚本
#
# 作用:从 GitHub Release 下载最新(或指定)版本的本地应用包,覆盖安装目录下的
#       source/ + docker-compose.yml + scripts/,然后 docker compose up -d --build 重建。
#       全程不动 .env(你的连接串/密钥)和 storage/(图片等数据),并自动备份可回滚。
#
# 用法:
#   ./update.sh              # 更新到最新 Release
#   ./update.sh v0.7.4       # 更新到指定版本(v 前缀可有可无)
#   APP_DIR=/路径 ./update.sh # 自定义安装目录(默认 /opt/1panel/apps/ai-image-web-studio)
#   FORCE=1 ./update.sh      # 即使版本相同也强制重建
#
# 远程直接安装到本机(只需一次):
#   curl -fsSL https://raw.githubusercontent.com/moyuhai223/ai-image-web-studio/main/scripts/update.sh -o /usr/local/bin/aiws-update
#   chmod +x /usr/local/bin/aiws-update
#   aiws-update              # 以后随时运行
#
set -euo pipefail

REPO="moyuhai223/ai-image-web-studio"
APP_DIR="${APP_DIR:-/opt/1panel/apps/ai-image-web-studio}"
ASSET_PREFIX="ai-image-web-studio-1panel-local-app"
REQ_VERSION="${1:-}"

log() { printf '\033[1;36m[update]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[update:error]\033[0m %s\n' "$*" >&2; }
die() { err "$*"; exit 1; }

# ---------- 前置检查 ----------
command -v curl  >/dev/null 2>&1 || die "缺少 curl"
command -v docker >/dev/null 2>&1 || die "缺少 docker"

DC="docker compose"
if ! docker compose version >/dev/null 2>&1; then
  if command -v docker-compose >/dev/null 2>&1; then DC="docker-compose"; else
    die "缺少 docker compose 插件(docker compose / docker-compose)"
  fi
fi

[ -d "$APP_DIR" ] || die "安装目录不存在:$APP_DIR(可用 APP_DIR=/你的路径 覆盖)"
[ -f "$APP_DIR/docker-compose.yml" ] || die "$APP_DIR 下没有 docker-compose.yml,确认这是应用安装目录"

extract() { # $1=zip $2=destdir
  mkdir -p "$2"
  if command -v unzip >/dev/null 2>&1; then unzip -q -o "$1" -d "$2"
  elif command -v python3 >/dev/null 2>&1; then python3 -m zipfile -e "$1" "$2"
  elif command -v bsdtar >/dev/null 2>&1; then bsdtar -xf "$1" -C "$2"
  else die "缺少解压工具,请先安装 unzip(apt install unzip / yum install unzip)"
  fi
}

# ---------- 解析目标版本 ----------
if [ -n "$REQ_VERSION" ]; then
  TAG="v${REQ_VERSION#v}"
else
  log "查询最新 Release ..."
  TAG="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
        | grep -m1 '"tag_name"' \
        | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
  [ -n "$TAG" ] || die "无法获取最新版本号(GitHub API 失败或被限流,可改用 ./update.sh v0.7.4 指定版本)"
fi
VERSION="${TAG#v}"
ASSET="${ASSET_PREFIX}-v${VERSION}.zip"
URL="https://github.com/$REPO/releases/download/$TAG/$ASSET"
log "目标版本:$TAG"

# ---------- 读当前版本,相同则跳过 ----------
CUR=""
if [ -f "$APP_DIR/source/lib/version.ts" ]; then
  CUR="$(sed -nE 's/.*APP_VERSION[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' "$APP_DIR/source/lib/version.ts" | head -1)"
elif [ -f "$APP_DIR/source/package.json" ]; then
  CUR="$(sed -nE 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$APP_DIR/source/package.json" | head -1)"
fi
[ -n "$CUR" ] && log "当前版本:$CUR"
if [ -n "$CUR" ] && [ "$CUR" = "$VERSION" ] && [ "${FORCE:-0}" != "1" ]; then
  log "已是 $VERSION,无需更新(如需强制重建:FORCE=1 ./update.sh)。"
  exit 0
fi

# ---------- 下载 + 解压到临时目录 ----------
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
log "下载 $ASSET ..."
curl -fL --retry 3 -o "$TMP/pkg.zip" "$URL" || die "下载失败:$URL"
extract "$TMP/pkg.zip" "$TMP/x"

VER_DIR="$TMP/x/ai-image-web-studio/$VERSION"
[ -d "$VER_DIR/source" ]            || die "包结构异常:缺少 $VERSION/source"
[ -f "$VER_DIR/source/Dockerfile" ] || die "包结构异常:缺少 source/Dockerfile"
[ -f "$VER_DIR/docker-compose.yml" ] || die "包结构异常:缺少 docker-compose.yml"

# ---------- 备份(不含 storage,避免占空间;保留最近 3 份)----------
STAMP="$(date +%Y%m%d-%H%M%S)"
BAK="$APP_DIR/.update-backup/$STAMP"
mkdir -p "$BAK"
log "备份当前 docker-compose.yml / scripts / source 到 $BAK"
[ -f "$APP_DIR/docker-compose.yml" ] && cp -a "$APP_DIR/docker-compose.yml" "$BAK/"
[ -d "$APP_DIR/scripts" ] && cp -a "$APP_DIR/scripts" "$BAK/"
[ -d "$APP_DIR/source" ]  && cp -a "$APP_DIR/source"  "$BAK/"
ls -1dt "$APP_DIR/.update-backup"/*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf

# ---------- 覆盖(保留 .env 和 storage)----------
log "更新 source/(整体替换)"
rm -rf "$APP_DIR/source"
cp -a "$VER_DIR/source" "$APP_DIR/source"

log "更新 docker-compose.yml / scripts / data.yml / .env.sample"
cp -a "$VER_DIR/docker-compose.yml" "$APP_DIR/docker-compose.yml"
if [ -d "$VER_DIR/scripts" ]; then
  rm -rf "$APP_DIR/scripts"; cp -a "$VER_DIR/scripts" "$APP_DIR/scripts"
  chmod +x "$APP_DIR/scripts/"*.sh 2>/dev/null || true
fi
[ -f "$VER_DIR/data.yml" ]     && cp -a "$VER_DIR/data.yml"     "$APP_DIR/data.yml"
[ -f "$VER_DIR/.env.sample" ]  && cp -a "$VER_DIR/.env.sample"  "$APP_DIR/.env.sample"
# .env 与 storage/ 保持不动

[ -f "$APP_DIR/.env" ] || err "警告:$APP_DIR/.env 不存在,compose 可能因缺少 DATABASE_URL 等变量而失败。"

# ---------- 重建 ----------
log "重建容器:$DC up -d --build(首次构建需联网装依赖,耗时数分钟)..."
cd "$APP_DIR"
$DC up -d --build

log "完成 ✅  版本 ${CUR:-?} → $VERSION"
$DC ps || true
log "如需回滚:停服后用 $BAK 下的 source/ 与 docker-compose.yml 覆盖回去,再 $DC up -d --build"
