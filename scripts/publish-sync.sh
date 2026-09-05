#!/bin/bash
# 发布包到 npmjs.org
# 用法: ./scripts/publish-sync.sh <package-name>
# 示例: ./scripts/publish-sync.sh vision-relay
#       ./scripts/publish-sync.sh commit-flow

set -e

PACKAGE_NAME=$1

if [ -z "$PACKAGE_NAME" ]; then
  echo "❌ 请指定包名"
  echo "用法: $0 <package-name>"
  echo "可用包: vision-relay, commit-flow"
  exit 1
fi

PACKAGE_DIR="packages/$PACKAGE_NAME"

if [ ! -d "$PACKAGE_DIR" ]; then
  echo "❌ 包目录不存在: $PACKAGE_DIR"
  exit 1
fi

echo "📦 开始发布 $PACKAGE_NAME..."

# 发布到 npmjs.org
cd "$PACKAGE_DIR"
npm publish
echo "✅ npmjs.org 发布成功"

echo ""
echo "🎉 发布完成！"
echo "📦 npmjs.org: https://www.npmjs.com/package/$PACKAGE_NAME"
