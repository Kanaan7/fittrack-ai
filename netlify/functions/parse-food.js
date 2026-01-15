
exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { text } = JSON.parse(event.body);
    
    if (!text) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No text provided' })
      };
    }

    // Call Anthropic API from server (secure!)
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY, // Secret, not exposed!
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: `Parse this food and return ONLY JSON array: [{"name":"Food","calories":num,"protein":num,"carbs":num,"fats":num}]. Food: "${text}"`
        }]
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || 'API error');
    }

    const content = data.content.find(item => item.type === "text")?.text || "";
    const cleaned = content.replace(/```json|```/g, "").trim();
    const parsedItems = JSON.parse(cleaned);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ items: parsedItems })
    };
    
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: error.message,
        details: 'Check Netlify function logs for more info'
      })
    };
  }
};