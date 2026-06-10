from __future__ import annotations

import json
import os
import base64
import re
import struct
import time
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


APP_DIR = Path(__file__).resolve().parent
MODELS = (
    "gemini-flash-lite-latest",
    "gemini-2.5-flash",
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash",
)
TTS_MODELS = ("gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts")
RETRYABLE_STATUS = {429, 500, 502, 503, 504}


def get_api_key() -> str:
    env_key = os.environ.get("GEMINI_API_KEY", "").strip().lstrip("\ufeff")
    if env_key:
        return env_key
    key_file = APP_DIR / "gemini_api_key.local"
    if key_file.exists():
        return key_file.read_text(encoding="utf-8-sig").strip().lstrip("\ufeff")
    return ""


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP_DIR), **kwargs)

    def do_GET(self):
        if self.path == "/api/health":
            self.send_json({"ok": True, "geminiReady": bool(get_api_key())})
            return
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/tts":
            self.handle_tts()
            return

        if self.path != "/api/gemini":
            self.send_error(404)
            return

        api_key = get_api_key()
        if not api_key:
            self.send_json({"error": "GEMINI_API_KEY is not configured."}, status=400)
            return

        try:
            length = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            message = str(payload.get("message", "")).strip()
            history = payload.get("history", [])
            if not message:
                self.send_json({"error": "Empty message."}, status=400)
                return

            contents = []
            for item in history[-12:]:
                role = "model" if item.get("role") == "model" else "user"
                text = str(item.get("text", "")).strip()
                if text:
                    contents.append({"role": role, "parts": [{"text": text}]})
            if not contents or contents[-1]["role"] != "user" or contents[-1]["parts"][0]["text"] != message:
                contents.append({"role": "user", "parts": [{"text": message}]})

            body = {
                "systemInstruction": {
                    "parts": [
                        {
                            "text": (
                                "You are a friendly 1:1 language tutor for a learner preparing for JLPT, Japanese "
                                "conversation, and job interviews. You fully support Korean, English, and Japanese. "
                                "Your tutor name is Ishihara. If asked your name, say that you are Ishihara, the "
                                "learner's Japanese tutor. Do not say that you are a Google-trained language model "
                                "unless the learner explicitly asks about the underlying technology. "
                                "For every normal answer, use this exact order:\n"
                                "Japanese:\n...\n\nEnglish:\n...\n\nKorean:\n...\n\nPronunciation:\n...\n"
                                "The Korean section must be a complete Korean meaning translation of the Japanese lines. "
                                "The Pronunciation section must be Korean Hangul phonetic pronunciation of the Japanese lines, "
                                "not a Korean meaning translation. Example: ありがとうございます -> 아리가토우 고자이마스. "
                                "In live conversation practice, proactively keep the dialogue going: after answering, "
                                "ask exactly one short, natural follow-up question in Japanese, and translate it in English. "
                                "Keep normal conversation replies very concise: usually 1 or 2 short Japanese sentences plus "
                                "their English translation. "
                                "Keep the Pronunciation section at the very bottom. "
                                "Correct mistakes gently, offer "
                                "more natural alternatives, and include pronunciation hints only when useful or asked. "
                                "Do not reveal private study data unless the learner includes it in the current message."
                            )
                        }
                    ]
                },
                "contents": contents,
                "generationConfig": {
                    "temperature": 0.45,
                    "topP": 0.9,
                    "maxOutputTokens": 700,
                },
            }

            data, model = call_gemini(api_key, body)
            text = extract_text(data)
            text = ensure_bilingual_response(api_key, text)
            self.send_json({"text": text, "model": model})
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            if exc.code in RETRYABLE_STATUS:
                self.send_json(
                    {
                        "error": (
                            "Gemini is temporarily busy. I tried the available fallback models too. "
                            "Please try again in a moment."
                        )
                    },
                    status=503,
                )
            else:
                self.send_json({"error": f"Gemini API error {exc.code}: {detail[:500]}"}, status=exc.code)
        except Exception as exc:
            self.send_json({"error": str(exc)}, status=500)

    def handle_tts(self):
        api_key = get_api_key()
        if not api_key:
            self.send_json({"error": "GEMINI_API_KEY is not configured."}, status=400)
            return

        try:
            length = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            text = str(payload.get("text", "")).strip()
            if not text:
                self.send_json({"error": "Empty text."}, status=400)
                return
            text = text[:1800]
            pcm, model = call_gemini_tts(api_key, text)
            wav = pcm_to_wav(pcm)
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("X-TTS-Model", model)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(wav)))
            self.end_headers()
            self.wfile.write(wav)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            self.send_json({"error": f"Gemini TTS API error {exc.code}: {detail[:500]}"}, status=exc.code)
        except Exception as exc:
            self.send_json({"error": str(exc)}, status=500)

    def send_json(self, payload: dict, status: int = 200):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()


def extract_text(data: dict) -> str:
    parts = []
    for candidate in data.get("candidates", []):
        for part in candidate.get("content", {}).get("parts", []):
            if "text" in part:
                parts.append(part["text"])
    return "\n".join(parts).strip() or "No answer was generated."


