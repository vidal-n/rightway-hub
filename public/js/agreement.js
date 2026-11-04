// The one Rightway Growth work order (service agreement), used for every plan. Only the two dollar amounts change.
// Pure: builds text and HTML strings, no DOM or network, so the Worker (snapshot on send), the sign page, the printable
// blank copy and the tests all use the same words.

export const AGREEMENT_VERSION = 1;

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
  'Website design, updates and optimization',
  'Local search visibility improvements',
  'Monthly performance tracking and reporting',
  'Ongoing marketing consulting and support',
];

const usd = (cents) => (cents == null || cents === '' ? '$________' : `$${(Number(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

// Sections as [heading, paragraphs[], bullets?]. Amounts in cents; leave them out for the blank printable copy.
export function agreementSections({ setupCents, monthlyCents } = {}) {
  const today = setupCents == null || monthlyCents == null ? null : Number(setupCents) + Number(monthlyCents);
  return [
    ['Services', ['Company agrees to provide digital marketing services, which may include, but are not limited to:'], SERVICES,
      'Company sets the mix and pace of the work each month based on what Client\'s business needs.'],
    ['Term', ['This Agreement starts on the date it is signed and runs for an initial minimum term of three (3) months. After that it continues month to month until either party ends it with thirty (30) days\' written notice.']],
    ['Payment', ['Client agrees to pay:'], [`Setup fee and first month of service: ${usd(today)} (due upon signing)`, `Monthly marketing fee: ${usd(monthlyCents)} per month`],
      'The first monthly payment is due thirty (30) days after the initial payment and continues monthly for the length of this Agreement. Payments are billed automatically through Stripe and are non-refundable once services have started.'],
    ['Early Termination', ['Client understands the three (3) month minimum covers the time, labor, strategy and asset creation in the initial buildout. If Client ends services before the end of the first three months, Client remains responsible for the remaining payments through the end of that term, unless Company agrees otherwise in writing. After the first three months, Client may end services at any time with thirty (30) days\' written notice, with no payments due beyond that notice period.']],
    ['No Guarantees', ['Company does not guarantee specific rankings, traffic, lead volume, revenue or other marketing outcomes. Search rankings and business results depend on many factors outside Company\'s control, including Google.']],
    ['Client Responsibilities', ['Client agrees to give timely access to the accounts, information, approvals and materials needed to do the work. Delays caused by Client do not pause payment obligations.']],
    ['Ownership', ['Client owns its Google Business Profile and accounts at all times. Websites, listings, content and other marketing assets Company creates for Client become Client\'s property once all amounts due under this Agreement are paid.']],
    ['Work Start', [`Work begins once this Agreement is signed and the initial payment of ${usd(today)} is received.`]],
    ['Limitation of Liability', ['Company\'s total liability under this Agreement will not exceed the total amount Client paid Company in the three (3) months before any claim. Company is not liable for indirect, incidental, special, consequential or punitive damages.']],
    ['Electronic Signature and Entire Agreement', ['Client agrees that typing its name below is its legal signature. This Agreement is the entire agreement between the parties and replaces all earlier discussions or understandings about these services.']],
  ];
}

// Plain text snapshot, saved with each work order so later wording changes never alter a signed agreement.
export function agreementSnapshot(amounts) {
  return { agreement: AGREEMENT_VERSION, sections: agreementSections(amounts) };
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// The one page document. `sig` = { name, at, business, contact } when signed; blank lines otherwise.
export function agreementHtml({ sections, business = '', contact = '', sig = null, logo = '' } = {}) {
  const line = (label, value) => `<div class="ag-line"><span>${esc(label)}</span><b>${value ? esc(value) : '&nbsp;'}</b></div>`;
  return `<article class="ag">
    <header class="ag-head">${logo}<div class="ag-co"><b>${esc(COMPANY.name)}</b><span>${esc(COMPANY.address)}</span><span>${esc(COMPANY.site)} · ${esc(COMPANY.email)}</span></div></header>
    <h1 class="ag-title">Digital Marketing Service Agreement</h1>
    <p class="ag-intro">This Service Agreement ("Agreement") is entered into between ${esc(COMPANY.name)} ("Company") and the undersigned Client${business ? `, <b>${esc(business)}</b>` : ''}.</p>
    <div class="ag-cols">${(sections || []).map(([h, paras, bullets, after]) => `<section><h2>${esc(h)}</h2>${(paras || []).map((p) => `<p>${esc(p)}</p>`).join('')}${bullets?.length ? `<ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}${after ? `<p>${esc(after)}</p>` : ''}</section>`).join('')}</div>
    <footer class="ag-sign">
      <div class="ag-sign-col"><h2>Client</h2>${line('Business', business)}${line('Name', sig?.name || contact)}
        <div class="ag-line"><span>Signature</span><b class="${sig ? 'ag-sig' : ''}">${sig ? esc(sig.name) : '&nbsp;'}</b></div>${line('Date', sig?.at ? new Date(sig.at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '')}</div>
      <div class="ag-sign-col"><h2>Company</h2>${line('Company', COMPANY.name)}${line('By', '')}${line('Title', 'Authorized representative')}${line('Date', '')}</div>
    </footer>
  </article>`;
}

// Styles for the document, shared by the sign page and the printable copy. Prints on one US Letter page.
export const AGREEMENT_CSS = `
.ag { background: #fff; color: #0F1B17; border: 1px solid #DCE6E1; border-radius: 14px; padding: 34px 38px; font: 12.5px/1.5 'Instrument Sans', system-ui, sans-serif; }
.ag-head { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding-bottom: 12px; border-bottom: 3px solid #9DEBCB; }
.ag-head img { height: 30px; width: auto; }
.ag-co { display: grid; text-align: right; font-size: 11px; color: #33433D; }
.ag-co b { font: 600 13px 'Outfit', sans-serif; color: #0F1B17; }
.ag-title { font: 700 21px/1.2 'Outfit', sans-serif; margin: 14px 0 4px; letter-spacing: -0.01em; }
.ag-intro { margin: 0 0 10px; color: #33433D; }
.ag-cols { column-count: 2; column-gap: 26px; }
.ag-cols section { break-inside: avoid; margin-bottom: 9px; }
.ag h2 { font: 600 12.5px 'Outfit', sans-serif; text-transform: uppercase; letter-spacing: 0.05em; color: #0A6B4C; margin: 0 0 3px; }
.ag p { margin: 0 0 4px; }
.ag ul { display: block; margin: 2px 0 5px; padding-left: 16px; }
.ag li { margin: 0; }
.ag-sign { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; margin-top: 10px; padding-top: 12px; border-top: 1px solid #DCE6E1; }
.ag-line { display: grid; grid-template-columns: 74px 1fr; align-items: end; gap: 8px; margin-top: 7px; }
.ag-line span { font-size: 11px; color: #61716B; }
.ag-line b { border-bottom: 1px solid #0F1B17; min-height: 20px; font-weight: 600; }
.ag-sig { font: italic 600 20px Georgia, serif !important; }
@media (max-width: 640px) { .ag { padding: 22px 18px; } .ag-cols { column-count: 1; } .ag-sign { grid-template-columns: 1fr; } .ag-head { flex-wrap: wrap; } .ag-co { text-align: left; } }
@media print {
  @page { size: letter; margin: 0.4in; }
  .ag { border: 0; border-radius: 0; padding: 0; font-size: 9.6px; line-height: 1.38; }
  .ag-title { font-size: 17px; margin-top: 10px; }
  .ag h2 { font-size: 10px; }
  .ag-co { font-size: 9px; }
  .ag-cols section { margin-bottom: 6px; }
  .ag-line { margin-top: 5px; }
  .ag-line b { min-height: 16px; }
}`;
