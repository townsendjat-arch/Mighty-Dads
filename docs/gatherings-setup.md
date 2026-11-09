# Gatherings: private RSVP setup proposal

Research checked November 9, 2026. This document describes proposed future operations, not an activated service or a security certification. Current website form is deliberately disconnected: no submission endpoint, no RSVP storage, and no real requests accepted. Review and approval are required before setup or collection.

## Recommended first release: Formspree intake, manual organizer approval

Use a dedicated Mighty Dads Formspree form for the existing onsite fields. Do not reuse another project's endpoint. Formspree accepts requests; it does **not** provide the approval state machine described below. Approval remains a human action by the designated organizer in a private workflow.

1. A visitor requests attendance using adult name, email, total party size (including the adult), optional message, and event identifier. Do not ask for children's names, ages, addresses, medical details, or attachments. Prompt visitors not to put sensitive information in the optional message.
2. Formspree privately receives the request. Display “Request received; attendance is not confirmed.” Never put an address in the submission acknowledgment, success page, public event description, calendar download, or autoresponder.
3. Only named authorized organizers can access intake. Use individual accounts and MFA; no shared passwords. The free plan has one dashboard member. Additional independent dashboard access requires a suitable paid plan, subject to approval.
4. Organizer checks eligibility and capacity, resolves duplicate requests, and records pending / approved / declined in a private record with timestamp and reviewer. Never use GitHub issues, a public spreadsheet, the site, or its analytics as that record.
5. Verify control of the submitted email before releasing a location, for example by requesting a reply to an address-free message. CAPTCHA and a syntactically valid email are not identity verification. Organizer approval should also establish the guest is welcome; email verification alone does not establish that.
6. After approval, the organizer sends the exact address individually through a private email to that verified adult. Keep the venue in an access-controlled private organizer record, separate from frontend code and public documents. Do not include other guests in To/CC, send group address blasts, or automatically forward the submission as an approval.
7. Cancellation stops further messages but cannot retract an address already emailed. Tell approved guests not to forward it. No system can prevent a recipient from sharing an address they have received.

### Costs and capacity

