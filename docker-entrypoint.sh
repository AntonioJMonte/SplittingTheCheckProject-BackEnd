#!/bin/sh
# D-109: o tini é o PID 1 e repassa os sinais. Uma migration que falhe aborta aqui (set -e) e o servidor não sobe;
# o exec troca este shell pelo node, que vira filho direto do tini e recebe o SIGTERM sem intermediário.
set -e

node_modules/.bin/prisma migrate deploy
exec node dist/server.js
