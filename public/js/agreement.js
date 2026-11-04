// Rightway Growth work orders (service agreements). Two kinds:
//   seo:     the one agreement for every Google and local SEO client. Only the buildout and monthly amounts change.
//   website: websites are a separate service with their own agreement (build fee, optional monthly care, the scope lines).
// Pure: builds text and HTML strings, no DOM or network, so the Worker (snapshot on send), the sign page, the printable
// blank copy and the tests all use the same words.

export const AGREEMENT_VERSION = 2;

export const COMPANY = {
  name: 'Rightway Growth LLC',
  address: '2001 Van Buren St, Hollywood, Florida 33020',
  site: 'rightwaygrowth.com',
  email: 'hello@rightwaygrowth.com',
};

export const SERVICES = [
  'Google Business Profile optimization and management',
  'Local SEO strategy and implementation',
  'Citation building and cleanup',
  'Review generation strategy',
  'Website recommendations',
  'Local search visibility improvements',
  'Monthly performance tracking and reporting',
  'Ongoing marketing consulting and support',
];

// Script fonts the client picks from for the signature and the initials (loaded from Google Fonts on the sign page).
export const SIG_FONTS = ['Dancing Script', 'Great Vibes', 'Allura', 'Caveat'];
export const SIG_FONTS_URL = 'https://fonts.googleapis.com/css2?family=Allura&family=Caveat:wght@600&family=Dancing+Script:wght@600&family=Great+Vibes&display=swap';
export const okFont = (f) => (SIG_FONTS.includes(f) ? f : SIG_FONTS[0]);
export const initialsOf = (name) => String(name || '').trim().split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).slice(0, 3).join('');

