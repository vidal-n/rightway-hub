// Current state questions per trade (Nov 2026, V: get them talking about their current state, based on the problems each industry faces;
// "How are you getting more customers in the door now?", quality or more; Nov 2026: no pet puns, customers and jobs only). Pure and shared. From the research report "Cold call scripts and split testing":
// one calibrated how/what question and two follow ups per trade, in the owner's own words (calls, jobs, patients, covers).
// The problems behind them are practitioner knowledge, not measured facts, so the questions ask, they never claim.
// Modeled on Josh Braun's poke the bear questions and Chris Voss's calibrated questions.

// [match, words owners use for a customer, question, follow up 1, follow up 2]. Most specific first.
export const DISCOVERY = [
  [/personal injury|accident|injury law/i, 'cases', 'Where are most of your new cases coming from right now?', 'Do you buy leads or run ads, or is it mostly referrals?', 'How happy are you with the quality of what comes in?'],
  [/family law|divorce|custody/i, 'clients', 'How are people finding you when they need a family lawyer?', 'Are most of those referrals from past clients or other attorneys?', 'How many callers are just shopping for a price?'],
  [/law|attorney|lawyer|legal/i, 'clients', 'How are new clients finding you right now?', 'Is it mostly referrals, or people searching on their own?', 'How many of those calls turn into cases you want?'],
  [/hvac|air cond|\bac\b|heating|cooling/i, 'calls', 'How are you keeping the trucks busy outside the summer rush?', 'When someone\'s AC dies and they search for help, where do you usually show up?', 'How much of your work is your maintenance members versus new people finding you?'],
  [/roof/i, 'jobs', 'Where are your roof jobs coming from right now?', 'How much of your work is insurance claims versus homeowners paying out of pocket?', 'When someone in your area searches roof repair, who do you see coming up first?'],
  [/plumb|septic|drain/i, 'calls', 'Where are most of your service calls coming from these days?', 'When you\'re under a sink and the phone rings, who picks it up?', 'Of last month\'s jobs, how many were people who already knew you, and how many were brand new?'],
  [/electric/i, 'calls', 'What kind of work is coming in most right now, service calls or bigger projects?', 'Where are those calls usually coming from?', 'Is that the kind of work you want more of, or would you rather shift the mix?'],
  [/remodel|contractor|construction|restoration|foundation|concrete|paving|kitchen|bath/i, 'projects', 'How are you finding your next few projects right now?', 'How far out is your schedule booked?', 'When referrals slow down, what do you lean on?'],
  [/floor|tile|carpet install/i, 'jobs', 'How are homeowners finding you for new floors right now?', 'How much of your work comes through contractors versus homeowners direct?', 'How many in home estimates turn into jobs?'],
  [/paint/i, 'jobs', 'How full is your schedule for the next month or so?', 'Where did those jobs come from?', 'How many estimates do you give for every job you land?'],
  [/handyman/i, 'jobs', 'What\'s keeping you busy right now, and where\'s that work coming from?', 'Are those the jobs you actually want, or just whatever comes in?', 'How many of your calls come from people who found you online?'],
  [/garage/i, 'calls', 'When someone\'s garage door breaks, how are they finding you right now?', 'How much of that comes from Google versus builders or referrals?', 'Who answers when it\'s after hours?'],
  [/locksmith/i, 'calls', 'Where are your lockout calls coming from these days?', 'What are you seeing from the listings that pop up near you on Google?', 'How much repeat work do you get from landlords or businesses?'],
  [/appliance/i, 'calls', 'Where are your repair calls coming from right now?', 'How much is warranty work versus people calling you direct?', 'When someone\'s fridge dies, how do they usually find you?'],
  [/fenc/i, 'jobs', 'How are you finding new fence jobs right now?', 'How many estimates do you run for each job you land?', 'Is it mostly homeowners, or builders and HOAs?'],
  [/tree|arbor/i, 'jobs', 'Outside of storm cleanup, where are your tree jobs coming from?', 'How much is homeowners versus HOAs and property managers?', 'When someone searches tree removal near them, who comes up first?'],
  [/solar/i, 'appointments', 'How are you getting homeowner appointments right now?', 'Do you buy leads, or do you generate your own?', 'How many of those appointments turn into signed deals?'],
  [/window|door|glass|shutter|impact/i, 'jobs', 'How are homeowners finding you for windows and doors right now?', 'How much of your work comes from referrals versus people searching?', 'How many estimates turn into installs?'],
  [/landscap|lawn|sod|irrigation/i, 'accounts', 'How are you keeping the route full right now?', 'Are you adding new accounts, or mostly holding the ones you have?', 'Where did your last few new customers find you?'],
  [/pool/i, 'pools', 'How are you adding new pools to the route these days?', 'When you lose an account, how fast do you usually replace it?', 'How do most people find you, neighbors or online?'],
  [/pest|termite|exterminat/i, 'homes', 'How are you getting new homes on a recurring plan right now?', 'How many of your new customers start as a one time call?', 'Who shows up above you when someone nearby searches pest control?'],
  [/pressure|power wash|soft wash/i, 'jobs', 'How are you finding new driveways and houses to wash right now?', 'Is that mostly door hangers and neighbors, or are people calling off Google?', 'What happens to your schedule when it rains for a week?'],
  [/carpet|upholster/i, 'jobs', 'Where are most of your jobs coming from right now, repeat customers or new ones?', 'How do new people usually find you?', 'What does a slow week look like for you?'],
  [/clean|maid|janitor/i, 'clients', 'How are you filling your cleaners\' schedules right now?', 'Are most new clients recurring, or one time cleans?', 'Where did your last few recurring clients come from?'],
  [/mov(ing|ers)\b|mover/i, 'moves', 'How are you booking moves right now, mostly referrals or online?', 'What has buying leads from the moving sites been like for you?', 'How many quotes turn into booked moves?'],
  [/junk|haul/i, 'jobs', 'How are you keeping the truck full right now?', 'Do most jobs come from homeowners, or realtors and property managers?', 'Where did your last few calls find you?'],
  [/tow/i, 'tows', 'Where are most of your tows coming from right now, motor clubs or direct calls?', 'How do you feel about the rates on the motor club work?', 'When someone breaks down and searches for a tow, where do they find you?'],
  [/mobile mechanic/i, 'customers', 'How are customers finding you right now?', 'Is it mostly people you already know, or people finding you online?', 'When someone near you searches mobile mechanic, where do you show up?'],
  [/detail/i, 'cars', 'How are you getting more cars booked right now?', 'Are those mostly one time details or repeat customers?', 'Where do new people usually find you, Instagram or Google?'],
  [/auto|car|mechanic|body shop|collision|tire|transmission/i, 'cars', 'How are you getting new cars in the bays right now?', 'How much of your work comes from insurance or dealers versus people finding you on their own?', 'When someone\'s check engine light comes on, how do they find you?'],
  [/dent|orthodont/i, 'new patients', 'How has the flow of new patients been lately?', 'Where do most new patients say they found you?', 'Are they mostly insurance patients, or the treatment you actually want more of?'],
  [/chiro/i, 'new patients', 'How are you getting new patients in the door right now?', 'How much of that is referrals versus people finding you online?', 'Once they come in, how many stick with their care plan?'],
  [/med spa|medspa|aesthetic|botox|laser|plastic surg/i, 'clients', 'Besides running specials, how are you bringing in new clients right now?', 'How many of the people who come in on a deal come back at full price?', 'How do you stand out from the other med spas nearby?'],
  [/physical therap|rehab/i, 'patients', 'How many of your new patients are coming from doctor referrals right now?', 'How many find you on their own?', 'How has that mix changed in the last year or so?'],
  [/vet|animal hosp/i, 'clients', 'How are new pet owners in the area finding you right now?', 'Are you taking new clients, or are you pretty booked up?', 'Which kind of visits would you want more of?'],
  [/groom/i, 'customers', 'How are you getting more customers in the door right now?', 'Are your regulars booked on a schedule, or do they call when they remember?', 'Where do new customers usually find you?'],
  [/dog train|boarding|kennel|pet sit|daycare for dogs/i, 'customers', 'How are you filling your boarding spots and classes right now?', 'Is it packed at holidays and slow the rest of the year?', 'Where do new clients usually find you?'],
  [/barber|hair|salon|beauty|lash|brow/i, 'clients', 'How are you getting new people in the chair right now?', 'Is that mostly walk ins, Instagram, or Google?', 'Are the books full, or are there gaps during the week?'],
  [/nail/i, 'clients', 'How are you getting new clients in the chairs right now?', 'Are they mostly walk ins or booked appointments?', 'When someone searches nail salon near them, where do you show up?'],
  [/gym|fitness|trainer|yoga|pilates|crossfit|martial/i, 'members', 'How are you getting new members right now?', 'Is January still your big month, or is it steadier now?', 'How many people who try a class end up joining?'],
  [/bak(e|ery)|cake/i, 'orders', 'How are people finding you for custom orders right now?', 'Is it more walk ins, or cakes and event orders?', 'Where do most orders come from, Instagram or Google?'],
  [/restaurant|cafe|coffee|food|pizza|grill|bar\b|kitchen|catering/i, 'guests', 'How are you getting new faces through the door right now?', 'How much of your business is the delivery apps versus people coming in?', 'When people nearby search for your kind of food, where do they find you?'],
  [/florist|flower/i, 'orders', 'Outside of Valentine\'s and Mother\'s Day, how are people finding you for orders?', 'How much comes through the wire services versus direct?', 'How many wedding and event orders do you get?'],
  [/photo/i, 'sessions', 'How are you booking sessions right now?', 'Is it mostly referrals and Instagram, or do people find you on Google?', 'What does your slow season look like?'],
  [/wedding|venue|event|party rental|dj\b/i, 'bookings', 'How are couples finding you right now?', 'Are the wedding sites still bringing you good inquiries?', 'How many tours turn into booked dates?'],
  [/account|cpa|tax|bookkeep/i, 'clients', 'Outside of tax season, how are you bringing on new clients?', 'Are you looking for more individual returns or more business clients?', 'Where did your last few business clients come from?'],
  [/real estate|realtor|realty/i, 'deals', 'Where are most of your deals coming from right now?', 'How much is your sphere versus online leads?', 'What has buying leads from the portals been like?'],
  [/insurance/i, 'households', 'How are you finding new households to quote right now?', 'Do you buy leads, or is it mostly referrals?', 'When someone searches insurance agent near them, where do you land?'],
  [/daycare|child care|preschool|tutor|learning center/i, 'families', 'How are families finding you right now?', 'Do you have open spots right now, or a waitlist?', 'Where do most parents say they heard about you?'],
  [/medical|doctor|clinic|urgent care|physician|pediatr|dermat/i, 'patients', 'How are new patients finding you right now?', 'How much of that is referrals versus people searching on their own?', 'Which kind of visits would you want more of?'],
  [/storage/i, 'units', 'How are people finding you when they need a unit?', 'How full are you running right now?', 'When someone searches storage near them, who shows up first?'],
  [/financial|advisor|wealth/i, 'clients', 'How are new clients finding you right now?', 'Is it mostly referrals, or people finding you on their own?', 'Where did your last few new clients come from?'],
];

const GENERIC = ['customers', 'How are most new customers finding you right now?', 'Where did your last few new customers come from?', 'Is that the kind of work you want more of?'];

// The question set for a lead. text: anything that names the trade (industry, Google category, the industry label).
export function discoveryFor(...texts) {
  for (const t of texts) {
    if (!t) continue;
    const row = DISCOVERY.find(([re]) => re.test(String(t)));
    if (row) return { word: row[1], q: row[2], f1: row[3], f2: row[4], generic: false };
  }
  return { word: GENERIC[0], q: GENERIC[1], f1: GENERIC[2], f2: GENERIC[3], generic: true };
}
