'use strict';
// Deliberately synthetic edge-case data. The real feed is read, never copied or changed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const FEED_URL = 'https://findeverypark.com/data/events/community-feed.v1.json';
const NOW = '2026-11-05T12:00:00.000Z';
const root = path.resolve(__dirname, '..');
const fixturePath = process.env.FEED_FIXTURE_PATH
  ? path.resolve(process.env.FEED_FIXTURE_PATH)
  : path.resolve(root, '../findeverypark-community-feed/data/events/community-feed.v1.json');
function realFeed() {
  if (!fs.existsSync(fixturePath)) throw new Error('Pinned candidate feed is required. Set FEED_FIXTURE_PATH to data/events/community-feed.v1.json from the reviewed FindEveryPark commit. Never use mutable main. Missing: ' + fixturePath);
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}
function fixtureHash() { return crypto.createHash('sha256').update(fs.readFileSync(fixturePath)).digest('hex'); }
function event(id = 'synthetic-one', overrides = {}) {
  return {
    id, city: 'denver', cityLabel: 'Denver', title: 'Synthetic family outing',
    description: 'Synthetic review-only event. Not a real listing.',
    dateStart: '2026-11-06T16:00:00.000Z', dateEnd: '2026-11-06T18:00:00.000Z',
    sortAt: '2026-11-06T16:00:00.000Z', expiresAt: '2026-11-06T18:00:00.000Z',
    dateLabel: 'November 6, 2026', timeLabel: '9–11 a.m. Mountain',
    locationLabel: 'Synthetic review venue', costLabel: 'Check current admission', costType: 'unknown',
    audienceLabel: 'Families', href: 'https://findeverypark.com/events.html#' + id,
    registrationLabel: 'Check organizer details', availabilityLabel: 'Confirm before attending',
    verifiedAt: '2026-11-04', ...overrides
  };
}
function feed(events = [event()], overrides = {}) {
  return { schemaVersion: 1, timeZone: 'America/Denver', contentUpdatedAt: '2026-11-04T18:00:00.000Z', sourceUrl: 'https://findeverypark.com/events.html', events, ...overrides };
}
function manyEvents(count = 8) {
  return Array.from({length: count}, (_, index) => event('synthetic-' + (index + 1), {
    title: 'Synthetic outing ' + (index + 1),
    dateStart: new Date(Date.parse('2026-11-06T16:00:00Z') + index * 86400000).toISOString(),
    dateEnd: new Date(Date.parse('2026-11-06T18:00:00Z') + index * 86400000).toISOString(),
    sortAt: new Date(Date.parse('2026-11-06T16:00:00Z') + index * 86400000).toISOString(),
    expiresAt: new Date(Date.parse('2026-11-06T18:00:00Z') + index * 86400000).toISOString()
  }));
}
function expectedIds(data, limit, now = NOW) {
  return [...new Map(data.events.filter(item => Date.parse(item.expiresAt) > Date.parse(now)).map(item => [item.id, item])).values()]
    .sort((a, b) => Date.parse(a.sortAt || a.dateStart) - Date.parse(b.sortAt || b.dateStart) || a.id.localeCompare(b.id))
    .slice(0, limit).map(item => item.id);
}
module.exports = { FEED_URL, NOW, root, fixturePath, realFeed, fixtureHash, event, feed, manyEvents, expectedIds };
