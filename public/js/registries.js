// Public business registries for every state and DC (pure, shared by the Worker, the app and the tests).
// Two kinds of access:
//  1. Open data: CO, OR, CT, NY and PA publish their registries as free Socrata datasets, so the Hub can look a company up by itself.
//     Florida is read from Sunbiz (src/freedata.js) because it also lists officers.
//  2. Every other state only has a search website (many use captchas or scripts and forbid automated use), so the Hub gives a one click
//     link to that state's official search with the business name ready to paste. It never pretends to have looked.
// Registries show who filed and who the registered agent is. A registered agent is often a service or a lawyer, so it is never used as the owner.
import { entityName, yearsSince } from './freedata.js';

// [code, name, registry, search page]. The links are the states' own public search pages.
export const STATES = [
  ['AL', 'Alabama', 'Secretary of State', 'https://arc-sos.state.al.us/cgi/corpname.mbr/input'],
  ['AK', 'Alaska', 'Corporations Database', 'https://www.commerce.alaska.gov/cbp/main/search/entities'],
  ['AZ', 'Arizona', 'Corporation Commission', 'https://ecorp.azcc.gov/EntitySearch/Index'],
  ['AR', 'Arkansas', 'Secretary of State', 'https://www.ark.org/corp-search/'],
  ['CA', 'California', 'Secretary of State (bizfile)', 'https://bizfileonline.sos.ca.gov/search/business'],
  ['CO', 'Colorado', 'Secretary of State', 'https://www.coloradosos.gov/biz/BusinessEntityCriteriaExt.do'],
  ['CT', 'Connecticut', 'Secretary of the State', 'https://service.ct.gov/business/s/onlinebusinesssearch'],
  ['DE', 'Delaware', 'Division of Corporations', 'https://icis.corp.delaware.gov/ecorp/entitysearch/namesearch.aspx'],
  ['DC', 'District of Columbia', 'DLCP CorpOnline', 'https://corponline.dlcp.dc.gov/'],
  ['FL', 'Florida', 'Sunbiz (Division of Corporations)', 'https://search.sunbiz.org/Inquiry/CorporationSearch/ByName'],
  ['GA', 'Georgia', 'Secretary of State', 'https://ecorp.sos.ga.gov/BusinessSearch'],
  ['HI', 'Hawaii', 'Business Registration Division', 'https://hbe.ehawaii.gov/documents/search.html'],
  ['ID', 'Idaho', 'Secretary of State', 'https://sosbiz.idaho.gov/search/business'],
  ['IL', 'Illinois', 'Secretary of State', 'https://apps.ilsos.gov/businessentitysearch/'],
  ['IN', 'Indiana', 'Secretary of State', 'https://bsd.sos.in.gov/publicbusinesssearch'],
  ['IA', 'Iowa', 'Secretary of State', 'https://sos.iowa.gov/search/business/search.aspx'],
  ['KS', 'Kansas', 'Secretary of State', 'https://www.sos.ks.gov/eforms/BusinessEntity/Search.aspx'],
  ['KY', 'Kentucky', 'Secretary of State', 'https://web.sos.ky.gov/bussearchnprofile/search'],
  ['LA', 'Louisiana', 'Secretary of State', 'https://coraweb.sos.la.gov/CommercialSearch/CommercialSearch.aspx'],
  ['ME', 'Maine', 'Secretary of State', 'https://apps3.web.maine.gov/nei-sos-icrs/ICRS?MainPage=x'],
  ['MD', 'Maryland', 'Business Express', 'https://egov.maryland.gov/BusinessExpress/EntitySearch'],
  ['MA', 'Massachusetts', 'Secretary of the Commonwealth', 'https://corp.sec.state.ma.us/CorpWeb/CorpSearch/CorpSearch.aspx'],
  ['MI', 'Michigan', 'LARA Business Registry', 'https://mibusinessregistry.lara.state.mi.us/search/business'],
  ['MN', 'Minnesota', 'Secretary of State', 'https://mblsportal.sos.mn.gov/Business/Search'],
  ['MS', 'Mississippi', 'Secretary of State', 'https://corp.sos.ms.gov/corp/portal/c/page/corpBusinessIdSearch/portal.aspx'],
  ['MO', 'Missouri', 'Secretary of State', 'https://bsd.sos.mo.gov/BusinessEntity/BESearch.aspx'],
  ['MT', 'Montana', 'Secretary of State', 'https://biz.sosmt.gov/search/business'],
  ['NE', 'Nebraska', 'Secretary of State', 'https://www.nebraska.gov/sos/corp/corpsearch.cgi'],
  ['NV', 'Nevada', 'Secretary of State (SilverFlume)', 'https://esos.nv.gov/EntitySearch/OnlineEntitySearch'],
  ['NH', 'New Hampshire', 'Secretary of State (QuickStart)', 'https://quickstart.sos.nh.gov/online/BusinessInquire'],
  ['NJ', 'New Jersey', 'Division of Revenue', 'https://www.njportal.com/DOR/BusinessNameSearch/'],
  ['NM', 'New Mexico', 'Secretary of State', 'https://enterprise.sos.nm.gov/search'],
  ['NY', 'New York', 'Department of State', 'https://apps.dos.ny.gov/publicInquiry/'],
  ['NC', 'North Carolina', 'Secretary of State', 'https://www.sosnc.gov/online_services/search/by_title/_Business_Registration'],
  ['ND', 'North Dakota', 'Secretary of State (FirstStop)', 'https://firststop.sos.nd.gov/search/business'],
  ['OH', 'Ohio', 'Secretary of State', 'https://businesssearch.ohiosos.gov/'],
  ['OK', 'Oklahoma', 'Secretary of State', 'https://www.sos.ok.gov/corp/corpInquiryFind.aspx'],
  ['OR', 'Oregon', 'Secretary of State', 'https://sos.oregon.gov/business/pages/find.aspx'],
  ['PA', 'Pennsylvania', 'Department of State', 'https://file.dos.pa.gov/search/business'],
  ['RI', 'Rhode Island', 'Secretary of State', 'https://business.sos.ri.gov/CorpWeb/CorpSearch/CorpSearch.aspx'],
  ['SC', 'South Carolina', 'Secretary of State', 'https://businessfilings.sc.gov/BusinessFiling/Entity/Search'],
  ['SD', 'South Dakota', 'Secretary of State', 'https://sosenterprise.sd.gov/BusinessServices/Business/FilingSearch.aspx'],
  ['TN', 'Tennessee', 'Secretary of State', 'https://tncab.tnsos.gov/business-entity-search'],
  ['TX', 'Texas', 'Comptroller and Secretary of State', 'https://mycpa.cpa.state.tx.us/coa/'],
  ['UT', 'Utah', 'Division of Corporations', 'https://businessregistration.utah.gov/NameAvailabilitySearch'],
  ['VT', 'Vermont', 'Secretary of State', 'https://bizfilings.vermont.gov/online/BusinessInquire'],
  ['VA', 'Virginia', 'State Corporation Commission', 'https://cis.scc.virginia.gov/EntitySearch/Index'],
  ['WA', 'Washington', 'Secretary of State (CCFS)', 'https://ccfs.sos.wa.gov/#/BusinessSearch'],
  ['WV', 'West Virginia', 'Secretary of State', 'https://apps.sos.wv.gov/business/corporations/'],
  ['WI', 'Wisconsin', 'Department of Financial Institutions', 'https://apps.dfi.wi.gov/apps/corpsearch/search.aspx'],
  ['WY', 'Wyoming', 'Secretary of State', 'https://wyobiz.wyo.gov/Business/FilingSearch.aspx'],
];
const BY_CODE = new Map(STATES.map((s) => [s[0], s]));
const BY_NAME = new Map(STATES.map((s) => [s[1].toLowerCase(), s]));

