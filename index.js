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
  'Swim': 'swam',
};

const EMOJI = {
  'Ride': ':bike:',
  'Run': ':runner:',
  'Swim': ':swimmer:',
};

function filterActivities(activities, club) {
  return activities.filter(function(activity) {
    // Filter out activities we've already seen.
    const isNew = !db.get('activities').find({id: activity.id}).value();

    // Filter out activities that are more than 7 days old.
    const SEVEN_DAYS = 1000 * 60 * 60 * 24 * 7;
    const isStale = (new Date(activity.start_date).getTime()) <= (new Date().getTime() - SEVEN_DAYS);

    // Filter out activities from blocked athletes.
    const isBlocked = _.includes(club.blocklist || [], activity.athlete.id);

    // Filter out bike commutes.
    const isBikeCommute = activity.type === 'Bike' && activity.commute;

    return isNew && !isStale && !isBlocked && !isBikeCommute;
  });
}

function checkForNewActivities(initial) {
  initial = !!initial

  config.strava_clubs.forEach(function(club) {
    strava.clubs.listActivities({
      access_token: config.strava_token,
      per_page: 200,
      id: club.id,
    }, function(error, activities) {
      if (error) {
        return logger.error('Error listing activities', {error: error, club: club});
      }

      if (!activities || !activities.length) {
        return logger.info('No activities found', {response: activities, club: club.id});
      }

      const newActivities = filterActivities(activities, club);

      logger.info('Checked for activities', {
        count: newActivities.length,
        club: club.id,
        initial: initial
      });

      // On the initial pass we just want to populate the database but not post
      // any activities. This makes it safe to start fitbot without bombing a
      // channel with messages.
      if (!initial) {
        newActivities.forEach(function(summary) {
          strava.activities.get({
            access_token: config.strava_token,
            id: summary.id
          }, function(error, activity) {
            if (error) {
              return logger.error('Error fetching activity details', {error: error, activity: summary});
            }

            postActivityToSlack(club.webhook, summary.athlete, activity);
          });
        });
      }

      newActivities.forEach(function(activity) {
        db.get('activities').push({id: activity.id}).write();
      });
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
      return logger.error('Error posting message to Slack', {
        webhook: webhook,
        error: error,
        activity: activity,
      });
    }

    logger.info(util.format('Posted to slack: %s', message));
  });
}

function formatActivity(athlete, activity) {
  const emoji = EMOJI[activity.type];
  const who = util.format('%s %s', dingProtect(athlete.firstname), dingProtect(athlete.lastname));
  const link = util.format('<https://www.strava.com/activities/%d>', activity.id);
  const distance = Math.round((activity.distance * 0.00062137) * 100) / 100; // Convert to miles /o\
  const verb = VERBS[activity.type] || activity.type;

  const message = '%s %s %d miles! %s %s %s %s';
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
