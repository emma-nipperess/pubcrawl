/**
 * Data-driven starter content for each theme: venues, challenges, team names,
 * scoring presets and event presets. Everything is a suggestion — the wizard
 * copies it into editable form state. Scoring never rewards drinking: every
 * challenge works with soft drinks or no drink at all.
 */
import type { ChallengeDraft, EventRow, VenueDraft } from '@/lib/supabase/types';
import type { ThemeKey } from '@/features/themes/themes';

export interface ScoringPreset {
  key: string;
  label: string;
  description: string;
  settings: Partial<Pick<EventRow, 'skip_policy' | 'skip_penalty' | 'provisional_scoring' | 'allow_partial_points' | 'tie_break' | 'default_requires_approval' | 'leaderboard_visible'>>;
}

export const SCORING_PRESETS: ScoringPreset[] = [
  {
    key: 'relaxed',
    label: 'Relaxed',
    description: 'Points as you go, no approval, skip any venue without penalty.',
    settings: { skip_policy: 'none', skip_penalty: 0, provisional_scoring: false, default_requires_approval: false, tie_break: 'shared', leaderboard_visible: true },
  },
  {
    key: 'refereed',
    label: 'Refereed',
    description: 'Organisers approve photo proof before it scores. Pending points show as provisional.',
    settings: { skip_policy: 'zero', skip_penalty: 0, provisional_scoring: true, default_requires_approval: true, allow_partial_points: true, tie_break: 'most_completed' },
  },
  {
    key: 'competitive',
    label: 'Competitive',
    description: 'Approval required, 5-point penalty for skipping, ties broken by who got there first.',
    settings: { skip_policy: 'penalty', skip_penalty: 5, provisional_scoring: false, default_requires_approval: true, tie_break: 'earliest' },
  },
];

export interface ChallengeLibraryItem extends ChallengeDraft {
  tags: string[];
}

const SAFETY_DRINK = 'Soft drinks, water and mocktails count. Nobody has to drink alcohol.';
const SAFETY_PUBLIC = 'Be kind to staff and strangers — ask before including anyone in photos.';

/** General-purpose challenge library available in every theme. */
export const CHALLENGE_LIBRARY: ChallengeLibraryItem[] = [
  { title: 'Team group photo', description: 'Get every member of your team in one photo, with the venue sign or bar visible.', type: 'photo', scope: 'team', points: 10, all_members_required: true, safety_notes: SAFETY_PUBLIC, tags: ['photo', 'team'] },
  { title: 'Colour hunt', description: 'Find something in the venue that matches the colour of the round and snap it.', type: 'photo', points: 8, tags: ['photo', 'scavenger'] },
  { title: 'Creative team pose', description: 'Recreate a famous painting, album cover or film poster as a team.', type: 'photo', scope: 'team', points: 15, requires_approval: true, tags: ['photo', 'team', 'creative'] },
  { title: 'Team cheer', description: 'Record a 10-second team cheer. Totally voluntary — keep it to a sensible volume.', type: 'video', scope: 'team', points: 12, safety_notes: 'Keep the volume friendly and step outside if the venue is quiet.', tags: ['video', 'team'] },
  { title: 'Find a zero-proof hero', description: 'Order or find a non-alcoholic drink that fits the theme of this round and tell us why.', type: 'photo_or_video', points: 10, text_prompt: 'Why does it fit the theme?', safety_notes: SAFETY_DRINK, tags: ['photo', 'non-alcoholic'] },
  { title: 'Scavenger: something older than you', description: 'Find an object in the venue that is older than the youngest person in your team.', type: 'photo', points: 8, tags: ['scavenger'] },
  { title: 'Riddle me this', description: 'What has keys but cannot open locks?', type: 'multiple_choice', points: 6, choices: ['A piano', 'A map', 'A prison'], correct_choice: 0, penalty_points: 0, max_attempts: 1, tags: ['trivia', 'riddle'] },
  { title: 'Name that pub sign', description: 'Ask the staff (nicely) where the venue name comes from and write it down.', type: 'text', points: 8, text_prompt: 'The story behind the name', requires_approval: true, tags: ['social', 'text'] },
  { title: 'Compliment chain', description: 'Every team member gives another a genuine compliment. Tick when done.', type: 'checkbox', scope: 'team', points: 5, tags: ['social'] },
  { title: 'Snack critic', description: 'Rate a bar snack out of 10 and write a one-line review.', type: 'text', points: 5, text_prompt: 'Your review', tags: ['food'] },
  { title: 'Beer-mat architect', description: 'Build the tallest free-standing tower you can from beer mats or napkins. Return them after!', type: 'photo', scope: 'team', points: 10, requires_approval: true, tags: ['team', 'creative'] },
  { title: 'Organiser\'s choice', description: 'The organiser will judge this one in person.', type: 'verified', points: 15, tags: ['verified'] },
  { title: 'Lucky bonus', description: 'Spot a four-leaf clover, a horseshoe or a lucky cat anywhere tonight.', type: 'bonus', points: 5, reveal: 'always', repeatable: false, tags: ['bonus'] },
];

