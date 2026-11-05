# FindEveryPark event previews

## Review status and release order

This is a review-only integration. Do not merge or deploy either repository without the owner's separate approval. FindEveryPark PR #11 is unrelated and must remain untouched.

The production feed URL does not exist until the companion FindEveryPark feed change is approved and released:

`https://findeverypark.com/data/events/community-feed.v1.json`

Release order after separate authorization:

1. Approve and release the companion FindEveryPark feed change. Confirm its generated JSON matches its manifest, HTTP 200, JSON content type, and cross-origin access from `https://www.mightydads.org`.
2. Verify all event content/registration qualifications with the owner as appropriate; automatic expiry does not recheck organizer availability.
3. Approve and release Mighty Dads. Verify the exact reviewed commit on both live pages, including fallback behavior.

Releasing Mighty Dads first remains safe but displays the static calendar fallback rather than event cards. A local/CI fixture test is not proof that a production feed has been published. No preview deployment is required for review.

## One source of truth

FindEveryPark's `data/events/events-manifest.js` remains the only editable source for its event facts. A deterministic generator in that repository produces the public JSON file. Its `--check` test fails if the committed feed is stale or missing; generation happens with an authorized editorial change, not a cron job. No production event data is copied into this repository. Browser tests read the companion checkout's feed at the revision recorded in `tests/feed-source.json` or `FEED_FIXTURE_PATH`.

Schema v1 includes `schemaVersion`, `timeZone`, `contentUpdatedAt`, `sourceUrl`, and `events`. Each candidate carries its canonical ID, original factual labels/qualification text, safe organizer link, exact `sortAt`, and exact `expiresAt`. The generator derives timestamps from FindEveryPark's shared Mountain-time lifecycle predicate, not from the build date or another manually maintained timezone implementation.

V1 deliberately supports approved single occurrences. Unapproved, cancelled, archived, invalid, and self-hosted community records are not syndicated. Complex recurring/pumpkin series are omitted rather than flattened into misleading dates or stripped of per-session limitations. All ten currently released November–December 2026 candidates are supported. Recurring syndication would require an explicitly versioned occurrence contract and tests, not guesswork in this consumer.

## Browser behavior

- One local script fetches JSON, with omitted credentials/referrer, CORS mode, revalidation, an eight-second timeout, and a bounded response size. It never loads or evaluates FindEveryPark JavaScript, HTML, CSS, cookies, or analytics.
- The homepage shows up to three candidates; the Events page shows up to five. A source can legitimately yield fewer or none.
- Missing/unsupported envelopes fail closed. Invalid records and expired records are excluded. IDs are deduplicated; `sortAt` and a stable ID break ties.
- The browser compares its current clock to source-owned `expiresAt` on initial load, every minute, on returning to a tab, and when restoring a page from the back/forward cache. The known limitation is the visitor's device clock.
- The feed revalidates every ten minutes while visible and on return when due. Existing CDN cache headers are currently ten minutes. Changed/cancelled source records require editorial publication and a successful revalidation; this is not live inventory.
- A failed reload clears old cards. There is no persistent event cache or stale hard-coded event fallback. Static calendar links always remain, including when JavaScript is disabled. An explicit retry control appears on failure.
- Text is rendered with DOM `textContent`. Organizer URLs permit only HTTP(S), forbid embedded credentials, and use `noopener noreferrer` in new tabs. User-facing source labels preserve prices, registration warnings and availability qualifications.
- Unchanged results do not churn DOM or announce the whole grid. Expanded disclosures and keyboard focus survive successful updates; removed focused cards and successful retries move focus to the section heading.

## Mighty Dads Gatherings

The two owner-approved 2026 dates are separate inline JSON in `events.html`: Poker Night on November 20 and Christmas Party on December 19. Cards publish only title, date, and “Details to be announced.” There are no venue addresses, RSVP/contact links, prices, attendance rules, age claims, times, private notes, or calendar exports in this data.

Their `expiresAt` values are listing-removal policy: the next midnight in `America/Denver`, with the correct November/December UTC offset. These are not asserted event closing times. Nothing is displayed as an event end time. The local date-only listings use the same source policy as FindEveryPark; missing actual times remain unknown. Gathering rendering is independent of network feed success.

## Verification

Run the existing Python smoke tests, Node unit/contract tests, and browser suite using the commands in `package.json`. Chromium and WebKit cover mobile/desktop card layouts, keyboard controls, scoped accessibility, loading failures, no-JavaScript fallback, missing/malformed/expired data, exact end boundaries, open-tab refresh, and source/privacy guards. Tests block external requests except a controlled JSON response; no event registration or organizer action occurs.

Read the PR's exact tested commit, CI links, screenshots, and remaining limitations before approving. Playwright WebKit is not physical iPhone or screen-reader certification.