const usd = (cents) => (cents == null || cents === '' ? '$________' : `$${(Number(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export const TITLES = { seo: 'Digital Marketing Service Agreement', website: 'Website Design Agreement' };

// Sections as [heading, paragraphs[], bullets?, after?]. Amounts in cents; leave them out for the blank printable copy.
export function agreementSections({ kind = 'seo', setupCents, monthlyCents, scope = [] } = {}) {
  if (kind === 'website') return websiteSections({ setupCents, monthlyCents, scope });
  const today = setupCents == null || monthlyCents == null ? null : Number(setupCents) + Number(monthlyCents);
  return [
    ['Services', ['Company agrees to provide digital marketing services, which may include, but are not limited to:'], SERVICES,
      'Company sets the mix and pace of the work each month based on what Client\'s business needs. Website design and builds are a separate service with their own agreement.'],
    ['Term', ['This Agreement starts on the date it is signed and runs for an initial minimum term of three (3) months. After that it continues month to month until either party ends it with thirty (30) days\' written notice.']],
    ['Payment', ['Client agrees to pay:'], [`Buildout fee and first month of service: ${usd(today)} (due upon signing)`, `Monthly marketing fee: ${usd(monthlyCents)} per month`],
      'The first monthly payment is due thirty (30) days after the initial payment and continues monthly for the length of this Agreement. Payments are billed automatically through Stripe and are non-refundable once services have started.'],
    ['Early Termination', ['Client understands the three (3) month minimum covers the time, labor, strategy and asset creation in the initial buildout. If Client ends services before the end of the first three months, Client remains responsible for the remaining payments through the end of that term, unless Company agrees otherwise in writing. After the first three months, Client may end services at any time with thirty (30) days\' written notice, with no payments due beyond that notice period.']],
    ['No Guarantees', ['Company does not guarantee specific rankings, traffic, lead volume, revenue or other marketing outcomes. Search rankings and business results depend on many factors outside Company\'s control, including Google.']],
    ['Client Responsibilities', ['Client agrees to give timely access to the accounts, information, approvals and materials needed to do the work. Delays caused by Client do not pause payment obligations.']],
    ['Ownership', ['Client owns its Google Business Profile and accounts at all times. Listings, content and other marketing assets Company creates for Client become Client\'s property once all amounts due under this Agreement are paid.']],
    ['Work Start', [`Work begins once this Agreement is signed and the initial payment of ${usd(today)} is received.`]],
    ['Limitation of Liability', ['Company\'s total liability under this Agreement will not exceed the total amount Client paid Company in the three (3) months before any claim. Company is not liable for indirect, incidental, special, consequential or punitive damages.']],
    ['Electronic Signature and Entire Agreement', ['Client agrees that its electronic signature and initials below are legally binding. This Agreement is the entire agreement between the parties and replaces all earlier discussions or understandings about these services.']],
  ];
}

function websiteSections({ setupCents, monthlyCents, scope }) {
  const lines = (Array.isArray(scope) ? scope : String(scope || '').split('\n')).map((s) => String(s).trim()).filter(Boolean).slice(0, 12);
  const care = monthlyCents == null ? `${usd(null)} per month (if selected)` : Number(monthlyCents) > 0 ? `${usd(monthlyCents)} per month` : 'Not included';
  return [
    ['Project', ['Company agrees to design and build a website for Client. The project includes:'], lines.length ? lines : ['________________________________________', '________________________________________', '________________________________________'],
      'Anything not listed above is outside this project and is added only in writing.'],
    ['Payment', ['Client agrees to pay:'], [`Website build fee: ${usd(setupCents)} (due upon signing)`, `Monthly hosting and care: ${care}`],
      'Monthly hosting and care, when included, starts thirty (30) days after signing and is billed automatically through Stripe. The build fee is non-refundable once design work has started.'],
    ['Timeline and Revisions', ['Company gives an estimated launch date once it has Client\'s content and access. Time spent waiting on Client moves that date. Two rounds of design revisions are included; more are added only in writing.']],
    ['Client Responsibilities', ['Client provides its logo, photos, text, service details and access to its domain and any existing site, and reviews each draft promptly.']],
    ['Hosting and Care', ['Monthly hosting and care runs month to month. Either party can end it with thirty (30) days\' written notice, and Company will hand over the site files and access.']],
    ['Ownership', ['Once the build fee is paid in full, Client owns the website design and content made for Client. Themes, plugins, fonts and stock photos stay under their own licenses.']],
    ['No Guarantees', ['Company does not guarantee rankings, traffic, leads or sales from the website.']],
    ['Limitation of Liability', ['Company\'s total liability under this Agreement will not exceed the total amount Client paid under it. Company is not liable for indirect, incidental, special, consequential or punitive damages.']],
    ['Electronic Signature and Entire Agreement', ['Client agrees that its electronic signature and initials below are legally binding. This Agreement is the entire agreement between the parties about this website.']],
  ];
}

// Snapshot saved with each work order, so later wording changes never alter an agreement someone already got.
export function agreementSnapshot(opts = {}) {
  const kind = opts.kind === 'website' ? 'website' : 'seo';
  return { agreement: AGREEMENT_VERSION, kind, title: TITLES[kind], sections: agreementSections({ ...opts, kind }) };
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const longDate = (t) => new Date(t).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

// The one page document. `sig` = { name, at, font, initials, initialsFont } once signed.
// `fill` = { name, business, date } shows the auto filled fields before signing (the sign page), blank lines otherwise.
export function agreementHtml({ sections, title = TITLES.seo, business = '', contact = '', sig = null, logo = '', preview = null } = {}) {
  const line = (label, value, cls = '', style = '') => `<div class="ag-line"><span>${esc(label)}</span><b class="${cls}"${style ? ` style="${style}"` : ''}>${value ? esc(value) : '&nbsp;'}</b></div>`;
  const p = sig || preview || {};
  const signFont = p.font ? `font-family:'${esc(okFont(p.font))}',cursive` : '';
  const iniFont = p.initialsFont ? `font-family:'${esc(okFont(p.initialsFont))}',cursive` : '';
  return `<article class="ag">
    <header class="ag-head">${logo}<div class="ag-co"><b>${esc(COMPANY.name)}</b><span>${esc(COMPANY.address)}</span><span>${esc(COMPANY.site)} · ${esc(COMPANY.email)}</span></div></header>
    <h1 class="ag-title">${esc(title)}</h1>
    <p class="ag-intro">This agreement ("Agreement") is entered into between ${esc(COMPANY.name)} ("Company") and the undersigned Client${business ? `, <b>${esc(business)}</b>` : ''}.</p>
    <div class="ag-body">${(sections || []).map(([h, paras, bullets, after]) => `<section><h2>${esc(h)}</h2>${(paras || []).map((x) => `<p>${esc(x)}</p>`).join('')}${bullets?.length ? `<ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}${after ? `<p>${esc(after)}</p>` : ''}</section>`).join('')}</div>
    <footer class="ag-sign">
      <h2>Client</h2>
      <div class="ag-grid">
        ${line('Name', p.name || contact)}
        ${line('Business', business)}
        ${line('Signature', p.font ? p.name || contact : '', p.font ? 'ag-sig' : '', signFont)}
        ${line('Initials', p.initialsFont ? p.initials || initialsOf(p.name || contact) : '', p.initialsFont ? 'ag-sig' : '', iniFont)}
        ${line('Date', p.at ? longDate(p.at) : '')}
        ${line('Company', `${COMPANY.name}`)}
      </div>
    </footer>
  </article>`;
}

// Styles shared by the sign page and the printable copy. One column, prints on one US Letter page.
export const AGREEMENT_CSS = `
.ag { background: #fff; color: #0F1B17; border: 1px solid #DCE6E1; border-radius: 14px; padding: 36px 42px; font: 13px/1.55 'Instrument Sans', system-ui, sans-serif; }
.ag-head { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding-bottom: 12px; border-bottom: 3px solid #9DEBCB; }
.ag-head img { height: 30px; width: auto; }
.ag-co { display: grid; text-align: right; font-size: 11px; color: #33433D; }
.ag-co b { font: 600 13px 'Outfit', sans-serif; color: #0F1B17; }
.ag-title { font: 700 21px/1.2 'Outfit', sans-serif; margin: 16px 0 4px; letter-spacing: -0.01em; }
.ag-intro { margin: 0 0 12px; color: #33433D; }
.ag-body section { margin-bottom: 10px; }
.ag h2 { font: 600 12.5px 'Outfit', sans-serif; text-transform: uppercase; letter-spacing: 0.05em; color: #0A6B4C; margin: 0 0 3px; }
.ag p { margin: 0 0 4px; }
.ag ul { display: block; margin: 2px 0 5px; padding-left: 18px; }
.ag li { margin: 0; break-inside: avoid; }
.ag-sign { margin-top: 14px; padding-top: 12px; border-top: 2px solid #0F1B17; }
.ag-grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 28px; row-gap: 12px; margin-top: 6px; }
.ag-line { display: grid; grid-template-columns: 78px 1fr; align-items: end; gap: 8px; }
.ag-line span { font-size: 11px; color: #61716B; }
.ag-line b { border-bottom: 1px solid #0F1B17; min-height: 26px; font-weight: 600; display: flex; align-items: flex-end; }
.ag-sig { font-size: 26px !important; font-weight: 600; line-height: 1.1; }
@media (max-width: 640px) { .ag { padding: 22px 18px; } .ag-grid { grid-template-columns: 1fr; } .ag-head { flex-wrap: wrap; } .ag-co { text-align: left; } }
@media print {
  @page { size: letter; margin: 0.4in 0.55in; }
  .ag { border: 0; border-radius: 0; padding: 0; font-size: 10.1px; line-height: 1.42; }
  .ag-head { padding-bottom: 9px; }
  .ag-title { font-size: 17px; margin-top: 10px; }
  .ag-intro { margin-bottom: 8px; }
  .ag h2 { font-size: 10.3px; margin-bottom: 2px; }
  .ag-co { font-size: 9.5px; }
  .ag p { margin-bottom: 3px; }
  .ag-body section { margin-bottom: 6px; }
  .ag-sign { margin-top: 10px; padding-top: 9px; }
  .ag-grid { row-gap: 12px; }
  .ag-line b { min-height: 22px; }
  .ag-sig { font-size: 21px !important; }
}`;
