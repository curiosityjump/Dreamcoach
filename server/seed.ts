/**
 * Deterministic demo data for the Dream Coach prototype.
 *
 * Everything is fictional. Dates are generated relative to "now" so the demo
 * always looks current: the program began 8 months ago and runs 10 months.
 * The generator is seeded, so the same shape of history is produced each time.
 */
import type { DB } from './db.ts';
import { hashPassword } from './auth.ts';
import { CARE_CATEGORIES, type CareCategory, type RatingCategory } from '../shared/care.ts';

export const DEMO_PASSWORD = 'dream2026';

/* ---------- tiny seeded PRNG ---------- */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rnd = mulberry32(20260216);
const rand = () => rnd();
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const chance = (p: number) => rand() < p;
const jitter = (n: number) => Math.round((rand() * 2 - 1) * n);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
/** An item this dreamer has not used yet, so no text repeats verbatim for one person; null once all are used. */
function pickUnused<T>(xs: readonly T[], used: Set<T>): T | null {
  const fresh = xs.filter((x) => !used.has(x));
  if (!fresh.length) return null;
  const x = pick(fresh);
  used.add(x);
  return x;
}

/* ---------- dates ---------- */
const NOW = new Date();
const HOUR = 3600000;
const DAY = 86400000;
function monthStartUTC(monthsAgo: number): Date {
  return new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - monthsAgo, 1));
}
function at(d: Date, hour = 15, minute = 0): string {
  const x = new Date(d.getTime());
  x.setUTCHours(hour, minute, 0, 0);
  return x.toISOString();
}
function addDays(d: Date | string, n: number): Date {
  return new Date(new Date(d).getTime() + n * DAY);
}
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/* ---------- people ---------- */
interface Person { name: string; email: string }
const DIRECTOR: Person = { name: 'Jordan Ellis', email: 'director@dreamcoach.demo' };
const COACHES: Person[] = [
  { name: 'Maya Thompson', email: 'maya@dreamcoach.demo' },
  { name: 'Daniel Okafor', email: 'daniel@dreamcoach.demo' },
  { name: 'Priya Raman', email: 'priya@dreamcoach.demo' },
];

type Engagement = 'high' | 'moderate' | 'light';

interface DreamSpec { title: string; description: string; start: number; end: number; actions: string[] }
interface DreamerSpec {
  name: string;
  email: string;
  coach: string; // coach email or director email
  about: string;
  engagement: Engagement;
  joinedMonthsAgo: number; // 8 = from the start
  status?: 'active' | 'paused' | 'completed';
  missedMonths?: number[]; // monthsAgo values with no session
  care: Record<CareCategory, [number, number]>; // start → end
  commitment: [number, number];
  satisfaction: [number, number];
  dreams: [DreamSpec, DreamSpec, DreamSpec, DreamSpec];
}

