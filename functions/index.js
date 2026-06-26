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