// "fl", "FL", "Florida", "florida " -> "FL". Anything else -> ''.
export function stateCode(input) {
  const v = String(input || '').trim();
  if (!v) return '';
  const up = v.toUpperCase().replace(/\./g, '');
  if (BY_CODE.has(up)) return up;
  return BY_NAME.get(v.toLowerCase().replace(/\./g, ''))?.[0] || '';
}
export function registryFor(input) {
  const s = BY_CODE.get(stateCode(input));
  return s ? { code: s[0], state: s[1], registry: s[2], url: s[3], mode: s[0] === 'FL' ? 'sunbiz' : OPEN_DATA[s[0]] ? 'open' : 'link' } : null;
}
export const registryCoverage = () => ({ states: STATES.length, sunbiz: ['FL'], open: Object.keys(OPEN_DATA), linkOnly: STATES.map((s) => s[0]).filter((c) => c !== 'FL' && !OPEN_DATA[c]) });

// ---------- open data (Socrata) ----------
// Column names come from each state's published dataset. `active` says whether the dataset only lists live companies.
export const OPEN_DATA = {
  CO: { domain: 'data.colorado.gov', id: '4ykn-tg5h', name: 'entityname', id_: 'entityid', kind: 'entitytype', status: 'entitystatus', filed: 'entityformdate', city: 'principalcity', agentOrg: 'agentorganizationname', agentFirst: 'agentfirstname', agentLast: 'agentlastname' },
  OR: { domain: 'data.oregon.gov', id: 'tckn-sxa6', name: 'business_name', id_: 'registry_number', kind: 'entity_type', filed: 'registry_date', city: 'city', agentFirst: 'first_name', agentLast: 'last_name', activeOnly: true },
  CT: { domain: 'data.ct.gov', id: 'n7gp-d28j', name: 'name', id_: 'accountnumber', kind: 'business_type', status: 'status', filed: 'date_registration', city: 'billingcity' },
  NY: { domain: 'data.ny.gov', id: 'n9v6-gdp6', name: 'current_entity_name', id_: 'dos_id', kind: 'entity_type', filed: 'initial_dos_filing_date', city: 'dos_process_city', agentOrg: 'dos_process_name', activeOnly: true },
  PA: { domain: 'data.pa.gov', id: 'xvd7-5r2c', name: 'business_name', id_: 'filing_number', kind: 'typeofbusinessregistration', filed: 'creationdate', city: 'city' },
};