def ensure_bilingual_response(api_key: str, text: str) -> str:
    cleaned = text.strip()
    japanese = extract_japanese_section(cleaned)
    english = extract_labeled_section(cleaned, "English")
    korean = extract_labeled_section(cleaned, "Korean", "한국어")
    pronunciation = extract_labeled_section(cleaned, "Pronunciation", "발음")

    if not english:
        english = translate_to_english(api_key, japanese)
    if not korean or not pronunciation:
        korean = translate_to_korean(api_key, japanese)
    if not pronunciation:
        pronunciation = generate_korean_pronunciation(api_key, japanese)

    return (
        f"Japanese:\n{japanese}\n\n"
        f"English:\n{english.strip()}\n\n"
        f"Korean:\n{korean.strip()}\n\n"
        f"Pronunciation:\n{pronunciation.strip()}"
    )


def extract_japanese_section(text: str) -> str:
    section = extract_labeled_section(text, "Japanese", "日本語")
    if section:
        return section
    return re.split(r"\n\s*(?:English|Korean|한국어|발음|Pronunciation)\s*:", text, maxsplit=1, flags=re.IGNORECASE)[0].strip()


def extract_labeled_section(text: str, *labels: str) -> str:
    label_pattern = "|".join(re.escape(label) for label in labels)
    boundary = r"Japanese|日本語|English|Korean|한국어|발음|Pronunciation"
    match = re.search(
        rf"(?:^|\n)\s*(?:{label_pattern})\s*:\s*(.*?)(?=\n\s*(?:{boundary})\s*:|\Z)",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    return match.group(1).strip() if match else ""


def has_english_section(text: str) -> bool:
    lowered = text.lower()
    return "\nenglish:" in lowered or lowered.startswith("english:")


def has_pronunciation_section(text: str) -> bool:
    lowered = text.lower()
    return "\n발음:" in text or text.startswith("발음:") or "\npronunciation:" in lowered or lowered.startswith("pronunciation:")


def translate_to_english(api_key: str, japanese: str) -> str:
    body = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": (
                            "Translate the following Japanese into natural English only. "
                            "Do not add labels, explanations, or markdown.\n\n"
                            f"{japanese}"
                        )
                    }
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 180,
        },
    }
    try:
        data, _ = call_gemini(api_key, body)
        return extract_text(data).strip()
    except Exception:
        return "(English translation unavailable. Please try again.)"


def translate_to_korean(api_key: str, japanese: str) -> str:
    body = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": (
                            "Translate the following Japanese into natural Korean meaning only. "
                            "Do not write pronunciation. Do not add labels, explanations, or markdown.\n\n"
                            f"{japanese}"
                        )
                    }
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 260,
        },
    }
    try:
        data, _ = call_gemini(api_key, body)
        return extract_text(data).strip()
    except Exception:
        return "(Korean translation unavailable. Please try again.)"


def generate_korean_pronunciation(api_key: str, japanese: str) -> str:
    body = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": (
                            "Convert the following Japanese into Korean Hangul pronunciation only. "
                            "Do not translate the meaning. Preserve sentence order and useful punctuation. "
                            "Example: ありがとうございます -> 아리가토우 고자이마스\n\n"
                            f"{japanese}"
                        )
                    }
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 180,
        },
    }
    try:
        data, _ = call_gemini(api_key, body)
        return extract_text(data).strip()
    except Exception:
        return "(Pronunciation could not be generated. Please try again.)"


def call_gemini(api_key: str, body: dict) -> tuple[dict, str]:
    last_error: urllib.error.HTTPError | None = None
    for model in MODELS:
        try:
            return request_gemini_model(api_key, model, body), model
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code not in RETRYABLE_STATUS and exc.code != 404:
                raise
            continue
    if last_error:
        raise last_error
    raise RuntimeError("Gemini request failed.")


def request_gemini_model(api_key: str, model: str, body: dict) -> dict:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=6) as response:
        return json.loads(response.read().decode("utf-8"))


def call_gemini_tts(api_key: str, text: str) -> tuple[bytes, str]:
    last_error: urllib.error.HTTPError | None = None
    for model in TTS_MODELS:
        try:
            data = request_gemini_tts_model(api_key, model, text)
            audio_b64 = data["candidates"][0]["content"]["parts"][0]["inlineData"]["data"]
            return base64.b64decode(audio_b64), model
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code in RETRYABLE_STATUS:
                time.sleep(0.8)
                continue
            raise
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError(f"Unexpected Gemini TTS response: {exc}") from exc
    if last_error:
        raise last_error
    raise RuntimeError("Gemini TTS request failed.")


def request_gemini_tts_model(api_key: str, model: str, text: str) -> dict:
    prompt = (
        "Read the following Japanese text aloud in a gentle, warm, kind native Japanese female tutor style. "
        "Speak at normal everyday Japanese native conversation speed, slightly brisk around 1.1x, not slowly "
        "and not overly enunciated. "
        "Keep it clear, friendly, and conversational. Do not add extra words.\n\n"
        f"{text}"
    )
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {
                        "voiceName": "Sulafat"
                    }
                }
            },
        },
    }
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def pcm_to_wav(pcm: bytes, sample_rate: int = 24000, channels: int = 1, sample_width: int = 2) -> bytes:
    byte_rate = sample_rate * channels * sample_width
    block_align = channels * sample_width
    data_size = len(pcm)
    header = b"".join(
        [
            b"RIFF",
            struct.pack("<I", 36 + data_size),
            b"WAVE",
            b"fmt ",
            struct.pack("<IHHIIHH", 16, 1, channels, sample_rate, byte_rate, block_align, sample_width * 8),
            b"data",
            struct.pack("<I", data_size),
        ]
    )
    return header + pcm


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 8765), Handler)
    print("Japanese Flashcards AI Tutor running on http://127.0.0.1:8765")
    server.serve_forever()


if __name__ == "__main__":
    main()
