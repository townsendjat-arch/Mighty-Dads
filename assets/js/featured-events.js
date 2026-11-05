/* Data-only FindEveryPark previews. The source owns dates and expiry instants. */
(function (root) {
  'use strict';
  var FEED_URL = 'https://findeverypark.com/data/events/community-feed.v1.json';
  var CALENDAR_URL = 'https://findeverypark.com/events.html';
  var REFRESH_MS = 10 * 60 * 1000;
  var TIMEOUT_MS = 8000;
  function text(value) { return typeof value === 'string' ? value.trim() : ''; }
  function safeUrl(value) {
    try {
      var url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
    } catch (_) { return ''; }
  }
  function instant(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
    var parsed = Date.parse(value);
    var day = value.slice(0, 10);
    if (!Number.isFinite(parsed) || new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) !== day) return NaN;
    return parsed;
  }
  function validRecord(event) {
    return event && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(text(event.id)) &&
      text(event.title) && text(event.dateLabel) && text(event.timeLabel) &&
      text(event.cityLabel || event.city) && text(event.locationLabel) && text(event.costLabel) && text(event.description) &&
      Number.isFinite(instant(event.expiresAt)) &&
      Number.isFinite(instant(event.sortAt || event.dateStart)) &&
      instant(event.sortAt || event.dateStart) < instant(event.expiresAt) && safeUrl(event.href);
  }
  function selectEvents(feed, now, limit) {
    if (!Number.isFinite(now) || !feed || feed.schemaVersion !== 1 || feed.timeZone !== 'America/Denver' ||
        feed.sourceUrl !== CALENDAR_URL || !Array.isArray(feed.events) || feed.events.length > 1000) {
      throw new Error('Unsupported or missing event feed');
    }
    var seen = new Set();
    return feed.events.filter(function (event) {
      if (!validRecord(event) || now >= instant(event.expiresAt) || seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    }).sort(function (a, b) {
      return instant(a.sortAt || a.dateStart) - instant(b.sortAt || b.dateStart) || a.id.localeCompare(b.id);
    }).slice(0, Math.max(0, Math.min(5, limit)));
  }
  var api = { selectEvents: selectEvents, safeUrl: safeUrl, instant: instant, validRecord: validRecord };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root.document) return;

  var document = root.document;
  function element(tag, className, value) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (value) node.textContent = value;
    return node;
  }
  function paragraph(parent, className, value) {
    if (text(value)) parent.appendChild(element('p', className, value));
  }
  function renderCard(event) {
    var card = element('article', 'card fep-event-card');
    card.dataset.eventId = event.id;
    paragraph(card, 'fep-event-city', event.cityLabel || event.city.replace(/_/g, ' '));
    card.appendChild(element('h3', '', event.title));
    paragraph(card, 'fep-event-date', event.dateLabel);
    paragraph(card, 'fep-event-time', event.timeLabel);
    paragraph(card, 'fep-event-location', event.locationLabel);
    paragraph(card, 'fep-event-cost', event.costLabel);
    paragraph(card, 'fep-event-description', event.description);
    paragraph(card, 'fep-event-registration', event.registrationLabel);
    var details = element('details', 'fep-event-details');
    details.appendChild(element('summary', '', 'Before you go'));
    paragraph(details, '', event.audienceLabel);
    paragraph(details, '', event.availabilityLabel);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text(event.verifiedAt))) {
      paragraph(details, '', 'Details checked ' + event.verifiedAt + '.');
    }
    paragraph(details, '', 'Confirm the latest details, prices and availability with the organizer.');
    card.appendChild(details);
    var link = element('a', 'fep-event-link', 'Organizer details');
    link.href = safeUrl(event.href);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.dataset.focusKey = 'organizer';
    link.setAttribute('aria-label', 'Organizer details for ' + event.title + ' (opens in a new tab)');
    card.appendChild(link);
    return card;
  }
  function updateGrid(section, events) {
    var grid = section.querySelector('[data-event-grid]');
    var signature = JSON.stringify(events);
    if (grid.dataset.signature === signature) return;
    var active = document.activeElement;
    var activeCard = active && active.closest('[data-event-id]');
    var focusedId = activeCard && grid.contains(activeCard) ? activeCard.dataset.eventId : '';
    var focusedKey = focusedId ? (active.dataset.focusKey || active.tagName.toLowerCase()) : '';
    var openIds = Array.from(grid.querySelectorAll('details[open]')).map(function (node) { return node.closest('[data-event-id]').dataset.eventId; });
    var fragment = document.createDocumentFragment();
    events.forEach(function (event) {
      var card = renderCard(event);
      if (openIds.includes(event.id)) card.querySelector('details').open = true;
      fragment.appendChild(card);
    });
    grid.replaceChildren(fragment);
    grid.dataset.signature = signature;
    if (focusedId) {
      var nextCard = Array.from(grid.children).find(function (card) { return card.dataset.eventId === focusedId; });
      var nextFocus = nextCard && (focusedKey === 'organizer' ? nextCard.querySelector('[data-focus-key="organizer"]') : nextCard.querySelector('summary'));
      (nextFocus || section.querySelector('h2')).focus({ preventScroll: true });
    }
  }
  function setStatus(section, message) {
    var status = section.querySelector('[data-feed-status]');
    if (status.textContent !== message) status.textContent = message;
  }
  var sections = Array.from(document.querySelectorAll('[data-fep-events]'));
  var feed = null, fetching = false, lastAttempt = 0;
  function renderFeed() {
    if (!feed) return;
    sections.forEach(function (section) {
      var events = selectEvents(feed, Date.now(), Number(section.dataset.limit));
      updateGrid(section, events);
      setStatus(section, events.length ? events.length + ' current and upcoming events from FindEveryPark. All times Mountain.' :
        'No current picks are available here. Check the full FindEveryPark calendar for more ideas.');
      var retry = section.querySelector('[data-feed-retry]');
      if (document.activeElement === retry) section.querySelector('h2').focus({ preventScroll: true });
      retry.hidden = true;
    });
  }
  function failFeed() {
    feed = null;
    sections.forEach(function (section) {
      updateGrid(section, []);
      setStatus(section, 'Event picks are temporarily unavailable. You can still browse the full FindEveryPark calendar.');
      section.querySelector('[data-feed-retry]').hidden = false;
    });
  }
  async function loadFeed() {
    if (fetching || !sections.length) return;
    fetching = true;
    lastAttempt = Date.now();
    var controller = new AbortController();
    var timer = root.setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
    // aria-disabled retains keyboard focus; loadFeed's guard prevents duplicates.
    sections.forEach(function (section) { section.querySelector('[data-feed-retry]').setAttribute('aria-disabled', 'true'); });
    try {
      var response = await root.fetch(FEED_URL, { signal: controller.signal, mode: 'cors', credentials: 'omit', cache: 'no-cache', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error('Event feed unavailable');
      var body = await response.text();
      if (body.length > 1000000) throw new Error('Event feed too large');
      var candidate = JSON.parse(body);
      selectEvents(candidate, Date.now(), 5);
      feed = candidate;
      renderFeed();
    } catch (_) { failFeed(); }
    finally {
      root.clearTimeout(timer);
      fetching = false;
      sections.forEach(function (section) { section.querySelector('[data-feed-retry]').setAttribute('aria-disabled', 'false'); });
    }
  }
  function renderGatherings() {
    var section = document.querySelector('[data-gatherings]');
    if (!section) return;
    var grid = section.querySelector('[data-gathering-grid]');
    var data;
    try { data = JSON.parse(document.getElementById('gatherings-data').textContent); }
    catch (_) { return; }
    if (!Array.isArray(data)) return;
    var events = data.filter(function (event) { return event && text(event.id) && text(event.title) && text(event.dateLabel) && Date.now() < instant(event.expiresAt); });
    var signature = JSON.stringify(events);
    if (grid.dataset.signature === signature) return;
    var fragment = document.createDocumentFragment();
    events.forEach(function (event) {
      var card = element('article', 'card gathering-card');
      card.dataset.gatheringId = event.id;
      card.appendChild(element('h3', '', event.title));
      var date = element('time', 'fep-event-date', event.dateLabel);
      date.dateTime = event.date;
      card.appendChild(date);
      paragraph(card, '', 'Details to be announced.');
      fragment.appendChild(card);
    });
    grid.replaceChildren(fragment);
    grid.dataset.signature = signature;
    var status = section.querySelector('[data-gathering-status]');
    status.textContent = events.length ? 'Save the dates. More information will be shared when confirmed.' : 'No upcoming Mighty Dads gatherings are listed right now.';
  }
  sections.forEach(function (section) {
    section.querySelector('[data-feed-retry]').addEventListener('click', loadFeed);
  });
  function tick() {
    renderGatherings();
    renderFeed();
    if (!document.hidden && Date.now() - lastAttempt >= REFRESH_MS) loadFeed();
  }
  renderGatherings();
  loadFeed();
  root.setInterval(tick, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  root.addEventListener('pageshow', function (event) { if (event.persisted) tick(); });
})(typeof window === 'undefined' ? globalThis : window);
