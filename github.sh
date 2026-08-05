#!/usr/bin/env bash

set -euo pipefail

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  source "$NVM_DIR/nvm.sh"
  nvm use --silent
fi

cd /var/www/app
git pull origin main --ff-only
npm ci
npm test
pm2 restart index-ws --interpreter "$(command -v node)" --update-env
