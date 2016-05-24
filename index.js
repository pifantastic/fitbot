var util = require('util');
var strava = require('strava-v3');
var _ = require('lodash');
var winston = require('winston');
var request = require('request');

try {
  const config = require('./config');
}
catch (e) {
  winston.error(e);
  process.exit(1);
}

var lastActivityCheck = Date.now();

const VERBS = {
  'Ride': 'rode',
  'Run': 'ran',
};

const EMOJI = {
  'Ride': ':bike:',
  'Run': ':runner:',
};

function checkForNewActivities() {
  config.strava_clubs.forEach(function(club) {
    strava.clubs.listActivities({
      access_token: config.strava_token,
      id: club.id,
    }, function(error, activities) {
      postActivitiesToSlack(error, club, activities);
    });
  });
};

function postActivitiesToSlack(error, club, activities) {
  if (error) {
    winston.error(error);
    return;
  } else if (!activities) {
    winston.info('No activities found.');
    return;
  }

  // Filter to new activities.
  activities = _.filter(activities, function(activity) {
    return Date.parse(activity.start_date) > lastActivityCheck;
  });

  // Sort activities by start_date descending.
  activities = _.sortBy(activities, 'start_date').reverse()

  winston.info(util.format('Found %d new activities.', activities.length));

  // Post activities to Slack.
  activities.forEach(function(activity) {
    const message = formatActivity(activity);

    request.post({
      url: club.webhook,
      method: 'POST',
      body: {
        username: config.slack_name,
        icon_url: config.slack_icon,
        text: message,
      },
      json: true,
    }, function(error) {
      if (error) {
        winston.error(error);
      }
      else {
        winston.info(util.format('Posted to slack: %s', message));
      }
    });
  });

  lastActivityCheck = Date.now();
}

function formatActivity(activity) {
  const message = '%s just %s %d miles! %s %s %s %s';

  const emoji = EMOJI[activity.type];
  const who = util.format('%s %s', activity.athlete.firstname, activity.athlete.lastname);
  const link = util.format('<https://www.strava.com/activities/%d>', activity.id);
  const distance = Math.round((activity.distance * 0.00062137) * 100) / 100;
  const verb = VERBS[activity.type] || activity.type;

  return util.format(message, who, verb, distance, emoji, activity.name, emoji, link);
}

checkForNewActivities();

setInterval(checkForNewActivities, config.activity_check_interval);
