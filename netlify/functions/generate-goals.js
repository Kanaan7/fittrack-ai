exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { height, weight, goal, workoutFrequency, historicalData } = JSON.parse(event.body);

    if (!height || !weight || !goal) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'height, weight, and goal are required' })
      };
    }

    const historyContext = historicalData
      ? `\n\nTracking history: ${historicalData.daysTracked} days logged, averaging ${historicalData.avgCalories} cal/day. Factor this into realistic goal-setting.`
      : '';

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
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

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('generate-goals error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message })
    };
  }
};