# Privacy and Security

This repository is intentionally sanitized for public technical review.

## What Is Not Included

- Personal API keys
- Private Google Docs URLs
- Original PDF or workbook content
- Private interview notes
- Personal account identifiers
- Full private flashcard datasets

## Secret Handling

The app supports two local-only ways to configure an API key:

1. Environment variable: `GEMINI_API_KEY`
2. Local file: `app/gemini_api_key.local`

The `.gitignore` file excludes `*.local`, so the key is not committed.

## Local-First Design

The app runs on:

```text
http://127.0.0.1:8765
```

This means the application is designed for personal use on the learner's machine. The demo does not include a hosted backend or database.

## AI Data Boundary

Only text explicitly sent to the AI tutor is forwarded to the AI API. Flashcard decks and local progress are not automatically uploaded.

## Public Demo Data

The included `app/data.js` file contains a small fictional sample dataset. It is not the original private study dataset.
