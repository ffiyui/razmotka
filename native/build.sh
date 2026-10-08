#!/usr/bin/env bash
# Сборка приложения для Android (запускается на GitHub, см. .github/workflows/android.yml).
# Страница берётся из папки android/ репозитория, оболочка Capacitor создаётся заново при каждой сборке.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf www android out
cp -r ../android www
rm -f www/sw.js                                   # в приложении офлайн-кэш не нужен: страница лежит внутри приложения
npm install --no-audit --no-fund
npx cap add android
npx cap sync android
python3 -m pip install --quiet pillow || true
python3 patch_android.py "${GITHUB_RUN_NUMBER:-1}"
cd android
chmod +x gradlew
./gradlew assembleRelease --no-daemon --stacktrace
mkdir -p ../out
cp app/build/outputs/apk/release/app-release.apk ../out/razmotka-sp10.apk
ls -la ../out