const c = (title: string, rest: Omit<ChallengeDraft, 'title'>): ChallengeDraft => ({ title, ...rest });

export interface ThemeTemplate {
  venues: VenueDraft[];
  teamNames: string[];
  teamColors: string[];
  scoringPreset: string;
  event: Partial<EventRow>;
}

const GOLF_TEAMS = ['The Bogey Men', 'Fore Play', 'Par-tea Animals', 'Hole in One', 'The Mulligans', 'Chip Shots'];

export const TEMPLATES: Record<ThemeKey, ThemeTemplate> = {
  classic: {
    teamNames: GOLF_TEAMS,
    teamColors: ['#1d6644', '#c2311c', '#245a8c', '#8a5a00', '#6b2f8a', '#0f6b6b'],
    scoringPreset: 'relaxed',
    event: { play_mode: 'both', tie_break: 'most_completed' },
    venues: [
      { name: 'Hole 1 — The Clubhouse', par: 20, description: 'Tee off. Meet the course and warm up.', challenges: [
        c('Opening drive', { description: 'Team photo at the first tee (the front door).', type: 'photo', scope: 'team', points: 10 }),
        c('Rule check', { description: 'Which of these is a real golf term for one under par?', type: 'multiple_choice', points: 5, choices: ['Birdie', 'Robin', 'Pigeon'], correct_choice: 0 }),
        c('Zero-proof caddie', { description: 'Order a soft drink or mocktail with a golf-sounding name (or invent one).', type: 'text', points: 5, text_prompt: 'Drink + name', required: false, safety_notes: SAFETY_DRINK }),
      ] },
      { name: 'Hole 2 — The Fairway', par: 20, challenges: [
        c('Putting green', { description: 'Roll a coin into a cup from two metres. Video your best attempt.', type: 'video', points: 10, max_attempts: 3 }),
        c('Course designer', { description: 'Sketch tonight’s hole on a napkin and photograph it.', type: 'photo', points: 10, requires_approval: true }),
      ] },
      { name: 'Hole 3 — The Bunker', par: 20, challenges: [
        c('Escape the bunker', { description: 'Your team has five minutes to solve: I am taken from a mine and shut in a wooden case, never released, yet used by almost everybody. What am I?', type: 'text', scope: 'team', points: 12, accepted_answers: ['pencil lead', 'lead', 'graphite', 'pencil'], max_attempts: 3, time_limit_minutes: 30 }),
        c('Caddie compliment', { description: 'Thank the bar staff by name. Tick when done.', type: 'checkbox', points: 5 }),
      ] },
      { name: 'Hole 4 — The Dogleg', par: 20, challenges: [
        c('Swing coach', { description: 'Slow-motion video of your best (imaginary) golf swing.', type: 'video', points: 10 }),
        c('Colour of the course', { description: 'Find something green in this venue.', type: 'photo', points: 8 }),
      ] },
      { name: 'Hole 5 — The 19th', par: 20, description: 'The clubhouse bar. Cards in, scores up.', challenges: [
        c('Trophy pose', { description: 'Whole-team victory pose, winners or not.', type: 'photo', scope: 'team', points: 10 }),
        c('Round review', { description: 'Your hole of the night and why.', type: 'text', points: 5, text_prompt: 'Best hole' }),
      ] },
    ],
  },
  halloween: {
    teamNames: ['The Coven', 'Grave Diggers', 'Boo Crew', 'Night Shift', 'Pumpkin Heads', 'The Undead'],
    teamColors: ['#ff7a1a', '#a6e35f', '#9b5de5', '#f15bb5', '#00bbf9', '#fee440'],
    scoringPreset: 'refereed',
    event: { play_mode: 'team', team_selection: 'self' },
    venues: [
      { name: 'The Crypt', description: 'Meeting point. Costumes on.', challenges: [
        c('Costume reveal', { description: 'Team photo in full costume — strike your scariest pose.', type: 'photo', scope: 'team', points: 15 }),
        c('Monster trivia', { description: 'Which author created Dracula?', type: 'multiple_choice', points: 6, choices: ['Mary Shelley', 'Bram Stoker', 'Edgar Allan Poe'], correct_choice: 1 }),
      ] },
      { name: 'The Haunted Inn', challenges: [
        c('Ghost hunt', { description: 'Photograph something in the venue that looks suspiciously haunted.', type: 'photo', points: 10 }),
        c('Spooky story', { description: 'Tell a 30-second ghost story to camera.', type: 'video', points: 12, requires_approval: true }),
        c('Potion master', { description: 'Find the spookiest-looking non-alcoholic drink on the menu.', type: 'photo', points: 8, required: false, safety_notes: SAFETY_DRINK }),
      ] },
      { name: 'The Witch\'s Cauldron', challenges: [
        c('Riddle of the crypt', { description: 'The more of me you take, the more you leave behind. What am I?', type: 'text', scope: 'team', points: 12, accepted_answers: ['footsteps', 'steps', 'footprints'], max_attempts: 3 }),
        c('Monster mash', { description: 'Team video: your best zombie walk, 10 seconds.', type: 'video', scope: 'team', points: 12 }),
      ] },
      { name: 'The Graveyard Shift', description: 'Final haunt. Results at midnight.', challenges: [
        c('Best dressed vote', { description: 'Organiser judges the best costume in person.', type: 'verified', points: 20 }),
        c('Final scream', { description: 'Whole-team silent scream photo.', type: 'photo', scope: 'team', points: 10 }),
      ] },
    ],
  },
  birthday: {
    teamNames: ['Party Animals', 'Cake Squad', 'Confetti Cannons', 'The Candles', 'Gift Wrappers', 'Balloon Brigade'],
    teamColors: ['#c0266f', '#ffc93c', '#2ec4b6', '#7b2cbf', '#ff6b35', '#3a86ff'],
    scoringPreset: 'relaxed',
    event: { play_mode: 'both' },
    venues: [
      { name: 'Kick-off Bar', challenges: [
        c('Birthday portrait', { description: 'Photo with the birthday star — everyone in!', type: 'photo', scope: 'team', points: 10 }),
        c('How well do you know them?', { description: 'Write the birthday star’s go-to karaoke song.', type: 'text', points: 8, text_prompt: 'Your guess', requires_approval: true }),
      ] },
      { name: 'Second Stop', challenges: [
        c('Sing it', { description: 'Lead a (quiet) round of Happy Birthday with strangers who volunteer.', type: 'video', points: 15, safety_notes: SAFETY_PUBLIC }),
        c('Wish list', { description: 'Find something in the venue the birthday star would love.', type: 'photo', points: 8 }),
      ] },
      { name: 'Third Stop', challenges: [
        c('Throwback', { description: 'Recreate a childhood photo of the birthday star.', type: 'photo', scope: 'team', points: 15, requires_approval: true }),
        c('Birthday mocktail', { description: 'Design a birthday mocktail and get it made (or describe it).', type: 'photo_or_video', points: 10, required: false, safety_notes: SAFETY_DRINK }),
      ] },
      { name: 'Grand Finale', challenges: [
        c('Speech!', { description: 'Record a 20-second toast to the birthday star (any drink, or none).', type: 'video', points: 12 }),
        c('Year in one word', { description: 'Sum up their year in one word.', type: 'text', points: 5 }),
      ] },
    ],
  },
  hens: {
    teamNames: ['Team Bride', 'The Bridesmaids', 'Something Borrowed', 'Something Blue', 'The Veil Squad', 'Tiara Troop'],
    teamColors: ['#9c3559', '#e9b9a7', '#6d597a', '#355070', '#b56576', '#eaac8b'],
    scoringPreset: 'relaxed',
    event: { play_mode: 'team', team_selection: 'organiser' },
    venues: [
      { name: 'Champagne-free Reception', description: 'Welcome drinks — fizzy or not.', challenges: [
        c('Squad photo', { description: 'Elegant group photo with the bride-to-be at the centre.', type: 'photo', scope: 'team', points: 10 }),
        c('Bride trivia', { description: 'Where did the couple first meet?', type: 'text', points: 8, requires_approval: true }),
      ] },
      { name: 'The Cocktail Lounge', challenges: [
        c('Signature mocktail', { description: 'Order (or invent) a drink named after the couple.', type: 'photo', points: 10, required: false, safety_notes: SAFETY_DRINK }),
        c('Advice for the couple', { description: 'Collect a piece of marriage advice from a willing stranger.', type: 'text', points: 12, safety_notes: SAFETY_PUBLIC }),
      ] },
      { name: 'Dinner & Dancing', challenges: [
        c('First dance rehearsal', { description: 'Team video: choreograph 10 seconds of the couple’s first dance.', type: 'video', scope: 'team', points: 15 }),
        c('Something old, new, borrowed, blue', { description: 'Find all four in one photo.', type: 'photo', scope: 'team', points: 15, requires_approval: true }),
      ] },
      { name: 'The Last Stop', challenges: [
        c('Love letter', { description: 'Write a two-line poem for the bride-to-be.', type: 'text', points: 8 }),
        c('Final portrait', { description: 'Your best squad photo of the night.', type: 'photo', scope: 'team', points: 10 }),
      ] },
    ],
  },
  christmas: {
    teamNames: ['Santa’s Helpers', 'The Reindeer', 'Jingle Belles', 'Snow Patrol', 'Mince Spies', 'Elf Service'],
    teamColors: ['#e23a4e', '#f2c14e', '#2a9d8f', '#8ecae6', '#bc4749', '#ffffff'],
    scoringPreset: 'relaxed',
    event: { play_mode: 'both' },
    venues: [
      { name: 'The North Pole', description: 'Meet by the tree. Jumpers on.', challenges: [
        c('Jumper parade', { description: 'Team photo showing off your festive jumpers.', type: 'photo', scope: 'team', points: 10 }),
        c('Reindeer roll call', { description: 'Which of these is NOT one of Santa’s reindeer?', type: 'multiple_choice', points: 6, choices: ['Comet', 'Blitzen', 'Rudolph', 'Twinkle'], correct_choice: 3 }),
      ] },
      { name: 'The Grotto', challenges: [
        c('Carol karaoke', { description: 'Ten seconds of your team’s favourite carol (quietly!).', type: 'video', scope: 'team', points: 12 }),
        c('Bauble hunt', { description: 'Spot the most festive decoration in the venue.', type: 'photo', points: 8 }),
      ] },
      { name: 'The Snowy Tavern', challenges: [
        c('Festive mocktail', { description: 'Find a hot chocolate, mulled juice or other festive soft drink.', type: 'photo', points: 8, required: false, safety_notes: SAFETY_DRINK }),
        c('Cracker joke', { description: 'Write your best (worst) cracker joke.', type: 'text', points: 5 }),
        c('Secret Santa riddle', { description: 'What do you call a cat on the beach at Christmas?', type: 'text', scope: 'team', points: 10, accepted_answers: ['sandy claws', 'sandy clause'], max_attempts: 3 }),
      ] },
      { name: 'The Last Sleigh', challenges: [
        c('Good deed', { description: 'Do something kind for a stranger or staff member. Organiser verifies.', type: 'verified', points: 15 }),
        c('Family portrait', { description: 'Final team photo — tinsel optional.', type: 'photo', scope: 'team', points: 10 }),
      ] },
    ],
  },
  retro: {
    teamNames: ['The Mixtapes', 'Disco Inferno', 'Boy Band Reunion', 'Spice Rack', 'The Walkmen', 'Neon Dreams'],
    teamColors: ['#c2311c', '#1fa39a', '#f4a261', '#7209b7', '#3a0ca3', '#ffbe0b'],
    scoringPreset: 'relaxed',
    event: { play_mode: 'team' },
    venues: [
      { name: 'Side A — The 70s', challenges: [
        c('Disco freeze', { description: 'Team photo frozen mid disco move.', type: 'photo', scope: 'team', points: 10 }),
        c('Name that decade', { description: 'In which decade did the Walkman launch?', type: 'multiple_choice', points: 6, choices: ['1960s', '1970s', '1980s', '1990s'], correct_choice: 1 }),
      ] },
      { name: 'Side B — The 80s', challenges: [
        c('Air guitar solo', { description: 'Ten-second air guitar solo video.', type: 'video', points: 12 }),
        c('Neon find', { description: 'Find something neon in the venue.', type: 'photo', points: 8 }),
      ] },
      { name: 'Bonus Track — The 90s', challenges: [
        c('Album cover', { description: 'Recreate a famous 90s album cover as a team.', type: 'photo', scope: 'team', points: 15, requires_approval: true }),
        c('Retro refresher', { description: 'Find a classic soft drink you loved as a kid.', type: 'photo', points: 8, required: false, safety_notes: SAFETY_DRINK }),
      ] },
      { name: 'The Encore', challenges: [
        c('Lyric relay', { description: 'Each team member writes one line of a throwback song — in order.', type: 'text', scope: 'team', points: 10 }),
        c('Final bow', { description: 'Band photo, rock-star poses.', type: 'photo', scope: 'team', points: 10 }),
      ] },
    ],
  },
  custom: {
    teamNames: ['Team One', 'Team Two', 'Team Three', 'Team Four'],
    teamColors: ['#b8401b', '#245a8c', '#2c7a4b', '#8a5a00'],
    scoringPreset: 'relaxed',
    event: {},
    venues: [
      { name: 'First venue', challenges: [
        c('Team group photo', { description: 'Everyone in, venue sign visible.', type: 'photo', scope: 'team', points: 10 }),
        c('Quick quiz', { description: 'What is the capital of Australia?', type: 'multiple_choice', points: 5, choices: ['Sydney', 'Canberra', 'Melbourne'], correct_choice: 1 }),
      ] },
      { name: 'Second venue', challenges: [
        c('Colour hunt', { description: 'Find something matching your team colour.', type: 'photo', points: 8 }),
      ] },
      { name: 'Third venue', challenges: [
        c('Team cheer', { description: 'A voluntary 10-second team cheer.', type: 'video', scope: 'team', points: 10 }),
      ] },
    ],
  },
};

export const TEAM_COLORS = ['#b8401b', '#245a8c', '#2c7a4b', '#8a5a00', '#7b2cbf', '#0f6b6b', '#c0266f', '#3a86ff', '#ff7a1a', '#6d597a'];
export const AVATAR_COLORS = ['#F2A93B', '#E76F51', '#2A9D8F', '#8ECAE6', '#F4A261', '#B5E48C', '#CDB4DB', '#FFC8DD', '#FFD166', '#90BE6D', '#A0C4FF', '#FFADAD'];

/** Event defaults for a quick crawl: private, invite-only, relaxed scoring. */
export const EVENT_DEFAULTS: Partial<EventRow> = {
  visibility: 'private',
  require_code: true,
  allow_late_join: true,
  join_open: true,
  play_mode: 'both',
  team_selection: 'organiser',
  allow_self_teams: true,
  allow_skip: true,
  skip_policy: 'none',
  skip_penalty: 0,
  allow_any_venue: false,
  challenges_visible_early: false,
  default_requires_approval: false,
  show_others_submissions: true,
  leaderboard_visible: true,
  provisional_scoring: false,
  allow_partial_points: false,
  tie_break: 'shared',
  media_retention_days: 30,
};
