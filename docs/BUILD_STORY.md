# Build Story: Japanese Flashcards AI Tutor

## 1. Problem Definition

The goal was to create a daily study tool for Japanese learners preparing for JLPT vocabulary, grammar, conversation, and job interviews. The core requirement was not just to display cards, but to support a repeatable learning habit:

- What should I study today?
- Which cards should I review?
- Which cards did I miss?
- Can I practice interview answers naturally?
- Can an AI tutor respond like a Japanese conversation partner?
- Can this run locally without exposing private study material?

Because the project handles study notes, interview drafts, and API credentials, privacy became a first-class engineering requirement.

## 2. Product Scope

The application was designed around seven study modes:

- Today: daily vocabulary workload
- Grammar: grammar pattern practice
- Conversation: speaking prompts
- Interview: job interview practice
- Review: spaced repetition queue
- Mistakes: weak cards
- All: global search and lookup

The AI tutor was added as a floating panel so the learner can ask questions without leaving the flashcard flow.

## 3. Data Modeling

Cards use a compact schema:

```js
{
  id: "sample-grammar-001",
  type: "grammar",
  front: "~ようとする",
  readingHint: "",
  meaning: "to try to do; to be about to do",
  importance: "★★★"
}
```

Daily study plans point to vocabulary units and grammar ranges. Progress is stored separately in browser localStorage so the deck data stays immutable.

## 4. Frontend Implementation

The UI was built with plain HTML, CSS, and JavaScript to keep the demo lightweight and easy to review. The main frontend responsibilities are:

- Building the active deck based on the selected mode
- Rendering the current flashcard
- Showing and hiding answers
- Recording ratings: Again, Hard, Good, Easy
- Updating daily progress
- Filtering cards with search
- Opening the AI tutor panel
- Managing speech recognition state

The card navigation wraps around at the end of the deck, which makes grammar practice feel continuous.

## 5. Review Logic

The review queue uses simple spaced-review offsets:

```js
const REVIEW_OFFSETS = [1, 3, 7, 14, 30];
```

This is intentionally transparent. The goal was to demonstrate how the learning loop works without hiding behavior behind a black-box algorithm.

## 6. AI Tutor Design

The tutor supports Japanese, English, and Korean. A local Python server sends messages to the AI API and normalizes the response into:

```text
Japanese:
...

English:
...

Korean:
...

Pronunciation:
...
```

This format helps the learner compare the natural Japanese expression, meaning, and pronunciation in one place.

## 7. Local API Proxy

The frontend never receives the API key. Instead:

- The browser calls `/api/gemini`
- The Python server reads `GEMINI_API_KEY` or `gemini_api_key.local`
- The server calls the AI provider
- The server returns normalized text to the browser

This keeps secrets out of JavaScript and out of the GitHub repository.

## 8. Voice Conversation Iteration

The first voice version submitted text too aggressively when the learner paused. The workflow was changed so speech recognition only fills the input box. The learner must click Send or Send Spoken Text to submit.

This fixed a real usability problem: learners often pause mid-sentence while thinking in Japanese.

## 9. UI Stability Fixes

Long Japanese, Korean, or romaji text can expand containers if wrapping is not handled carefully. The chat panel was stabilized with:

- `max-width`
- `min-width: 0`
- `overflow-wrap: anywhere`
- `overflow-x: hidden`
- fixed chat panel boundaries

This prevents the page from shifting horizontally during chat.

## 10. Public Repository Sanitization

The working local app used private study material. For this public repository, all sensitive content was removed:

- Real deck data replaced with small sample data
- Local API key excluded
- Google Docs IDs replaced with placeholders
- Screenshots retained as UI evidence only

This demonstrates a production-minded habit: separating a real working prototype from a safe public artifact.
