// Helper for OpenAPI-compatible chat completions (e.g., OpenAI)
// Accepts simpleFetch and streamResponseToRenderer from caller to reuse existing networking/stream parsing.

async function openapiChatCompletion(event, { baseurl, apikey, model, messages, prompt, stream = true, temperature, top_p, max_tokens, ...rest } = {}, simpleFetch, streamResponseToRenderer) {
    if (!baseurl) throw new Error('OpenAPI baseurl not configured');
    if (!simpleFetch) throw new Error('simpleFetch required');

    const url = `${baseurl.replace(/\/$/, '')}/v1/chat/completions`;

    const payload = {
        model: model,
        messages: messages || (prompt ? [{ role: 'user', content: prompt }] : [{ role: 'user', content: '' }]),
        temperature: typeof temperature !== 'undefined' ? temperature : undefined,
        top_p: typeof top_p !== 'undefined' ? top_p : undefined,
        max_tokens: typeof max_tokens !== 'undefined' ? max_tokens : undefined,
        stream: !!stream,
        ...rest
    };

    const headers = { 'Content-Type': 'application/json' };
    if (apikey) headers['Authorization'] = `Bearer ${apikey}`;

    const res = await simpleFetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });

    if (stream) {
        // let the mainProcess stream parser handle the response
        await streamResponseToRenderer(event, res);
        return;
    }

    // non-streaming: try to return parsed JSON
    try {
        // undici Response has json(), node http response does not — handle both
        if (res && typeof res.json === 'function') return await res.json();
        // fallback: collect body from stream
        return new Promise((resolve, reject) => {
            let acc = '';
            res.setEncoding && res.setEncoding('utf8');
            res.on && res.on('data', (chunk) => { acc += String(chunk); });
            res.on && res.on('end', () => {
                try { resolve(JSON.parse(acc)); } catch (e) { resolve({ raw: acc }); }
            });
            res.on && res.on('error', reject);
        });
    } catch (err) {
        throw err;
    }
}

module.exports = { openapiChatCompletion };
