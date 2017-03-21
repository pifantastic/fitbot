const winston = require('winston');

const logger = new (winston.Logger)({
  transports: [
    new (winston.transports.Console)({
      colorize: true,
      timestamp: true,
    }),
    new (winston.transports.File)({
      filename: 'fitbot.log',
      json: false,
      timestamp: true,
    }),
  ],
});

module.exports = logger;
