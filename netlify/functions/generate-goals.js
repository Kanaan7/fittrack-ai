import { ANTHROPIC_MODEL } from './_shared/anthropic.js';

export default async (request) => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const apiKey = Netlify.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'Missing Anthropic API key' }, { status: 500 });
    }

    const { height, weight, goal, workoutFrequency, historicalData } = await request.json();

    if (!height || !weight || !goal) {
      return Response.json({ error: 'Height, weight, and goal are required' }, { status: 400 });
    }

    const historyContext = historicalData
      ? `\n\nTracking history: ${historicalData.daysTracked} days logged, averaging ${historicalData.avgCalories} cal/day. Factor this into realistic goal-setting.`
      : '';

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: `You are a certified sports nutritionist. Calculate personalized daily macro targets for this user.

User stats:
- Height: ${height}
- Weight: ${weight}
- Primary goal: ${goal}
- Workout frequency: ${workoutFrequency || 'not specified'}${historyContext}

Guidelines:
- Use TDEE-based calculations appropriate for their goal (cut/bulk/maintain)
- Protein: prioritize adequacy for muscle retention/growth
- Be realistic — don't set targets too aggressive or too conservative
- Write a short, encouraging explanation (1-2 sentences)

Return ONLY a raw JSON object with no markdown:
{"calories":number,"protein":number,"carbs":number,"fats":number,"explanation":"string"}`
        }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Anthropic API error');
    }

    const content = data.content.find(item => item.type === "text")?.text || "";
    const cleaned = content.replace(/```json|```/g, "").trim();
    const result = JSON.parse(cleaned);

    return Response.json(result);

  } catch (error) {
    console.error('generate-goals error:', error);
    return Response.json(
      { error: error.message || 'Failed to generate goals' },
      { status: 500 }
    );
  }
};
