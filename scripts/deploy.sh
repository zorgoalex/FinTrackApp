#!/bin/bash
# Push to GitHub and let the private Vercel Git integration deploy.
# Usage: ./scripts/deploy.sh [commit message]
# Or:    git add . && ./scripts/deploy.sh "your message"

set -e

echo "📦 Pushing to GitHub..."
git push origin main

echo "🚀 Push complete. Vercel Git integration will build the published commit."
echo "🌐 Production: https://fintrackapp-wheat.vercel.app"
