#!/bin/bash
git push
ssh root@hk.banana001.cn "cd /banana/air724 && git pull"
ssh root@hk.banana001.cn "cd /banana/air724/server && npm install && pm2 restart index"

cd web
bun run build:pro

rm -rf dist.zip
zip -r dist.zip dist

ssh root@hk.banana001.cn "cd /banana/air724-client && rm -rf ./*"
scp dist.zip root@hk.banana001.cn:/banana/air724-client
ssh root@hk.banana001.cn "cd /banana/air724-client && unzip dist.zip && mv ./dist/* ./ && rm -rf dist.zip && rm -rf dist"
