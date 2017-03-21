const logger = require('./logger');

let config = {};

try {
  config = require('../config');
}
catch (e) {
  logger.error(e);
  process.exit(1);
}

module.exports = config;
