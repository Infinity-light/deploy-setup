#!/bin/bash
set -euo pipefail

APP_NAME="{{APP_NAME}}"
DEPLOY_DIR="{{DEPLOY_DIR}}"
APP_DIR="${DEPLOY_DIR}/${APP_NAME}"
APP_PORT="{{APP_PORT}}"
DOMAIN_ENABLED="{{DOMAIN_ENABLED}}"
DOMAIN_NAME="{{DOMAIN_NAME}}"
HTTPS_ENABLED="{{HTTPS_ENABLED}}"

GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

CURRENT_STEP=""

on_error() {
    echo ""
    echo -e "${RED}✗ 失败于: [${CURRENT_STEP}]${NC}"
    echo -e "${RED}  退出码: $?${NC}"
    echo -e "${RED}  请检查上方输出定位问题${NC}"
    exit 1
}
trap on_error ERR

step() {
    CURRENT_STEP="$1"
    echo ""
    echo -e "${CYAN}[${CURRENT_STEP}]${NC}"
}

ok() {
    echo -e "${GREEN}  ✔ $1${NC}"
}

# ─── 开始 ───
echo -e "${CYAN}=== 服务器初始化: ${APP_NAME} ===${NC}"
echo "  目录: ${APP_DIR} | 端口: ${APP_PORT}"
[ "${DOMAIN_ENABLED}" = "true" ] && echo "  域名: ${DOMAIN_NAME} | HTTPS: ${HTTPS_ENABLED}"

# ─── Step 1: Docker ───
step "1/7 检查 Docker"
if command -v docker &> /dev/null; then
    ok "Docker 已安装: $(docker --version)"
else
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker && systemctl start docker
    ok "Docker 安装完成: $(docker --version)"
fi

# ─── Step 2: Docker Compose ───
step "2/7 检查 Docker Compose"
if docker compose version &> /dev/null; then
    ok "Docker Compose 已安装: $(docker compose version --short)"
else
    apt-get update && apt-get install -y docker-compose-plugin
    ok "Docker Compose 安装完成: $(docker compose version --short)"
fi

# ─── Step 3: 部署目录 ───
step "3/7 创建部署目录"
mkdir -p "${APP_DIR}"
ok "目录就绪: ${APP_DIR}"
ls -la "${APP_DIR}"

# ─── Step 4: 确保 .env 存在 ───
step "4/7 初始化 .env"
if [ ! -f "${APP_DIR}/.env" ]; then
    touch "${APP_DIR}/.env"
    ok "已创建空 .env (请按需填入环境变量)"
else
    ok ".env 已存在，跳过"
fi

# ─── Step 5: 复制 compose 文件 ───
step "5/7 部署 docker-compose.yml"
if [ -f "docker-compose.yml" ]; then
    cp docker-compose.yml "${APP_DIR}/"
    ok "已复制到 ${APP_DIR}/docker-compose.yml"
else
    echo "  当前目录无 docker-compose.yml，跳过（后续由 CI/CD 部署）"
fi

# ─── Step 5: Nginx 反向代理 ───
if [ "${DOMAIN_ENABLED}" = "true" ]; then
    step "6/7 配置 Nginx 反向代理"

    if ! command -v nginx &> /dev/null; then
        apt-get update && apt-get install -y nginx
        systemctl enable nginx
    fi
    ok "Nginx 已安装: $(nginx -v 2>&1)"

    cat > /etc/nginx/sites-available/${APP_NAME} <<NGINX
server {
    listen 80;
    server_name ${DOMAIN_NAME};

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX

    ln -sf /etc/nginx/sites-available/${APP_NAME} /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default
    nginx -t
    systemctl reload nginx
    ok "反向代理已生效: ${DOMAIN_NAME} → 127.0.0.1:${APP_PORT}"
    echo "  验证: curl -H 'Host: ${DOMAIN_NAME}' http://127.0.0.1"
else
    step "6/7 Nginx"
    echo "  未配置域名，跳过"
fi

# ─── Step 6: HTTPS ───
if [ "${DOMAIN_ENABLED}" = "true" ] && [ "${HTTPS_ENABLED}" = "true" ]; then
    step "7/7 配置 HTTPS (Let's Encrypt)"

    if ! command -v certbot &> /dev/null; then
        apt-get install -y certbot python3-certbot-nginx
    fi
    ok "certbot 已安装"

    certbot --nginx -d ${DOMAIN_NAME} --non-interactive --agree-tos --email admin@${DOMAIN_NAME} --redirect
    ok "SSL 证书已签发"
    certbot certificates 2>/dev/null | grep -A2 "Certificate Name"
else
    step "7/7 HTTPS"
    echo "  未启用，跳过"
fi

# ─── 完成 ───
echo ""
echo -e "${GREEN}=== 全部完成 ===${NC}"
echo "  部署目录: ${APP_DIR}"
if [ "${DOMAIN_ENABLED}" = "true" ]; then
    [ "${HTTPS_ENABLED}" = "true" ] && echo "  访问: https://${DOMAIN_NAME}" || echo "  访问: http://${DOMAIN_NAME}"
else
    echo "  访问: http://$(hostname -I | awk '{print $1}'):${APP_PORT}"
fi
