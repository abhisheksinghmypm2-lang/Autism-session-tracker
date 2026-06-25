// Default content for the Daily dashboard and Resources dashboard.
// You can freely edit these lists — they are just starting points.
// (Users can also add their own items in-app, stored on-device.)

// ---------- Daily "Call To Action" home activities ----------
// cat = which therapy area it supports.
export const DEFAULT_CTAS = [
  { id: 'cta-ot-1', cat: 'OT', text: 'Heavy-work / proprioceptive activity (carrying, pushing, animal walks) for 5–10 min' },
  { id: 'cta-ot-2', cat: 'OT', text: 'Fine-motor practice: threading, pinching, scissors, or play-dough' },
  { id: 'cta-ot-3', cat: 'OT', text: 'Self-care step practiced independently (dressing, brushing, zipping)' },
  { id: 'cta-sp-1', cat: 'Speech', text: 'Model & expand language during play (narrate what they do)' },
  { id: 'cta-sp-2', cat: 'Speech', text: 'Practice target sounds/words from this week 3× during the day' },
  { id: 'cta-sp-3', cat: 'Speech', text: 'Offer choices to prompt requesting ("ball or car?")' },
  { id: 'cta-aba-1', cat: 'ABA', text: 'Reinforce a target behavior immediately when it happens' },
  { id: 'cta-aba-2', cat: 'ABA', text: 'Run 1 short practice trial of the current learning goal' },
  { id: 'cta-aba-3', cat: 'ABA', text: 'Use first/then language for a non-preferred task' },
  { id: 'cta-gen-1', cat: 'General', text: 'Keep a predictable visual schedule for the day' },
  { id: 'cta-gen-2', cat: 'General', text: 'Note one win and one challenge from today' },
];

export const CAT_COLORS = {
  OT: '#2563eb',
  Speech: '#7c3aed',
  ABA: '#ea580c',
  General: '#0f766e',
};

// ---------- Recommended online resources ----------
// Reputable, broadly-stable organizations. Edit/remove to taste.
export const DEFAULT_RESOURCES = [
  {
    id: 'res-aota', cat: 'OT', title: 'AOTA — Autism & Occupational Therapy',
    desc: 'American Occupational Therapy Association: home strategies and what OT addresses in autism.',
    url: 'https://www.aota.org',
  },
  {
    id: 'res-asha', cat: 'Speech', title: 'ASHA — Autism Spectrum Disorder',
    desc: 'American Speech-Language-Hearing Association: communication strategies and milestones.',
    url: 'https://www.asha.org/public/speech/disorders/autism/',
  },
  {
    id: 'res-afirm', cat: 'ABA', title: 'AFIRM — Evidence-Based Practice Modules',
    desc: 'Free modules on evidence-based interventions (reinforcement, prompting, etc.).',
    url: 'https://afirm.fpg.unc.edu',
  },
  {
    id: 'res-asat', cat: 'General', title: 'Association for Science in Autism Treatment',
    desc: 'Plain-language summaries of which autism treatments have scientific support.',
    url: 'https://asatonline.org',
  },
  {
    id: 'res-autnav', cat: 'General', title: 'Autism Navigator — Look-and-Learn',
    desc: 'Video-rich early-intervention resources for families.',
    url: 'https://autismnavigator.com',
  },
  {
    id: 'res-cdc', cat: 'General', title: 'CDC — Learn the Signs / Milestones',
    desc: 'Developmental milestone trackers and free family materials.',
    url: 'https://www.cdc.gov/ncbddd/actearly/index.html',
  },
];
