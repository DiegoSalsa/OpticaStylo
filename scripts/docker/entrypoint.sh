#!/bin/sh
set -eu

node scripts/docker/init.mjs
exec "$@"
