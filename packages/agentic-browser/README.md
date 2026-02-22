# Agentic Browser

**LLM-powered autonomous browser agent for TypeScript/Node.js.**

A standalone package that turns any LLM into a browser agent — give it a goal like *"log into my utility portal and get the latest bill"* and it autonomously navigates, fills forms, handles CAPTCHAs, and extracts data.

Think of it as **[Browser Use](https://github.com/browser-use/browser-use) for TypeScript** — but provider-agnostic and framework-independent.

## Features

| Feature | Description |
|---------|-------------|
| **Vision-based navigation** | Sends screenshots to multimodal LLMs for visual understanding |
| **Numbered element interaction** | No CSS selectors — LLM says "click [3]" to interact with element #3 |
| **Goal-driven ReAct loop** | Observe → Think → Act → Repeat until goal is done |
| **CAPTCHA solving** | Auto-detects reCAPTCHA v2/v3, hCaptcha, Turnstile, image CAPTCHAs |
| **Persistent sessions** | Cookies, auth state, and JS context maintained across steps |
| **Provider-agnostic** | Works with Gemini, OpenAI, Anthropic, Ollama, or any custom LLM |
| **Anti-detection** | Stealth mode: hides webdriver flag, realistic user-agents |
| **Agent framework tools** | Export as OpenAI function-calling or Gemini FunctionDeclaration |

## Installation

```bash
npm install agentic-browser puppeteer
```

Or with puppeteer-core (bring your own Chrome):
```bash
npm install agentic-browser puppeteer-core
```

## Quick Start

### With Google Gemini

```typescript
import { AgenticBrowser, createGeminiProvider } from 'agentic-browser';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI('YOUR_API_KEY');
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

const browser = new AgenticBrowser({
  llm: createGeminiProvider(model),
  debug: true,  // See step-by-step logs
});

const result = await browser.run(
  'Log into the portal and find the latest electricity bill amount',
  'https://myhydro.com/login',
  {
    credentials: { username: 'user@email.com', password: 'mypassword' },
    extractSchema: { billAmount: 'dollar amount', dueDate: 'date', usage: 'kWh usage' },
  }
);

console.log(result.success);        // true
console.log(result.extractedData);  // { billAmount: "$142.50", dueDate: "March 15", usage: "850 kWh" }
console.log(result.steps.length);   // 7
console.log(result.totalTimeMs);    // 23500
```

### With OpenAI

```typescript
import { AgenticBrowser, createOpenAIProvider } from 'agentic-browser';
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: 'sk-...' });
const browser = new AgenticBrowser({
  llm: createOpenAIProvider(client, 'gpt-4o'),
});
```

### With Anthropic Claude

```typescript
import { AgenticBrowser, createAnthropicProvider } from 'agentic-browser';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: 'sk-ant-...' });
const browser = new AgenticBrowser({
  llm: createAnthropicProvider(client, 'claude-sonnet-4-20250514'),
});
```

### With Ollama (Local)

```typescript
import { AgenticBrowser, createOllamaProvider } from 'agentic-browser';

const browser = new AgenticBrowser({
  llm: createOllamaProvider('llava:latest'),
  headless: false,  // Watch it navigate in real-time
});
```

### Custom LLM Provider

```typescript
import { AgenticBrowser, createCustomProvider } from 'agentic-browser';

const browser = new AgenticBrowser({
  llm: createCustomProvider(async (prompt, images) => {
    // Call any API — just return the text response
    const result = await myCustomAPI({ prompt, images });
    return result.text;
  }),
});
```

## CAPTCHA Solving

### External Solvers (reCAPTCHA, hCaptcha, Turnstile)

```typescript
const browser = new AgenticBrowser({
  llm: createGeminiProvider(model),
  captcha: {
    provider: '2captcha',      // or 'anticaptcha', 'capsolver'
    apiKey: 'YOUR_SOLVER_KEY',
    useLLMVision: true,        // Try LLM vision for image CAPTCHAs first (free)
  },
});
```

Supported solvers:
- **[2Captcha](https://2captcha.com)** — Most popular, reliable
- **[Anti-Captcha](https://anti-captcha.com)** — Good API, competitive pricing
- **[CapSolver](https://capsolver.com)** — Fast, supports all types

### LLM Vision (Image CAPTCHAs)

For simple image CAPTCHAs (distorted text), the LLM can often solve them directly via its vision capabilities — no external solver needed. Set `useLLMVision: true`.

## Using as Agent Tools

Export browser tools for any agent framework:

### OpenAI Function Calling

```typescript
import { createBrowserTools, toOpenAITools } from 'agentic-browser';

const tools = createBrowserTools({ llm: myProvider });
const openaiTools = toOpenAITools(tools);

// Pass to OpenAI
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  tools: openaiTools,
  messages: [...],
});
```

### Gemini Function Calling

```typescript
import { createBrowserTools, toGeminiTools } from 'agentic-browser';

const tools = createBrowserTools({ llm: myProvider });
const geminiTools = toGeminiTools(tools);
```

### Tools Provided

| Tool | Description |
|------|-------------|
| `agentic_browse` | Full autonomous navigation — give it a goal |
| `browse_page` | Quick page read — returns text, elements, forms |
| `screenshot` | Take a screenshot of any URL |

## Architecture

```
┌─────────────────────────────────────────────────┐
│                 AgenticBrowser                   │
│  (convenience wrapper — create once, run many)   │
├─────────────────────────────────────────────────┤
│              AgenticNavigator                    │
│  (ReAct loop: Observe → Think → Act → Repeat)   │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Elements │  │ Captcha  │  │ LLM Provider  │  │
│  │ Mapper   │  │ Solver   │  │ (pluggable)   │  │
│  └──────────┘  └──────────┘  └───────────────┘  │
├─────────────────────────────────────────────────┤
│              BrowserSession                      │
│  (persistent Puppeteer session w/ cookies)       │
└─────────────────────────────────────────────────┘
```

### How the ReAct Loop Works

1. **Navigate** to start URL
2. **Extract** all interactive elements, assign numbers [1], [2], [3]...
3. **Screenshot** the page
4. **Send to LLM**: screenshot + element list + page text + goal + history
5. **LLM responds** with JSON action: `{ "type": "click", "elementId": 3 }`
6. **Execute** the action (click, type, navigate, etc.)
7. **Check** for CAPTCHAs — auto-solve if configured
8. **Repeat** from step 2 until LLM says "done" or max steps reached

## Configuration

```typescript
const browser = new AgenticBrowser({
  // Required
  llm: myProvider,

  // Browser
  headless: true,           // false to watch in real-time
  proxy: 'http://...',      // HTTP/SOCKS5 proxy
  userAgent: '...',         // Custom user-agent
  viewport: { width: 1280, height: 900 },
  timeout: 30000,           // Navigation timeout (ms)
  executablePath: '/path/to/chrome',  // For puppeteer-core

  // CAPTCHA
  captcha: {
    provider: '2captcha',   // 'none' | '2captcha' | 'anticaptcha' | 'capsolver'
    apiKey: 'xxx',
    useLLMVision: true,
  },

  // Debug
  debug: true,              // Console logging
});
```

## Comparison with Alternatives

| Feature | Agentic Browser | Browser Use | Stagehand |
|---------|----------------|-------------|-----------|
| Language | **TypeScript** | Python | TypeScript |
| LLM Agnostic | **Yes** (any provider) | OpenAI only | OpenAI/Anthropic |
| Vision | **Yes** | Yes | Yes |
| CAPTCHA Solving | **Yes** (3 services + LLM) | No | No |
| Element Numbering | **Yes** | Yes | No |
| Standalone Package | **Yes** | Yes | Tied to BrowserBase |
| Goal-driven | **Yes** | Yes | Partial |
| Session Persistence | **Yes** | Partial | Yes |

## License

MIT
