'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { root, FEED_URL, realFeed, fixtureHash } = require('./events-fixtures');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('runtime is lightweight, local and data-only', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(Object.keys(pkg.dependencies || {}).length, 0);
  for (const page of ['index.html', 'events.html']) {
    const html = read(page);
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)/gi)].map(match => match[1]);
    assert.ok(scripts.includes('assets/js/featured-events.js'), page);
    assert.ok(scripts.every(src => !/^https?:|^\/\//i.test(src)), 'No external application or analytics scripts');
    assert.match(html, /data-fep-events/);
    assert.match(html, /data-feed-status[^>]*role="status"|role="status"[^>]*data-feed-status/);
    assert.match(html, /href="https:\/\/findeverypark\.com\/events\.html"/);
  }
  const script = read('assets/js/featured-events.js');
  assert.ok(script.includes(FEED_URL));
  assert.doesNotMatch(script, /document\.write\s*\(|\.innerHTML\s*=|eval\s*\(|new\s+Function\s*\(/);
  assert.doesNotMatch(script, /localStorage|sessionStorage|sendBeacon|google-analytics|gtag\s*\(|analytics\./i);
});

test('test workflow is review-only, read-only and checks exact commits', () => {
  const workflow = read('.github/workflows/community-events-review.yml');
  assert.match(workflow, /pull_request:/);
  assert.doesNotMatch(workflow, /pull_request_target|workflow_dispatch|push:|pages:|id-token:|write-all|deploy/i);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /ref: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.equal((workflow.match(/persist-credentials: false/g) || []).length, 2);
  assert.match(workflow, /mcr.microsoft.com\/playwright:v1\.62\.1-noble/);
  assert.match(workflow, /browser: \[chromium, webkit\]/);
  const source = JSON.parse(read('tests/feed-source.json'));
  assert.equal(source.repository, 'townsendjat-arch/findeverypark');
  assert.match(source.revision, /^[a-f0-9]{40}$/);
  assert.notEqual(source.revision, '0'.repeat(40), 'Replace pending revision with the reviewed feed commit before publication');
});

test('candidate feed has explicit Mountain-time expiry and safe source links', () => {
  const hash = fixtureHash();
  const data = realFeed();
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.timeZone, 'America/Denver');
  assert.ok(Number.isFinite(Date.parse(data.contentUpdatedAt)));
  assert.ok(Array.isArray(data.events) && data.events.length > 0);
  assert.equal(new URL(data.sourceUrl).origin, 'https://findeverypark.com');
  const ids = new Set();
  for (const item of data.events) {
    assert.ok(item.id && !ids.has(item.id), item.id + ': unique ID'); ids.add(item.id);
    for (const field of ['title', 'description', 'dateLabel', 'locationLabel', 'href']) assert.equal(typeof item[field], 'string', item.id + ': ' + field);
    for (const field of ['sortAt', 'expiresAt']) assert.ok(Number.isFinite(Date.parse(item[field])), item.id + ': ' + field);
    assert.ok(Date.parse(item.expiresAt) > Date.parse(item.sortAt), item.id + ': positive duration');
    const href = new URL(item.href);
    assert.ok(['https:', 'http:'].includes(href.protocol), item.id + ': safe organizer URL');
    assert.equal(href.username, ''); assert.equal(href.password, '');
    if (item.dateEnd && !/^\d{4}-\d{2}-\d{2}$/.test(item.dateEnd)) assert.equal(Date.parse(item.expiresAt), Date.parse(item.dateEnd), item.id + ': exact timed end');
  }
  assert.equal(fixtureHash(), hash, 'Read-only consumer must leave source fixture unchanged');
});

test('private gathering details remain absent from the published source', () => {
  const html = read('events.html');
  assert.match(html, /Mighty Dads Gatherings/);
  assert.match(html, /Poker Night/);
  assert.match(html, /Christmas Party/);
  assert.match(html, /2026-11-20/);
  assert.match(html, /2026-12-19/);
  assert.doesNotMatch(html, /2026-11-20T\d{2}:\d{2}|2026-12-19T\d{2}:\d{2}/, 'Do not invent gathering start times');
});

const { selectEvents, safeUrl, instant, validRecord } = require('../assets/js/featured-events.js');
const { event, feed, manyEvents, NOW, expectedIds } = require('./events-fixtures');
const now = Date.parse(NOW);
test('consumer selects exact real feed IDs at both page limits without mutating source', () => {
  const input = realFeed(), before = JSON.stringify(input);
  for (const limit of [3, 5]) assert.deepEqual(selectEvents(input, now, limit).map(item=>item.id), expectedIds(input,limit));
  assert.equal(JSON.stringify(input),before);
});
test('consumer sorts before capping, deduplicates IDs, and resolves time ties by ID', () => {
  const events = manyEvents();
  const input = feed([...events].reverse().concat(events[0]));
  assert.deepEqual(selectEvents(input,now,3).map(item=>item.id),events.slice(0,3).map(item=>item.id));
  assert.deepEqual(selectEvents(feed([event('z'),event('a')]),now,5).map(item=>item.id),['a','z']);
  assert.equal(selectEvents(feed(events),now,99).length,5);
  assert.equal(selectEvents(feed(events),now,0).length,0);
});
test('invalid and expired records are dropped individually, valid ones survive', () => {
  const input=feed([null,{},event('valid'),event('bad-id',{id:'" onclick="alert(1)'}),event('missing',{title:''}),event('expired',{expiresAt:NOW}),event('bad-date',{sortAt:'2026-02-30T12:00:00Z'})]);
  assert.deepEqual(selectEvents(input,now,5).map(item=>item.id),['valid']);
});
test('required card data is enforced; optional qualification fields may be omitted', () => {
  for (const key of ['id','title','description','dateLabel','timeLabel','locationLabel','costLabel','expiresAt','href']) {
    const record=event();delete record[key];assert.ok(!validRecord(record),key);
  }
  const record=event();delete record.registrationLabel;delete record.availabilityLabel;delete record.audienceLabel;delete record.verifiedAt;
  assert.ok(validRecord(record));
});
test('strict offset instants reject ambiguous, invalid, and date-only expiry values', () => {
  for(const value of ['2026-11-20','2026-11-20T00:00:00','2026-02-30T00:00:00Z','not a date',null,{},'2026-13-01T00:00:00Z']) assert.ok(Number.isNaN(instant(value)),String(value));
  assert.equal(instant('2026-11-21T00:00:00-07:00'),Date.parse('2026-11-21T07:00:00Z'));
});
test('expiry removes an occurrence at its exact end, never before', () => {
  const record=event(),end=Date.parse(record.expiresAt);
  assert.equal(selectEvents(feed([record]),end-1,5).length,1);
  assert.equal(selectEvents(feed([record]),end,5).length,0);
  assert.equal(selectEvents(feed([record]),end+1,5).length,0);
});
test('canonical date-only next-midnight expiry covers Mountain DST transitions', () => {
  // Consumer trusts explicit canonical instants, never the viewer timezone.
  for(const [date,end] of [['2026-03-08','2026-03-09T06:00:00Z'],['2026-11-01','2026-11-02T07:00:00Z'],['2026-11-20','2026-11-21T07:00:00Z']]) {
    const record=event('date-only',{dateStart:date,dateEnd:'',sortAt:date+'T07:00:00Z',expiresAt:end});
    assert.equal(selectEvents(feed([record]),Date.parse(end)-1,5).length,1);
    assert.equal(selectEvents(feed([record]),Date.parse(end),5).length,0);
  }
});
test('unsafe link schemes, credentials and relative links are rejected', () => {
  for(const value of ['javascript:alert(1)','data:text/html,hello','vbscript:msgbox(1)','file:///tmp/private','//example.com','/events.html','https://user:secret@example.com']) assert.equal(safeUrl(value),'',value);
  for(const value of ['https://organizer.example/events','http://organizer.example/events']) assert.equal(safeUrl(value),value);
});
test('malformed, unsupported, off-source and excessive feed envelopes fail closed', () => {
  for(const value of [null,{},[],feed([],{schemaVersion:2}),feed([],{timeZone:'UTC'}),feed([],{sourceUrl:'https://evil.invalid'}),feed([],{events:null}),feed(Array(1001).fill(event()))]) assert.throws(()=>selectEvents(value,now,5));
});

test('nonpositive event duration is rejected instead of rendered as current', () => {
  for(const sortAt of ['2026-11-06T18:00:00.000Z','2026-11-07T18:00:00.000Z']) assert.ok(!validRecord(event('bad-order',{sortAt})));
});

test('all real candidate occurrences expire individually at their canonical boundary', () => {
  const data=realFeed();
  for(const record of data.events) {
    const boundary=Date.parse(record.expiresAt),single={...data,events:[record]};
    assert.deepEqual(selectEvents(single,boundary-1,5).map(item=>item.id),[record.id],record.id+' before end');
    assert.deepEqual(selectEvents(single,boundary,5),[],record.id+' at end');
  }
});
test('gatherings JSON contains only approved public fields and next-Mountain-midnight expiry', () => {
  const html=read('events.html'),match=html.match(/<script type="application\/json" id="gatherings-data">([\s\S]*?)<\/script>/);
  assert.ok(match);const data=JSON.parse(match[1]);assert.equal(data.length,2);
  const expected=[['Poker Night','2026-11-20','2026-11-21T07:00:00.000Z'],['Christmas Party','2026-12-19','2026-12-20T07:00:00.000Z']];
  data.forEach((item,index)=>{
    assert.deepEqual(Object.keys(item).sort(),['date','dateLabel','expiresAt','id','title']);
    assert.equal(item.title,expected[index][0]);assert.equal(item.date,expected[index][1]);
    assert.equal(new Date(item.expiresAt).toISOString(),expected[index][2]);
    assert.equal(Object.hasOwn(item,'dateEnd'),false,'Listing expiry must not become an invented actual ending time');
  });
});
