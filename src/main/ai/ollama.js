// Centralized Ollama client helpers
// This module provides functions to interact with Ollama's REST API,
// building requests and delegating networking/streaming to the caller.

/**
 * A helper function to handle the actual fetch request and response.
 * @param {object} params - The parameters for the request.
 * @param {Function} params.simpleFetch - The fetch implementation to use.
 * @param {string} params.method - The HTTP method (GET, POST, DELETE, HEAD).
 * @param {string} params.url - The full URL for the API endpoint.
 * @param {string} [params.apikey] - Optional API key for authorization.
 * @param {object} [params.body] - The JSON body for the request.
 * @param {boolean} [params.isStreaming] - Whether the request expects a streaming response.
 * @param {Function} [params.streamHandler] - The function to call with the streaming response.
 * @returns {Promise<object|void>} A promise that resolves with the JSON response for non-streaming calls, or void for streaming calls.
 * @private
 */
async function ollama_request({ simpleFetch, method, url, apikey, body, isStreaming, streamHandler }) {
    if (!simpleFetch) throw new Error('simpleFetch helper required');
    if (isStreaming && !streamHandler) throw new Error('streamHandler helper required for streaming responses');

    const headers = { 'Content-Type': 'application/json' };
    if (apikey) {
        headers['Authorization'] = `Bearer ${apikey}`;
    }

    const fetchOptions = {
        method,
        headers,
    };

    if (body) {
        fetchOptions.body = JSON.stringify(body);
    }

    const res = await simpleFetch(url, fetchOptions);

    // Detect whether `res` is a Fetch-like Response (undici) or a Node IncomingMessage
    const isFetchResponse = res && (typeof res.ok !== 'undefined') && (typeof res.body !== 'undefined');

    const getStatus = () => (isFetchResponse ? res.status : res.statusCode);
    const getStatusText = () => (isFetchResponse ? res.statusText : res.statusMessage);
    const getHeader = (name) => {
        if (isFetchResponse) {
            try { return res.headers.get(name); } catch (_) { return null; }
        }
        if (res && res.headers) {
            // Node IncomingMessage headers are lowercased keys
            return res.headers[name.toLowerCase()] || res.headers[name];
        }
        return null;
    };

    // Helper to read a Node stream into string
    const readStreamToString = (stream) => new Promise((resolve, reject) => {
        if (!stream || typeof stream.on !== 'function') return resolve('');
        let acc = '';
        stream.setEncoding && stream.setEncoding('utf8');
        stream.on('data', (c) => { try { acc += String(c); } catch (_) { } });
        stream.on('end', () => resolve(acc));
        stream.on('error', (err) => reject(err));
    });

    // If HTTP error, try to read body for better message
    if (getStatus() >= 400) {
        let errorBody = '';
        try {
            if (isFetchResponse && typeof res.text === 'function') {
                errorBody = await res.text();
            } else {
                // Node IncomingMessage
                errorBody = await readStreamToString(res) || '';
            }
        } catch (e) {
            // ignore body-read errors
        }
        throw new Error(`Ollama API Error: ${getStatus()} ${getStatusText()} - ${String(errorBody)}`);
    }

    if (isStreaming) {
        // Delegate streaming to caller (undici Response or Node stream)
        await streamHandler(res);
    } else {
        // Handle HEAD request success which has no body
        if (method === 'HEAD') {
            return { ok: true, status: getStatus() };
        }

        // Handle successful responses that might have an empty body
        const contentLength = getHeader('content-length') || getHeader('Content-Length');
        if (getStatus() === 200 && contentLength === '0') {
            return { success: true };
        }

        // For Fetch-like responses, use res.json(); for Node streams, collect and parse
        if (isFetchResponse && typeof res.json === 'function') {
            return res.json();
        }
        // Node IncomingMessage: read and parse
        const text = await readStreamToString(res);
        try {
            return text ? JSON.parse(text) : {};
        } catch (e) {
            // If not JSON, return raw text
            return { text };
        }
    }
}