const soql = (s) => String(s).replace(/'/g, "''").replace(/[%_]/g, '');
// The search address for one lead's name, or '' when the state has no open data or the name is empty.
export function openDataUrl(code, business) {
  const c = OPEN_DATA[code];
  const words = entityName(business).split(' ').filter(Boolean).slice(0, 3);
  if (!c || !words.length) return '';
  const where = `upper(${c.name}) like '%${soql(words.join(' ').toUpperCase())}%'`;
  return `https://${c.domain}/resource/${c.id}.json?$where=${encodeURIComponent(where)}&$limit=25`;
}

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const titleCase = (s) => clean(s).toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
// "2012-02-14T00:00:00.000" -> "02/14/2012"
export function usDate(v) {
  const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(String(v || ''));
  if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  const n = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(v || ''));
  return n ? `${n[1].padStart(2, '0')}/${n[2].padStart(2, '0')}/${n[3]}` : '';
}
// Rows from a state's dataset -> one shape. Unknown fields stay empty.
export function normalizeRows(code, rows) {
  const c = OPEN_DATA[code];
  if (!c || !Array.isArray(rows)) return [];
  return rows.map((r) => {
    const status = clean(c.status ? r[c.status] : '');
    const filed = usDate(r[c.filed]);
    const agent = clean(c.agentOrg ? r[c.agentOrg] : '') || clean([c.agentFirst ? r[c.agentFirst] : '', c.agentLast ? r[c.agentLast] : ''].filter(Boolean).join(' '));
    return {
      name: clean(r[c.name]), id: clean(r[c.id_]), kind: clean(r[c.kind]), status, filed, years: yearsSince(filed),
      active: status ? /good standing|^active|in existence|exists/i.test(status) : c.activeOnly ? true : null,
      agent: agent === agent.toUpperCase() ? titleCase(agent) : agent, city: titleCase(r[c.city]),
    };
  }).filter((r) => r.name);
}
