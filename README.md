# FitTrack AI

FitTrack AI is a responsive nutrition tracker built with React, Vite, Firebase, and Netlify Functions. It supports guest tracking, account sync, CSV imports, meal history, macro goals, and AI-assisted nutrition feedback.

## Requirements

- Node.js 22 or newer
- npm
- A Firebase project with Email/Password and Google authentication enabled
- An Anthropic API key for AI features

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in the values:

   ```env
   VITE_FIREBASE_API_KEY=
   VITE_FIREBASE_AUTH_DOMAIN=
   VITE_FIREBASE_PROJECT_ID=
   VITE_FIREBASE_STORAGE_BUCKET=
   VITE_FIREBASE_MESSAGING_SENDER_ID=
   VITE_FIREBASE_APP_ID=
   ANTHROPIC_API_KEY=
   ```

3. Start the complete local app:

   ```bash
   npm run dev
   ```

   Open the local URL printed by Vite. Netlify's Vite integration serves the function routes alongside the frontend, so AI features work from the same development server.

## Validation

```bash
npm run check
```

## Deployment

The repository includes `netlify.toml`, so Netlify can build with `npm run build` and publish the `dist` directory. Add every environment variable above to the Netlify project before deploying. Keep `ANTHROPIC_API_KEY` server-side and never prefix it with `VITE_`.

Firestore data is stored under `users/{userId}` and `users/{userId}/meals/{mealId}`. Publish `firestore.rules` through Firebase so users can access only their own records.
