#!/bin/bash
# Deploy to Vercel via deploy hook after git push
# Usage: ./scripts/deploy.sh [commit message]
# Or:    git add . && ./scripts/deploy.sh "your message"

set -e

DEPLOY_HOOK="https://api.vercel.com/v1/integrations/deploy/prj_vnYvd0kNsQaPhb2C9YhpoStteznm/sRpMQ41UwB"

echo "📦 Pushing to GitHub..."
git push origin main

echo "🚀 Triggering Vercel deployment..."
RESULT=$(curl -s -X POST "$DEPLOY_HOOK")
echo "$RESULT" | python3 -c "
import json,sys
try:
    d = json.load(sys.stdin)
    print('✅ Vercel deploy triggered:', d.get('job', {}).get('id', d.get('id', 'ok')))
except:
    print('Response:', sys.stdin.read())
" 2>/dev/null || echo "✅ Deploy hook called"

echo "🌐 Production: https://fintrackapp-alexeys-projects-7afd0399.vercel.app"