const DREAMERS: DreamerSpec[] = [
  {
    name: 'Alicia Moreno', email: 'alicia@dreamcoach.demo', coach: 'maya@dreamcoach.demo',
    about: 'Resident Services Coordinator · 3 years', engagement: 'high', joinedMonthsAgo: 8,
    care: { contribution: [5, 8], alignment: [6, 8], relationships: [7, 8], energy: [4, 7] }, commitment: [7, 9], satisfaction: [6, 9],
    dreams: [
      { title: 'Run the Riverfront Half Marathon', description: 'Cross the finish line of the spring half marathon, running the whole way.', start: 10, end: 70, actions: ['Sign up for the 10K in May as a stepping stone', 'Run three mornings this week before work', 'Book a gait assessment at the running store', 'Find a running buddy for long Saturday runs'] },
      { title: 'Read twelve books during the program', description: 'One book a month — mostly fiction, a few on leadership.', start: 8, end: 85, actions: ['Pick the next book and put it by the bed', 'Join the library’s evening book club', 'Finish “The Overstory” before the next session'] },
      { title: 'Finish my bachelor’s degree', description: 'Complete the remaining 30 credits in social work, part-time.', start: 15, end: 32, actions: ['Meet with the admissions advisor about transfer credits', 'Submit the FAFSA renewal', 'Register for the fall evening course'] },
      { title: 'Start a community garden at Oakwood', description: 'A shared garden where residents grow food together.', start: 0, end: 12, actions: ['Sketch the garden idea on one page', 'Talk to the property manager about the empty lot', 'Visit the Eastside community garden for ideas'] },
    ],
  },
  {
    name: 'Marcus Bell', email: 'marcus@dreamcoach.demo', coach: 'maya@dreamcoach.demo',
    about: 'Maintenance Technician · 6 years', engagement: 'moderate', joinedMonthsAgo: 8,
    care: { contribution: [6, 8], alignment: [7, 8], relationships: [5, 7], energy: [6, 7] }, commitment: [8, 9], satisfaction: [6, 8],
    dreams: [
      { title: 'Earn my HVAC certification', description: 'Pass the EPA 608 and the state HVAC exam.', start: 20, end: 90, actions: ['Schedule the EPA 608 exam', 'Study one chapter each evening', 'Ask Ray to mentor me on the commercial units'] },
      { title: 'Take the kids camping every month', description: 'A real tent, a real fire, phones off.', start: 10, end: 100, actions: ['Reserve a site at Pine Hollow', 'Teach Jada to set up the tent', 'Plan the October trip around the leaves'] },
      { title: 'Buy a home for my family', description: 'Three bedrooms, a yard, within 30 minutes of work.', start: 5, end: 25, actions: ['Pull my credit report and read it line by line', 'Open a dedicated down-payment savings account', 'Attend the first-time buyer workshop'] },
      { title: 'Build a workshop and teach kids to fix things', description: 'A garage workshop where neighborhood kids learn hands-on skills.', start: 0, end: 8, actions: ['Write down what the first class would cover', 'Price a used workbench and basic tools'] },
    ],
  },
  {
    name: 'Tamsin Reyes', email: 'tamsin@dreamcoach.demo', coach: 'maya@dreamcoach.demo',
    about: 'Leasing Consultant · 1 year', engagement: 'light', joinedMonthsAgo: 8, missedMonths: [5, 1, 0],
    care: { contribution: [5, 6], alignment: [5, 6], relationships: [6, 7], energy: [5, 6] }, commitment: [6, 7], satisfaction: [5, 7],
    dreams: [
      { title: 'Get promoted to Assistant Property Manager', description: 'Lead a site team within the year.', start: 10, end: 45, actions: ['Ask my manager what the APM role requires', 'Shadow the APM on month-end reporting', 'Complete the Fair Housing refresher'] },
      { title: 'Learn to cook ten family recipes', description: 'The dishes my grandmother made — written down and mastered.', start: 10, end: 50, actions: ['Call Abuela and write down the arroz con pollo recipe', 'Cook one recipe every Sunday'] },
      { title: 'Travel to Oaxaca with my mom', description: 'Two weeks, Day of the Dead, her hometown.', start: 5, end: 20, actions: ['Set up an automatic $75 transfer into a travel fund', 'Renew my passport'] },
      { title: 'Own a small café', description: 'A neighborhood place with good coffee and pan dulce.', start: 0, end: 5, actions: ['Write a one-page vision of the café'] },
    ],
  },
  {
    name: 'Owen Fitzgerald', email: 'owen@dreamcoach.demo', coach: 'maya@dreamcoach.demo',
    about: 'Compliance Specialist · 2 years', engagement: 'moderate', joinedMonthsAgo: 8,
    care: { contribution: [6, 7], alignment: [4, 7], relationships: [5, 7], energy: [5, 6] }, commitment: [6, 8], satisfaction: [5, 8],
    dreams: [
      { title: 'Write and perform a set of original songs', description: 'Ten songs, one open-mic night, no apologies.', start: 20, end: 60, actions: ['Finish the bridge for “Northbound”', 'Book a slot at the Tuesday open mic', 'Record rough demos on my phone'] },
      { title: 'Rebuild a weekly rhythm with my dad', description: 'Sunday calls that actually happen.', start: 15, end: 80, actions: ['Put the Sunday call on both our calendars', 'Visit for his birthday in June'] },
      { title: 'Move into a role that uses my analysis skills', description: 'Data or policy work — something that uses the numbers side of me.', start: 5, end: 30, actions: ['Finish the SQL course', 'Ask Priya’s team if I can help with the annual report data', 'Update my résumé with the compliance dashboards work'] },
      { title: 'Live by the sea for a year', description: 'Somewhere with a long beach and a small apartment.', start: 0, end: 6, actions: ['Make a list of coastal towns with remote-friendly work'] },
    ],
  },
  {
    name: 'Lena Hoffmann', email: 'lena@dreamcoach.demo', coach: 'maya@dreamcoach.demo',
    about: 'Accounts Payable Clerk · new this year', engagement: 'moderate', joinedMonthsAgo: 2,
    care: { contribution: [5, 6], alignment: [6, 7], relationships: [7, 7], energy: [6, 7] }, commitment: [8, 8], satisfaction: [6, 7],
    dreams: [
      { title: 'Pass the bookkeeping certification', description: 'The AIPB certified bookkeeper exam by spring.', start: 10, end: 25, actions: ['Order the study guide', 'Block two study hours on Tuesday and Thursday'] },
      { title: 'Swim twice a week', description: 'Back in the pool after ten years.', start: 0, end: 35, actions: ['Buy goggles and a membership at the Y', 'Swim Monday and Thursday mornings'] },
      { title: 'Visit my grandparents in Hamburg', description: 'Three weeks there, with my daughter.', start: 5, end: 10, actions: ['Price flights for next summer'] },
      { title: 'Start a small bakery', description: 'Rye bread, cardamom buns, and a counter with four stools.', start: 0, end: 3, actions: ['Bake one new recipe each weekend'] },
    ],
  },
  {
    name: 'Darnell Price', email: 'darnell@dreamcoach.demo', coach: 'daniel@dreamcoach.demo',
    about: 'Community Engagement Lead · 5 years', engagement: 'high', joinedMonthsAgo: 8,
    care: { contribution: [7, 8], alignment: [7, 9], relationships: [6, 8], energy: [5, 8] }, commitment: [8, 9], satisfaction: [6, 9],
    dreams: [
      { title: 'Launch a youth mentoring program at Cedar Court', description: 'Twelve mentors, twelve kids, one school year.', start: 15, end: 75, actions: ['Draft the mentor commitment form', 'Meet the principal at Lincoln Middle', 'Recruit three mentors from the maintenance team', 'Hold the mentor orientation'] },
      { title: 'Be fully present at dinner every night', description: 'Phone in the drawer. Real conversation with Keisha and the boys.', start: 30, end: 90, actions: ['Buy a basket for phones by the door', 'Ask each kid one real question at dinner'] },
      { title: 'Complete a master’s in nonprofit leadership', description: 'Part-time, two years, starting next fall.', start: 5, end: 30, actions: ['Request transcripts', 'Visit the info session on the 14th', 'Draft the personal statement'] },
      { title: 'Found a nonprofit that serves families like mine', description: 'Housing stability plus mentoring, under one roof.', start: 2, end: 10, actions: ['Write the mission statement in one sentence', 'Have coffee with the director of Bright Futures'] },
    ],
  },
  {
    name: 'Hana Sato', email: 'hana@dreamcoach.demo', coach: 'daniel@dreamcoach.demo',
    about: 'Property Manager · 4 years', engagement: 'moderate', joinedMonthsAgo: 8,
    care: { contribution: [7, 8], alignment: [6, 7], relationships: [5, 7], energy: [4, 6] }, commitment: [7, 8], satisfaction: [6, 8],
    dreams: [
      { title: 'Take a real two-week vacation', description: 'Fully offline. Someone else handles the property.', start: 5, end: 65, actions: ['Train Luis to cover emergency calls', 'Request the time off for September', 'Write the coverage handbook'] },
      { title: 'Paint again — one canvas a month', description: 'Oils, the way I did in college.', start: 10, end: 80, actions: ['Set up the spare room as a studio corner', 'Paint on the first Sunday of the month'] },
      { title: 'Become a regional manager', description: 'Oversee a portfolio of sites and mentor new managers.', start: 10, end: 35, actions: ['Ask Jordan for feedback on my readiness', 'Lead the budgeting workshop for new PMs'] },
      { title: 'Build a cabin with my partner', description: 'Small, off-grid, near the lake where we met.', start: 0, end: 10, actions: ['Start a shared “cabin” savings account'] },
    ],
  },
  {
    name: 'Victor Alvarez', email: 'victor@dreamcoach.demo', coach: 'daniel@dreamcoach.demo',
    about: 'Groundskeeper · 9 years', engagement: 'light', joinedMonthsAgo: 8, status: 'paused', missedMonths: [1, 0],
    care: { contribution: [5, 6], alignment: [6, 6], relationships: [7, 7], energy: [6, 5] }, commitment: [6, 6], satisfaction: [5, 6],
    dreams: [
      { title: 'Get my commercial driver’s license', description: 'Open up weekend work and a path to fleet maintenance.', start: 10, end: 40, actions: ['Pick up the CDL study manual', 'Schedule the permit test'] },
      { title: 'Coach my son’s soccer team', description: 'Every Saturday this season.', start: 20, end: 70, actions: ['Sign up as assistant coach', 'Run one practice on my own'] },
      { title: 'Pay off the truck', description: 'Zero balance by year three.', start: 15, end: 30, actions: ['Add $100 to the payment each month'] },
      { title: 'Retire to a small ranch', description: 'A few acres, a couple of horses, grandkids visiting.', start: 0, end: 4, actions: ['Talk with Maria about where'] },
    ],
  },
  {
    name: 'Grace Oyelaran', email: 'grace@dreamcoach.demo', coach: 'priya@dreamcoach.demo',
    about: 'HR Generalist · 2 years', engagement: 'high', joinedMonthsAgo: 8,
    care: { contribution: [6, 8], alignment: [5, 8], relationships: [6, 8], energy: [6, 7] }, commitment: [7, 9], satisfaction: [5, 8],
    dreams: [
      { title: 'Earn the SHRM-CP credential', description: 'Certified by the fall testing window.', start: 20, end: 85, actions: ['Register for the September exam window', 'Finish the employment law module', 'Take a full practice exam'] },
      { title: 'Host a monthly dinner for friends', description: 'Eight people, one long table, no phones.', start: 10, end: 90, actions: ['Send the first invitation', 'Learn jollof the way my mother makes it'] },
      { title: 'Lead people operations at a mission-driven organization', description: 'Shape how a whole organization treats its people.', start: 10, end: 30, actions: ['Ask to sit in on the leadership team’s planning day', 'Find a mentor in people operations'] },
      { title: 'Write a book about belonging at work', description: 'Essays, stories, and a little research.', start: 2, end: 12, actions: ['Write 300 words every Saturday morning', 'Outline five chapters'] },
    ],
  },
  {
    name: 'Theo Lindqvist', email: 'theo@dreamcoach.demo', coach: 'priya@dreamcoach.demo',
    about: 'IT Support Specialist · 3 years', engagement: 'light', joinedMonthsAgo: 8, missedMonths: [4, 0],
    care: { contribution: [6, 7], alignment: [5, 6], relationships: [4, 6], energy: [5, 6] }, commitment: [6, 7], satisfaction: [5, 7],
    dreams: [
      { title: 'Earn the Network+ certification', description: 'Then Security+ next year.', start: 30, end: 80, actions: ['Book the exam for July', 'Do one practice lab each weekend'] },
      { title: 'Climb outdoors once a month', description: 'Trade the gym wall for real rock.', start: 10, end: 60, actions: ['Join the Saturday outdoor meetup', 'Buy a used rope and quickdraws'] },
      { title: 'Move into cybersecurity', description: 'An analyst role within three years.', start: 5, end: 20, actions: ['Set up a home lab', 'Ask Dana about shadowing the security team'] },
      { title: 'Sail across the Baltic', description: 'Stockholm to Helsinki, on a boat I helped crew.', start: 0, end: 5, actions: ['Take the basic keelboat course'] },
    ],
  },
  {
    name: 'Sam Whitaker', email: 'sam@dreamcoach.demo', coach: 'director@dreamcoach.demo',
    about: 'Facilities Supervisor · 7 years', engagement: 'moderate', joinedMonthsAgo: 8,
    care: { contribution: [6, 8], alignment: [6, 8], relationships: [6, 7], energy: [5, 7] }, commitment: [7, 9], satisfaction: [6, 8],
    dreams: [
      { title: 'Build a preventive maintenance program', description: 'Fewer emergencies, more planned work, across all sites.', start: 20, end: 70, actions: ['Inventory the HVAC units at Cedar Court', 'Draft the quarterly inspection checklist', 'Present the plan to the leadership team'] },
      { title: 'Walk 10,000 steps a day', description: 'Every day of the program.', start: 20, end: 85, actions: ['Walk the sites instead of driving between buildings', 'Evening walk with Dee after dinner'] },
      { title: 'Become Director of Facilities', description: 'Lead the whole facilities function.', start: 10, end: 35, actions: ['Enroll in the leadership certificate', 'Mentor two new supervisors'] },
      { title: 'Restore a 1968 Mustang with my daughter', description: 'Weekends in the garage, one part at a time.', start: 5, end: 15, actions: ['Find the car', 'Clear out the garage bay'] },
    ],
  },
];