/**
 * Generates a response for a given prompt with a provided model.
 * This is a streaming endpoint by default.
 * POST /api/generate
 * @param {object} event - The event object, passed to the stream handler.
 * @param {object} config - Configuration for the request.
 * @param {string} config.baseurl - The base URL of the Ollama API. Defaults to http://localhost:11434.
 * @param {string} [config.apikey] - Optional API key.
 * @param {string} config.model - The model name.
 * @param {string} config.prompt - The prompt to generate a response for.
 * @param {string[]} [config.images] - A list of base64-encoded images (for multimodal models).
 * @param {string|object} [config.format] - The format to return a response in (e.g., 'json' or a JSON schema).
 * @param {object} [config.options] - Additional model parameters (e.g., temperature, seed).
 * @param {string} [config.system] - The system message.
 * @param {string} [config.template] - The prompt template to use.
 * @param {boolean} [config.stream=true] - If false, the response will be returned as a single object.
 * @param {boolean} [config.raw=false] - If true, no formatting will be applied to the prompt.
 * @param {string} [config.keep_alive] - Controls how long the model stays loaded in memory.
 * @param {Function} simpleFetch - A function that behaves like `fetch`.
 * @param {Function} streamResponseToRenderer - A function to handle the streaming response.
 * @returns {Promise<object|void>} JSON response if stream is false, otherwise void.
 */
async function ollamaGenerateCompletion(event, { baseurl = 'http://localhost:11434', apikey, model, prompt, stream = true, ...rest } = {}, simpleFetch, streamResponseToRenderer) {
    const url = `${baseurl.replace(/\/$/, '')}/api/generate`;
    const body = { model, prompt, stream, ...rest };

    return ollama_request({
        simpleFetch,
        method: 'POST',
        url,
        apikey,
        body,
        isStreaming: stream,
        streamHandler: (res) => streamResponseToRenderer(event, res),
    });
}

/**
 * Generates the next message in a chat with a provided model.
 * This is a streaming endpoint by default.
 * POST /api/chat
 * @param {object} event - The event object, passed to the stream handler.
 * @param {object} config - Configuration for the request.
 * @param {string} config.baseurl - The base URL of the Ollama API.
 * @param {string} [config.apikey] - Optional API key.
 * @param {string} config.model - The model name.
 * @param {object[]} config.messages - The messages of the chat.
 * @param {object[]} [config.tools] - A list of tools the model can use.
 * @param {boolean} [config.stream=true] - If false, the response will be returned as a single object.
 * @param {string|object} [config.format] - The format to return a response in (e.g., 'json' or a JSON schema).
 * @param {object} [config.options] - Additional model parameters.
 * @param {Function} simpleFetch - A function that behaves like `fetch`.
 * @param {Function} streamResponseToRenderer - A function to handle the streaming response.
 * @returns {Promise<object|void>} JSON response if stream is false, otherwise void.
 */
async function ollamaChatCompletion(event, { baseurl = 'http://localhost:11434', apikey, model, messages, stream = true, ...rest } = {}, simpleFetch, streamResponseToRenderer) {
    const url = `${baseurl.replace(/\/$/, '')}/api/chat`;
    const body = { model, messages, stream, ...rest };

    return ollama_request({
        simpleFetch,
        method: 'POST',
        url,
        apikey,
        body,
        isStreaming: stream,
        streamHandler: (res) => streamResponseToRenderer(event, res),
    });
}

/**
 * Lists models that are available locally.
 * GET /api/tags
 * @param {object} config - Configuration for the request.
 * @param {string} config.baseurl - The base URL of the Ollama API.
 * @param {string} [config.apikey] - Optional API key.
 * @param {Function} simpleFetch - A function that behaves like `fetch`.
 * @returns {Promise<object>} A promise that resolves with the list of models.
 */
