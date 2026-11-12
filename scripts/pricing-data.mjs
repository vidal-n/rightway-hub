// Prints the pricing numbers the Hub uses as JSON, so the spreadsheet generator (scripts/pricing-sheet.py) always matches the code.
import { PLAN_REF, PLAN_KEYS, INCLUDED_ALL } from '../public/js/planref.js';
import { WEB_TIERS, WEB_MIN, CARE_MONTHLY, OWN_AFTER_MONTHS, SOCIAL_AVG, YELP_AVG } from '../public/js/webprice.js';
console.log(JSON.stringify({ PLAN_KEYS, PLAN_REF, INCLUDED_ALL, WEB_TIERS, WEB_MIN, CARE_MONTHLY, OWN_AFTER_MONTHS, SOCIAL_AVG, YELP_AVG }));