/* ---------- text banks ---------- */
// The brief's Energy story for Darnell Price; kept out of the shared banks so nobody else writes it.
const ENERGY_STORY = {
  low: 'I haven’t been sleeping well this week. Work has been stressful, and I haven’t been exercising.',
  high: 'Getting back into my morning routine has made a big difference. I feel much more stable.',
};
const NOTES: Record<RatingCategory, { low: string[]; mid: string[]; high: string[] }> = {
  energy: {
    low: [
      'Running on fumes. Too many late nights and I skipped every workout.',
      'Allergies plus a rough stretch at work. I feel flat most afternoons.',
      'Tired in a way that sleep doesn’t fix. I think it’s the constant interruptions.',
      'Caught the cold that’s going around. Doing the minimum and resting.',
      'Back-to-back late shifts. My body is asking for a break.',
      'Skipped lunch most days this week and I can feel it.',
    ],
    mid: [
      'Decent week. Walked most mornings, though sleep is still inconsistent.',
      'Cut back on the late coffee, and the afternoons are easier.',
      'Up and down. Good energy early in the week, crashed by Thursday.',
      'Okay. Not great, not bad — I notice I feel best on the days I move.',
      'Steady. Not much in the tank on weekends, but the weekdays hold up.',
      'Getting to bed earlier most nights. Still a work in progress.',
    ],
    high: [
      'Sleeping seven hours most nights. Mornings feel like mine again.',
      'Strong week. Moved every day, early nights, and I actually felt rested.',
      'Energy is the best it has been all year. The routine is holding.',
      'Lots of energy this week — even had some left over for the evenings.',
      'Feeling strong. Walking to work instead of driving has made a difference.',
      'Woke up before the alarm three days in a row, feeling rested.',
    ],
  },
  contribution: {
    low: [
      'Feeling stuck professionally — same tasks, no stretch.',
      'I haven’t learned anything new in a while and I can feel it.',
      'Busy but not growing. The days blur together.',
      'Covering for two people at work. No room to grow right now.',
      'I keep putting off the course I signed up for.',
      'Not much stretch this month — mostly keeping things running.',
    ],
    mid: [
      'Picked up a new responsibility at work; a little nervous, mostly glad.',
      'Growing slowly. Finished a course module and it felt good.',
      'Some growth. I’m asking for more feedback than I used to.',
      'Learning a new system at work. Slow going, but it’s something.',
      'Helped a newer colleague find their feet. Felt useful.',
      'Read two articles in my field this week. Small, but I’m curious again.',
    ],
    high: [
      'I can feel myself growing — at work and in how I show up at home.',
      'Led something for the first time this month and it went well.',
      'Learning a lot right now. Stretching in good ways.',
      'My manager asked me to present our results. I said yes before I could talk myself out of it.',
      'Taught a colleague something I only learned last month. That’s how I know it stuck.',
      'Volunteered for the new project. Nervous and excited in equal parts.',
    ],
  },
  alignment: {
    low: [
      'My days don’t match what I say matters to me. That gap is loud right now.',
      'Going through the motions. Hard to connect what I do to any bigger purpose.',
      'Feeling pulled in directions that aren’t mine.',
      'Said yes to too many things again. None of them were really mine.',
      'I know what matters to me; I just haven’t been acting like it.',
      'Lost the thread this month. Need to remember why I started.',
    ],
    mid: [
      'Clearer on my values than I was, still working on living them daily.',
      'Mostly aligned. A couple of commitments I should let go of.',
      'Getting there. Saying no more often, which helps.',
      'Some days line up with what matters, some don’t. More good days lately.',
      'Thinking about what I want my weekends to be for.',
      'Made one decision this week purely on my values. It felt right.',
    ],
    high: [
      'The work and the dreams point the same direction right now. Rare and good.',
      'I know why I’m doing what I’m doing. That makes the hard parts easier.',
      'Living closer to my values than I have in years.',
      'Every big choice this month felt like mine.',
      'I feel like the same person at work and at home. That’s new.',
      'Clear on what matters, and my calendar finally shows it.',
    ],
  },
  relationships: {
    low: [
      'I’ve been isolating. Haven’t seen friends in weeks.',
      'Tension at home. We’re both tired and it shows.',
      'My space is a mess and it’s affecting how I feel in it.',
      'Missed two plans with friends this month. I miss them.',
      'Work has been eating my evenings, and home feels the strain.',
      'Feeling disconnected, even around people.',
    ],
    mid: [
      'Reconnected with an old friend. Want more of that.',
      'Home feels calmer. Still working on being present.',
      'Good with people, less good with my surroundings — the apartment needs attention.',
      'Had a long phone call with my cousin. Should do that more often.',
      'Fine with family, a bit distant from friends lately.',
      'Cleared the kitchen table so we can actually eat at it.',
    ],
    high: [
      'Full week of good conversations. I feel connected.',
      'Family dinners are back. It changes everything.',
      'Cleared out the spare room and it feels like a new place. Lighter.',
      'Hosted friends on Saturday. The house felt full in the best way.',
      'Really present with the people I love this week.',
      'The neighbors invited us over. Feels like we belong here.',
    ],
  },
  commitment: {
    low: ['Hard to stay committed when everything else is on fire.'],
    mid: ['Still in it, but I need to re-find the why.'],
    high: ['All in. This matters to me more than I expected.'],
  },
  satisfaction: {
    low: ['Progress feels slow. Trying to be patient with myself.'],
    mid: ['Satisfied with the direction, want more pace.'],
    high: ['Genuinely proud of how far this has come.'],
  },
};

