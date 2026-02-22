const { GoogleGenerativeAI, DynamicRetrievalMode } = require("@google/generative-ai");
require("dotenv").config();

async function testGeminiSearch(query) {
    console.log(`\nSearching with Gemini grounding: "${query}"\n`);

    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    const model = genAI.getGenerativeModel(
        {
            model: "gemini-2.5-flash",
            tools: [{
                googleSearch: {},
            }],
        },
    );

    const result = await model.generateContent(
        `Search the web and find: ${query}\n\nReturn the most relevant URLs and key information found. Include direct links to manuals/documentation if available.`
    );

    const response = result.response;
    const text = response.text();
    console.log("Response:\n", text);

    // Check for grounding metadata
    const candidate = response.candidates?.[0];
    const groundingMeta = candidate?.groundingMetadata;
    if (groundingMeta) {
        console.log("\n=== Grounding Sources ===");
        if (groundingMeta.webSearchQueries) {
            console.log("Searched for:", groundingMeta.webSearchQueries);
        }
        if (groundingMeta.groundingChunks) {
            groundingMeta.groundingChunks.forEach((c, i) => {
                if (c.web) console.log(`${i + 1}. ${c.web.title} - ${c.web.uri}`);
            });
        }
    }
}

testGeminiSearch("Honeywell T6 Pro thermostat user manual PDF download").catch(console.error);
