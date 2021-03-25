#!/bin/bash

set -eufo pipefail

cd lambda
npm ci && npm run startTestEnv && npm test && npm run stopTestEnv
npm prune --production
cd ..