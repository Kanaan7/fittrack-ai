
exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { height, weight, goal, workoutFrequency, historicalData } = JSON.parse(event.body);
    
    if (!height || !weight || !goal) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    let contextPrompt = '';
    if (historicalData) {
      contextPrompt = `\n\nUser has ${historicalData.daysTracked} days tracked, avg ${historicalData.avgCalories} cal/day.`;
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
          content: `Calculate optimal macros. Height: ${height}, Weight: ${weight}, Goal: ${goal}, Workout: ${workoutFrequency}${contextPrompt}. Return ONLY JSON: {"calories":num,"protein":num,"carbs":num,"fats":num,"explanation":"text"}`
        }]
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || 'API error');
    }

    const content = data.content.find(item => item.type === "text")?.text || "";
    const cleaned = content.replace(/```json|```/g, "").trim();
    const result = JSON.parse(cleaned);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(result)
    };
    
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: error.message 
      })
    };
  }
};