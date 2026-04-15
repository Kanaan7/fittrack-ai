export default async (request) => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const apiKey = Netlify.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'Missing Anthropic API key' }, { status: 500 });
    }

    const { date, entries, totals, targets } = await request.json();

    if (!totals || !targets) {
      return Response.json({ error: 'Totals and targets are required' }, { status: 400 });
    }

    const safeEntries = Array.isArray(entries) ? entries.slice(0, 20) : [];

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: `You are an expert nutrition coach writing short daily adherence feedback.

Style rules:
- practical and concise
- positive but honest
- slightly human
- never cheesy
- no medical claims
- useful for everyday diet adherence
- avoid robotic filler
- keep every sentence easy to scan

Evaluate:
- current totals versus targets
- protein adequacy
- calorie direction
- overall balance
- meal composition
- what the user should do next today

Return JSON only with this exact shape:
{
  "summary": "string",
  "strengths": ["string", "string"],
  "improvements": ["string"],
  "nextStep": "string"
}

Requirements:
- summary must be 1 short sentence
- strengths should have 1 or 2 items
- improvements should have exactly 1 item
- nextStep should be 1 short sentence
- be specific to the numbers provided

Day: ${date || 'today'}
Entries: ${JSON.stringify(safeEntries)}
Totals: ${JSON.stringify(totals)}
Targets: ${JSON.stringify(targets)}`,
          },
        ],
      }),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error?.message || 'Anthropic API error');
    }

    const text = payload.content?.find((item) => item.type === 'text')?.text || '';
    const cleaned = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const normalized = {
      summary: String(parsed.summary || '').trim(),
      strengths: Array.isArray(parsed.strengths)
        ? parsed.strengths.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 2)
        : [],
      improvements: Array.isArray(parsed.improvements)
        ? parsed.improvements.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 1)
        : [],
      nextStep: String(parsed.nextStep || '').trim(),
    };

    if (!normalized.summary || !normalized.nextStep) {
      throw new Error('The model returned an incomplete insight');
    }

    if (!normalized.strengths.length) {
      normalized.strengths = ['You are keeping the day visible by logging it honestly.'];
    }

    if (!normalized.improvements.length) {
      normalized.improvements = ['Use your next meal to correct the biggest gap.'];
    }

    return Response.json(normalized);
  } catch (error) {
    console.error('daily-feedback error:', error);
    return Response.json({ error: error.message || 'Failed to generate daily feedback' }, { status: 500 });
  }
};
