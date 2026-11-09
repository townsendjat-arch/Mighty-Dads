/* Prepared adapter only. Not loaded by events.html. No live transport is installed. */
(function (root) {
  'use strict';
  const config = Object.freeze({ endpoint: 'https://formspree.io/f/xrppngnk', enabled: false });
  const closes = Object.freeze({ 'poker-2026': '2026-11-20T17:30:00-07:00', 'christmas-2026': '2026-12-19T17:30:00-07:00' });
  function validate(input, now = Date.now()) {
    const data = { event: String(input.event || ''), name: String(input.name || '').trim(), email: String(input.email || '').trim(), guests: String(input.guests || ''), message: String(input.message || '').trim() };
    const errors = {};
    if (!closes[data.event] || now >= Date.parse(closes[data.event])) errors.event = 'Choose an upcoming gathering.';
    if (!data.name || data.name.length > 100) errors.name = 'Enter an adult name (up to 100 characters).';
    if (data.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.email = 'Enter a valid email address.';
    if (!/^[1-9]\d*$/.test(data.guests) || !Number.isSafeInteger(Number(data.guests))) errors.guests = 'Enter a whole-number headcount of at least one.';
    if (data.message.length > 1000) errors.message = 'Keep the message within 1,000 characters.';
    return { data, errors };
  }
  function createClient({ settings = config, transport, now = Date.now, timeoutMs = 15000 } = {}) {
    let busy = false;
    return async function submit(input, captchaToken = '') {
      if (!settings.enabled || typeof transport !== 'function') return { state: 'disabled', message: 'Invitation requests are not open yet.' };
      if (busy) return { state: 'busy', message: 'Your request is still being sent.' };
      const checked = validate(input, now());
      if (Object.keys(checked.errors).length) return { state: 'invalid', errors: checked.errors, message: 'Please check the highlighted fields.' };
      if (input._gotcha) return { state: 'invalid', message: 'Unable to send this request.' };
      if (!captchaToken) return { state: 'invalid', message: 'Complete the spam check before sending.' };
      busy = true;
      const controller = new AbortController(); let timer;
      try {
        const result = await Promise.race([
          transport(settings.endpoint, { method: 'POST', credentials: 'omit', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ ...checked.data, _gotcha: '', 'cf-turnstile-response': captchaToken }) }),
          new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs); })
        ]);
        if (!result.ok || result.redirected) return { state: 'error', message: 'Request not confirmed. Please try again later or contact the organizer.' };
        const body = await result.json();
        if (body.ok !== true) return { state: 'error', message: 'Request not confirmed. Please contact the organizer before retrying.' };
        return { state: 'success', message: 'Request received; attendance is not confirmed. An organizer will review your request. No location is included in this receipt.' };
      } catch (_) {
        return { state: 'error', message: 'Delivery could not be confirmed. Contact the organizer before retrying to avoid duplicate requests.' };
      } finally { clearTimeout(timer); busy = false; }
    };
  }
  const api = Object.freeze({ config, validate, createClient });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GatheringsRSVP = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