const REFLECTIONS_SHARED = [
  'Noticed today that I don’t dread Mondays anymore. Not sure when that changed.',
  'A resident told me I made her week. Carrying that around with me.',
  'Small wins count. I kept the morning routine for five days straight.',
  'Big realization in the car: I keep waiting for permission. Nobody is going to give it to me.',
  'Tried the thing I was afraid of. It was fine. It was actually fine.',
  'Reread my dreams this morning. Still want them. Good sign.',
  'Rough week, but I kept one promise to myself, and that feels like enough.',
  'Talked about the dream out loud at dinner. Saying it made it feel real.',
  'I am learning to let the plan change without letting the dream change.',
  'Grateful for the people who ask how it’s going and actually wait for the answer.',
  'Said no to something today without over-explaining. Felt strange, then good.',
  'A quiet Sunday with nothing scheduled. I forgot how much I need those.',
  'Wrote down three things that went right this week. The third took a while, but I found it.',
  'Someone at work asked me for advice. I didn’t realize people saw me that way.',
  'I keep coming back to the same question: what would I do if I knew it would work?',
  'Took a walk at lunch instead of eating at my desk. Small, but the afternoon felt different.',
  'My coach asked what I’d tell a friend in my position. I’d be much kinder to them than I am to me.',
  'Finally cleared out my inbox. Felt like opening a window.',
  'Had a good laugh with the team today. I want to remember that work can feel like this.',
  'Not every week has to be a breakthrough. This one was just steady, and steady is good.',
  'I noticed I sleep better on the days I write things down.',
  'Caught myself planning the next step without being asked. That feels like ownership.',
  'Told a friend about one of my dreams. She didn’t laugh. She asked how she could help.',
  'Some days the dream feels close, some days far. Today it felt close.',
  'Spent the evening on something just for me. No guilt.',
  'I used to think rest was something I had to earn. Starting to question that.',
  'Asked for help with something I usually push through alone. It went better than I expected.',
  'Getting clearer on which dream matters most right now. The others can wait a little.',
];
const REFLECTIONS_PRIVATE = [
  'Had a hard conversation with my sister tonight. I don’t want to bring this to coaching yet, but I need to write it down.',
  'Honestly scared I’ll fail at this and everyone will know. Writing it so it stops circling.',
  'Money is tighter than I have let on. Need to think about what that means for the big dream.',
  'Cried in the car after work. Not about anything in particular. Just a lot.',
  'I think I want something different from what I said I wanted. Sitting with that before I say it out loud.',
  'Argument with my partner about time. We’re both right, which is the hard part.',
  'Doctor’s appointment next week. Trying not to spiral.',
  'I compare myself to my brother more than I admit. Writing it down so I can look at it.',
  'Some mornings I don’t want to do any of this. Today was one of them.',
  'Still upset about how my review went. Not ready to talk about it with anyone.',
  'Bad night. Old worries came back. I know they pass, but they’re loud right now.',
  'I feel guilty spending time on my own dreams when the family needs so much.',
  'Sometimes I wonder if I picked the safe dreams so I couldn’t fail at the big ones.',
  'Lonelier than I let on. Most people would never guess.',
];
const PRIVATE_NOTES = [
  'Part of this is the medication change — not ready to share that yet.',
  'The real reason is my mom’s health. Keeping that to myself for now.',
  'Didn’t mention it in the session, but I’ve been anxious about money again.',
  'Not sharing this one — I need to figure out how I feel first.',
  'Honestly, it’s the situation at home. That stays here for now.',
  'I haven’t told anyone I’m thinking about leaving my job.',
  'Some of this is grief. The anniversary is coming up.',
  'Keeping this between me and the page: I’m not sure I want the promotion.',
  'The part I left out: I’ve been skipping meals when work gets busy.',
];
const PROGRESS_NOTES = {
  small: [
    'Small step, but a real one.',
    'Slower than I hoped, but moving.',
    'A little further along.',
    'Not much, but not nothing.',
    'Inching forward — that counts.',
    'One small thing done this week.',
  ],
  big: [
    'Momentum is back.',
    'Did the thing I said I would do.',
    'Good week for this one.',
    'A real jump — felt great to update this.',
    'Put real time into this one this week.',
    'Further along than I expected by now.',
  ],
};
const PRIVATE_ACTIONS = [
  'Make the therapy appointment I keep putting off',
  'Tell my partner about the job I applied for',
  'Look at the budget honestly — all of it',
  'Call Dad',
  'Write the apology letter, even if I never send it',
  'Book a check-up — it’s been three years',
  'Ask my sister how she’s really doing',
  'Cancel the subscriptions I don’t use',
  'Write down what I actually want from the next five years',
];
const CARE_ACTIONS: Record<CareCategory, string[]> = {
  energy: ['Lights out by 10:30 on weeknights', 'Walk 20 minutes at lunch', 'No coffee after 2pm', 'Stretch for ten minutes before bed'],
  contribution: ['Ask my manager for one stretch assignment', 'Finish one chapter of the course', 'Teach someone something I know'],
  alignment: ['Write my top three values on a card for my desk', 'Say no to one thing that isn’t mine this week', 'Ten quiet minutes each morning'],
  relationships: ['Text one friend I’ve lost touch with', 'Clear one surface at home every evening', 'Plan one phone-free dinner'],
};

// Session notes in the coach's voice. The opener matches the mood of the session's ratings; a CARE rating that
// moved two or more points is described by its direction and by where it landed.
const OPENERS: Record<'first' | 'up' | 'steady' | 'down' | 'tired', string[]> = {
  first: ['First session — got to know each other and set starting points.', 'First conversation: the four dreams, the CARE wheel, and how we’ll work together.'],
  up: ['In good spirits today.', 'Upbeat and ready to go.', 'Came in smiling — a good month.', 'Lots to share today, most of it good news.'],
  steady: ['Arrived a little rushed but settled quickly.', 'A steady month; came in with a clear list.', 'Calm and focused today.', 'Easy conversation; picked up right where we left off.'],
  down: ['Reflective mood; wanted to talk before rating.', 'A heavier month — we took our time.', 'Quiet at first, opened up around the dreams.'],
  tired: ['Tired but engaged — a long week.', 'Low on energy today; we kept the pace gentle.', 'Worn out from a busy stretch, still showed up ready to talk.'],
};
const CARE_MOVES: Record<CareCategory, Record<'upHigh' | 'up' | 'down' | 'downLow', string[]>> = {
  energy: {
    upHigh: ['sleeping better, and the morning routine is back.', 'more rest and regular movement are paying off.', 'early nights most of the month; feeling rested.'],
    up: ['recovering after a draining stretch; sleep still uneven.', 'a little more rest this month, still running low by Friday.', 'cut back on late coffee and the afternoons are easier.'],
    down: ['a busier month, still in a reasonable place.', 'dipped with the schedule changes; the routine is mostly intact.', 'a bit flatter than last month; sleep slipped during the busy weeks.'],
    downLow: ['a draining month: short nights and a heavy workload. We kept the plan light.', 'running low; constant interruptions at work are taking a toll.', 'tired in a way sleep doesn’t fix. Agreed to protect one quiet evening a week.'],
  },
  contribution: {
    upHigh: ['led something new at work and it went well.', 'learning a lot right now, stretching in good ways.', 'asked for more responsibility and got it.'],
    up: ['picked up a new responsibility — a little nervous, mostly glad.', 'finished a course module; growth feels possible again.', 'asking for feedback more often.'],
    down: ['a maintenance month at work, less stretch than before.', 'growth on hold while covering for a colleague.', 'fewer new challenges this month; that’s okay for now.'],
    downLow: ['feeling stuck — same tasks, no stretch.', 'busy but not growing; the days blur together.', 'no room to learn anything new lately.'],
  },
  alignment: {
    upHigh: ['work and dreams point the same direction right now.', 'clear on the why, which makes the hard parts easier.', 'saying no more often, and it shows.'],
    up: ['clearer on values, still working on living them daily.', 'let go of one commitment that didn’t fit.', 'getting closer to what matters, one choice at a time.'],
    down: ['a few extra commitments crept back in.', 'the big picture got crowded out this month.', 'still aligned overall; the schedule got in the way.'],
    downLow: ['days don’t match what matters right now, and that gap feels loud.', 'going through the motions; hard to connect the work to a bigger purpose.', 'pulled in other people’s directions this month.'],
  },
  relationships: {
    upHigh: ['a month of good conversations; feeling connected.', 'family dinners are back, and it shows.', 'cleared out the spare room — home feels lighter.'],
    up: ['reconnected with an old friend and wants more of that.', 'home feels calmer; still working on being present.', 'reaching out to people a little more.'],
    down: ['less time with friends during a busy month.', 'some friction at home; talking it through.', 'a quieter month socially.'],
    downLow: ['has been isolating; hasn’t seen friends in weeks.', 'tension at home — everyone is tired.', 'the living space is cluttered and it’s weighing on things.'],
  },
};
// Focus for the coming month: a CARE area that slipped or sits low, otherwise the dream the new actions serve.
const CARE_FOCUS: Record<CareCategory, string[]> = {
  energy: ['Energy — rebuild the morning routine', 'Energy — protect sleep on weeknights'],
  contribution: ['Contribution — ask for the stretch', 'Contribution — make room to learn something new'],
  alignment: ['Alignment — say no to what doesn’t fit', 'Alignment — let the week reflect what matters'],
  relationships: ['Relationships — reconnect with people who matter', 'Relationships — make home a calmer place'],
};
const DREAM_FOCUS = {
  early: ['gather information before deciding', 'sketch the first small step'],
  middle: ['the next concrete step', 'make room in the week for it'],
  late: ['plan the last stretch', 'protect what’s working'],
  done: ['celebrate, then decide what comes next'],
};

