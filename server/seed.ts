/**
 * Deterministic demo data for the Dream Coach prototype.
 *
 * Everything is fictional. Dates are generated relative to "now" so the demo
 * always looks current: the program began 8 months ago and runs 10 months.
 * The generator is seeded, so the same shape of history is produced each time.
 */
import type { Statement } from 'better-sqlite3';
import type { DB } from './db.ts';
import { hashPassword } from './auth.ts';
import { randomId } from './ids.ts';
import { CARE_CATEGORIES, PROGRAM_CATEGORIES, isCareCategory, type CareCategory, type RatingCategory } from '../shared/care.ts';

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
// Row ids come from a stream of their own, so they stay reproducible without reshuffling the story. Two draws
// make a full 53-bit fraction, so seeded ids look like any others.
let idRnd = mulberry32(48151623);
const newId = () => randomId(() => (Math.floor(idRnd() * 2 ** 26) * 2 ** 27 + Math.floor(idRnd() * 2 ** 27)) / 2 ** 53);
// The dreamer's words about their dreams (progress notes, dream reflections) come from a stream of their own too, so
// adding words never reshuffles the numbers they sit beside.
let wordsRnd = mulberry32(31415926);
const wordsRand = () => wordsRnd();
const pick = <T,>(xs: readonly T[], r: () => number = rand): T => xs[Math.floor(r() * xs.length)]!;
const chance = (p: number, r: () => number = rand) => r() < p;
const jitter = (n: number) => Math.round((rand() * 2 - 1) * n);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
/** One of `xs`, each as likely as its weight (a single draw, like pick()). */
function pickWeighted<T>(xs: readonly T[], weight: (x: T) => number): T {
  let x = rand() * xs.reduce((n, v) => n + weight(v), 0);
  for (const v of xs) if ((x -= weight(v)) < 0) return v;
  return xs[xs.length - 1]!;
}
/** An item this dreamer has not used yet, so no text repeats verbatim for one person; null once all are used. */
function pickUnused<T>(xs: readonly T[], used: Set<T>, r: () => number = rand): T | null {
  const fresh = xs.filter((x) => !used.has(x));
  if (!fresh.length) return null;
  const x = pick(fresh, r);
  used.add(x);
  return x;
}
/** An unused item from the first bank that still has one; a line repeats only once every bank that fits is used up. */
function pickFresh<T>(used: Set<T>, ...banks: readonly (readonly T[])[]): T {
  for (const xs of banks) {
    const x = pickUnused(xs, used);
    if (x != null) return x;
  }
  return pick(banks[0]!);
}

