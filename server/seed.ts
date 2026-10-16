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

/* ---------- dates ---------- */
const NOW = new Date();
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
    about: 'Leasing Consultant · 1 year', engagement: 'light', joinedMonthsAgo: 8, missedMonths: [5, 2],
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
    about: 'IT Support Specialist · 3 years', engagement: 'light', joinedMonthsAgo: 8, missedMonths: [4],
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
const NOTES: Record<RatingCategory, { low: string[]; mid: string[]; high: string[] }> = {
  energy: {
    low: [
      'I haven’t been sleeping well this week. Work has been stressful, and I haven’t been exercising.',
      'Running on fumes. Too many late nights and I skipped every workout.',
      'Allergies plus a rough stretch at work. I feel flat most afternoons.',
      'Tired in a way that sleep doesn’t fix. I think it’s the constant interruptions.',
    ],
    mid: [
      'Decent week. Walked most mornings, though sleep is still inconsistent.',
      'Better than last month. Cut back on the late coffee and it shows.',
      'Up and down. Good energy early in the week, crashed by Thursday.',
      'Okay. Not great, not bad — I notice I feel best on the days I move.',
    ],
    high: [
      'Getting back into my morning routine has made a big difference. I feel much more stable.',
      'Sleeping seven hours most nights. Mornings feel like mine again.',
      'Strong week. Three runs, early nights, and I actually felt rested.',
      'Energy is the best it has been all year. The routine is holding.',
    ],
  },
  contribution: {
    low: ['Feeling stuck professionally — same tasks, no stretch.', 'I haven’t learned anything new in a while and I can feel it.', 'Busy but not growing. The days blur together.'],
    mid: ['Picked up a new responsibility at work; a little nervous, mostly glad.', 'Growing slowly. Finished a course module and it felt good.', 'Some growth. I’m asking for more feedback than I used to.'],
    high: ['I can feel myself growing — at work and in how I show up at home.', 'Led something for the first time this month and it went well.', 'Learning a lot right now. Stretching in good ways.'],
  },
  alignment: {
    low: ['My days don’t match what I say matters to me. That gap is loud right now.', 'Going through the motions. Hard to connect what I do to any bigger purpose.', 'Feeling pulled in directions that aren’t mine.'],
    mid: ['Clearer on my values than I was, still working on living them daily.', 'Mostly aligned. A couple of commitments I should let go of.', 'Getting there. Saying no more often, which helps.'],
    high: ['The work and the dreams point the same direction right now. Rare and good.', 'I know why I’m doing what I’m doing. That makes the hard parts easier.', 'Living closer to my values than I have in years.'],
  },
  relationships: {
    low: ['I’ve been isolating. Haven’t seen friends in weeks.', 'Tension at home. We’re both tired and it shows.', 'My space is a mess and it’s affecting how I feel in it.'],
    mid: ['Reconnected with an old friend. Want more of that.', 'Home feels calmer. Still working on being present.', 'Good with people, less good with my surroundings — the apartment needs attention.'],
    high: ['Full week of good conversations. I feel connected.', 'Family dinners are back. It changes everything.', 'Cleared out the spare room and it feels like a new place. Lighter.'],
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
];
const REFLECTIONS_PRIVATE = [
  'Had a hard conversation with my sister tonight. I don’t want to bring this to coaching yet, but I need to write it down.',
  'Honestly scared I’ll fail at this and everyone will know. Writing it so it stops circling.',
  'Money is tighter than I have let on. Need to think about what that means for the big dream.',
  'Cried in the car after work. Not about anything in particular. Just a lot.',
  'I think I want something different from what I said I wanted. Sitting with that before I say it out loud.',
  'Argument with my partner about time. We’re both right, which is the hard part.',
  'Doctor’s appointment next week. Trying not to spiral.',
];
const PRIVATE_NOTES = [
  'Part of this is the medication change — not ready to share that yet.',
  'The real reason is my mom’s health. Keeping that to myself for now.',
  'Didn’t mention it in the session, but I’ve been anxious about money again.',
  'Not sharing this one — I need to figure out how I feel first.',
];
const PRIVATE_ACTIONS = [
  'Make the therapy appointment I keep putting off',
  'Tell my partner about the job I applied for',
  'Look at the budget honestly — all of it',
  'Call Dad',
  'Write the apology letter, even if I never send it',
];
const CARE_ACTIONS: Record<CareCategory, string[]> = {
  energy: ['Lights out by 10:30 on weeknights', 'Walk 20 minutes at lunch', 'No coffee after 2pm', 'Stretch for ten minutes before bed'],
  contribution: ['Ask my manager for one stretch assignment', 'Finish one chapter of the course', 'Teach someone something I know'],
  alignment: ['Write my top three values on a card for my desk', 'Say no to one thing that isn’t mine this week', 'Ten quiet minutes each morning'],
  relationships: ['Text one friend I’ve lost touch with', 'Clear one surface at home every evening', 'Plan one phone-free dinner'],
};
const FOCUS = [
  'Energy — rebuild the morning routine',
  'Dream 1 — the next concrete step',
  'Relationships — reconnect with people who matter',
  'Alignment — say no to what isn’t mine',
  'Dream 2 — keep the streak alive',
  'Contribution — ask for the stretch',
  'Dream 3 — gather information before deciding',
];
const OPENERS = [
  'Arrived a little rushed but settled quickly.',
  'In good spirits today.',
  'Tired but engaged — a long week.',
  'Reflective mood; wanted to talk before rating.',
  'Energetic and ready to go.',
  'Quiet at first, opened up around the dreams.',
];

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

      // ---- monthly sessions ----
      const totalMonths = spec.joinedMonthsAgo + 1; // including the current month
      const sessionMonths: number[] = [];
      for (let m = spec.joinedMonthsAgo; m >= 0; m--) {
        if (spec.missedMonths?.includes(m)) continue;
        sessionMonths.push(m);
      }
      const lastDreamValue = spec.dreams.map((d) => d.start);
      const lastCare: Record<RatingCategory, number> = { contribution: 0, alignment: 0, relationships: 0, energy: 0, commitment: 0, satisfaction: 0 };
      const dreamActionIdx = spec.dreams.map(() => 0);
      const openActions: { id: number; createdAt: string }[] = [];
      const careActionsUsed = new Set<string>();
      let prevSessionEnd: string | null = null;

      for (const m of sessionMonths) {
        const monthStart = monthStartUTC(m);
        // session day: 3rd–20th; in the current month only if that day has already passed
        const day = 3 + Math.floor(rand() * 17);
        const sessionDate = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), day));
        if (sessionDate.getTime() > NOW.getTime() - DAY) continue;
        const occurredAt = at(sessionDate, 14 + Math.floor(rand() * 6), pick([0, 15, 30, 45]));
        const completedAt = new Date(new Date(occurredAt).getTime() + (15 + Math.floor(rand() * 15)) * 60000).toISOString();
        const progressT = (spec.joinedMonthsAgo - m) / Math.max(1, spec.joinedMonthsAgo); // 0..1

        const sessionId = Number(
          db
            .prepare(`INSERT INTO coaching_sessions (dreamer_id, coach_user_id, status, occurred_at, completed_at, notes, focus, created_at, updated_at) VALUES (?, ?, 'completed', ?, ?, '', '', ?, ?)`)
            .run(dreamerId, coachUserId, occurredAt, completedAt, occurredAt, completedAt).lastInsertRowid,
        );
        counts.sessions++;

        // CARE + program ratings
        const ratings: Partial<Record<RatingCategory, number>> = {};
        const lines: string[] = [pick(OPENERS)];
        for (const cat of CARE_CATEGORIES) {
          const [s, e] = spec.care[cat];
          let v = Math.round(s + (e - s) * progressT + jitter(1));
          // Darnell's energy story: a dip two months ago, recovered since.
          if (spec.email === 'darnell@dreamcoach.demo' && cat === 'energy' && m === 2) v = 4;
          v = clamp(v, 1, 10);
          ratings[cat] = v;
          if (lastCare[cat] && Math.abs(v - lastCare[cat]) >= 2) {
            lines.push(`${cat[0]!.toUpperCase()}${cat.slice(1)} ${v > lastCare[cat] ? 'up' : 'down'} to ${v} (from ${lastCare[cat]}). ${v > lastCare[cat] ? pick(NOTES[cat].high) : pick(NOTES[cat].low)}`);
          }
          lastCare[cat] = v;
        }
        const [cs, ce] = spec.commitment;
        ratings.commitment = clamp(Math.round(cs + (ce - cs) * progressT + jitter(0.6)), 1, 10);
        const [ss, se] = spec.satisfaction;
        ratings.satisfaction = clamp(Math.round(ss + (se - ss) * progressT + jitter(0.6)), 1, 10);
        for (const [cat, v] of Object.entries(ratings) as [RatingCategory, number][]) {
          insRating.run(dreamerId, cat, v, occurredAt, 'session', sessionId, null, coachUserId, 0, occurredAt, completedAt);
          counts.ratings++;
        }

        // Dream progress
        spec.dreams.forEach((d, i) => {
          const target = d.start + (d.end - d.start) * progressT;
          let v = Math.round(Math.max(lastDreamValue[i]!, target) + (chance(0.15) ? -jitter(3) : jitter(3)));
          if (chance(0.12) && i !== 1) v = Math.max(0, lastDreamValue[i]! - 3); // an honest dip
          v = clamp(v, 0, 100);
          if (d.end >= 100 && progressT >= 0.85) v = 100;
          lastDreamValue[i] = v;
          insProgress.run(dreamerId, dreamIds[i], v, occurredAt, 'session', sessionId, null, coachUserId, 0, occurredAt, completedAt);
          counts.progress++;
          if (v >= 100) db.prepare('UPDATE dreams SET achieved_at = COALESCE(achieved_at, ?) WHERE id = ?').run(occurredAt, dreamIds[i]);
        });
        const best = lastDreamValue.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v)[0]!;
        lines.push(`Most movement on “${spec.dreams[best.i]!.title}” — now at ${best.v}%.`);

        // Review previous actions: complete / archive some
        for (const a of [...openActions]) {
          const roll = rand();
          if (roll < 0.55) {
            const doneAt = new Date(new Date(a.createdAt).getTime() + (3 + rand() * 25) * DAY);
            const finalDone = doneAt.getTime() > new Date(occurredAt).getTime() ? occurredAt : doneAt.toISOString();
            db.prepare(`UPDATE actions SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?`).run(finalDone, finalDone, a.id);
            openActions.splice(openActions.indexOf(a), 1);
          } else if (roll < 0.7) {
            db.prepare(`UPDATE actions SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?`).run(occurredAt, occurredAt, a.id);
            openActions.splice(openActions.indexOf(a), 1);
          }
        }

        // New actions chosen in this session (1–3), tied to dreams or CARE
        const nActions = 1 + Math.floor(rand() * 3);
        const chosen: string[] = [];
        for (let k = 0; k < nActions; k++) {
          if (chance(0.7)) {
            const di = pick([0, 0, 1, 1, 2, 3]);
            const list = spec.dreams[di]!.actions;
            if (dreamActionIdx[di]! < list.length) {
              const title = list[dreamActionIdx[di]!]!;
              dreamActionIdx[di]!++;
              const r = insAction.run(dreamerId, title, '', 'active', dreamIds[di], null, 0, coachUserId, sessionId, completedAt, null, null, completedAt);
              openActions.push({ id: Number(r.lastInsertRowid), createdAt: completedAt });
              chosen.push(title);
              counts.actions++;
              continue;
            }
          }
          const cat = pick(CARE_CATEGORIES);
          const candidates = CARE_ACTIONS[cat].filter((t) => !careActionsUsed.has(t));
          if (!candidates.length) continue;
          const title = pick(candidates);
          careActionsUsed.add(title);
          const r = insAction.run(dreamerId, title, '', 'active', null, cat, 0, coachUserId, sessionId, completedAt, null, null, completedAt);
          openActions.push({ id: Number(r.lastInsertRowid), createdAt: completedAt });
          chosen.push(title);
          counts.actions++;
        }
        const focus = pick(FOCUS);
        if (chosen.length) lines.push(`Actions chosen: ${chosen.join('; ')}.`);
        lines.push(`Commitment ${ratings.commitment}, satisfaction ${ratings.satisfaction}.`);
        db.prepare('UPDATE coaching_sessions SET notes = ?, focus = ? WHERE id = ?').run(lines.join('\n'), focus, sessionId);

        // ---- between-session self activity (until next month's session or now) ----
        const windowStart = new Date(completedAt);
        const nextMonth = monthStartUTC(m - 1);
        const windowEnd = new Date(Math.min(NOW.getTime() - 3600000, nextMonth.getTime() + 20 * DAY));
        const freq = spec.engagement === 'high' ? 4 : spec.engagement === 'moderate' ? 1.5 : 0.3;
        let nCheckIns = Math.floor(freq + (rand() < freq % 1 ? 1 : 0));
        if (spec.email === 'darnell@dreamcoach.demo' && m === 2) nCheckIns = Math.max(nCheckIns, 2);
        const slots: Date[] = [];
        for (let k = 0; k < nCheckIns; k++) {
          const t = windowStart.getTime() + 2 * DAY + rand() * Math.max(DAY, windowEnd.getTime() - windowStart.getTime() - 3 * DAY);
          if (t < NOW.getTime() - 3600000) slots.push(new Date(t));
        }
        slots.sort((a, b) => a.getTime() - b.getTime());
        slots.forEach((d, idx) => {
          const when = at(d, 12 + Math.floor(rand() * 10), pick([0, 10, 20, 30, 40, 50]));
          const ciId = Number(db.prepare('INSERT INTO check_ins (dreamer_id, occurred_at, created_by, created_at) VALUES (?, ?, ?, ?)').run(dreamerId, when, userId, when).lastInsertRowid);
          counts.checkIns++;
          // Which categories? 1–3 of them
          let cats: RatingCategory[] = CARE_CATEGORIES.filter(() => chance(0.45));
          if (!cats.length) cats = [pick(CARE_CATEGORIES)];
          let scripted: { cat: RatingCategory; value: number; note: string } | null = null;
          if (spec.email === 'darnell@dreamcoach.demo' && m === 2 && idx === 0) scripted = { cat: 'energy', value: 4, note: NOTES.energy.low[0]! };
          if (spec.email === 'darnell@dreamcoach.demo' && m === 2 && idx === 1) scripted = { cat: 'energy', value: 8, note: NOTES.energy.high[0]! };
          if (scripted) cats = [scripted.cat, ...cats.filter((c) => c !== scripted!.cat)].slice(0, 2);
          let wroteSomething = false;
          for (const cat of cats) {
            let v = clamp(lastCare[cat] + jitter(2), 1, 10);
            let noteText: string | null = null;
            let ratingPrivate = false;
            let notePrivate = false;
            if (scripted && cat === scripted.cat) { v = scripted.value; noteText = scripted.note; }
            else {
              if (chance(0.6)) noteText = v <= 4 ? pick(NOTES[cat].low) : v <= 7 ? pick(NOTES[cat].mid) : pick(NOTES[cat].high);
              ratingPrivate = chance(0.12);
              notePrivate = !ratingPrivate && !!noteText && chance(0.2);
              if (notePrivate) noteText = `${noteText} ${pick(PRIVATE_NOTES)}`;
            }
            const rr = insRating.run(dreamerId, cat, v, when, 'self', null, ciId, userId, ratingPrivate ? 1 : 0, when, when);
            counts.ratings++;
            if (ratingPrivate) counts.private++;
            if (noteText) {
              insJournal.run(dreamerId, noteText, when, notePrivate ? 1 : 0, 'self', null, ciId, Number(rr.lastInsertRowid), null, null, cat, userId, when, when);
              counts.journal++;
              if (notePrivate) counts.private++;
            }
            wroteSomething = true;
          }
          // Occasionally a self progress update
          if (chance(0.3)) {
            const di = pick([0, 1, 1, 2]);
            const v = clamp(lastDreamValue[di]! + 1 + Math.floor(rand() * 5), 0, 100);
            lastDreamValue[di] = v;
            const isPriv = chance(0.15);
            const pr = insProgress.run(dreamerId, dreamIds[di], v, when, 'self', null, ciId, userId, isPriv ? 1 : 0, when, when);
            counts.progress++;
            if (isPriv) counts.private++;
            if (chance(0.5)) {
              insJournal.run(dreamerId, pick(['Small step, but a real one.', 'Did the thing I said I would do.', 'Slower than I hoped, but moving.', 'Momentum is back.']), when, 0, 'self', null, ciId, null, Number(pr.lastInsertRowid), dreamIds[di], null, userId, when, when);
              counts.journal++;
            }
            if (v >= 100 && !isPriv) db.prepare('UPDATE dreams SET achieved_at = COALESCE(achieved_at, ?) WHERE id = ?').run(when, dreamIds[di]);
          }
          // Check-in level reflection
          if (chance(spec.engagement === 'high' ? 0.5 : 0.3)) {
            const priv = chance(0.3);
            insJournal.run(dreamerId, priv ? pick(REFLECTIONS_PRIVATE) : pick(REFLECTIONS_SHARED), when, priv ? 1 : 0, 'self', null, ciId, null, null, null, null, userId, when, when);
            counts.journal++;
            if (priv) counts.private++;
          }
          void wroteSomething;
        });

        // Standalone journal entries & dreamer-created actions in this window
        const nJournal = spec.engagement === 'high' ? 2 : spec.engagement === 'moderate' ? 1 : 0;
        for (let k = 0; k < nJournal; k++) {
          const t = windowStart.getTime() + rand() * Math.max(DAY, windowEnd.getTime() - windowStart.getTime());
          if (t > NOW.getTime() - 3600000) continue;
          const when = new Date(t).toISOString();
          const priv = chance(0.35);
          const dreamTag = chance(0.3) ? dreamIds[Math.floor(rand() * 4)]! : null;
          insJournal.run(dreamerId, priv ? pick(REFLECTIONS_PRIVATE) : pick(REFLECTIONS_SHARED), when, priv ? 1 : 0, 'self', null, null, null, null, dreamTag, null, userId, when, when);
          counts.journal++;
          if (priv) counts.private++;
        }
        if (spec.engagement !== 'light' && chance(0.6)) {
          const t = windowStart.getTime() + rand() * Math.max(DAY, windowEnd.getTime() - windowStart.getTime());
          if (t <= NOW.getTime() - 3600000) {
            const when = new Date(t).toISOString();
            const priv = chance(0.35);
            const di = Math.floor(rand() * 4);
            const list = spec.dreams[di]!.actions;
            let title: string;
            if (priv) title = pick(PRIVATE_ACTIONS);
            else if (dreamActionIdx[di]! < list.length) { title = list[dreamActionIdx[di]!]!; dreamActionIdx[di]!++; }
            else title = pick(CARE_ACTIONS[pick(CARE_CATEGORIES)]);
            const done = chance(0.4);
            const doneAt = done ? new Date(t + (2 + rand() * 12) * DAY) : null;
            const doneIso = doneAt && doneAt.getTime() < NOW.getTime() ? doneAt.toISOString() : null;
            const r = insAction.run(dreamerId, title, '', doneIso ? 'completed' : 'active', priv ? null : dreamIds[di], null, priv ? 1 : 0, userId, null, when, doneIso, null, doneIso ?? when);
            if (!doneIso) openActions.push({ id: Number(r.lastInsertRowid), createdAt: when });
            counts.actions++;
            if (priv) counts.private++;
          }
        }
        prevSessionEnd = completedAt;
      }
      void prevSessionEnd;
      void totalMonths;
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
