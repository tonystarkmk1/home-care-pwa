'use strict';

const { start } = require('../server3');

start().catch((error) => {
  console.error('Avvio Home Care non riuscito:', error);
  process.exit(1);
});
