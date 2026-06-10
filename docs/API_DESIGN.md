# API Design

The local server exposes a small API surface.

## `GET /api/health`

Checks whether the local server is running and whether an API key is configured.

Response:

```json
{
  "ok": true,
  "geminiReady": true
}
```

## `POST /api/gemini`

Generates an AI tutor response.

Request:

```json
{
  "message": "日本で働きたいです",
  "history": []
}
```

Response:

```json
{
  "text": "Japanese:\n...\n\nEnglish:\n...\n\nKorean:\n...\n\nPronunciation:\n...",
  "model": "gemini-flash-lite-latest"
}
```

## `POST /api/tts`

Generates speech audio for Japanese listening practice.

Request:

```json
{
  "text": "よろしくお願いいたします。"
}
```

Response:

```text
audio/wav
```

## Response Normalization

The server validates the AI response. If a section is missing, it generates the missing English, Korean, or pronunciation section from the Japanese text.

