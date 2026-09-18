#!/bin/sh
# Cloudflare Pages build step.
#   Build command:     sh build.sh
#   Output directory:  dist
#
# Copies only the public site into dist/, so the SQL in supabase/, the README
# and this script are never served. Pages Functions in functions/ are picked
# up from the repo root automatically and do not need copying.
set -e
rm -rf dist
mkdir dist
cp -r ./*.html _headers css js assets dist/
echo "Built $(find dist -type f | wc -l) files into dist/"
