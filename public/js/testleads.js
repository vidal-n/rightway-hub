// Pretend leads for the "Test power dial" mode on the dialer. Nothing here is a real business or a real number (555 01xx),
// nothing is saved, and nothing is dialed. `test_outcome` says how the pretend call goes: answered, or rings out.
export const TEST_OUTCOMES = ['answer', 'no-answer', 'answer'];
export function testLeads(now = Date.now()) {
  const d = new Date(now);
  const local = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const base = { stage: 'new', attempts: 0, next_action: '', tz_known: true, local_time: local, state: 'FL', sms_consent: 0, test: true, website: '', rating: null, reviews: null };
  return [
    { ...base, id: 'test-1', business: 'Test Plumbing Co', city: 'Miami', industry: 'Plumbing', phone: '(305) 555-0101', contact_name: 'Pat Sample', email: 'pat@example.com', grade: 'A', score: 82, test_outcome: TEST_OUTCOMES[0], persona: 'friendly' },
    { ...base, id: 'test-2', business: 'Test Roofing LLC', city: 'Fort Lauderdale', industry: 'Roofing', phone: '(954) 555-0102', contact_name: '', email: '', grade: 'B', score: 66, test_outcome: TEST_OUTCOMES[1], persona: 'skeptical' },
    { ...base, id: 'test-3', business: 'Test HVAC Services', city: 'Hollywood', industry: 'HVAC', phone: '(954) 555-0103', contact_name: 'Sam Example', email: 'sam@example.com', grade: 'C', score: 51, test_outcome: TEST_OUTCOMES[2], persona: 'agency' },
  ];
}
