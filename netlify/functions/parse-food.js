exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { text } = JSON.parse(event.body);

    if (!text?.trim()) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'No food text provided' })
      };
    }

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
          content: `You are a nutrition expert helping users log their food intake. Parse the following food description and return accurate macro estimates.

Rules:
- If portions aren't specified, assume a typical/standard serving size
- For restaurant items (e.g. "Big Mac", "Chipotle burrito"), use well-known published nutrition values
- For vague items (e.g. "a coffee", "some rice"), use reasonable common estimates
- Split combined meals into individual items when clearly separate (e.g. "eggs and toast" → 2 items)
- Round values to whole numbers
- Never refuse to estimate — always make a sensible best guess

Return ONLY a raw JSON array with no markdown or explanation:
[{"name":"Food name","calories":number,"protein":number,"carbs":number,"fats":number}]

Food to parse: "${text}"`
        }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Anthropic API error');
    }

    const content = data.content.find(item => item.type === "text")?.text || "";
    const cleaned = content.replace(/```json|```/g, "").trim();
    const parsedItems = JSON.parse(cleaned);

    if (!Array.isArray(parsedItems) || parsedItems.length === 0) {
      throw new Error('No items could be parsed from that description');
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: parsedItems })
    };

  } catch (error) {
    console.error('parse-food error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: error.message,
        details: 'Check Netlify function logs for more info'
      })
    };
  }
};