'use strict';

process.on('message', (message, cacheClient) => {
  if (message === 'delCacheKey') {
    console.log(cacheClient);
  }
});

process.on('uncaughtException', () => {
  process.exit(0);
});

process.on('unhandledRejection', () => {
  process.exit(0);
});
