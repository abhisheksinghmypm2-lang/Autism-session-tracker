/**
 * generateHomePlan — a callable Cloud Function.
 *
 * Takes a therapist's weekly plan (photo / PDF text / typed text), asks Claude
 * (with web search) to design a 7-day, ~15-min/day at-home activity plan with
 * checkable action items, then attaches a verified YouTube video per day.
 *
 * Secrets (set with the Firebase CLI — never hard-coded):
 *   firebase functions:secrets:set ANTHROPIC_API_KEY
 *   firebase functions:secrets:set YOUTUBE_API_KEY   (optional — videos)
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const Anthropic = require('@anthropic-ai/sdk');

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const YOUTUBE_API_KEY = defineSecret('YOUTUBE_API_KEY');

// ---- the instruction we give Claude ----
function buildInstruction(weekStartDate, childContext) {
  return `You are helping a parent turn their child's therapist's weekly plan into a simple, safe, at-home routine.

CONTEXT
- The image/text above is the therapist's plan for this week (OT, Speech, and/or ABA goals).
${childContext ? `- About the child: ${childContext}\n` : ''}- Week starts: ${weekStartDate || 'this week'}.

YOUR TASK
1. Read the therapist's plan and extract the key goals/targets per therapy area.
2. Use web search to find current, reputable, parent-friendly home activities and techniques that support those goals (prefer sources like ASHA, AOTA, AFIRM, ASAT, CDC, Autism Navigator, and established clinics).
3. Design a 7-day plan. EACH DAY is ONE short routine of about 15 minutes total, broken into 2–4 concrete action steps a parent can do at home. Keep it specific, achievable, and tied to the therapist's goals.
4. For each day, also suggest a short YouTube search query that would find a helpful demonstration video for that activity.

SAFETY
- These are supportive suggestions for the parent to review with their therapist — not medical advice. Keep activities gentle and age-appropriate. Do not diagnose.

OUTPUT — return ONLY a JSON object (no prose, no markdown fences) in exactly this shape:
{
  "week_focus": "one short sentence summarizing the week's focus",
  "disclaimer": "one short reminder to review with the therapist",
  "days": [
    {
      "label": "Day 1 — short title",
      "area": "OT" | "Speech" | "ABA" | "General",
      "goal": "the therapist goal this supports (short)",
      "video_search": "a short YouTube search query",
      "steps": [
        { "text": "concrete action step", "minutes": 5 }
      ]
    }
  ]
}
Rules: exactly 7 days; each day's steps sum to about 15 minutes; 2–4 steps per day; plain language a busy parent can follow.`;
}

// ---- robust JSON extraction from the model's text ----
function extractJson(text) {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

// ---- verified YouTube lookup (kid-safe, embeddable) ----
async function searchYouTube(query, key) {
  try {
    const url = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video'
      + '&safeSearch=strict&videoEmbeddable=true&maxResults=1'
      + `&q=${encodeURIComponent(query)}&key=${key}`;
    const r = await fetch(url);
    if (!r.ok) { logger.warn('YouTube API', r.status, await r.text()); return null; }
    const data = await r.json();
    const item = (data.items || [])[0];
    if (!item) return null;
    return {
      id: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
    };
  } catch (e) { logger.warn('YouTube lookup failed', e); return null; }
}

exports.generateHomePlan = onCall(
  { secrets: [ANTHROPIC_API_KEY, YOUTUBE_API_KEY], timeoutSeconds: 300, memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in first.');

    const { planText, planImageBase64, planImageMediaType, weekStartDate, childContext } = request.data || {};
    if (!planText && !planImageBase64) {
      throw new HttpsError('invalid-argument', 'Provide the therapist plan as text or an image.');
    }

    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });

    const userContent = [];
    if (planImageBase64) {
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: planImageMediaType || 'image/jpeg', data: planImageBase64 },
      });
    }
    if (planText) userContent.push({ type: 'text', text: `Therapist's weekly plan (text):\n${planText}` });
    userContent.push({ type: 'text', text: buildInstruction(weekStartDate, childContext) });

    let resp;
    try {
      resp = await client.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 8000,
        thinking: { type: 'adaptive' },
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
        messages: [{ role: 'user', content: userContent }],
      });
    } catch (e) {
      logger.error('Anthropic request failed', e);
      throw new HttpsError('internal', 'The AI request failed: ' + (e?.message || e));
    }

    if (resp.stop_reason === 'refusal') {
      throw new HttpsError('failed-precondition', 'The request was declined by the safety system. Try rephrasing the plan.');
    }

    const text = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const plan = extractJson(text);
    if (!plan || !Array.isArray(plan.days) || !plan.days.length) {
      logger.error('Unparseable plan', text.slice(0, 500));
      throw new HttpsError('internal', 'The AI did not return a usable plan. Please try again.');
    }

    // Attach a verified video per day when a YouTube key is configured.
    if (YOUTUBE_API_KEY.value()) {
      for (const day of plan.days) {
        if (day.video_search) {
          const vid = await searchYouTube(day.video_search, YOUTUBE_API_KEY.value());
          if (vid) day.video = vid;
        }
      }
    }

    return { plan, model: resp.model, usage: resp.usage };
  }
);

// ---- shared: one plain Claude JSON call (no tools), returns parsed object ----
async function claudeJson(instruction, { maxTokens = 2500 } = {}) {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
  let resp;
  try {
    resp = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: maxTokens,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: [{ type: 'text', text: instruction }] }],
    });
  } catch (e) {
    logger.error('Anthropic request failed', e);
    throw new HttpsError('internal', 'The AI request failed: ' + (e?.message || e));
  }
  if (resp.stop_reason === 'refusal') {
    throw new HttpsError('failed-precondition', 'The request was declined by the safety system.');
  }
  const text = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const obj = extractJson(text);
  if (!obj) {
    logger.error('Unparseable AI output', text.slice(0, 500));
    throw new HttpsError('internal', 'The AI did not return a usable result. Please try again.');
  }
  return { obj, model: resp.model, usage: resp.usage };
}

const TONE_RULES = `TONE & SAFETY (must follow):
- Warm, encouraging, plain language a tired parent can read at a glance.
- NEVER use clinical, diagnostic, or medical language. Never diagnose or assess.
- NEVER shame the parent or imply they should be doing more.
- These are supportive observations/ideas to review WITH their therapist — not advice.
- Refer to the child by name only. Note correlations gently, never as cause or fact.`;

// ============================================================
// weeklyRecap — turn a week of logs/sessions/milestones into a
// warm parent recap + a concise summary to share with the team.
// ============================================================
exports.weeklyRecap = onCall(
  { secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120, memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in first.');
    const { childName, rangeLabel, data } = request.data || {};
    const name = (childName || 'your child').toString().slice(0, 60);
    if (!data || typeof data !== 'object') {
      throw new HttpsError('invalid-argument', 'No week data was provided.');
    }
    const instruction = `You are helping a parent reflect on their autistic child's week using the data they logged.

CHILD: ${name}
PERIOD: ${rangeLabel || 'the past week'}

THE DATA (JSON — daily logs, therapy sessions, and milestones the parent recorded):
${JSON.stringify(data).slice(0, 12000)}

${TONE_RULES}

YOUR TASK
1. Write a short, warm recap for the parent (2–4 short paragraphs) highlighting what went well, gentle patterns worth noticing, and genuine encouragement. Reference specific logged moments (wins, moods, sessions) by name where possible.
2. Pull out 3–5 bullet "highlights" — the most notable moments or patterns.
3. Write a concise, neutral summary the parent can share with their therapy team: dates/attendance, observed moods, sleep/eating/sensory notes, concerns, and milestones. Factual and organized, still non-clinical.

OUTPUT — return ONLY a JSON object (no prose, no markdown fences):
{
  "recap": "the warm parent-facing recap (use \\n\\n between paragraphs)",
  "highlights": ["short highlight", "..."],
  "forTherapist": "the concise shareable summary (use \\n between lines)",
  "disclaimer": "one short reminder to review with the therapist"
}`;
    const { obj, model, usage } = await claudeJson(instruction, { maxTokens: 3000 });
    if (!obj.recap) throw new HttpsError('internal', 'The AI did not return a usable recap. Please try again.');
    return { recap: obj, model, usage };
  }
);

// ============================================================
// concernIdeas — gentle, non-clinical ideas for a logged concern.
// ============================================================
exports.concernIdeas = onCall(
  { secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120, memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in first.');
    const { childName, concern, childContext } = request.data || {};
    const name = (childName || 'your child').toString().slice(0, 60);
    const text = (concern || '').toString().trim().slice(0, 1500);
    if (!text) throw new HttpsError('invalid-argument', 'Please provide the concern.');
    const instruction = `A parent of an autistic child logged this concern about their day:

CHILD: ${name}
${childContext ? `ABOUT ${name}: ${childContext}\n` : ''}CONCERN: "${text}"

${TONE_RULES}

YOUR TASK
Offer 2–4 gentle, practical ideas the parent could try at home for this kind of situation, plus a short note on what's worth raising with their therapist. Keep each idea concrete and doable. Do not diagnose or explain "why" clinically.

OUTPUT — return ONLY a JSON object (no prose, no markdown fences):
{
  "ideas": [ { "title": "short idea title", "detail": "1–2 sentence how-to" } ],
  "discussWithTherapist": "one short, specific thing to mention to the therapist",
  "disclaimer": "one short reminder that these are supportive ideas, not medical advice"
}`;
    const { obj, model, usage } = await claudeJson(instruction, { maxTokens: 1800 });
    if (!Array.isArray(obj.ideas) || !obj.ideas.length) {
      throw new HttpsError('internal', 'The AI did not return usable ideas. Please try again.');
    }
    return { result: obj, model, usage };
  }
);
