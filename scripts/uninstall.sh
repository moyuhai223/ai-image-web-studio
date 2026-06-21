#!/usr/bin/env bash
#
# AI Image Web Studio —— 1Panel 本地部署「一键卸载」脚本(默认保留图片)
#
# 作用:停止并删除容器 + 删除本应用构建的镜像 + 删除应用代码(source/、scripts/、
#       docker-compose.yml、data.yml、.env.sample、更新备份),
#       但**默认保留 storage/(图片、参考图)与 .env(连接串/密钥)**,
#       并且**不触碰外部 1Panel PostgreSQL**(图片/记录的元数据)。
#       因此重新 aiws-update 安装后,图片与历史记录会自动恢复。
#
# 用法:
#   ./uninstall.sh                # 卸载,保留 storage/ 与 .env(执行前会确认)
#   APP_DIR=/路径 ./uninstall.sh   # 自定义安装目录(默认 /opt/1panel/apps/ai-image-web-studio)
#   YES=1 ./uninstall.sh          # 跳过交互确认(用于自动化 / 非交互环境)
#   PURGE_ENV=1 ./uninstall.sh    # 连 .env 一起删(仅保留 storage/ 图片)
#   PURGE_ALL=1 ./uninstall.sh    # 全部删除(含 storage/ 图片!)—— 危险,需二次确认
#
# 远程直接安装到本机(只需一次):
#   curl -fsSL https://raw.githubusercontent.com/moyuhai223/ai-image-web-studio/main/scripts/uninstall.sh -o /usr/local/bin/aiws-uninstall
#   chmod +x /usr/local/bin/aiws-uninstall
#   aiws-uninstall              # 以后随时运行
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/1panel/apps/ai-image-web-studio}"
PURGE_ALL="${PURGE_ALL:-0}"
PURGE_ENV="${PURGE_ENV:-0}"

log() { printf '\033[1;36m[uninstall]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[uninstall:error]\033[0m %s\n' "$*" >&2; }
die() { err "$*"; exit 1; }

# ---------- 前置检查 ----------
command -v docker >/dev/null 2>&1 || die "缺少 docker"
DC="docker compose"
if ! docker compose version >/dev/null 2>&1; then
  if command -v docker-compose >/dev/null 2>&1; then DC="docker-compose"; else
    die "缺少 docker compose 插件(docker compose / docker-compose)"
  fi
fi

[ -d "$APP_DIR" ] || die "安装目录不存在:$APP_DIR(可用 APP_DIR=/你的路径 覆盖)"
[ -f "$APP_DIR/docker-compose.yml" ] || die "$APP_DIR 下没有 docker-compose.yml,确认这是应用安装目录"

STORAGE_DIR="$APP_DIR/storage"
IMG_COUNT="$(find "$STORAGE_DIR/images" -type f 2>/dev/null | wc -l | tr -d ' ')"
STORAGE_SIZE="$(du -sh "$STORAGE_DIR" 2>/dev/null | cut -f1 || true)"

# ---------- 概要 ----------
log "安装目录:$APP_DIR"
if [ "$PURGE_ALL" = "1" ]; then
  err "PURGE_ALL=1 —— 将删除「整个安装目录」,包括 storage/ 里的 ${IMG_COUNT:-0} 张图片(${STORAGE_SIZE:-?}),不可恢复!"
else
  log "将删除:容器 / 本应用构建的镜像 / 应用代码(source、scripts、docker-compose.yml、data.yml、.env.sample、.update-backup)"
  if [ "$PURGE_ENV" = "1" ]; then
    log "将保留:storage/(图片 ${IMG_COUNT:-0} 张,${STORAGE_SIZE:-?})"
    log "将删除:.env(PURGE_ENV=1)"
  else
    log "将保留:storage/(图片 ${IMG_COUNT:-0} 张,${STORAGE_SIZE:-?}) + .env(连接串/密钥)"
  fi
  log "不触碰:外部 1Panel PostgreSQL(图片/记录元数据)—— 重装后自动恢复"
fi

# ---------- 确认 ----------
if [ "${YES:-0}" != "1" ]; then
  [ -t 0 ] || die "非交互环境无法确认,请加 YES=1(或先确认你真的要卸载)。"
  printf '确认继续卸载?输入 yes 回车:'
  read -r ans
  [ "$ans" = "yes" ] || die "已取消,未做任何更改。"
  if [ "$PURGE_ALL" = "1" ]; then
    printf '\033[1;31m这会一并删除全部图片(%s 张),确认请输入 DELETE:\033[0m' "${IMG_COUNT:-0}"
    read -r ans2
    [ "$ans2" = "DELETE" ] || die "已取消,未做任何更改。"
  fi
fi

# ---------- 停止 + 删除容器/镜像 ----------
# 注意:storage 是 bind mount(./storage),docker compose down 不会删除它;这里也不用 --volumes。
cd "$APP_DIR"
log "停止并删除容器 + 本应用构建的镜像 ..."
$DC down --rmi local --remove-orphans 2>/dev/null \
  || $DC down --remove-orphans 2>/dev/null \
  || $DC down 2>/dev/null || true

# ---------- 删除 ----------
if [ "$PURGE_ALL" = "1" ]; then
  log "删除整个安装目录:$APP_DIR"
  cd /
  rm -rf "$APP_DIR"
  log "完成 ✅  已彻底卸载(图片也已删除)。"
  log "提示:外部 PostgreSQL 里的元数据未动;如需清理请在 1Panel 数据库中手动操作。"
  exit 0
fi

log "删除应用代码 ..."
rm -rf "$APP_DIR/source" "$APP_DIR/scripts" "$APP_DIR/.update-backup"
rm -f "$APP_DIR/docker-compose.yml" "$APP_DIR/data.yml" "$APP_DIR/.env.sample"
if [ "$PURGE_ENV" = "1" ]; then
  rm -f "$APP_DIR/.env"
fi

log "完成 ✅  已卸载。"
log "图片已保留在:$STORAGE_DIR(${IMG_COUNT:-0} 张,${STORAGE_SIZE:-?})"
if [ "$PURGE_ENV" = "1" ]; then
  log ".env 已删除。重装时需重新填写 DATABASE_URL 等;只要连回同一个数据库,记录与图片即可恢复。"
else
  log ".env 已保留(含 DATABASE_URL/密钥)。重新运行 aiws-update 即可恢复整套应用与图片、记录。"
fi
log "如需连同图片一起彻底删除:PURGE_ALL=1 aiws-uninstall"
log "命令快捷方式 /usr/local/bin/aiws-update、aiws-uninstall 如不再需要可自行 rm。"