[Formspree pricing](https://formspree.io/plans) currently lists free intake at 50 submissions/month, 30-day submission archive, and one team member. Personal is $15/month or $120/year, with 200 submissions/month and one member. Professional is $30/month or $240/year, with 2,000 submissions/month and two members. Confirm account-wide limits before launch and monitor quota; repeated submissions consume capacity. A longer archive is not a reason to keep personal data indefinitely.

### Spam and validation

- Configure server-side required-field, length, email and party-size validation; client validation is only convenience. Reject unsupported event IDs and closed events. Verify which constraints the selected provider plan can enforce before enabling collection.
- Enable CAPTCHA and provider filtering. [Formspree's documented Turnstile integration](https://help.formspree.io/articles/form-and-project-settings/protecting-your-forms-with-cloudflare-turnstile) stores the secret in the provider dashboard; only the public site key belongs in HTML. Formspree verifies the submitted token. Test missing, invalid, expired and reused tokens; do not rely on a frontend success flag.
- Add the standard [_gotcha honeypot](https://help.formspree.io/articles/building-your-form/honeypot-spam-filtering) as an additional signal, not authorization.
- [Restrict submissions to the intended domain](https://help.formspree.io/articles/form-and-project-settings/restrict-to-domain/). This uses referrer behavior and is defense in depth, not authentication. Ensure the site's referrer policy is compatible.
- Handle provider rejection, quota errors, timeouts and offline conditions without announcing success. Prevent repeat clicks, preserve recoverable input only in page memory, and never log submitted data or place it in URLs, localStorage or analytics.

### Data access and retention

[Formspree security documentation](https://formspree.io/security/) describes US AWS hosting, encrypted storage and transport. [MFA is supported](https://help.formspree.io/articles/account-management/setting-up-2-factor-authentication). Restrict notifications to the approved organizer mailbox and secure that mailbox with MFA. Disable unnecessary email forwarding and integrations.

Proposed retention policy for approval: delete RSVP records and organizer email copies 30 days after the event, or earlier when no longer needed; retain only anonymous counts. Delete declined/withdrawn requests sooner if no operational reason remains. Confirm provider deletion behavior, backups and exceptions before promising a specific erasure deadline. The free provider's 30-day archive is not the same as deletion from notification inboxes or all backups. Do not export guest lists unless needed and explicitly controlled. See [privacy policy](https://formspree.io/legal/privacy-policy/) and [account limits](https://help.formspree.io/articles/account-management/account-limits/).

Publish a short privacy notice before collection identifying the organizer, provider, purpose, fields, access, retention and contact method. No newsletter enrollment or marketing reuse. Guest-count data is enough for children; this is an adult-facing form. Confirm applicable privacy obligations rather than claiming blanket legal compliance.

## Alternative: Luma-hosted registration

Luma has a stronger built-in event approval workflow but replaces the site's custom form with a hosted registration experience. [Free pricing](https://luma.com/pricing) includes unlimited events/guests and registration approval. [Registration questions](https://help.luma.com/p/collect-registration-questions) support required name/email plus party-size options and an optional message. API automation is a paid feature; no API is needed for a simple registration link.

Required configuration if chosen:

- Require organizer approval on every ticket type; use a free ticket.
- [Hide the guest list](https://help.luma.com/p/event-guest-list), including names and counts.
- Use only generic city/area in public content and keep the precise venue outside Luma initially, with manual approved-only email. Its [restricted-location setting](https://help.luma.com/p/hiding-your-event-location) is a documented alternative, but must pass anonymous, pending, declined and approved access tests before any real address is entered.
- **Do not use Luma's invitation flow.** [Official limitations](https://help.luma.com/p/payment-require-approval) say invited guests skip approval, even when their invitation was forwarded. Generic registration links avoid intentionally granting that bypass.
- [Pending and confirmed emails are distinct](https://help.luma.com/p/event-registration-process); inspect both, calendar attachments, page source, metadata and network responses. Registration does not require sign-in, and it stays open by default until closed.
- Enable [organizer MFA](https://help.luma.com/p/two-factor-authentication); give management access only to named organizers. [Security documentation](https://luma.com/security) describes encryption and audited controls.
- [Luma's privacy policy](https://luma.com/privacy-policy) does not commit to a simple event-specific deletion schedule. Verify guest erasure procedures and backup retention. Deleting a registration question preserves earlier answers; it is not data deletion. Host-configurable bot/rate-limit protections were not confirmed in this research and require verification before launch.

## Approval and acceptance gates

Before any real collection: approve provider, owner, organizer access, general locations, party-size/capacity rules, privacy notice, retention policy and operational workflow. Approve any paid plan separately. Configure services only after authorization.

Use synthetic test data, never real guests or home addresses, for initial verification:

- Form has no data transmission while disabled, including Enter key and script-disabled fallback.
- Validate fields and invalid event IDs; test duplicates, full/expired events, request limits, CAPTCHA failure, offline and provider errors.
- Only authorized organizer can read requests or approve; direct unauthenticated access fails.
- Anonymous/pending/declined users see no location; only approved verified adult receives it.
- Inspect HTML, JS, images, metadata, JSON, source maps, network responses, email previews and calendar attachments for leaks.
- Check mobile/desktop, keyboard navigation, labels, error announcements, zoom, contrast and screen-reader flow.
- Confirm private email delivery, revocation workflow, retention deletion procedure and quota behavior before enabling the site form.

No provider account, event, submission, email, or integration was created as part of this research.

## This draft and regression checks

The Events page contains two public gathering cards and the verified address-free Poker Night flyer. The homepage links directly to those cards. Poker Night is listed generally in Aurora; the Christmas Party area is still to be confirmed, not invented. Both dates are explicitly 2026 at 5:30 PM Mountain time.

The form intentionally has disabled fields, no field names, no endpoint, and no submit button. The page's `form-action 'none'` Content Security Policy blocks submission even if JavaScript attempts to submit. There is no form script, analytics tracking of field values, or browser storage. Enabling collection is a separate reviewed change, not a configuration toggle. Keep these protections until the provider and privacy checks above pass.

Run `npm ci`, `npx playwright install --with-deps chromium webkit`, `npm test`, and `npm run test:browser`. The browser suite covers 320px, 390px, and 1280px widths in Chromium and WebKit, automated accessibility, navigation, no-JavaScript fallback, blocked submission and no browser storage. Screenshots are written locally to ignored `test-results/`; CI retains them seven days. Automated accessibility does not replace a screen-reader and actual-device check.

The GitHub workflow only tests and stores screenshots. It does not deploy. Merge, deployment, provider activation, real submissions, emails and private venue distribution require separate approval.
