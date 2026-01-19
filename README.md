# fittrack-ai

FitTrack AI is a web app built with Vite and a Netlify serverless backend. The frontend lives in `src/`, and backend endpoints live in `netlify/functions/` for handling API-style requests (for example, AI-powered features) without exposing secrets in the browser. :contentReference[oaicite:0]{index=0}

## What’s in this repo

From the repository structure: :contentReference[oaicite:1]{index=1}

- `src/`  
  Frontend application code (Vite project).

- `netlify/functions/`  
  Netlify Functions (serverless endpoints). Use these for anything that needs secrets (API keys) or server-side logic.

- `index.html`  
  Vite entry HTML.

- `vite.config.js`  
  Vite configuration.

- `tailwind.config.js` and `postcss.config.js`  
  Tailwind CSS and PostCSS configuration.

- `netlify.toml`  
  Netlify build and functions configuration.

## Tech stack

- Vite (frontend tooling)
- JavaScript (primary language in this repo) :contentReference[oaicite:2]{index=2}
- Tailwind CSS (styling) :contentReference[oaicite:3]{index=3}
- Netlify Functions (serverless backend) :contentReference[oaicite:4]{index=4}

## Getting started

### Prerequisites

- Node.js (recommended: current LTS)
- npm (or your preferred package manager)

### Install

```bash
git clone https://github.com/Kanaan7/fittrack-ai.git
cd fittrack-ai
npm install
