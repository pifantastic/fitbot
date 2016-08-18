#!/usr/bin/env nodejs

const util = require('util');
const strava = require('strava-v3');
const _ = require('lodash');
const winston = require('winston');
const request = require('request');
const Set = require('Set');

const logger = new (winston.Logger)({
  transports: [
    new (winston.transports.Console)({
      colorize: true,
    }),
    new (winston.transports.File)({
      filename: 'fitbot.log',
      json: false,
    }),
  ],
});

let config = {};

try {
  config = require('./config');
}
catch (e) {
  logger.error(e);
  process.exit(1);
}

const seenActivities = new Set();

const VERBS = {
  'Ride': 'rode',
  'Run': 'ran',
};

const EMOJI = {
  'Ride': ':bike:',
  'Run': ':runner:',
};

function checkForNewActivities(initial) {
  initial = !!initial

  config.strava_clubs.forEach(function(club) {
    strava.clubs.listActivities({
      access_token: config.strava_token,
      per_page: 200,
      id: club.id,
    }, function(error, activities) {
      if (error) {
        logger.error(error);
      }
      else if (!activities || !activities.length) {
        logger.info(util.format('No activities found for %s.', club.id));
      }
      else {
        const newActivities = activities.filter(function(activity) {
          return !seenActivities.has(activity.id) && !activity.commute;
        });

        logger.info(util.format('Found %d new activities for %s.', newActivities.length, club.id), {
          initial: initial,
        });

        const ONE_DAY_AGO = new Date().getTime() - 1000 * 60 * 60 * 24;

        if (!initial) {
          newActivities.forEach(function(activity) {
            const startDate = new Date(activity.start_date);
            if (startDate.getTime() >= ONE_DAY_AGO) {
              postMessageToSlack(club.webhook, formatActivity(activity));
            }
            else {
              logger.info('Not posting activity to slack because it\'s old', {
                activity: activity.id,
                start_date: activity.start_date,
              });
            }
          });
        }

        newActivities.forEach(function(activity) {
          seenActivities.add(activity.id);
        });
      }
    });
  });
};

function postMessageToSlack(webhook, message) {
  request.post({
    url: webhook,
    method: 'POST',
    json: true,
    body: {
      username: config.slack_name,
      icon_url: config.slack_icon,
      text: message,
    },
  }, function(error) {
    if (error) {
      logger.error(error);
    }
    else {
      logger.info(util.format('Posted to slack: %s', message));
    }
  });
}

function formatActivity(activity) {
  const message = '%s %s %d miles! %s %s %s %s';

  const emoji = EMOJI[activity.type];
  const who = util.format('%s %s', dingProtect(activity.athlete.firstname), dingProtect(activity.athlete.lastname));
  const link = util.format('<https://www.strava.com/activities/%d>', activity.id);
  const distance = Math.round((activity.distance * 0.00062137) * 100) / 100;
  const verb = VERBS[activity.type] || activity.type;

  return util.format(message, who, verb, distance, emoji, activity.name, emoji, link);
}

function dingProtect(string) {
  if (string && string.length > 1) {
    return string[0] + '.' + string.substring(1);
  }
  return string;
}

checkForNewActivities(true);

setInterval(checkForNewActivities, config.activity_check_interval);
