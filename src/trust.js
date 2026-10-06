// Trust signals: domain age (RDAP), Google Safe Browsing (optional key), URL and page heuristics.
// Everything is deterministic. Each flag carries points; the verdict comes from the total.

const f = (id, severity, title, detail, fix = '', points = 0) => ({ id, category: 'Trust', severity, title, detail, fix, points });

const RISKY_TLDS = new Set(['xyz', 'top', 'tk', 'gq', 'ml', 'cf', 'ga', 'buzz', 'icu', 'click', 'link', 'work', 'rest', 'cam', 'loan', 'win', 'bid', 'monster', 'cyou', 'sbs', 'vip']);
const SHORTENERS = new Set(['bit.ly', 't.co', 'tinyurl.com', 'goo.gl', 'ow.ly', 'is.gd', 'cutt.ly', 'rb.gy', 'shorturl.at', 'buff.ly', 'tiny.cc']);
const WEBMAIL = new Set(['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'aol.com', 'proton.me', 'protonmail.com', 'mail.com', 'yandex.com', 'rediffmail.com', 'gmx.com', 'icloud.com']);
const BRANDS = ['paypal', 'apple', 'google', 'microsoft', 'amazon', 'facebook', 'instagram', 'netflix', 'binance', 'coinbase', 'metamask', 'whatsapp', 'linkedin', 'dropbox', 'adobe', 'spotify', 'steam', 'dhl', 'fedex', 'usps', 'paytm', 'phonepe', 'irctc', 'hdfc', 'icici', 'sbi', 'axis bank', 'kotak', 'flipkart', 'airtel', 'jio', 'walmart', 'chase', 'wells fargo', 'bank of america', 'docusign', 'telegram', 'tiktok', 'ebay'];
const URGENCY = [/account (has been |is |will be )?(suspended|locked|limited|disabled)/i, /verify (your )?(account|identity|payment)?\s*(immediately|now|within)/i, /(act|respond|claim)\s+(now|immediately|within \d+)/i, /limited[- ]time (offer|only)/i, /(urgent|immediate) action required/i, /your (account|package|parcel) (is|has been) (on hold|held|blocked)/i, /you('ve| have) won/i, /unusual (sign[- ]?in|activity)/i, /confirm your (password|card|bank)/i, /only \d+ (left|remaining)/i];
const BADGES = /(norton|mcafee|trustpilot|verified[-_ ]?(by|seller|secure)|secure[-_ ]?(checkout|payment)|ssl[-_ ]?(secure|secured|certified)|100%[-_ ]?(safe|secure|guarantee)|bbb[-_ ]?accredited|money[-_ ]?back)/i;

export function registrable(host) {
  const p = host.toLowerCase().replace(/\.$/, '').split('.');
  if (p.length <= 2) return p.join('.');
  const slds = ['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'ltd'];
  return (p.at(-1).length === 2 && slds.includes(p.at(-2)) ? p.slice(-3) : p.slice(-2)).join('.');
}

const cache = new Map();
async function rdap(domain) {
  const hit = cache.get(domain);
  if (hit && Date.now() - hit.t < 3_600_000) return hit.v;
  let v = { ok: false };
  try {
    const r = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { signal: AbortSignal.timeout(6000), headers: { accept: 'application/rdap+json', 'user-agent': 'Mozilla/5.0 (compatible; ScoutBot/1.0)' } });
    if (r.ok) {
      const j = await r.json();
      const ev = (j.events || []).find((e) => e.eventAction === 'registration');
      const reg = (j.entities || []).find((e) => (e.roles || []).includes('registrar'));
      const fn = reg?.vcardArray?.[1]?.find((x) => x[0] === 'fn')?.[3];
      if (ev?.eventDate) v = { ok: true, created: Date.parse(ev.eventDate), registrar: fn || '' };
    }
  } catch { /* unavailable */ }
  cache.set(domain, { t: Date.now(), v });
  return v;
}

async function safeBrowsing(url) {
  const key = process.env.SAFE_BROWSING_KEY;
  if (!key) return { status: 'unavailable', reason: 'no API key configured' };
  try {
    const r = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(6000),
      body: JSON.stringify({
        client: { clientId: 'scout-audit', clientVersion: '1.0' },
        threatInfo: { threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'], platformTypes: ['ANY_PLATFORM'], threatEntryTypes: ['URL'], threatEntries: [{ url }] },
      }),
    });
    if (!r.ok) return { status: 'unavailable', reason: `API returned ${r.status}` };
    const j = await r.json();
    const threats = [...new Set((j.matches || []).map((m) => m.threatType))];
    return threats.length ? { status: 'threat', threats } : { status: 'clean' };
  } catch { return { status: 'unavailable', reason: 'request failed' }; }
}

// Network signals, started early so they overlap with the rest of the audit.
export function fetchSignals(url, host) {
  return Promise.all([rdap(registrable(host)), safeBrowsing(url)]).then(([age, sb]) => ({ age, sb }));
}

const pretty = (ms) => { const d = Math.floor((Date.now() - ms) / 86_400_000); return d < 60 ? `${d} days` : d < 730 ? `${Math.round(d / 30)} months` : `${Math.round(d / 365)} years`; };

export function trustFindings({ host, url, https, chain = [], $, text, signals, snippet, whereIs }) {
  const out = [], evidence = {};
  const ev = (id, els) => { const l = els.slice(0, 3).map((el) => ({ html: snippet($, el), where: whereIs($, el) })); if (l.length) evidence[id] = l; };
  const reg = registrable(host);
  const tld = host.split('.').at(-1);
  const body = (text || '').toLowerCase();

  // Safe Browsing
  const sb = signals?.sb || { status: 'unavailable', reason: 'not run' };
  if (sb.status === 'threat') out.push(f('trust-sb', 'critical', 'Google Safe Browsing flags this site', `Listed for: ${sb.threats.join(', ').toLowerCase().replace(/_/g, ' ')}`, 'Do not enter data on this site. If you own it, clean it up and request a review in Google Search Console.', 10));
  else if (sb.status === 'clean') out.push(f('trust-sb', 'pass', 'Not on Google Safe Browsing lists', 'Checked for malware, phishing, unwanted software and harmful apps.'));
  else out.push(Object.assign(f('trust-sb', 'info', 'Blacklist check unavailable', `Google Safe Browsing was not checked (${sb.reason}). The verdict uses the other signals only.`, '', 0), { neutral: true }));

  // Domain age
  const age = signals?.age;
  if (age?.ok) {
    const days = (Date.now() - age.created) / 86_400_000;
    const when = `Registered ${new Date(age.created).toISOString().slice(0, 10)} (${pretty(age.created)} ago)${age.registrar ? ` via ${age.registrar}` : ''}`;
    if (days < 30) out.push(f('trust-age', 'critical', `Domain is only ${Math.max(0, Math.floor(days))} days old`, when, 'Brand-new domains are a common trait of scam sites. Look for independent proof the business is real.', 6));
    else if (days < 183) out.push(f('trust-age', 'warning', `Domain is less than 6 months old (${pretty(age.created)})`, when, 'Young domains deserve extra checking before you pay or log in.', 3));
    else out.push(f('trust-age', 'pass', `Domain registered ${pretty(age.created)} ago`, when));
  } else out.push(Object.assign(f('trust-age', 'info', 'Domain age unavailable', 'The registry did not return a registration date (RDAP).', '', 0), { neutral: true }));

  // URL heuristics
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) out.push(f('trust-ip', 'warning', 'Site is served from a raw IP address', host, 'Real businesses use a proper domain name.', 4));
  if (host.split('.').some((l) => l.startsWith('xn--'))) out.push(f('trust-puny', 'warning', 'Domain uses punycode (xn--)', `${host} may imitate another name with look-alike characters.`, 'Compare the domain letter by letter with the brand you expect.', 3));
  if (RISKY_TLDS.has(tld)) out.push(f('trust-tld', 'warning', `Uses the .${tld} extension, common in abuse reports`, `${host}`, 'Not proof of anything alone, but scam sites favour cheap extensions like this.', 2));
  const label = reg.split('.')[0];
  const hy = (label.match(/-/g) || []).length, dg = (label.match(/\d/g) || []).length;
  if (hy >= 3 || dg >= 4) out.push(f('trust-name', 'info', 'Domain name has many hyphens or digits', reg, '', 1));
  if (SHORTENERS.has(reg) || chain.slice(0, -1).some((c) => { try { return SHORTENERS.has(registrable(new URL(c.url).hostname)); } catch { return false; } })) out.push(f('trust-short', 'warning', 'Link went through a URL shortener', chain.map((c) => `${c.status} ${c.url}`).join('\n'), 'Shorteners hide the real destination.', 2));

  // Brand claimed on page vs registrable domain
  const claim = `${($('head title').first().text() || '')} ${$('meta[property="og:site_name"]').attr('content') || ''} ${$('h1').first().text()}`.toLowerCase();
  const brand = BRANDS.find((b) => new RegExp(`\\b${b}\\b`).test(claim));
  const pw = $('input[type="password"]').get();
  const ownsBrand = brand && reg.replace(/[-.]/g, '').includes(brand.replace(/\s/g, ''));
  if (brand && !ownsBrand && pw.length) {
    out.push(f('trust-brand', 'critical', `Page uses the "${brand}" name but the domain is ${reg}`, `The title or headline mentions ${brand} and the page asks for a password.`, 'Type the real brand address yourself instead of following links.', 5));
    ev('trust-brand', pw);
  }

  // Login forms
  if (pw.length) {
    const forms = $('form').filter((_, el) => $(el).find('input[type="password"]').length).get();
    const actions = forms.map((el) => { try { return new URL($(el).attr('action') || url, url); } catch { return null; } }).filter(Boolean);
    const insecure = !https || actions.some((a) => a.protocol === 'http:');
    const offsite = actions.filter((a) => registrable(a.hostname) !== reg);
    if (insecure) { out.push(f('trust-pw', 'critical', 'Password field on an insecure (HTTP) page', 'Anything typed here can be read in transit.', 'Serve the page and the form action over HTTPS.', 6)); ev('trust-pw', pw); }
    else if (offsite.length) { out.push(f('trust-pw', 'warning', 'Login form sends data to a different domain', offsite.map((a) => a.href).slice(0, 3).join('\n'), 'Phishing pages often post credentials to another site.', 3)); ev('trust-pw', forms); }
  }

  // Urgency language
  const hits = URGENCY.map((re) => body.match(re)?.[0]).filter(Boolean);
  if (hits.length) out.push(f('trust-urgency', hits.length >= 2 ? 'warning' : 'info', `Urgency or fear language (${hits.length} phrase${hits.length > 1 ? 's' : ''})`, hits.slice(0, 4).map((h) => `"${h}"`).join('\n'), 'Pressure to act now is a standard scam tactic.', hits.length >= 2 ? 3 : 1));

  // Imprint / contact / privacy
  const links = $('a[href]').map((_, a) => `${$(a).attr('href')} ${$(a).text()}`.toLowerCase()).get().join(' ');
  const hasPrivacy = /privacy/.test(links), hasContact = /contact|support|imprint|impressum|about/.test(links) || $('a[href^="mailto:"],a[href^="tel:"]').length;
  if (!hasPrivacy && !hasContact) out.push(f('trust-contact', 'warning', 'No privacy, contact or about page linked', 'Legitimate businesses link at least a contact route and a privacy policy.', 'Add contact details and a privacy policy.', 2));
  else if (!hasPrivacy || !hasContact) out.push(f('trust-contact', 'info', `No ${hasPrivacy ? 'contact' : 'privacy policy'} link found`, '', 'Link both a privacy policy and a contact route from every page.', 1));
  else out.push(f('trust-contact', 'pass', 'Privacy and contact links present', ''));

  // Free webmail as official contact
  const mails = [...new Set(($.root().text().match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || []).concat($('a[href^="mailto:"]').map((_, a) => ($(a).attr('href') || '').replace(/^mailto:/i, '').split('?')[0]).get()))];
  const free = mails.filter((m) => WEBMAIL.has(m.split('@')[1]?.toLowerCase()) && !WEBMAIL.has(reg));
  if (free.length) { out.push(f('trust-mail', 'info', 'Free webmail address shown as contact', free.slice(0, 3).join('\n'), 'A business domain email looks more trustworthy than a free webmail one.', 1)); ev('trust-mail', $('a[href^="mailto:"]').get().filter((a) => free.some((m) => ($(a).attr('href') || '').includes(m)))); }

  // Unverifiable trust badges
  const badges = $('img').get().filter((i) => BADGES.test(`${$(i).attr('alt') || ''} ${$(i).attr('src') || ''}`));
  if (badges.length) { out.push(f('trust-badge', 'info', `${badges.length} trust badge image${badges.length > 1 ? 's' : ''} that cannot be verified`, 'A badge image can be copied by anyone. A real one links to the issuer\'s verification page.', 'Link badges to their verification page, or remove them.', 1)); ev('trust-badge', badges); }

  const points = out.reduce((s, x) => s + (x.severity === 'pass' ? 0 : x.points), 0);
  const verdict = sb.status === 'threat' || points >= 6 ? 'high' : points >= 3 ? 'suspicious' : 'safe';
  return { findings: out.map(({ points: _p, ...x }) => x), evidence, trust: { verdict, points, safeBrowsing: sb.status, domainAge: age?.ok ? { created: age.created, registrar: age.registrar } : null } };
  }