async function ollamaListLocalModels({ baseurl = 'http://localhost:11434', apikey } = {}, simpleFetch) {
    const url = `${baseurl.replace(/\/$/, '')}/api/tags`;
    return ollama_request({ simpleFetch, method: 'GET', url, apikey });
}

/**
 * Shows information about a model.
 * POST /api/show
 * @param {object} config - Configuration for the request.
 * @param {string} config.baseurl - The base URL of the Ollama API.
 * @param {string} [config.apikey] - Optional API key.
 * @param {string} config.model - The name of the model to show.
 * @param {boolean} [config.verbose] - If true, returns more detailed information.
 * @param {Function} simpleFetch - A function that behaves like `fetch`.
 * @returns {Promise<object>} A promise that resolves with the model information.
 */
async function ollamaShowModelInfo({ baseurl = 'http://localhost:11434', apikey, model, verbose } = {}, simpleFetch) {
    const url = `${baseurl.replace(/\/$/, '')}/api/show`;
    const body = { model, verbose };
    return ollama_request({ simpleFetch, method: 'POST', url, apikey, body });
}

/**
 * Generates embeddings from a model for a given input.
 * POST /api/embed
 * @param {object} config - Configuration for the request.
 * @param {string} config.baseurl - The base URL of the Ollama API.
 * @param {string} [config.apikey] - Optional API key.
 * @param {string} config.model - The name of the model to use.
 * @param {string|string[]} config.input - The text or list of texts to generate embeddings for.
 * @param {object} [config.options] - Additional model parameters.
 * @param {string} [config.keep_alive] - Controls how long the model stays loaded.
 * @param {Function} simpleFetch - A function that behaves like `fetch`.
 * @returns {Promise<object>} A promise that resolves with the embeddings.
 */
async function ollamaGenerateEmbeddings({ baseurl = 'http://localhost:11434', apikey, model, input, ...rest } = {}, simpleFetch) {
    const url = `${baseurl.replace(/\/$/, '')}/api/embed`;
    const body = { model, input, ...rest };
    return ollama_request({ simpleFetch, method: 'POST', url, apikey, body });
}

/**
 * Lists models that are currently loaded into memory.
 * GET /api/ps
 * @param {object} config - Configuration for the request.
 * @param {string} config.baseurl - The base URL of the Ollama API.
 * @param {string} [config.apikey] - Optional API key.
 * @param {Function} simpleFetch - A function that behaves like `fetch`.
 * @returns {Promise<object>} A promise that resolves with the list of running models.
 */
async function ollamaListRunningModels({ baseurl = 'http://localhost:11434', apikey } = {}, simpleFetch) {
    const url = `${baseurl.replace(/\/$/, '')}/api/ps`;
    return ollama_request({ simpleFetch, method: 'GET', url, apikey });
}

/**
 * Gets the version of the Ollama API.
 * GET /api/version
 * @param {object} config - Configuration for the request.
 * @param {string} config.baseurl - The base URL of the Ollama API.
 * @param {string} [config.apikey] - Optional API key.
 * @param {Function} simpleFetch - A function that behaves like `fetch`.
 * @returns {Promise<object>} A promise that resolves with the version information.
 */
async function ollamaGetVersion({ baseurl = 'http://localhost:11434', apikey } = {}, simpleFetch) {
    const url = `${baseurl.replace(/\/$/, '')}/api/version`;
    return ollama_request({ simpleFetch, method: 'GET', url, apikey });
}


module.exports = {
    // Renamed the original function for clarity and consistency
    ollamaGenerateCompletion,
    ollamaChatCompletion,
    ollamaListLocalModels,
    ollamaShowModelInfo,
    ollamaGenerateEmbeddings,
    ollamaListRunningModels,
    ollamaGetVersion
    // NOTE: /api/push, /api/create, and /api/blobs endpoints are more complex and
    // require additional logic for file handling (pushing blobs) which is not
    // detailed here but could be added following the same pattern.
};