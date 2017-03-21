const low = require('lowdb');

const db = low('db.json');

db.defaults({activities: []}).write();

module.exports = db;
