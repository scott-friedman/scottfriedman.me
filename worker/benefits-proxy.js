/**
 * Benefits of Everything - Gemini API Proxy
 *
 * Cloudflare Worker that proxies requests to Google's Gemini API.
 * Checks Firebase cache first, only calls Gemini for new queries.
 *
 * Environment Variables (set via wrangler secret):
 * - GEMINI_API_KEY: Google AI Studio API key
 *
 * Deploy: npx wrangler deploy --config wrangler-benefits.toml
 */

const FIREBASE_URL = 'https://scottfriedman-f400d-default-rtdb.firebaseio.com';

// CORS headers for your domain
const ALLOWED_ORIGINS = [
    'https://scottfriedman.ooo',
    'http://localhost:8000',
    'http://localhost:8001',
    'http://127.0.0.1:8000',
    'http://127.0.0.1:8001'
];

function getCorsHeaders(request) {
    const origin = request.headers.get('Origin') || '';
    const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
    };
}

// Rate limiting: simple in-memory counter (resets on worker restart)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 10; // 10 requests per minute per IP

function checkRateLimit(ip) {
    const now = Date.now();
    const entry = rateLimitMap.get(ip);

    if (!entry || now - entry.timestamp > RATE_LIMIT_WINDOW) {
        rateLimitMap.set(ip, { count: 1, timestamp: now });
        return true;
    }

    if (entry.count >= RATE_LIMIT_MAX) {
        return false;
    }

    entry.count++;
    return true;
}

// Normalize query for caching (lowercase, trim, remove extra spaces)
function normalizeQuery(query) {
    return query.toLowerCase().trim().replace(/\s+/g, ' ');
}

// Generate Firebase-safe key from query
function queryToFirebaseKey(query) {
    // Firebase keys can't contain . $ # [ ] /
    return normalizeQuery(query)
        .replace(/[.#$\[\]\/]/g, '_')
        .replace(/\s/g, '_')
        .substring(0, 100);
}

export default {
    async fetch(request, env, ctx) {
        const corsHeaders = getCorsHeaders(request);

        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);
        const path = url.pathname;

        try {
            if (path === '/api/benefits' && request.method === 'POST') {
                return await handleBenefits(request, env, corsHeaders);
            }

            if (path === '/api/health') {
                return jsonResponse({ status: 'ok', timestamp: Date.now() }, 200, corsHeaders);
            }

            return jsonResponse({ error: 'Not found' }, 404, corsHeaders);
        } catch (error) {
            console.error('Worker error:', error);
            return jsonResponse({ error: 'Internal server error' }, 500, corsHeaders);
        }
    }
};

/**
 * POST /api/benefits
 * Body: { query: string }
 * Returns: { benefits: string[], usageTips: string[], query: string, cached: boolean }
 */
async function handleBenefits(request, env, corsHeaders) {
    // Rate limiting
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!checkRateLimit(clientIP)) {
        return jsonResponse({
            error: 'Rate limit exceeded. Please try again in a minute.'
        }, 429, corsHeaders);
    }

    // Parse request
    let body;
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: 'Invalid JSON' }, 400, corsHeaders);
    }

    const { query } = body;

    // Validate query
    if (!query || typeof query !== 'string') {
        return jsonResponse({ error: 'Query is required' }, 400, corsHeaders);
    }

    const normalizedQuery = normalizeQuery(query);

    if (normalizedQuery.length < 2) {
        return jsonResponse({ error: 'Query too short' }, 400, corsHeaders);
    }

    if (normalizedQuery.length > 200) {
        return jsonResponse({ error: 'Query too long' }, 400, corsHeaders);
    }

    // Check Firebase cache first
    const cacheKey = queryToFirebaseKey(normalizedQuery);
    const cached = await checkCache(cacheKey);

    if (cached) {
        return jsonResponse({
            benefits: cached.benefits,
            usageTips: cached.usageTips,
            query: query,
            normalizedQuery: normalizedQuery,
            cached: true
        }, 200, corsHeaders);
    }

    // Call Gemini API
    const result = await callGemini(env, normalizedQuery);

    if (result.error) {
        return jsonResponse({ error: result.error }, 500, corsHeaders);
    }

    // Cache the result
    await saveToCache(cacheKey, result);

    return jsonResponse({
        benefits: result.benefits,
        usageTips: result.usageTips,
        query: query,
        normalizedQuery: normalizedQuery,
        cached: false
    }, 200, corsHeaders);
}

/**
 * Check Firebase cache for existing result
 */
async function checkCache(cacheKey) {
    try {
        const response = await fetch(
            `${FIREBASE_URL}/benefits/cache/${cacheKey}.json`
        );

        if (!response.ok) return null;

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Cache check failed:', error);
        return null;
    }
}

/**
 * Save result to Firebase cache
 */
async function saveToCache(cacheKey, result) {
    try {
        await fetch(
            `${FIREBASE_URL}/benefits/cache/${cacheKey}.json`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    benefits: result.benefits,
                    usageTips: result.usageTips,
                    cachedAt: Date.now()
                })
            }
        );
    } catch (error) {
        console.error('Cache save failed:', error);
    }
}

/**
 * Call Gemini API to generate benefits
 */
async function callGemini(env, query) {
    const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

    const prompt = `List benefits of "${query}".

Rules:
- Each benefit: 1 sentence max (2 only if essential)
- Be specific and insightful, not generic
- For negative topics, find genuine silver linings

Return JSON only:
{
  "benefits": ["benefit 1", "benefit 2", "benefit 3", "benefit 4", "benefit 5"],
  "usageTips": ["how to obtain/apply benefit 1", "tip 2"]
}

5-7 benefits, 2-3 usage tips. Keep it brief.`;

    try {
        const response = await fetch(`${GEMINI_URL}?key=${env.GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 1024,
                    topP: 0.9
                },
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
                ]
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Gemini API error:', errorText);
            return { error: 'Failed to generate benefits. Please try again.' };
        }

        const data = await response.json();

        // Extract text from Gemini response
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) {
            console.error('No text in Gemini response:', JSON.stringify(data));
            return { error: 'Empty response from AI. Please try again.' };
        }

        // Parse JSON from response (handle potential markdown wrapping)
        let parsed;
        try {
            const cleanText = text.replace(/```json\n?|\n?```/g, '').trim();
            parsed = JSON.parse(cleanText);
        } catch (parseError) {
            console.error('Failed to parse Gemini response:', text);
            return { error: 'Failed to parse AI response. Please try again.' };
        }

        // Validate structure
        if (!Array.isArray(parsed.benefits) || !Array.isArray(parsed.usageTips)) {
            console.error('Invalid response structure:', parsed);
            return { error: 'Invalid response format. Please try again.' };
        }

        return {
            benefits: parsed.benefits,
            usageTips: parsed.usageTips
        };

    } catch (error) {
        console.error('Gemini API call failed:', error);
        return { error: 'Failed to connect to AI service. Please try again.' };
    }
}

/**
 * Helper to create JSON responses
 */
function jsonResponse(data, status = 200, corsHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
        }
    });
}