/* ---------- dates ---------- */
// The demo program runs in US Eastern time (America/New_York, DST-aware): sessions fall in its working hours,
// check-ins and reflections in its waking hours, and a text that says "tonight" in its evening. Times are stored
// as UTC instants, so viewers elsewhere see the same moments in their own local time. Months stay UTC months,
// like the trend charts that bucket by them.
const DEMO_TZ = 'America/New_York';
const NOW = new Date();
const MINUTE = 60000;
const HOUR = 3600000;
const DAY = 86400000;
function monthStartUTC(monthsAgo: number): Date {
  return new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - monthsAgo, 1));
}
const zoneClock = new Intl.DateTimeFormat('en-US', { timeZone: DEMO_TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
const zoneOffsets = new Map<number, number>(); // by UTC hour: the zone's offsets change only on the hour
/** The demo zone's wall clock at instant `t`, as a timestamp whose UTC fields read that wall time. */
function wall(t: number): number {
  const h = Math.floor(t / HOUR);
  let offset = zoneOffsets.get(h);
  if (offset == null) {
    const p = Object.fromEntries(zoneClock.formatToParts(h * HOUR).map((x) => [x.type, Number(x.value)]));
    offset = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!) - h * HOUR;
    zoneOffsets.set(h, offset);
  }
  return t + offset;
}
/** The instant at which the demo zone's wall clock reads `w` (a wall() value). */
function unwall(w: number): number {
  const guess = w - (wall(w) - w);
  return w - (wall(guess) - guess);
}
/** `hour:minute` in the demo zone on the calendar date of `d` (its UTC date, as isoDate() writes it). */
function at(d: Date, hour = 15, minute = 0): string {
  return new Date(unwall(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, minute))).toISOString();
}
/** The demo-zone calendar date of instant `t`, for at(). */
const zoneDate = (t: number) => new Date(Math.floor(wall(t) / DAY) * DAY);
/** When something may be written: demo-zone weekdays (0 = Sunday) and hours [from, to). Waking hours by default. */
interface Hours { days?: number[]; hours?: [number, number] }
/** The stretches of [from, to] that fall on an allowed day and hour. */
function slots(from: number, to: number, when: Hours = {}): [number, number][] {
  const [h0, h1] = when.hours ?? [8, 22];
  const out: [number, number][] = [];
  for (let day = zoneDate(from).getTime(); day <= wall(to); day += DAY) {
    if (when.days && !when.days.includes(new Date(day).getUTCDay())) continue;
    const a = Math.max(from, unwall(day + h0 * HOUR));
    const b = Math.min(to, unwall(day + h1 * HOUR));
    if (a <= b) out.push([a, b]);
  }
  return out;
}
/** A time in [from, to] on an allowed day and hour, on a five-minute mark; null if the window has none. */
function timeBetween(from: number, to: number, when?: Hours, r: () => number = rand): number | null {
  const s = slots(from, to, when);
  const total = s.reduce((n, [a, b]) => n + (b - a), 0);
  let x = r() * total;
  for (let i = 0; i < s.length; i++) {
    const [a, b] = s[i]!;
    if (x > b - a && i < s.length - 1) { x -= b - a; continue; }
    const t = Math.min(b, a + x);
    const step = 5 * MINUTE;
    const rounded = Math.ceil(t / step) * step <= b ? Math.ceil(t / step) * step : Math.floor(t / step) * step;
    return rounded >= a ? rounded : Math.round(t);
  }
  return null;
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

/**
 * A dream and the dreamer's words about it: the steps they take (calendar-free, so any month can choose them), short
 * notes that go with a progress update, an optional reflection written about the dream, and, for a dream that
 * reaches 100%, what they wrote on that value.
 */
interface DreamSpec { title: string; description: string; start: number; end: number; actions: string[]; notes: string[]; reflection?: string; achieved?: string }
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
      {
        title: 'Run the Riverfront Half Marathon', description: 'Cross the finish line of the spring half marathon, running the whole way.', start: 10, end: 70,
        actions: ['Sign up for a 10K as a stepping stone', 'Run three mornings this week before work', 'Book a gait assessment at the running store', 'Find a running buddy for long Saturday runs', 'Build the long run up to eight miles', 'Plan race-week meals and sleep'],
        notes: ['Ran the whole river loop without walking once.', 'Long run went further than last month, and my knees didn’t complain.', 'Added a mile to the long run and still had something left.', 'Slow and steady, but I’m running farther than I was.'],
        reflection: 'Thought about why the half marathon matters so much to me. It’s the first goal in years that’s only about me, and I want to see what I’m capable of.',
      },
      {
        title: 'Read twelve books during the program', description: 'One book a month — mostly fiction, a few on leadership.', start: 8, end: 85,
        actions: ['Pick the next book and put it by the bed', 'Join the library’s evening book club', 'Finish “The Overstory” before the next session', 'Swap one evening of TV a week for reading', 'Pick a leadership book to read next'],
        notes: ['Finished another book, and this one stayed with me for days.', 'Reading before bed instead of scrolling. Ahead of where I thought I’d be.', 'Halfway through a long one, but I’m reading most nights.'],
        reflection: 'Reading again feels like getting a part of myself back. I used to read on the bus every day, and I missed it more than I knew.',
      },
      {
        title: 'Finish my bachelor’s degree', description: 'Complete the remaining 30 credits in social work, part-time.', start: 15, end: 32,
        actions: ['Meet with the admissions advisor about transfer credits', 'Submit the FAFSA renewal', 'Register for next term’s evening course', 'Map the remaining credits semester by semester', 'Ask my supervisor about a study-friendly schedule'],
        notes: ['One more course mapped out. The finish line is starting to look real.', 'Turned in the paper I’d been dreading, and it came back with a good grade.'],
        reflection: 'Worked out that I can finish the degree in two years if I keep taking one evening class. Two years sounds long, but it was “someday” for a decade.',
      },
      {
        title: 'Start a community garden at Oakwood', description: 'A shared garden where residents grow food together.', start: 0, end: 12,
        actions: ['Sketch the garden idea on one page', 'Talk to the property manager about the empty lot', 'Visit the Eastside community garden for ideas', 'Ask five residents what they would grow', 'Draft a one-page proposal for the resident council'],
        notes: ['Three residents said they’d help. That’s three more than I had.', 'Measured the empty lot. It’s bigger than it looks from the parking lot.'],
        reflection: 'Mrs. Lin on the second floor wants to grow peppers like her mother did. That’s the whole reason for the garden, right there.',
      },
    ],
  },
  {
    name: 'Marcus Bell', email: 'marcus@dreamcoach.demo', coach: 'maya@dreamcoach.demo',
    about: 'Maintenance Technician · 6 years', engagement: 'moderate', joinedMonthsAgo: 8,
    care: { contribution: [6, 8], alignment: [7, 8], relationships: [5, 7], energy: [6, 7] }, commitment: [8, 9], satisfaction: [6, 8],
    dreams: [
      {
        title: 'Earn my HVAC certification', description: 'Pass the EPA 608 and the state HVAC exam.', start: 20, end: 90,
        actions: ['Schedule the EPA 608 exam', 'Study one chapter each evening', 'Ask Ray to mentor me on the commercial units', 'Take a full EPA 608 practice test', 'Book the state HVAC exam date'],
        notes: ['Scored better on the practice questions than last month.', 'Studied every evening this week, even the tired ones.'],
        reflection: 'Ray said I troubleshoot like someone who’s been doing this for twenty years. Six years ago I couldn’t tell a compressor from a condenser. The certificate is just catching up.',
      },
      {
        title: 'Take the kids camping every month', description: 'A real tent, a real fire, phones off.', start: 10, end: 100,
        actions: ['Reserve a site at Pine Hollow', 'Teach Jada to set up the tent', 'Plan a fall trip around the leaves', 'Make a gear checklist with the kids', 'Let the kids pick next month’s campsite'],
        notes: ['Another trip done. Jada lit the fire herself this time.', 'Rained the whole second day, and the kids still want to go back.'],
        achieved: 'We did it: a trip every month, just like we said. The kids are already arguing about where we go next.',
        reflection: 'Sat by the fire after the kids fell asleep and realized I hadn’t checked my phone in two days. This dream was for them, but it’s doing something for me too.',
      },
      {
        title: 'Buy a home for my family', description: 'Three bedrooms, a yard, within 30 minutes of work.', start: 5, end: 25,
        actions: ['Pull my credit report and read it line by line', 'Open a dedicated down-payment savings account', 'Attend the first-time buyer workshop', 'Meet a lender about pre-approval', 'Automate a monthly transfer to the down-payment fund'],
        notes: ['The down-payment fund grows every month now, without me thinking about it.', 'Credit score went up again. Slowly getting there.'],
        reflection: 'Drove past a house with a yard on the way home and let myself picture us there for a minute. It didn’t feel silly this time.',
      },
      {
        title: 'Build a workshop and teach kids to fix things', description: 'A garage workshop where neighborhood kids learn hands-on skills.', start: 0, end: 8,
        actions: ['Write down what the first class would cover', 'Price a used workbench and basic tools', 'Ask the community center about a room for a pilot class'],
        notes: ['Wrote down the first class: fixing a bike chain.', 'A neighbor offered me his old tools. It’s starting to feel possible.'],
      },
    ],
  },
  {
    name: 'Tamsin Reyes', email: 'tamsin@dreamcoach.demo', coach: 'maya@dreamcoach.demo',
    about: 'Leasing Consultant · 1 year', engagement: 'light', joinedMonthsAgo: 8, missedMonths: [5, 1, 0],
    care: { contribution: [5, 6], alignment: [5, 6], relationships: [6, 7], energy: [5, 6] }, commitment: [6, 7], satisfaction: [5, 7],
    dreams: [
      { title: 'Get promoted to Assistant Property Manager', description: 'Lead a site team within the year.', start: 10, end: 45, actions: ['Ask my manager what the APM role requires', 'Shadow the APM on month-end reporting', 'Complete the Fair Housing refresher'], notes: ['Sat in on month-end reporting. It made more sense than I expected.'] },
      { title: 'Learn to cook ten family recipes', description: 'The dishes my grandmother made — written down and mastered.', start: 10, end: 50, actions: ['Call Abuela and write down the arroz con pollo recipe', 'Cook one recipe every Sunday'], notes: ['Cooked another family recipe. Mom said it tasted like home.'] },
      { title: 'Travel to Oaxaca with my mom', description: 'Two weeks, Day of the Dead, her hometown.', start: 5, end: 20, actions: ['Set up an automatic $75 transfer into a travel fund', 'Renew my passport'], notes: ['The travel fund is finally growing.'] },
      { title: 'Own a small café', description: 'A neighborhood place with good coffee and pan dulce.', start: 0, end: 5, actions: ['Write a one-page vision of the café'], notes: ['Sketched a café menu on a napkin at lunch.'] },
    ],
  },
  {
    name: 'Owen Fitzgerald', email: 'owen@dreamcoach.demo', coach: 'maya@dreamcoach.demo',
    about: 'Compliance Specialist · 2 years', engagement: 'moderate', joinedMonthsAgo: 8,
    care: { contribution: [6, 7], alignment: [4, 7], relationships: [5, 7], energy: [5, 6] }, commitment: [6, 8], satisfaction: [5, 8],
    dreams: [
      {
        title: 'Write and perform a set of original songs', description: 'Ten songs, one open-mic night, no apologies.', start: 20, end: 60,
        actions: ['Finish the bridge for “Northbound”', 'Book a slot at the Tuesday open mic', 'Record rough demos on my phone', 'Write one new verse every week', 'Play two songs for a friend before the open mic'],
        notes: ['Wrote two new verses this week. One of them is a keeper.', 'Listened back to a rough demo and didn’t delete it. Progress.'],
        reflection: 'Played guitar for an hour without checking the time. Writing songs again feels like talking to the version of me who was nineteen.',
      },
      {
        title: 'Rebuild a weekly rhythm with my dad', description: 'Sunday calls that actually happen.', start: 15, end: 80,
        actions: ['Put the Sunday call on both our calendars', 'Plan a visit for Dad’s birthday', 'Ask Dad to teach me his chili recipe'],
        notes: ['Three Sunday calls in a row. Dad started calling me first.', 'We talked for an hour about nothing in particular. It was great.'],
        reflection: 'Dad told me a story about his first job that I’d never heard. I’m glad I didn’t wait for a better time to start these calls.',
      },
      {
        title: 'Move into a role that uses my analysis skills', description: 'Data or policy work — something that uses the numbers side of me.', start: 5, end: 30,
        actions: ['Finish the SQL course', 'Ask the finance team if I can help with the annual report data', 'Update my résumé with the compliance dashboards work', 'Ask an analyst about how they got into the role'],
        notes: ['Another module of the SQL course done.', 'Built a small dashboard at work, and people actually used it.'],
      },
      { title: 'Live by the sea for a year', description: 'Somewhere with a long beach and a small apartment.', start: 0, end: 6, actions: ['Make a list of coastal towns with remote-friendly work', 'Price a month-long rental in one of them'], notes: ['Looked at a few coastal towns. One of them stuck with me.', 'Started a small savings pot labelled “sea”.'] },
    ],
  },
  {
    name: 'Lena Hoffmann', email: 'lena@dreamcoach.demo', coach: 'maya@dreamcoach.demo',
    about: 'Accounts Payable Clerk · new this year', engagement: 'moderate', joinedMonthsAgo: 2,
    care: { contribution: [5, 6], alignment: [6, 7], relationships: [7, 7], energy: [6, 7] }, commitment: [8, 8], satisfaction: [6, 7],
    dreams: [
      { title: 'Pass the bookkeeping certification', description: 'The AIPB certified bookkeeper exam by spring.', start: 10, end: 25, actions: ['Order the study guide', 'Block two study hours on Tuesday and Thursday'], notes: ['Two study sessions this week, both on time.', 'The practice questions on reconciliations finally clicked.'] },
      {
        title: 'Swim twice a week', description: 'Back in the pool after ten years.', start: 0, end: 35,
        actions: ['Buy goggles and a membership at the Y', 'Swim Monday and Thursday mornings'],
        notes: ['Swam twice this week, and ten more lengths than last time.', 'The early swims are getting easier to get up for.'],
        reflection: 'First time in the pool in ten years. I was nervous walking in, and then I forgot to be nervous.',
      },
      { title: 'Visit my grandparents in Hamburg', description: 'Three weeks there, with my daughter.', start: 5, end: 10, actions: ['Price flights for next summer'], notes: ['Found flights that might work. My daughter is already excited.'] },
      { title: 'Start a small bakery', description: 'Rye bread, cardamom buns, and a counter with four stools.', start: 0, end: 3, actions: ['Bake one new recipe each weekend'], notes: ['The cardamom buns came out right on the second try.'] },
    ],
  },
  {
    name: 'Darnell Price', email: 'darnell@dreamcoach.demo', coach: 'daniel@dreamcoach.demo',
    about: 'Community Engagement Lead · 5 years', engagement: 'high', joinedMonthsAgo: 8,
    care: { contribution: [7, 8], alignment: [7, 9], relationships: [6, 8], energy: [5, 8] }, commitment: [8, 9], satisfaction: [6, 9],
    dreams: [
      {
        title: 'Launch a youth mentoring program at Cedar Court', description: 'Twelve mentors, twelve kids, one school year.', start: 15, end: 75,
        actions: ['Draft the mentor commitment form', 'Meet the principal at Lincoln Middle', 'Recruit three mentors from the maintenance team', 'Hold the mentor orientation', 'Pair the first mentors with students', 'Plan the first mentor check-in night'],
        notes: ['Two more mentors signed up.', 'The kids asked when the next mentor night is. That’s the best sign yet.', 'The principal at Lincoln Middle wants to send more students our way.'],
        reflection: 'One of the boys at Cedar Court asked whether his mentor would “still come back next month.” I want this program to be the thing that does come back.',
      },
      {
        title: 'Be fully present at dinner every night', description: 'Phone in the drawer. Real conversation with Keisha and the boys.', start: 30, end: 90,
        actions: ['Buy a basket for phones by the door', 'Ask each kid one real question at dinner', 'Let the boys cook one dinner a week', 'Turn off work notifications after six'],
        notes: ['Phones in the basket five nights out of seven.', 'The boys did most of the talking at dinner. I mostly listened.'],
        reflection: 'Keisha said dinner feels different now. I didn’t realize how much I was only half there until I stopped.',
      },
      {
        title: 'Complete a master’s in nonprofit leadership', description: 'Part-time, two years, starting next fall.', start: 5, end: 30,
        actions: ['Request transcripts', 'Go to the program’s next info session', 'Draft the personal statement', 'Ask two colleagues for recommendation letters'],
        notes: ['The personal statement has a real first draft now.', 'Talked to two people who did the program. Both said go for it.'],
      },
      {
        title: 'Found a nonprofit that serves families like mine', description: 'Housing stability plus mentoring, under one roof.', start: 2, end: 10,
        actions: ['Write the mission statement in one sentence', 'Have coffee with the director of Bright Futures', 'List the first five families we’d want to serve'],
        notes: ['Got the mission down to one sentence. It took me twelve tries.', 'Learned a lot about running a nonprofit, and nothing that scared me off.'],
        reflection: 'Someday, the nonprofit. For now I keep a list of what helped my family when we needed it. The list is getting long.',
      },
    ],
  },
  {
    name: 'Hana Sato', email: 'hana@dreamcoach.demo', coach: 'daniel@dreamcoach.demo',
    about: 'Property Manager · 4 years', engagement: 'moderate', joinedMonthsAgo: 8,
    care: { contribution: [7, 8], alignment: [6, 7], relationships: [5, 7], energy: [4, 6] }, commitment: [7, 8], satisfaction: [6, 8],
    dreams: [
      {
        title: 'Take a real two-week vacation', description: 'Fully offline. Someone else handles the property.', start: 5, end: 65,
        actions: ['Train Luis to cover emergency calls', 'Request two weeks off and put them on the team calendar', 'Write the coverage handbook', 'Pick the destination and book the flights', 'Let Luis cover a trial weekend on his own'],
        notes: ['Luis handled two emergency calls on his own this week.', 'The coverage handbook is mostly written.'],
        reflection: 'Pictured two weeks with no phone and felt my shoulders drop. I’ve never once had that at this job.',
      },
      {
        title: 'Paint again — one canvas a month', description: 'Oils, the way I did in college.', start: 10, end: 80,
        actions: ['Set up the spare room as a studio corner', 'Paint on the first Sunday of the month', 'Buy new brushes and two canvases', 'Finish the lake painting I started in college'],
        notes: ['Another canvas finished. The light on the water is better than in the last one.', 'Painted for three hours straight and lost track of time.'],
        reflection: 'The studio corner is the only place where nobody needs anything from me. I didn’t know how much I needed that.',
      },
      { title: 'Become a regional manager', description: 'Oversee a portfolio of sites and mentor new managers.', start: 10, end: 35, actions: ['Ask the VP of Property Management for feedback on my readiness', 'Lead the budgeting workshop for new PMs', 'Shadow the regional manager on a site visit'], notes: ['The new property managers asked good questions in the budgeting workshop.', 'Got honest feedback on what I still need for the regional role.'] },
      { title: 'Build a cabin with my partner', description: 'Small, off-grid, near the lake where we met.', start: 0, end: 10, actions: ['Start a shared “cabin” savings account', 'Visit two lots near the lake'], notes: ['Walked two lots by the lake. One of them felt right.'] },
    ],
  },
  {
    name: 'Victor Alvarez', email: 'victor@dreamcoach.demo', coach: 'daniel@dreamcoach.demo',
    about: 'Groundskeeper · 9 years', engagement: 'light', joinedMonthsAgo: 8, status: 'paused', missedMonths: [1, 0],
    care: { contribution: [5, 6], alignment: [6, 6], relationships: [7, 7], energy: [6, 5] }, commitment: [6, 6], satisfaction: [5, 6],
    dreams: [
      { title: 'Get my commercial driver’s license', description: 'Open up weekend work and a path to fleet maintenance.', start: 10, end: 40, actions: ['Pick up the CDL study manual', 'Schedule the permit test', 'Practice the pre-trip inspection checklist'], notes: ['Studied the manual on my breaks this week.'] },
      { title: 'Coach my son’s soccer team', description: 'Every Saturday this season.', start: 20, end: 70, actions: ['Sign up as assistant coach', 'Run one practice on my own', 'Plan three drills for the next practice'], notes: ['Ran practice on my own. The kids listened, mostly.'] },
      { title: 'Pay off the truck', description: 'Zero balance by year three.', start: 15, end: 30, actions: ['Add $100 to the payment each month'], notes: ['Paid an extra hundred again this month.'] },
      { title: 'Retire to a small ranch', description: 'A few acres, a couple of horses, grandkids visiting.', start: 0, end: 4, actions: ['Talk with Maria about where we’d want the ranch to be'], notes: ['Maria and I talked about the ranch over dinner. She wants horses too.'] },
    ],
  },
  {
    name: 'Grace Oyelaran', email: 'grace@dreamcoach.demo', coach: 'priya@dreamcoach.demo',
    about: 'HR Generalist · 2 years', engagement: 'high', joinedMonthsAgo: 8,
    care: { contribution: [6, 8], alignment: [5, 8], relationships: [6, 8], energy: [6, 7] }, commitment: [7, 9], satisfaction: [5, 8],
    dreams: [
      {
        title: 'Earn the SHRM-CP credential', description: 'Certified by the fall testing window.', start: 20, end: 85,
        actions: ['Register for the fall exam window', 'Finish the employment law module', 'Take a full practice exam', 'Block two study evenings a week', 'Join the online study group'],
        notes: ['Practice exam score went up nine points.', 'Two study evenings this week, and the material is sticking.'],
        reflection: 'Explaining the leave rules to the study group made them finally make sense to me. Teaching is how I learn.',
      },
      {
        title: 'Host a monthly dinner for friends', description: 'Eight people, one long table, no phones.', start: 10, end: 90,
        actions: ['Send the first invitation', 'Learn jollof the way my mother makes it', 'Pick a date for the next dinner and send the invites', 'Try a new recipe on a weeknight first'],
        notes: ['Eight people around the table again, and nobody looked at a phone.', 'The jollof came out right this time. My mother would approve.'],
        reflection: 'Someone at the dinner said it’s the one night a month she feels fully herself. That’s exactly what I hoped this table would be.',
      },
      { title: 'Lead people operations at a mission-driven organization', description: 'Shape how a whole organization treats its people.', start: 10, end: 30, actions: ['Ask to sit in on the leadership team’s planning day', 'Find a mentor in people operations', 'Read one book on workplace culture'], notes: ['Found someone who leads people operations at a nonprofit and is happy to mentor me.', 'Sat in on a planning meeting and actually spoke up.'] },
      {
        title: 'Write a book about belonging at work', description: 'Essays, stories, and a little research.', start: 2, end: 12,
        actions: ['Write 300 words every Saturday morning', 'Outline five chapters', 'Share one essay with a friend for feedback'],
        notes: ['Three hundred words a week so far. They add up.', 'Outlined the first chapter. It’s about the first day at a new job.'],
        reflection: 'Every essay I write for the book comes back to the same thing: people do their best work where they don’t have to pretend.',
      },
    ],
  },
  {
    name: 'Theo Lindqvist', email: 'theo@dreamcoach.demo', coach: 'priya@dreamcoach.demo',
    about: 'IT Support Specialist · 3 years', engagement: 'light', joinedMonthsAgo: 8, missedMonths: [4, 0],
    care: { contribution: [6, 7], alignment: [5, 6], relationships: [4, 6], energy: [5, 6] }, commitment: [6, 7], satisfaction: [5, 7],
    dreams: [
      { title: 'Earn the Network+ certification', description: 'Then Security+ next year.', start: 30, end: 80, actions: ['Book the Network+ exam date', 'Do one practice lab each weekend'], notes: ['Practice lab went smoothly this weekend.'] },
      { title: 'Climb outdoors once a month', description: 'Trade the gym wall for real rock.', start: 10, end: 60, actions: ['Join the Saturday outdoor meetup', 'Buy a used rope and quickdraws'], notes: ['Climbed real rock again. Hands are wrecked; worth it.'] },
      { title: 'Move into cybersecurity', description: 'An analyst role within three years.', start: 5, end: 20, actions: ['Set up a home lab', 'Ask Dana about shadowing the security team'], notes: ['The home lab is up and running.'] },
      { title: 'Sail across the Baltic', description: 'Stockholm to Helsinki, on a boat I helped crew.', start: 0, end: 5, actions: ['Take the basic keelboat course'], notes: ['Read about crewing on a sailboat. It sounds hard and wonderful.'] },
    ],
  },
  {
    name: 'Sam Whitaker', email: 'sam@dreamcoach.demo', coach: 'director@dreamcoach.demo',
    about: 'Facilities Supervisor · 7 years', engagement: 'moderate', joinedMonthsAgo: 8,
    care: { contribution: [6, 8], alignment: [6, 8], relationships: [6, 7], energy: [5, 7] }, commitment: [7, 9], satisfaction: [6, 8],
    dreams: [
      {
        title: 'Build a preventive maintenance program', description: 'Fewer emergencies, more planned work, across all sites.', start: 20, end: 70,
        actions: ['Inventory the HVAC units at Cedar Court', 'Draft the quarterly inspection checklist', 'Present the plan to the leadership team', 'Pilot the checklist at one site for a month', 'Track emergency calls before and after the pilot'],
        notes: ['Fewer emergency calls this month at the first site.', 'The team is starting to plan work instead of chasing it.'],
        reflection: 'For the first time in years I planned a week instead of reacting to it. That’s what this program is really for.',
      },
      { title: 'Walk 10,000 steps a day', description: 'Every day of the program.', start: 20, end: 85, actions: ['Walk the sites instead of driving between buildings', 'Evening walk with Dee after dinner', 'Take the stairs at every site', 'Plan a weekend hike with Dee'], notes: ['Hit 10,000 steps six days out of seven.', 'Walking between buildings adds up faster than I thought.'] },
      { title: 'Become Director of Facilities', description: 'Lead the whole facilities function.', start: 10, end: 35, actions: ['Enroll in the leadership certificate', 'Mentor two new supervisors', 'Ask the VP of Operations what the director role needs most'], notes: ['Finished the first unit of the leadership certificate.'] },
      {
        title: 'Restore a 1968 Mustang with my daughter', description: 'Weekends in the garage, one part at a time.', start: 5, end: 15,
        actions: ['Find the car', 'Clear out the garage bay', 'Set a parts budget together'],
        notes: ['Got the old carburetor off with my daughter. Grease everywhere, both of us grinning.'],
        reflection: 'My daughter knows the name of every part now. Honestly, the car is the excuse; the weekends with her are the point.',
      },
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
    low: ['Hard to stay committed when everything else is on fire.', 'Showing up, but only just. This month asked a lot of me.', 'My heart is in it more than my calendar is right now.'],
    mid: ['Still in it, but I need to re-find the why.', 'Committed, though the busy weeks test it.', 'Not every week feels like a step, but I’m staying with it.'],
    high: ['All in. This matters to me more than I expected.', 'Fully committed. I’ve stopped treating this as optional.', 'I keep choosing this, even on the hard days.'],
  },
  satisfaction: {
    low: ['Progress feels slow. Trying to be patient with myself.', 'Not where I hoped to be by now, and that’s frustrating.', 'A harder month. I know the trend matters more than one number.'],
    mid: ['Satisfied with the direction, want more pace.', 'Happy with some parts, restless about others.', 'Pleased with the small wins, still waiting on the big ones.'],
    high: ['Genuinely proud of how far this has come.', 'Really pleased with this month. It feels like real progress.', 'Looking back at where I started, I’m proud.'],
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
// Private notes on shared ratings: whole notes in their own right, written for the level they sit at, so the
// thing kept back always fits the number beside it.
const PRIVATE_NOTES: Record<CareCategory, { low: string[]; mid: string[]; high: string[] }> = {
  energy: {
    low: [
      'Running on empty, and part of it is the medication change. Not ready to share that yet.',
      'The part I left out in the session: I’ve been skipping meals when work gets busy, and I can feel it.',
      'Not sleeping, mostly because I’m anxious about money again. Keeping that to myself for now.',
    ],
    mid: [
      'Okay on the surface. Honestly, the situation at home is what’s draining me, and that stays here for now.',
      'Some good days, some flat ones. The flat ones are about my mom’s health, which I’m not ready to talk about.',
      'Better than last month. What I haven’t said: I started taking something to help me sleep.',
    ],
    high: [
      'Lots of energy since I stopped drinking during the week. Not ready to make that a topic.',
      'Feeling strong, and I know why: I finally told my doctor what’s been going on. That stays with me for now.',
    ],
  },
  contribution: {
    low: [
      'Stuck at work, and I haven’t told anyone I’m thinking about leaving my job.',
      'No room to grow right now. I’m covering more at home for my mom than anyone at work knows.',
    ],
    mid: [
      'Growing a little. Keeping this between me and the page: I’m not sure I want the promotion.',
      'Okay at work. I applied for a job somewhere else last week and haven’t told anyone yet.',
    ],
    high: [
      'Learning fast, partly because I’m quietly getting ready to apply somewhere else. Not sharing that yet.',
      'My manager wants me for the new role. Exciting, but I haven’t told my family, because it means longer hours.',
    ],
  },
  alignment: {
    low: [
      'Doing work I don’t believe in to keep the overtime. Not ready to say that out loud.',
      'Off track, and some of it is grief. The anniversary is coming up.',
    ],
    mid: [
      'Mostly aligned. The piece I left out: I’m not sure I still want the big dream I wrote down.',
      'Getting there. Not sharing this one yet. I need to figure out how I feel first.',
    ],
    high: [
      'Clear on what matters, and part of that is deciding to leave my job in the spring. Nobody knows yet.',
      'Living closer to my values since a conversation with my dad that I’m keeping to myself.',
    ],
  },
  relationships: {
    low: [
      'Things at home are harder than I let on. That stays here for now.',
      'Pulling away from friends because money is tight and I can’t keep up with plans.',
    ],
    mid: [
      'Fine with most people. My brother and I aren’t speaking, and I’m not ready to talk about it.',
      'Calmer at home, but we’ve started seeing a counselor together, and that’s ours for now.',
    ],
    high: [
      'Really connected this month. I’ve started seeing someone, and I’m keeping it to myself for a while.',
      'Close with the family again since my sister and I made up. The whole story stays here.',
    ],
  },
};
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
// A note on a progress value right after the dreamer finished one of the dream's steps says so.
const STEP_NOTES: ((step: string) => string)[] = [
  (t) => `${t} — done.`,
  (t) => `${t} — done, and it moved this one along.`,
  (t) => `${t} — done. On to the next step.`,
  (t) => `${t} — finally done.`,
];
// Check-in reflections fit the check-in they belong to: nothing hard beside a good week, no bright news beside a low one.
const HARD_WEEK = new Set([
  'Rough week, but I kept one promise to myself, and that feels like enough.',
  'Wrote down three things that went right this week. The third took a while, but I found it.',
  'Cried in the car after work. Not about anything in particular. Just a lot.',
  'Some mornings I don’t want to do any of this. Today was one of them.',
  'Bad night. Old worries came back. I know they pass, but they’re loud right now.',
]);
const GOOD_WEEK = new Set([
  'Noticed today that I don’t dread Mondays anymore. Not sure when that changed.',
  'A resident told me I made her week. Carrying that around with me.',
  'Small wins count. I kept the morning routine for five days straight.',
  'Tried the thing I was afraid of. It was fine. It was actually fine.',
  'Talked about the dream out loud at dinner. Saying it made it feel real.',
  'Someone at work asked me for advice. I didn’t realize people saw me that way.',
  'Had a good laugh with the team today. I want to remember that work can feel like this.',
  'Caught myself planning the next step without being asked. That feels like ownership.',
  'Told a friend about one of my dreams. She didn’t laugh. She asked how she could help.',
  'Some days the dream feels close, some days far. Today it felt close.',
  'Spent the evening on something just for me. No guilt.',
  'Finally cleared out my inbox. Felt like opening a window.',
  'Asked for help with something I usually push through alone. It went better than I expected.',
]);
type Level = 'low' | 'mid' | 'high';
const fitsLevel = (text: string, level: Level) => !(level === 'low' && GOOD_WEEK.has(text)) && !(level === 'high' && HARD_WEEK.has(text));
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
type Mood = 'first' | 'up' | 'steady' | 'down' | 'tired';
const OPENERS: Record<Mood, string[]> = {
  first: ['First session — got to know each other and set starting points.', 'First conversation: the four dreams, the CARE wheel, and how we’ll work together.'],
  up: [
    'In good spirits today.', 'Upbeat and ready to go.', 'Came in smiling — a good month.', 'Lots to share today, most of it good news.',
    'Bright and talkative from the start.', 'Proud of the month, and it showed.', 'Light, easy energy today — a lot went right.', 'Started with a win to share before we even sat down.',
  ],
  steady: [
    'Arrived a little rushed but settled quickly.', 'A steady month; came in with a clear list.', 'Calm and focused today.', 'Easy conversation; picked up right where we left off.',
    'A quieter month, nothing dramatic — a good time to take stock.', 'Came in with questions already written down.', 'Settled and thoughtful; we went straight to the dreams.',
    'Even-keeled today; a month of small, steady steps.', 'Short on time, but a focused conversation.', 'Comfortable start — talked about the week before rating.',
  ],
  down: [
    'Reflective mood; wanted to talk before rating.', 'A heavier month — we took our time.', 'Quiet at first, opened up around the dreams.',
    'A harder month; we slowed down and listened first.', 'Some frustration today, and we made room for it.',
  ],
  tired: [
    'Tired but engaged — a long week.', 'Low on energy today; we kept the pace gentle.', 'Worn out from a busy stretch, still showed up ready to talk.',
    'Running low this month; we kept it short and kind.', 'Visibly tired, but wanted to keep the session.',
  ],
};
// Once a mood's openers are used up, the nearest mood lends one before anything repeats.
const NEAR_MOOD: Record<Mood, Mood> = { first: 'steady', up: 'steady', steady: 'up', down: 'tired', tired: 'down' };
/** Openers that describe the month itself as uneventful. */
const QUIET_MONTH = /quieter month|small, steady steps|steady month/;
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
// Focus for the coming month: a dream just achieved, a CARE area that slipped or sits low, otherwise the dream the
// new actions serve (or the lowest area that did not just rise).
const CARE_FOCUS: Record<CareCategory, string[]> = {
  energy: ['Energy — rebuild the morning routine', 'Energy — protect sleep on weeknights', 'Energy — keep moving a little every day', 'Energy — build in one real rest day', 'Energy — eat properly on the busy days'],
  contribution: ['Contribution — ask for the stretch', 'Contribution — make room to learn something new', 'Contribution — share what you know with someone', 'Contribution — notice and name what you’re learning'],
  alignment: ['Alignment — say no to what doesn’t fit', 'Alignment — let the week reflect what matters', 'Alignment — check big choices against your values', 'Alignment — make time for what you say matters'],
  relationships: ['Relationships — reconnect with people who matter', 'Relationships — make home a calmer place', 'Relationships — protect one evening for family', 'Relationships — reach out instead of waiting to be asked'],
};
const DREAM_FOCUS = {
  start: ['sketch the first small step', 'choose one way to begin', 'gather information before deciding'], // early, nothing done yet
  early: ['build on the first step', 'talk it over with someone who has done it', 'pick the next small step'], // early, a step done
  middle: ['the next concrete step', 'make room in the week for it', 'turn the plan into dates on the calendar', 'keep the momentum going'],
  late: ['plan the last stretch', 'protect what’s working', 'finish what’s already in motion'],
  done: ['celebrate, then decide what comes next'],
};

// Texts that name a day or a time of day are only written then (demo-zone time; 0 = Sunday).
const WEEKDAYS = [1, 2, 3, 4, 5];
const TEXT_TIMES: [RegExp, Hours][] = [
  [/quiet Sunday/, { days: [0], hours: [14, 22] }],
  [/dread Mondays/, { days: [1], hours: [17, 22] }],
  [/tonight|at dinner|the evening on/, { hours: [19, 23] }],
  [/Some nights|Bad night/, { hours: [21, 24] }],
  [/walk at lunch|after work|with the team today|team announcement/, { days: WEEKDAYS, hours: [17, 22] }],
  [/on Saturday/, { days: [0, 1, 2, 3] }],
  [/by Thursday/, { days: [5, 6, 0] }],
];
const textTime = (text: string): Hours | undefined => TEXT_TIMES.find(([re]) => re.test(text))?.[1];
/** Whether `text` could have been written at `t`. */
const fitsTime = (text: string, t: number) => { const w = textTime(text); return !w || slots(t, t, w).length > 0; };

// How each dream horizon moves from session to session: nearer dreams most months, the 3–5 year and lifetime
// dreams in small, occasional steps (at most `step` points at a time, even after a few quiet months). Only the
// nearer-term dreams take the odd honest dip.
const DREAM_PACE = [
  { move: 0.85, wobble: 3, dip: 0.08, step: Infinity }, // 6–12 month dream
  { move: 0.9, wobble: 3, dip: 0, step: Infinity }, // program dream
  { move: 0.55, wobble: 2, dip: 0.05, step: 6 }, // 3–5 year dream
  { move: 0.35, wobble: 1, dip: 0, step: 4 }, // lifetime dream
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
// Alignment rating with a note, and a shared Energy rating whose note is private. They fall in the last ten days,
// after the latest session and a day or more clear of any, so they are easy to find and “the session” they
// mention has already happened. `rulesOut` lists the bank texts that would repeat or contradict them; that dreamer
// never gets those.
interface PrivacyExample { action: string; actionDetails: string; reflection: string; alignmentNote: string; energyNote: string; rulesOut: string[] }
const PRIVACY_EXAMPLES: Record<string, PrivacyExample> = {
  'alicia@dreamcoach.demo': {
    action: 'Ask HR about tuition reimbursement before I tell anyone',
    actionDetails: 'If the answer is no, I want time to work out the next step on my own.',
    reflection: 'Mom asked again when I’ll “finally” finish my degree. I laughed it off, but it stung. I want to finish it for me, not to end that conversation.',
    alignmentNote: 'Picked up two extra weekend shifts for the money, and the garden plan slid again. That isn’t a trade I want to keep making.',
    energyNote: 'Long run on Saturday felt good. What I didn’t say in the session: I’m only sleeping five hours on shift weeks.',
    rulesOut: ['Clear on what matters, and part of that is deciding to leave my job in the spring. Nobody knows yet.'],
  },
  'darnell@dreamcoach.demo': {
    action: 'Book the physical I keep pushing back',
    actionDetails: 'Haven’t told Keisha that the pharmacy machine read my blood pressure high.',
    reflection: 'Some nights I wonder if the mentoring program is me trying to give those kids what nobody gave me. Maybe that’s a fine reason. I just want to be honest about it.',
    alignmentNote: 'Said yes to the church board because I couldn’t say no to Pastor James. It takes the evenings I promised the boys.',
    energyNote: 'Morning walks are holding. Not ready to say this out loud yet: I get winded on the stairs at Cedar Court, and it scares me a little.',
    rulesOut: [
      'Book a check-up — it’s been three years',
      'Doctor’s appointment next week. Trying not to spiral.',
      'Sometimes I wonder if I picked the safe dreams so I couldn’t fail at the big ones.',
      'Running on empty, and part of it is the medication change. Not ready to share that yet.',
      'Feeling strong, and I know why: I finally told my doctor what’s been going on. That stays with me for now.',
    ],
  },
  'grace@dreamcoach.demo': {
    action: 'Update my résumé for the People Ops role at Fernhill Collective',
    actionDetails: 'Not ready for anyone at work to know I’m looking.',
    reflection: 'Got passed over for the HR business partner role and smiled through the team announcement. I’m not fine about it yet. Writing it here so I can be honest somewhere.',
    alignmentNote: 'Spent the week defending a leave policy I don’t believe in. Repeating the company line is costing me something.',
    energyNote: 'Planning the next dinner gave me a lift this week. Also: I started seeing a therapist on Thursdays, and that’s mine for now.',
    rulesOut: [
      'Make the therapy appointment I keep putting off',
      'Calmer at home, but we’ve started seeing a counselor together, and that’s ours for now.',
      'Growing a little. Keeping this between me and the page: I’m not sure I want the promotion.',
      'My manager wants me for the new role. Exciting, but I haven’t told my family, because it means longer hours.',
    ],
  },
};
const PRIVATE_BANKS: readonly (readonly string[])[] = [PRIVATE_ACTIONS, REFLECTIONS_PRIVATE, ...Object.values(PRIVATE_NOTES).flatMap((n) => [n.low, n.mid, n.high])];
for (const { rulesOut } of Object.values(PRIVACY_EXAMPLES)) {
  for (const t of rulesOut) if (!PRIVATE_BANKS.some((bank) => bank.includes(t))) throw new Error(`rulesOut text is in no bank: ${t}`);
}
for (const t of [...HARD_WEEK, ...GOOD_WEEK]) if (!REFLECTIONS_SHARED.includes(t) && !REFLECTIONS_PRIVATE.includes(t)) throw new Error(`mood text is in no bank: ${t}`);
// Any month can choose any step, so no action names a calendar date; and the demo's own staff only ever appear as
// themselves, so no action or dreamer's words name one of them.
const ACTION_TITLES = [...DREAMERS.flatMap((d) => d.dreams.flatMap((x) => x.actions)), ...Object.values(CARE_ACTIONS).flat(), ...PRIVATE_ACTIONS, ...Object.values(PRIVACY_EXAMPLES).map((e) => e.action)];
const DREAM_WORDS = DREAMERS.flatMap((d) => d.dreams.flatMap((x) => [...x.notes, x.reflection ?? '', x.achieved ?? '']));
const STAFF_NAME = new RegExp(`\\b(${[DIRECTOR, ...COACHES].flatMap((p) => p.name.split(' ')).join('|')})\\b`);
const CALENDAR_DATE = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b|\b\d{1,2}(st|nd|rd|th)\b/;
for (const t of ACTION_TITLES) if (CALENDAR_DATE.test(t)) throw new Error(`action names a date: ${t}`);
for (const t of [...ACTION_TITLES, ...DREAM_WORDS]) if (STAFF_NAME.test(t)) throw new Error(`names a staff member: ${t}`);

/* ---------- insert helpers ---------- */
/** Runs an INSERT whose first parameter is the row id with a fresh random id, and returns that id. */
function insert(stmt: Statement, ...values: unknown[]): number {
  const id = newId();
  stmt.run(id, ...values);
  return id;
}
function insertUser(db: DB, p: Person, role: 'dreamer' | 'coach' | 'director', hash: string): number {
  const r = db.prepare('INSERT INTO users (email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?)').run(p.email, hash, p.name, role, at(monthStartUTC(9)));
  return Number(r.lastInsertRowid);
}

export interface SeedSummary { users: number; dreamers: number; sessions: number; ratings: number; progress: number; journal: number; actions: number; checkIns: number; private: number }

export function resetAndSeed(db: DB): SeedSummary {
  rnd = mulberry32(20260216);
  idRnd = mulberry32(48151623);
  wordsRnd = mulberry32(31415926);
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

    // Rows a dreamer can make private get random ids (DECISIONS #23); use them with insert().
    const insRating = db.prepare(
      `INSERT INTO ratings (id, dreamer_id, category, value, occurred_at, source, session_id, check_in_id, recorded_by, is_private, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insProgress = db.prepare(
      `INSERT INTO dream_progress (id, dreamer_id, dream_id, value, occurred_at, source, session_id, check_in_id, recorded_by, is_private, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insJournal = db.prepare(
      `INSERT INTO journal_entries (id, dreamer_id, body, occurred_at, is_private, source, session_id, check_in_id, rating_id, progress_id, dream_id, category, author_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insAction = db.prepare(
      `INSERT INTO actions (id, dreamer_id, title, details, status, dream_id, category, is_private, created_by, session_id, created_at, completed_at, archived_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insCheckIn = db.prepare('INSERT INTO check_ins (id, dreamer_id, occurred_at, created_by, created_at) VALUES (?, ?, ?, ?, ?)');

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
        // session day: a weekday from the 3rd to the 20th, starting 9:00–15:45 Eastern for 15–30 minutes, clear of
        // the coach's other sessions
        let date: number, start: number, end: number;
        do {
          date = Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 3 + Math.floor(rand() * 17));
          start = unwall(date + (9 + Math.floor(rand() * 7)) * HOUR + pick([0, 15, 30, 45]) * MINUTE);
          end = start + (15 + Math.floor(rand() * 15)) * 60000;
        } while (!WEEKDAYS.includes(new Date(date).getUTCDay()) || calendar.some(([a, b]) => start < b + 15 * 60000 && a < end + 15 * 60000));
        // in the current month only if that day has already passed
        const held = !upcoming && date <= NOW.getTime() - DAY;
        if (held) calendar.push([start, end]);
        const progressT = Math.min(1, (spec.joinedMonthsAgo - m) / Math.max(1, spec.joinedMonthsAgo)); // 0..1

        // Ratings walk toward the dreamer's trend, at most two points a month and never straight back by more than a
        // point after a move, so a change the notes describe is one that holds.
        const walk = (cat: RatingCategory, [s, e]: [number, number], wobble: number): number => {
          const target = s + (e - s) * progressT;
          const was = prev?.ratings[cat];
          if (was == null) return Math.round(target + jitter(wobble));
          const lastStep = was - (plan[plan.length - 2]?.ratings[cat] ?? was);
          let step = clamp(Math.round((target - was) * 0.6 + (rand() * 2 - 1) * wobble), -2, 2);
          if (lastStep * step < 0) step = Math.sign(step);
          return was + step;
        };
        const ratings = {} as Record<RatingCategory, number>;
        for (const cat of CARE_CATEGORIES) {
          let v = walk(cat, spec.care[cat], 1);
          // Darnell's energy story: a dip two months ago, back to 8 by the next session.
          if (spec.email === 'darnell@dreamcoach.demo' && cat === 'energy' && m === 2) v = 4;
          if (spec.email === 'darnell@dreamcoach.demo' && cat === 'energy' && m === 1) v = 8;
          ratings[cat] = clamp(v, 1, 10);
        }
        ratings.commitment = clamp(walk('commitment', spec.commitment, 0.6), 1, 10);
        ratings.satisfaction = clamp(walk('satisfaction', spec.satisfaction, 0.6), 1, 10);

        // Dream progress: catches up with the planned path at each dream's own pace, never sliding back
        // except for the odd honest dip (never two in a row).
        const progress = spec.dreams.map((d, i) => {
          const pace = DREAM_PACE[i]!;
          const was = prev?.progress[i];
          const dipped = was != null && was < (plan[plan.length - 2]?.progress[i] ?? 0);
          let v: number;
          if (was == null) v = d.start;
          else if (!dipped && chance(pace.dip)) v = was - (2 + Math.floor(rand() * 3));
          else if (chance(pace.move)) v = Math.max(was, Math.min(was + pace.step, Math.round(d.start + (d.end - d.start) * progressT + jitter(pace.wobble))));
          else v = was;
          if (d.end >= 100 && progressT >= 0.85) v = 100;
          return clamp(v, 0, 100);
        });
        // The month a dream is achieved is never one in which commitment or satisfaction fall.
        if (prev && progress.some((v, i) => v >= 100 && prev.progress[i]! < 100)) {
          ratings.commitment = Math.max(ratings.commitment, prev.ratings.commitment);
          ratings.satisfaction = Math.max(ratings.satisfaction, prev.ratings.satisfaction);
        }
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
      const lastProgressAt = spec.dreams.map(() => plan[0]!.start); // and when it was recorded
      const dreamActionIdx = spec.dreams.map(() => 0);
      const openActions: { id: number; createdAt: string; dream: number | null; title: string }[] = [];
      // Completed dream steps, so the focus never asks for a first step twice and a progress note can name the step
      // just finished (each step once).
      const stepsDone: { dream: number; at: number; title: string; told?: boolean }[] = [];
      const example = PRIVACY_EXAMPLES[spec.email];
      const used = new Set<string>(example?.rulesOut); // texts and titles this dreamer already has, or must not get
      // Steps go to the dreams that have moved furthest ahead of the steps already chosen for them, so a dream's
      // progress is backed by steps taken along the way.
      const stepWeight = (i: number, progress: number) => {
        const d = spec.dreams[i]!;
        const due = d.actions.length * clamp((progress - d.start) / Math.max(1, d.end - d.start), 0, 1);
        return Math.max(0.2, due + 0.5 - dreamActionIdx[i]!);
      };
      const hasSteps = (i: number, progress: number) => dreamActionIdx[i]! < spec.dreams[i]!.actions.length && progress < 100;
      /** The dreamer's words on a progress value recorded at `t`: the step they finished since the dream's last entry, else a line of their own. */
      const progressWords = (di: number, since: number, t: number): string | null => {
        const step = stepsDone.find((s) => s.dream === di && !s.told && s.at > since && s.at <= t);
        if (step) {
          step.told = true;
          return pick(STEP_NOTES, wordsRand)(step.title);
        }
        return pickUnused(spec.dreams[di]!.notes, used, wordsRand);
      };
      // Reflections written about a particular dream, spread across the months (an engaged dreamer writes them).
      const dreamReflections = spec.engagement === 'light' ? [] : spec.dreams.flatMap((d, i) => (d.reflection ? [{ dream: i, body: d.reflection }] : []));
      const heldCount = plan.filter((s) => s.held).length;
      const reflectionDue = dreamReflections.map((_, r) => Math.floor(((r + 0.5) * heldCount) / dreamReflections.length));

      for (let k = 0; k < plan.length && plan[k]!.held; k++) {
        const p = plan[k]!;
        const prev = plan[k - 1];
        const next = plan[k + 1];
        const occurredAt = new Date(p.start).toISOString();
        const completedAt = new Date(p.end).toISOString();
        // Actions are ticked off or set aside in the review step, after the ratings and dream progress.
        const reviewAt = new Date(p.start + Math.round(((p.end - p.start) * (0.4 + rand() * 0.3)) / MINUTE) * MINUTE).toISOString();

        const sessionId = Number(
          db
            .prepare(`INSERT INTO coaching_sessions (dreamer_id, coach_user_id, status, occurred_at, completed_at, notes, focus, actions_reviewed, created_at, updated_at) VALUES (?, ?, 'completed', ?, ?, '', '', 1, ?, ?)`)
            .run(dreamerId, coachUserId, occurredAt, completedAt, occurredAt, completedAt).lastInsertRowid,
        );
        counts.sessions++;
        for (const [cat, v] of Object.entries(p.ratings) as [RatingCategory, number][]) {
          insert(insRating, dreamerId, cat, v, occurredAt, 'session', sessionId, null, coachUserId, 0, occurredAt, completedAt);
          counts.ratings++;
        }
        const sinceLast = [...lastProgressAt]; // for the dreamer's notes on these values, below
        const progressIds = p.progress.map((v, i) => {
          const id = insert(insProgress, dreamerId, dreamIds[i], v, occurredAt, 'session', sessionId, null, coachUserId, 0, occurredAt, completedAt);
          counts.progress++;
          lastProgress[i] = v;
          lastProgressAt[i] = p.start;
          if (v >= 100) db.prepare('UPDATE dreams SET achieved_at = COALESCE(achieved_at, ?) WHERE id = ?').run(occurredAt, dreamIds[i]);
          return id;
        });

        // Coach notes: an opener that fits the session, the CARE moves, and a dream achieved or the dream that moved most.
        const achieved = prev ? p.progress.findIndex((v, i) => v >= 100 && prev.progress[i]! < 100) : -1;
        const moved = prev ? p.progress.map((v, i) => ({ i, v, by: v - prev.progress[i]! })).filter((d) => d.i !== achieved).sort((a, b) => b.by - a.by)[0] : undefined;
        const careShift = prev ? CARE_CATEGORIES.reduce((n, c) => n + p.ratings[c] - prev.ratings[c], 0) / CARE_CATEGORIES.length : 0;
        const mood: Mood = !prev ? 'first' : achieved >= 0 ? 'up' : p.ratings.energy <= 4 ? 'tired' : careShift >= 0.75 ? 'up' : careShift <= -0.75 ? 'down' : 'steady';
        // A month in which a dream took a big step is never called a quiet one.
        const openers = (m: Mood) => OPENERS[m].filter((o) => !((moved?.by ?? 0) >= 8 && QUIET_MONTH.test(o)));
        const lines: string[] = [pickFresh(used, openers(mood), openers(NEAR_MOOD[mood]))];
        for (const cat of CARE_CATEGORIES) {
          const v = p.ratings[cat];
          const was = prev?.ratings[cat];
          if (was == null || Math.abs(v - was) < 2) continue;
          const moves = CARE_MOVES[cat][v > was ? (v >= 7 ? 'upHigh' : 'up') : v <= 4 ? 'downLow' : 'down'];
          lines.push(`${cat[0]!.toUpperCase()}${cat.slice(1)} ${v > was ? 'up' : 'down'} to ${v} (from ${was}) — ${pickFresh(used, moves)}`);
        }
        if (achieved >= 0) lines.push(`“${spec.dreams[achieved]!.title}” reached 100% — a dream achieved. We took time to celebrate before looking ahead.`);
        if (moved && moved.by >= 3) lines.push(`Most movement on “${spec.dreams[moved.i]!.title}” — up ${moved.by} points to ${moved.v}%.`);

        // Review previous actions: some were done in between (at a waking hour) or are ticked off now; some set aside.
        for (const a of [...openActions]) {
          const roll = rand();
          if (roll < 0.55) {
            // It was still open at the last review, so it was done after that session (and after it was added).
            const due = Math.max(Date.parse(a.createdAt), prev?.end ?? 0) + (3 + rand() * 25) * DAY;
            const between = due < p.start - HOUR ? timeBetween(due - 12 * HOUR, Math.min(due + 12 * HOUR, p.start - HOUR)) : null;
            const doneAt = between != null ? new Date(between).toISOString() : reviewAt;
            db.prepare(`UPDATE actions SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?`).run(doneAt, doneAt, a.id);
            if (a.dream != null) stepsDone.push({ dream: a.dream, at: Date.parse(doneAt), title: a.title });
            openActions.splice(openActions.indexOf(a), 1);
          } else if (roll < 0.7) {
            db.prepare(`UPDATE actions SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?`).run(reviewAt, reviewAt, a.id);
            openActions.splice(openActions.indexOf(a), 1);
          }
        }

        // New actions chosen in this session (1–3), tied to dreams or CARE. A CARE area that slipped two points
        // or sits at 4 or below becomes the focus, and the first action is a habit for it. Other habits go to the
        // lowest areas that did not just rise, and a dream already achieved gets no new steps.
        const drop = (c: CareCategory) => (prev ? prev.ratings[c] - p.ratings[c] : 0);
        const slipped = CARE_CATEGORIES.filter((c) => drop(c) >= 2 || p.ratings[c] <= 4).sort((a, b) => drop(b) - drop(a) || p.ratings[a] - p.ratings[b])[0];
        const calm = CARE_CATEGORIES.filter((c) => drop(c) > -2).sort((a, b) => p.ratings[a] - p.ratings[b]); // lowest first
        const hasHabits = (c: CareCategory) => CARE_ACTIONS[c].some((t) => !used.has(t));
        const nActions = 1 + Math.floor(rand() * 3);
        const chosen: string[] = [];
        // Chosen near the end of the session, a few seconds apart, in the order the notes list them.
        const chosenAt = () => new Date(p.end - 2 * MINUTE + chosen.length * 15_000).toISOString();
        let focusDream: number | null = null;
        let focusCare: CareCategory | null = slipped ?? null;
        for (let n = 0; n < nActions; n++) {
          const forSlipped = n === 0 && !!slipped && hasHabits(slipped);
          const areas = forSlipped ? [slipped] : calm.filter(hasHabits).slice(0, 2);
          const dreams = [0, 1, 2, 3].filter((i) => hasSteps(i, p.progress[i]!));
          if (!forSlipped && dreams.length && (chance(0.7) || !areas.length)) {
            const di = pickWeighted(dreams, (i) => stepWeight(i, p.progress[i]!));
            const title = spec.dreams[di]!.actions[dreamActionIdx[di]!]!;
            dreamActionIdx[di]!++;
            const createdAt = chosenAt();
            const id = insert(insAction, dreamerId, title, '', 'active', dreamIds[di], null, 0, coachUserId, sessionId, createdAt, null, null, createdAt);
            openActions.push({ id, createdAt, dream: di, title });
            chosen.push(title);
            counts.actions++;
            focusDream ??= di;
            continue;
          }
          if (!areas.length) break; // nothing left to choose from
          const cat = pick(areas);
          const title = pickUnused(CARE_ACTIONS[cat], used)!;
          const createdAt = chosenAt();
          const id = insert(insAction, dreamerId, title, '', 'active', null, cat, 0, coachUserId, sessionId, createdAt, null, null, createdAt);
          openActions.push({ id, createdAt, dream: null, title });
          chosen.push(title);
          counts.actions++;
          if (focusDream == null) focusCare ??= cat;
        }
        // Focus: a dream just achieved, the slipped area, the dream the new steps serve, or the lowest calm area.
        const dreamFocus = (di: number): string | null => {
          const v = p.progress[di]!;
          const begun = stepsDone.some((s) => s.dream === di && s.at <= p.end);
          const stage = v >= 65 ? DREAM_FOCUS.late : v >= 15 ? DREAM_FOCUS.middle : begun ? DREAM_FOCUS.early : DREAM_FOCUS.start;
          return pickUnused(stage.map((phrase) => `${spec.dreams[di]!.title} — ${phrase}`), used);
        };
        const careFocus = (cat: CareCategory) => pickFresh(used, CARE_FOCUS[cat], ...(cat === slipped ? [] : calm.filter((c) => c !== cat).map((c) => CARE_FOCUS[c])));
        const focus = achieved >= 0
          ? `${spec.dreams[achieved]!.title} — ${pick(DREAM_FOCUS.done)}`
          : (focusDream != null && !slipped ? dreamFocus(focusDream) : null) ?? careFocus(focusCare ?? calm[0] ?? CARE_CATEGORIES[0]);
        if (chosen.length) lines.push(`Actions chosen: ${chosen.join('; ')}.`);
        lines.push(`Commitment ${p.ratings.commitment}, satisfaction ${p.ratings.satisfaction}.`);
        db.prepare('UPDATE coaching_sessions SET notes = ?, focus = ? WHERE id = ?').run(lines.join('\n'), focus, sessionId);

        // Afterwards the dreamer adds their own words to some of the dream values recorded in the session (DECISIONS
        // #2): the dream they just achieved, or ones that moved or saw a step finished since their last entry. Dated
        // when written — that evening or in the next few days — the note keeps the session's date as its own.
        const noteBy = Math.min(p.end + 3 * DAY, (next?.held ? next.start : NOW.getTime()) - HOUR);
        const noteChance = spec.engagement === 'high' ? 0.5 : spec.engagement === 'moderate' ? 0.3 : 0;
        let notesWritten = 0;
        for (let i = 0; i < spec.dreams.length && noteChance > 0 && notesWritten < 2; i++) {
          const isAchieved = i === achieved;
          const stepped = stepsDone.some((st) => st.dream === i && !st.told && st.at > sinceLast[i]! && st.at <= p.end);
          if (!isAchieved && !(prev && p.progress[i]! - prev.progress[i]! >= 3) && !stepped) continue;
          if (!isAchieved && !chance(stepped ? 0.8 : noteChance, wordsRand)) continue;
          const writtenAt = timeBetween(p.end + HOUR, noteBy, undefined, wordsRand);
          const body = (isAchieved ? spec.dreams[i]!.achieved : null) ?? progressWords(i, sinceLast[i]!, p.end);
          if (writtenAt == null || !body) continue;
          const written = new Date(writtenAt).toISOString();
          insert(insJournal, dreamerId, body, occurredAt, 0, 'session', sessionId, null, null, progressIds[i], dreamIds[i], null, userId, written, written);
          counts.journal++;
          notesWritten++;
        }

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
          const when = at(zoneDate(t), 8 + Math.floor(rand() * 14), pick([0, 10, 20, 30, 40, 50]));
          const tWhen = new Date(when).getTime();
          const ciId = insert(insCheckIn, dreamerId, when, userId, when);
          counts.checkIns++;
          // Which categories? 1–3 CARE areas, and now and then Commitment or Satisfaction for the more engaged.
          let cats: RatingCategory[] = CARE_CATEGORIES.filter(() => chance(0.45));
          if (!cats.length) cats = [pick(CARE_CATEGORIES)];
          if (spec.engagement !== 'light' && chance(0.25)) cats.push(pick(PROGRAM_CATEGORIES));
          // Darnell's story: Energy 4 in the first check-in after August's session, 8 by the last one.
          let scripted: { cat: RatingCategory; value: number; note: string } | null = null;
          if (story && idx === 0) scripted = { cat: 'energy', value: 4, note: ENERGY_STORY.low };
          if (story && idx === nCheckIns - 1) scripted = { cat: 'energy', value: 8, note: ENERGY_STORY.high };
          if (scripted) cats = [scripted.cat, ...cats.filter((c) => c !== scripted!.cat)].slice(0, 2);
          else if (story && !cats.includes('energy')) cats = ['energy', ...cats]; // …and on its way up in between
          const values: number[] = [];
          for (const cat of cats) {
            // Self ratings travel from this session's value toward the next one, with the odd one-point wobble.
            let v = clamp(Math.round(along(k, tWhen, (s) => s.ratings[cat])) + (chance(0.2) ? jitter(1) : 0), 1, 10);
            let noteText: string | null = null;
            let ratingPrivate = false;
            let notePrivate = false;
            if (scripted && cat === scripted.cat) { v = scripted.value; noteText = scripted.note; }
            else {
              if (story && cat === 'energy') v = clamp(v, 5, 7);
              const level = v <= 4 ? 'low' : v <= 7 ? 'mid' : 'high';
              ratingPrivate = chance(0.12);
              if (chance(0.6)) {
                const kept = !ratingPrivate && isCareCategory(cat) && chance(0.2) ? pickUnused(PRIVATE_NOTES[cat][level], used) : null;
                noteText = kept ?? pickUnused(NOTES[cat][level].filter((x) => fitsTime(x, tWhen)), used);
                notePrivate = kept != null;
              }
            }
            values.push(v);
            const ratingId = insert(insRating, dreamerId, cat, v, when, 'self', null, ciId, userId, ratingPrivate ? 1 : 0, when, when);
            counts.ratings++;
            if (ratingPrivate) counts.private++;
            if (noteText) {
              insert(insJournal, dreamerId, noteText, when, notePrivate ? 1 : 0, 'self', null, ciId, ratingId, null, null, cat, userId, when, when);
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
              const since = lastProgressAt[di]!;
              lastProgress[di] = v;
              lastProgressAt[di] = tWhen;
              const isPriv = chance(0.15);
              const progressId = insert(insProgress, dreamerId, dreamIds[di], v, when, 'self', null, ciId, userId, isPriv ? 1 : 0, when, when);
              counts.progress++;
              if (isPriv) counts.private++;
              // In their own words: the step just finished, a line about this dream, or — once those are used — a general one.
              const note = chance(0.65) ? progressWords(di, since, tWhen) ?? pickUnused(step >= 5 ? PROGRESS_NOTES.big : PROGRESS_NOTES.small, used, wordsRand) : null;
              if (note) {
                insert(insJournal, dreamerId, note, when, 0, 'self', null, ciId, null, progressId, dreamIds[di], null, userId, when, when);
                counts.journal++;
              }
              if (v >= 100 && !isPriv) db.prepare('UPDATE dreams SET achieved_at = COALESCE(achieved_at, ?) WHERE id = ?').run(when, dreamIds[di]);
            }
          }
          // Check-in level reflection, in keeping with how the check-in went (the story's last check-in is its good news).
          if (chance(spec.engagement === 'high' ? 0.5 : 0.3)) {
            const priv = chance(0.3);
            const mean = values.reduce((n, x) => n + x, 0) / values.length;
            const level: Level = scripted ? (scripted.value >= 7 ? 'high' : 'low') : mean < 5 ? 'low' : mean >= 7 ? 'high' : 'mid';
            const body = pickUnused((priv ? REFLECTIONS_PRIVATE : REFLECTIONS_SHARED).filter((b) => fitsTime(b, tWhen) && fitsLevel(b, level)), used);
            if (body) {
              insert(insJournal, dreamerId, body, when, priv ? 1 : 0, 'self', null, ciId, null, null, null, null, userId, when, when);
              counts.journal++;
              if (priv) counts.private++;
            }
          }
        }

        // Standalone journal entries & dreamer-created actions in this window, at waking hours
        const nJournal = spec.engagement === 'high' ? 2 : spec.engagement === 'moderate' ? 1 : 0;
        for (let j = 0; j < nJournal && span > 0; j++) {
          const priv = chance(0.35);
          // The reflection banks are about life in general, so they are not tagged to a particular dream. One that
          // names a day or a time of day is only written then.
          const body = pickUnused((priv ? REFLECTIONS_PRIVATE : REFLECTIONS_SHARED).filter((b) => slots(windowStart, windowEnd, textTime(b)).length), used);
          if (!body) continue;
          const when = new Date(timeBetween(windowStart, windowEnd, textTime(body))!).toISOString();
          insert(insJournal, dreamerId, body, when, priv ? 1 : 0, 'self', null, null, null, null, null, null, userId, when, when);
          counts.journal++;
          if (priv) counts.private++;
        }
        // A reflection about one of the dreams, tagged to it, when its turn comes (or at the next window with room).
        const r = dreamReflections.findIndex((_, i) => reflectionDue[i]! <= k && reflectionDue[i]! >= 0);
        const reflectionAt = r >= 0 && span > DAY ? timeBetween(windowStart, windowEnd, textTime(dreamReflections[r]!.body), wordsRand) : null;
        if (reflectionAt != null) {
          const when = new Date(reflectionAt).toISOString();
          insert(insJournal, dreamerId, dreamReflections[r]!.body, when, 0, 'self', null, null, null, null, dreamIds[dreamReflections[r]!.dream], null, userId, when, when);
          counts.journal++;
          reflectionDue[r] = -1;
        }
        const actionAt = spec.engagement !== 'light' && span > 0 && chance(0.6) ? timeBetween(windowStart, windowEnd) : null;
        if (actionAt != null) {
          const when = new Date(actionAt).toISOString();
          const priv = chance(0.35);
          const withSteps = [0, 1, 2, 3].filter((i) => hasSteps(i, lastProgress[i]!));
          const di = withSteps.length ? pickWeighted(withSteps, (i) => stepWeight(i, lastProgress[i]!)) : -1;
          // A private action, the next step of a dream (the further it has moved, the likelier), or — once those run
          // out — a CARE habit.
          let title: string | null;
          let dreamId: number | null = null;
          let category: CareCategory | null = null;
          if (priv) title = pickUnused(PRIVATE_ACTIONS, used);
          else if (di >= 0) { title = spec.dreams[di]!.actions[dreamActionIdx[di]!]!; dreamActionIdx[di]!++; dreamId = dreamIds[di]!; }
          else { const areas = CARE_CATEGORIES.filter(hasHabits); category = areas.length ? pick(areas) : null; title = category && pickUnused(CARE_ACTIONS[category], used); }
          if (title) {
            const due = chance(0.4) ? actionAt + (2 + rand() * 12) * DAY : null;
            const doneAt = due != null && due < NOW.getTime() - HOUR ? timeBetween(due - 12 * HOUR, Math.min(due + 12 * HOUR, NOW.getTime() - HOUR)) : null;
            const doneIso = doneAt != null ? new Date(doneAt).toISOString() : null;
            const id = insert(insAction, dreamerId, title, '', doneIso ? 'completed' : 'active', dreamId, category, priv ? 1 : 0, userId, null, when, doneIso, null, doneIso ?? when);
            // Shared open actions come up for review at the next session; private ones are the dreamer's alone.
            if (!doneIso && !priv) openActions.push({ id, createdAt: when, dream: dreamId == null ? null : di, title });
            if (doneAt != null && dreamId != null) stepsDone.push({ dream: di, at: doneAt, title });
            counts.actions++;
            if (priv) counts.private++;
          }
        }
      }

      // ---- Guaranteed demo privacy examples, personal to each main demo dreamer ----
      if (example) {
        // The last ten days, starting a day after the latest session; if that session was only just held, the ten
        // days before it instead. The action, the reflection and the check-in each take a third, in that order.
        const held = plan.filter((s) => s.held);
        const last = held[held.length - 1]!;
        let from = Math.max(last.end + DAY, NOW.getTime() - 10 * DAY);
        let to = NOW.getTime() - 2 * HOUR;
        if (to - from < 2 * DAY) {
          from = Math.max((held[held.length - 2]?.end ?? 0) + DAY, last.start - 10 * DAY);
          to = last.start - DAY;
        }
        const third = (to - from) / 3;
        const place = (text: string, i: number) =>
          timeBetween(from + i * third, from + (i + 1) * third, textTime(text)) ?? timeBetween(from, to, textTime(text)) ?? timeBetween(from, to) ?? from;
        const whenA = new Date(place(example.action, 0)).toISOString();
        insert(insAction, dreamerId, example.action, example.actionDetails, 'active', null, null, 1, userId, null, whenA, null, null, whenA);
        counts.actions++; counts.private++;
        const whenJ = new Date(place(example.reflection, 1)).toISOString();
        insert(insJournal, dreamerId, example.reflection, whenJ, 1, 'self', null, null, null, null, null, null, userId, whenJ, whenJ);
        counts.journal++; counts.private++;
        const tC = place(`${example.alignmentNote} ${example.energyNote}`, 2);
        const whenC = new Date(tC).toISOString();
        const ciId = insert(insCheckIn, dreamerId, whenC, userId, whenC);
        counts.checkIns++;
        // Values sit on the dreamer's path at that moment; the private Alignment rating is an honest dip below it.
        let k = 0;
        while (plan[k + 1]?.held && plan[k + 1]!.start <= tC) k++;
        // Private Alignment rating with a note.
        const privateId = insert(insRating, dreamerId, 'alignment', clamp(Math.round(along(k, tC, (s) => s.ratings.alignment)) - 2, 1, 10), whenC, 'self', null, ciId, userId, 1, whenC, whenC);
        insert(insJournal, dreamerId, example.alignmentNote, whenC, 0, 'self', null, ciId, privateId, null, null, 'alignment', userId, whenC, whenC);
        counts.ratings++; counts.journal++; counts.private++;
        // Shared Energy rating whose note is private.
        const sharedId = insert(insRating, dreamerId, 'energy', clamp(Math.round(along(k, tC, (s) => s.ratings.energy)), 1, 10), whenC, 'self', null, ciId, userId, 0, whenC, whenC);
        insert(insJournal, dreamerId, example.energyNote, whenC, 1, 'self', null, ciId, sharedId, null, null, 'energy', userId, whenC, whenC);
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
