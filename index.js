#!/usr/bin/env nodejs

const util = require('util');
const strava = require('strava-v3');
const _ = require('lodash');
const request = require('request');

const logger = require('./lib/logger');
const db = require('./lib/db');
const config = require('./lib/config');

const VERBS = {
  'Ride': 'rode',
  'Run': 'ran',
};

const EMOJI = {
  'Ride': ':bike:',
  'Run': ':runner:',
  'Swim': ':swimmer:',
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
        logger.error('Error listing activities', {error: error, club: club});
      }
      else if (!activities || !activities.length) {
        logger.info('No activities found', {response: activities, club: club.id});
      }
      else {
        // Filter out activities we've already seen.
        const newActivities = activities.filter(function(activity) {
          return !db.get('activities').find({id: activity.id}).value();
        });

        logger.info('Checked for activities', {count: newActivities.length, club: club.id, initial: initial});

        const SEVEN_DAYS_AGO = new Date().getTime() - 1000 * 60 * 60 * 24 * 7;

        if (!initial) {
          newActivities.forEach(function(summary) {
            const startDate = new Date(summary.start_date);

            if (summary.type === 'Bike' && summary.commute) {
              logger.info('Not posting to slack because it\'s a bike commute', {activity: summary.id, club: club.id});
            }
            else if (startDate.getTime() <= SEVEN_DAYS_AGO) {
              logger.info('Not posting to slack because it\'s old', {
                activity: summary.id,
                club: club.id,
                start_date: summary.start_date,
              });
            }
            else {
              strava.activities.get({
                access_token: config.strava_token,
                id: summary.id
              }, function(error, activity) {
                if (error) {
                  logger.error('Error fetching activity details', {error: error, activity: summary});
                } else {
                  postActivityToSlack(club.webhook, summary.athlete, activity);
                }
              });
            }
          });
        }

        newActivities.forEach(function(activity) {
          db.get('activities').push({id: activity.id}).write();
        });
      }
    });
  });
};

function postActivityToSlack(webhook, athlete, activity) {
  var message = formatActivity(athlete, activity);

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
      logger.error('Error posting message to Slack', {
        webhook: webhook,
        error: error,
        activity: activity,
      });
    }
    else {
      logger.info(util.format('Posted to slack: %s', message));
    }
  });
}

function formatActivity(athlete, activity) {
  const message = '%s %s %d miles! %s %s %s %s';

  const emoji = EMOJI[activity.type];
  const who = util.format('%s %s', dingProtect(athlete.firstname), dingProtect(athlete.lastname));
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