// How each dream horizon moves from session to session: nearer dreams most months, the 3–5 year and lifetime
// dreams in small, occasional steps. Only the nearer-term dreams take the odd honest dip.
const DREAM_PACE = [
  { move: 0.85, wobble: 3, dip: 0.08 }, // 6–12 month dream
  { move: 0.9, wobble: 3, dip: 0 }, // program dream
  { move: 0.55, wobble: 2, dip: 0.05 }, // 3–5 year dream
  { move: 0.35, wobble: 1, dip: 0 }, // lifetime dream
];

/** A monthly one-on-one, planned before anything is written so the activity between sessions can lead into the next. */
interface PlannedSession {
  m: number; // months ago
  start: number;
  end: number;
  held: boolean; // false for a session still to come
  ratings: Record<RatingCategory, number>;
  progress: number[];
}

// Guaranteed privacy examples for the main demo dreamers — a private action, a private reflection, a private
// Alignment rating with a note, and a shared Energy rating whose note is private — 4–10 days ago so they are
// easy to find. Times are [days ago, hour, minute] (UTC).
type When = [number, number, number];
const PRIVACY_EXAMPLES: Record<string, { action: string; actionDetails: string; reflection: string; alignmentNote: string; energyNote: string; times: { action: When; reflection: When; checkIn: When } }> = {
  'alicia@dreamcoach.demo': {
    action: 'Ask HR about tuition reimbursement before I tell anyone',
    actionDetails: 'If the answer is no, I want time to work out the next step on my own.',
    reflection: 'Mom asked again when I’ll “finally” finish my degree. I laughed it off, but it stung. I want to finish it for me, not to end that conversation.',
    alignmentNote: 'Picked up two extra weekend shifts for the money, and the garden plan slid again. That isn’t a trade I want to keep making.',
    energyNote: 'Long run on Saturday felt good. What I didn’t say in the session: I’m only sleeping five hours on shift weeks.',
    times: { action: [9, 21, 5], reflection: [7, 22, 40], checkIn: [4, 7, 20] },
  },
  'darnell@dreamcoach.demo': {
    action: 'Book the physical I keep pushing back',
    actionDetails: 'Haven’t told Keisha that the pharmacy machine read my blood pressure high.',
    reflection: 'Some nights I wonder if the mentoring program is me trying to give those kids what nobody gave me. Maybe that’s a fine reason. I just want to be honest about it.',
    alignmentNote: 'Said yes to the church board because I couldn’t say no to Pastor James. It takes the evenings I promised the boys.',
    energyNote: 'Morning walks are holding. Not ready to say this out loud yet: the new blood-pressure pills leave me foggy until noon.',
    times: { action: [10, 19, 30], reflection: [5, 23, 10], checkIn: [6, 6, 45] },
  },
  'grace@dreamcoach.demo': {
    action: 'Update my résumé for the People Ops role at Fernhill Collective',
    actionDetails: 'Not ready for anyone at work to know I’m looking.',
    reflection: 'Got passed over for the HR business partner role and smiled through the team announcement. I’m not fine about it yet. Writing it here so I can be honest somewhere.',
    alignmentNote: 'Spent the week defending a leave policy I don’t believe in. Repeating the company line is costing me something.',
    energyNote: 'Planning the next dinner gave me a lift this week. Also: I started seeing a therapist on Thursdays, and that’s mine for now.',
    times: { action: [8, 12, 50], reflection: [6, 20, 55], checkIn: [5, 21, 5] },
  },
};

/* ---------- insert helpers ---------- */
function insertUser(db: DB, p: Person, role: 'dreamer' | 'coach' | 'director', hash: string): number {
  const r = db.prepare('INSERT INTO users (email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?)').run(p.email, hash, p.name, role, at(monthStartUTC(9)));
  return Number(r.lastInsertRowid);
}

export interface SeedSummary { users: number; dreamers: number; sessions: number; ratings: number; progress: number; journal: number; actions: number; checkIns: number; private: number }

export function resetAndSeed(db: DB): SeedSummary {
  rnd = mulberry32(20260216);
  db.exec(`
    DELETE FROM journal_entries; DELETE FROM actions; DELETE FROM ratings; DELETE FROM dream_progress;
    DELETE FROM check_ins; DELETE FROM coaching_sessions; DELETE FROM dreams; DELETE FROM dreamers;
    DELETE FROM auth_sessions; DELETE FROM login_attempts; DELETE FROM users; DELETE FROM programs;
  `);
  const hash = hashPassword(DEMO_PASSWORD);
  const seed = db.transaction(() => {
    const programStart = monthStartUTC(8);
    const programEnd = addDays(new Date(Date.UTC(programStart.getUTCFullYear(), programStart.getUTCMonth() + 10, 1)), -1);
    const programId = Number(
      db
        .prepare('INSERT INTO programs (name, description, slot_labels, slot_guidance, starts_on, ends_on) VALUES (?, ?, ?, ?, ?, ?)')
        .run(
          `Employee Dream Series ${programStart.getUTCFullYear()}`,
          'A ten-month Dream Coaching program for employees: monthly one-on-ones, four dreams, and the CARE framework.',
          JSON.stringify(['6–12 month dream', 'Program dream', '3–5 year dream', 'Lifetime dream']),
          JSON.stringify([
            'A dream you hope to accomplish in roughly 6–12 months.',
            'A dream you intend to live out during the 10-month program.',
            'A larger dream on a 3–5 year horizon.',
            'A significant lifetime dream.',
          ]),
          isoDate(programStart),
          isoDate(programEnd),
        ).lastInsertRowid,
    );

    const directorId = insertUser(db, DIRECTOR, 'director', hash);
    const coachIds = new Map<string, number>();
    coachIds.set(DIRECTOR.email, directorId);
    for (const c of COACHES) coachIds.set(c.email, insertUser(db, c, 'coach', hash));

    const counts: SeedSummary = { users: 1 + COACHES.length, dreamers: 0, sessions: 0, ratings: 0, progress: 0, journal: 0, actions: 0, checkIns: 0, private: 0 };

    const insRating = db.prepare(
      `INSERT INTO ratings (dreamer_id, category, value, occurred_at, source, session_id, check_in_id, recorded_by, is_private, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insProgress = db.prepare(
      `INSERT INTO dream_progress (dreamer_id, dream_id, value, occurred_at, source, session_id, check_in_id, recorded_by, is_private, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insJournal = db.prepare(
      `INSERT INTO journal_entries (dreamer_id, body, occurred_at, is_private, source, session_id, check_in_id, rating_id, progress_id, dream_id, category, author_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insAction = db.prepare(
      `INSERT INTO actions (dreamer_id, title, details, status, dream_id, category, is_private, created_by, session_id, created_at, completed_at, archived_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const coachCalendars = new Map<number, [number, number][]>(); // booked [start, end] per coach

    for (const spec of DREAMERS) {
      const userId = insertUser(db, { name: spec.name, email: spec.email }, 'dreamer', hash);
      counts.users++;
      const coachUserId = coachIds.get(spec.coach)!;
      const joined = monthStartUTC(spec.joinedMonthsAgo);
      const dreamerId = Number(
        db
          .prepare('INSERT INTO dreamers (user_id, coach_user_id, program_id, status, joined_on, about) VALUES (?, ?, ?, ?, ?, ?)')
          .run(userId, coachUserId, programId, spec.status ?? 'active', isoDate(addDays(joined, 2)), spec.about).lastInsertRowid,
      );
      counts.dreamers++;
      const dreamIds: number[] = [];
      spec.dreams.forEach((d, i) => {
        const r = db
          .prepare('INSERT INTO dreams (dreamer_id, slot, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(dreamerId, i + 1, d.title, d.description, at(addDays(joined, 3)), at(addDays(joined, 3)));
        dreamIds.push(Number(r.lastInsertRowid));
      });

      // ---- plan the monthly sessions (dates and values) before writing anything ----
      const sessionMonths: number[] = [];
      for (let m = spec.joinedMonthsAgo; m >= 0; m--) {
        if (spec.missedMonths?.includes(m)) continue;
        sessionMonths.push(m);
      }
      const calendar = coachCalendars.get(coachUserId) ?? [];
      coachCalendars.set(coachUserId, calendar);
      const plan: PlannedSession[] = [];
      const planSession = (m: number, upcoming: boolean): PlannedSession => {
        const prev = plan[plan.length - 1];
        const monthStart = monthStartUTC(m);
        // session day: 3rd–20th, starting 14:00–19:45 for 15–30 minutes, clear of the coach's other sessions
        let day: number, start: number, end: number;
        do {
          day = 3 + Math.floor(rand() * 17);
          start = Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), day, 14 + Math.floor(rand() * 6), pick([0, 15, 30, 45]));
          end = start + (15 + Math.floor(rand() * 15)) * 60000;
        } while (calendar.some(([a, b]) => start < b + 15 * 60000 && a < end + 15 * 60000));
        // in the current month only if that day has already passed
        const held = !upcoming && Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), day) <= NOW.getTime() - DAY;
        if (held) calendar.push([start, end]);
        const progressT = Math.min(1, (spec.joinedMonthsAgo - m) / Math.max(1, spec.joinedMonthsAgo)); // 0..1

        // CARE + program ratings
        const ratings = {} as Record<RatingCategory, number>;
        for (const cat of CARE_CATEGORIES) {
          const [s, e] = spec.care[cat];
          let v = Math.round(s + (e - s) * progressT + jitter(1));
          // Darnell's energy story: a dip two months ago, back to 8 by the next session.
          if (spec.email === 'darnell@dreamcoach.demo' && cat === 'energy' && m === 2) v = 4;
          if (spec.email === 'darnell@dreamcoach.demo' && cat === 'energy' && m === 1) v = 8;
          ratings[cat] = clamp(v, 1, 10);
        }
        const [cs, ce] = spec.commitment;
        ratings.commitment = clamp(Math.round(cs + (ce - cs) * progressT + jitter(0.6)), 1, 10);
        const [ss, se] = spec.satisfaction;
        ratings.satisfaction = clamp(Math.round(ss + (se - ss) * progressT + jitter(0.6)), 1, 10);

        // Dream progress: catches up with the planned path at each dream's own pace, never sliding back
        // except for the odd honest dip (never two in a row).
        const progress = spec.dreams.map((d, i) => {
          const pace = DREAM_PACE[i]!;
          const was = prev?.progress[i];
          const dipped = was != null && was < (plan[plan.length - 2]?.progress[i] ?? 0);
          let v: number;
          if (was == null) v = d.start;
          else if (!dipped && chance(pace.dip)) v = was - (2 + Math.floor(rand() * 3));
          else if (chance(pace.move)) v = Math.max(was, Math.round(d.start + (d.end - d.start) * progressT + jitter(pace.wobble)));
          else v = was;
          if (d.end >= 100 && progressT >= 0.85) v = 100;
          return clamp(v, 0, 100);
        });
        return { m, start, end, held, ratings, progress };
      };
      for (const m of sessionMonths) {
        plan.push(planSession(m, false));
        if (!plan[plan.length - 1]!.held) break; // this month's session has not happened yet
      }
      // After the latest session, self activity leans toward where next month's session would land.
      const latest = plan[plan.length - 1]!;
      if (latest.held) plan.push(planSession(latest.m - 1, true));
      // A planned value on the way from session k to the next one, for the self activity in between.
      const along = (k: number, t: number, read: (s: PlannedSession) => number): number => {
        const a = plan[k]!;
        const b = plan[k + 1];
        if (!b) return read(a);
        const until = b.held ? b.start : Math.max(b.start, NOW.getTime());
        return lerp(read(a), read(b), clamp((t - a.end) / (until - a.end), 0, 1));
      };

      // ---- monthly sessions ----
      const lastProgress = [...plan[0]!.progress]; // latest recorded value per dream, session or self
      const dreamActionIdx = spec.dreams.map(() => 0);
      const openActions: { id: number; createdAt: string }[] = [];
      const used = new Set<string>(); // texts and titles this dreamer already has

      for (let k = 0; k < plan.length && plan[k]!.held; k++) {
        const p = plan[k]!;
        const prev = plan[k - 1];
        const next = plan[k + 1];
        const occurredAt = new Date(p.start).toISOString();
        const completedAt = new Date(p.end).toISOString();

        const sessionId = Number(
          db
            .prepare(`INSERT INTO coaching_sessions (dreamer_id, coach_user_id, status, occurred_at, completed_at, notes, focus, created_at, updated_at) VALUES (?, ?, 'completed', ?, ?, '', '', ?, ?)`)
            .run(dreamerId, coachUserId, occurredAt, completedAt, occurredAt, completedAt).lastInsertRowid,
        );
        counts.sessions++;
        for (const [cat, v] of Object.entries(p.ratings) as [RatingCategory, number][]) {
          insRating.run(dreamerId, cat, v, occurredAt, 'session', sessionId, null, coachUserId, 0, occurredAt, completedAt);
          counts.ratings++;
        }
        p.progress.forEach((v, i) => {
          insProgress.run(dreamerId, dreamIds[i], v, occurredAt, 'session', sessionId, null, coachUserId, 0, occurredAt, completedAt);
          counts.progress++;
          lastProgress[i] = v;
          if (v >= 100) db.prepare('UPDATE dreams SET achieved_at = COALESCE(achieved_at, ?) WHERE id = ?').run(occurredAt, dreamIds[i]);
        });

        // Coach notes: an opener that fits the ratings, the CARE moves, and the dream that moved most.
        const careShift = prev ? CARE_CATEGORIES.reduce((n, c) => n + p.ratings[c] - prev.ratings[c], 0) / CARE_CATEGORIES.length : 0;
        const mood = !prev ? 'first' : p.ratings.energy <= 4 ? 'tired' : careShift >= 0.75 ? 'up' : careShift <= -0.75 ? 'down' : 'steady';
        const lines: string[] = [pickUnused(OPENERS[mood], used) ?? pick(OPENERS[mood])];
        for (const cat of CARE_CATEGORIES) {
          const v = p.ratings[cat];
          const was = prev?.ratings[cat];
          if (was == null || Math.abs(v - was) < 2) continue;
          const moves = CARE_MOVES[cat][v > was ? (v >= 7 ? 'upHigh' : 'up') : v <= 4 ? 'downLow' : 'down'];
          lines.push(`${cat[0]!.toUpperCase()}${cat.slice(1)} ${v > was ? 'up' : 'down'} to ${v} (from ${was}) — ${pickUnused(moves, used) ?? pick(moves)}`);
        }
        if (prev) {
          const moved = p.progress.map((v, i) => ({ i, v, by: v - prev.progress[i]! })).sort((a, b) => b.by - a.by)[0]!;
          if (moved.by >= 3) lines.push(`Most movement on “${spec.dreams[moved.i]!.title}” — up ${moved.by} points to ${moved.v}%.`);
        }

        // Review previous actions: complete / archive some
        for (const a of [...openActions]) {
          const roll = rand();
          if (roll < 0.55) {
            const doneAt = new Date(new Date(a.createdAt).getTime() + (3 + rand() * 25) * DAY);
            const finalDone = doneAt.getTime() > p.start ? occurredAt : doneAt.toISOString();
            db.prepare(`UPDATE actions SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?`).run(finalDone, finalDone, a.id);
            openActions.splice(openActions.indexOf(a), 1);
          } else if (roll < 0.7) {
            db.prepare(`UPDATE actions SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?`).run(occurredAt, occurredAt, a.id);
            openActions.splice(openActions.indexOf(a), 1);
          }
        }

        // New actions chosen in this session (1–3), tied to dreams or CARE. A CARE area that slipped two points
        // or sits at 4 or below becomes the focus, and the first action is a habit for it.
        const drop = (c: CareCategory) => (prev ? prev.ratings[c] - p.ratings[c] : 0);
        const slipped = CARE_CATEGORIES.filter((c) => drop(c) >= 2 || p.ratings[c] <= 4).sort((a, b) => drop(b) - drop(a) || p.ratings[a] - p.ratings[b])[0];
        const nActions = 1 + Math.floor(rand() * 3);
        const chosen: string[] = [];
        let focusDream: number | null = null;
        let focusCare: CareCategory | null = slipped ?? null;
        for (let n = 0; n < nActions; n++) {
          const forSlipped = n === 0 && !!slipped && CARE_ACTIONS[slipped].some((t) => !used.has(t));
          if (!forSlipped && chance(0.7)) {
            const di = pick([0, 0, 1, 1, 2, 3]);
            const list = spec.dreams[di]!.actions;
            if (dreamActionIdx[di]! < list.length) {
              const title = list[dreamActionIdx[di]!]!;
              dreamActionIdx[di]!++;
              const r = insAction.run(dreamerId, title, '', 'active', dreamIds[di], null, 0, coachUserId, sessionId, completedAt, null, null, completedAt);
              openActions.push({ id: Number(r.lastInsertRowid), createdAt: completedAt });
              chosen.push(title);
              counts.actions++;
              focusDream ??= di;
              continue;
            }
          }
          const cat = forSlipped ? slipped : pick(CARE_CATEGORIES);
          const title = pickUnused(CARE_ACTIONS[cat], used);
          if (!title) continue;
          const r = insAction.run(dreamerId, title, '', 'active', null, cat, 0, coachUserId, sessionId, completedAt, null, null, completedAt);
          openActions.push({ id: Number(r.lastInsertRowid), createdAt: completedAt });
          chosen.push(title);
          counts.actions++;
          if (focusDream == null) focusCare ??= cat;
        }
        let focus: string;
        if (focusDream != null && !slipped) {
          const v = p.progress[focusDream]!;
          const stage = DREAM_FOCUS[v >= 100 ? 'done' : v >= 65 ? 'late' : v >= 15 ? 'middle' : 'early'];
          focus = `${spec.dreams[focusDream]!.title} — ${pickUnused(stage, used) ?? pick(stage)}`;
        } else {
          const cat = focusCare ?? [...CARE_CATEGORIES].sort((a, b) => p.ratings[a] - p.ratings[b])[0]!;
          focus = pickUnused(CARE_FOCUS[cat], used) ?? pick(CARE_FOCUS[cat]);
        }
        if (chosen.length) lines.push(`Actions chosen: ${chosen.join('; ')}.`);
        lines.push(`Commitment ${p.ratings.commitment}, satisfaction ${p.ratings.satisfaction}.`);
        db.prepare('UPDATE coaching_sessions SET notes = ?, focus = ? WHERE id = ?').run(lines.join('\n'), focus, sessionId);

        // ---- between-session self activity: until the next session (or now), tailing off 20 days into next month ----
        const windowStart = p.end;
        const windowEnd = Math.min(next?.held ? next.start : NOW.getTime(), monthStartUTC(p.m - 1).getTime() + 20 * DAY) - HOUR;
        const span = windowEnd - windowStart;
        // Check-ins spread through the window (weekly for the most engaged), each a day clear of either session.
        const perMonth = spec.engagement === 'high' ? 4 : spec.engagement === 'moderate' ? 1.5 : 0.3;
        let nCheckIns = span > 2 * DAY ? Math.floor((perMonth * span) / (30 * DAY) + rand()) : 0;
        const story = spec.email === 'darnell@dreamcoach.demo' && p.m === 2;
        if (story) nCheckIns = Math.max(nCheckIns, 2);
        for (let idx = 0; idx < nCheckIns; idx++) {
          const t = windowStart + DAY + (span - 2 * DAY) * ((idx + 0.2 + rand() * 0.6) / nCheckIns);
          const when = at(new Date(t), 12 + Math.floor(rand() * 10), pick([0, 10, 20, 30, 40, 50]));
          const tWhen = new Date(when).getTime();
          const ciId = Number(db.prepare('INSERT INTO check_ins (dreamer_id, occurred_at, created_by, created_at) VALUES (?, ?, ?, ?)').run(dreamerId, when, userId, when).lastInsertRowid);
          counts.checkIns++;
          // Which categories? 1–3 of them
          let cats: RatingCategory[] = CARE_CATEGORIES.filter(() => chance(0.45));
          if (!cats.length) cats = [pick(CARE_CATEGORIES)];
          // Darnell's story: Energy 4 in the first check-in after August's session, 8 by the last one.
          let scripted: { cat: RatingCategory; value: number; note: string } | null = null;
          if (story && idx === 0) scripted = { cat: 'energy', value: 4, note: ENERGY_STORY.low };
          if (story && idx === nCheckIns - 1) scripted = { cat: 'energy', value: 8, note: ENERGY_STORY.high };
          if (scripted) cats = [scripted.cat, ...cats.filter((c) => c !== scripted!.cat)].slice(0, 2);
          for (const cat of cats) {
            // Self ratings travel from this session's value toward the next one, with the odd one-point wobble.
            let v = clamp(Math.round(along(k, tWhen, (s) => s.ratings[cat])) + (chance(0.2) ? jitter(1) : 0), 1, 10);
            let noteText: string | null = null;
            let ratingPrivate = false;
            let notePrivate = false;
            if (scripted && cat === scripted.cat) { v = scripted.value; noteText = scripted.note; }
            else {
              if (chance(0.6)) noteText = pickUnused(NOTES[cat][v <= 4 ? 'low' : v <= 7 ? 'mid' : 'high'], used);
              ratingPrivate = chance(0.12);
              notePrivate = !ratingPrivate && !!noteText && chance(0.2);
              const aside = notePrivate ? pickUnused(PRIVATE_NOTES, used) : null;
              if (aside) noteText = `${noteText} ${aside}`;
            }
            const rr = insRating.run(dreamerId, cat, v, when, 'self', null, ciId, userId, ratingPrivate ? 1 : 0, when, when);
            counts.ratings++;
            if (ratingPrivate) counts.private++;
            if (noteText) {
              insJournal.run(dreamerId, noteText, when, notePrivate ? 1 : 0, 'self', null, ciId, Number(rr.lastInsertRowid), null, null, cat, userId, when, when);
              counts.journal++;
              if (notePrivate) counts.private++;
            }
          }
          // Occasionally a self progress update, for a dream that has moved on since its last entry
          if (chance(0.3)) {
            const movedOn = [0, 1, 1, 2].filter((i) => Math.round(along(k, tWhen, (s) => s.progress[i]!)) > lastProgress[i]!);
            if (movedOn.length) {
              const di = pick(movedOn);
              const v = Math.round(along(k, tWhen, (s) => s.progress[di]!));
              const step = v - lastProgress[di]!;
              lastProgress[di] = v;
              const isPriv = chance(0.15);
              const pr = insProgress.run(dreamerId, dreamIds[di], v, when, 'self', null, ciId, userId, isPriv ? 1 : 0, when, when);
              counts.progress++;
              if (isPriv) counts.private++;
              const note = chance(0.5) ? pickUnused(step >= 5 ? PROGRESS_NOTES.big : PROGRESS_NOTES.small, used) : null;
              if (note) {
                insJournal.run(dreamerId, note, when, 0, 'self', null, ciId, null, Number(pr.lastInsertRowid), dreamIds[di], null, userId, when, when);
                counts.journal++;
              }
              if (v >= 100 && !isPriv) db.prepare('UPDATE dreams SET achieved_at = COALESCE(achieved_at, ?) WHERE id = ?').run(when, dreamIds[di]);
            }
          }
          // Check-in level reflection
          if (chance(spec.engagement === 'high' ? 0.5 : 0.3)) {
            const priv = chance(0.3);
            const body = pickUnused(priv ? REFLECTIONS_PRIVATE : REFLECTIONS_SHARED, used);
            if (body) {
              insJournal.run(dreamerId, body, when, priv ? 1 : 0, 'self', null, ciId, null, null, null, null, userId, when, when);
              counts.journal++;
              if (priv) counts.private++;
            }
          }
        }

        // Standalone journal entries & dreamer-created actions in this window
        const nJournal = spec.engagement === 'high' ? 2 : spec.engagement === 'moderate' ? 1 : 0;
        for (let j = 0; j < nJournal && span > 0; j++) {
          const when = new Date(windowStart + rand() * span).toISOString();
          const priv = chance(0.35);
          const dreamTag = chance(0.3) ? dreamIds[Math.floor(rand() * 4)]! : null;
          const body = pickUnused(priv ? REFLECTIONS_PRIVATE : REFLECTIONS_SHARED, used);
          if (!body) continue;
          insJournal.run(dreamerId, body, when, priv ? 1 : 0, 'self', null, null, null, null, dreamTag, null, userId, when, when);
          counts.journal++;
          if (priv) counts.private++;
        }
        if (spec.engagement !== 'light' && chance(0.6) && span > 0) {
          const t = windowStart + rand() * span;
          const when = new Date(t).toISOString();
          const priv = chance(0.35);
          const di = Math.floor(rand() * 4);
          const list = spec.dreams[di]!.actions;
          // A private action, the dream's next step, or — once those run out — a CARE habit linked to its area.
          let title: string | null;
          let dreamId: number | null = null;
          let category: CareCategory | null = null;
          if (priv) title = pickUnused(PRIVATE_ACTIONS, used);
          else if (dreamActionIdx[di]! < list.length) { title = list[dreamActionIdx[di]!]!; dreamActionIdx[di]!++; dreamId = dreamIds[di]!; }
          else { category = pick(CARE_CATEGORIES); title = pickUnused(CARE_ACTIONS[category], used); }
          if (title) {
            const done = chance(0.4);
            const doneAt = done ? new Date(t + (2 + rand() * 12) * DAY) : null;
            const doneIso = doneAt && doneAt.getTime() < NOW.getTime() ? doneAt.toISOString() : null;
            const r = insAction.run(dreamerId, title, '', doneIso ? 'completed' : 'active', dreamId, category, priv ? 1 : 0, userId, null, when, doneIso, null, doneIso ?? when);
            // Shared open actions come up for review at the next session; private ones are the dreamer's alone.
            if (!doneIso && !priv) openActions.push({ id: Number(r.lastInsertRowid), createdAt: when });
            counts.actions++;
            if (priv) counts.private++;
          }
        }
      }

      // ---- Guaranteed demo privacy examples, personal to each main demo dreamer ----
      const example = PRIVACY_EXAMPLES[spec.email];
      if (example) {
        const time = ([daysAgo, hour, minute]: When) => at(new Date(NOW.getTime() - daysAgo * DAY), hour, minute);
        const whenA = time(example.times.action);
        insAction.run(dreamerId, example.action, example.actionDetails, 'active', null, null, 1, userId, null, whenA, null, null, whenA);
        counts.actions++; counts.private++;
        const whenJ = time(example.times.reflection);
        insJournal.run(dreamerId, example.reflection, whenJ, 1, 'self', null, null, null, null, null, null, userId, whenJ, whenJ);
        counts.journal++; counts.private++;
        const whenC = time(example.times.checkIn);
        const tC = new Date(whenC).getTime();
        const ciId = Number(db.prepare('INSERT INTO check_ins (dreamer_id, occurred_at, created_by, created_at) VALUES (?, ?, ?, ?)').run(dreamerId, whenC, userId, whenC).lastInsertRowid);
        counts.checkIns++;
        // Values sit on the dreamer's path at that moment; the private Alignment rating is an honest dip below it.
        let k = 0;
        while (plan[k + 1]?.held && plan[k + 1]!.start <= tC) k++;
        // Private Alignment rating with a note.
        const pr = insRating.run(dreamerId, 'alignment', clamp(Math.round(along(k, tC, (s) => s.ratings.alignment)) - 2, 1, 10), whenC, 'self', null, ciId, userId, 1, whenC, whenC);
        insJournal.run(dreamerId, example.alignmentNote, whenC, 0, 'self', null, ciId, Number(pr.lastInsertRowid), null, null, 'alignment', userId, whenC, whenC);
        counts.ratings++; counts.journal++; counts.private++;
        // Shared Energy rating whose note is private.
        const sr = insRating.run(dreamerId, 'energy', clamp(Math.round(along(k, tC, (s) => s.ratings.energy)), 1, 10), whenC, 'self', null, ciId, userId, 0, whenC, whenC);
        insJournal.run(dreamerId, example.energyNote, whenC, 1, 'self', null, ciId, Number(sr.lastInsertRowid), null, null, 'energy', userId, whenC, whenC);
        counts.ratings++; counts.journal++; counts.private++;
      }
    }
    return counts;
  });
  return seed();
}

export function seedIfEmpty(db: DB): SeedSummary | null {
  const n = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  if (n > 0) return null;
  const summary = resetAndSeed(db);
  console.log('Seeded demo data:', summary);
  return summary;
}
