# Cloud Run OpenAI Proxy

A minimal Express service that proxies OpenAI operations for your Google Apps Script. It exposes:

- POST `/assistant/master-prompts`: Creates a thread, runs init and user prompts with the given assistant, returns the assistant's reply text.
- POST `/chat/complete`: Calls Chat Completions (default model `o3`) for a single prompt.
- POST `/images/generate`: Calls Responses API with `image_generation` tool and returns base64 data.
- GET `/healthz`: Health check.

## Configuration

- `OPENAI_API_KEY` (required): OpenAI API key.
- `SERVICE_TOKEN` (optional, recommended): Shared secret. If set, clients must send header `x-service-token: <SERVICE_TOKEN>`.

## Deploy to Cloud Run

```bash
# Build container
gcloud builds submit --tag gcr.io/$(gcloud config get-value project)/cloudrun-openai-proxy

# Deploy
gcloud run deploy cloudrun-openai-proxy \
  --image gcr.io/$(gcloud config get-value project)/cloudrun-openai-proxy \
  --platform managed \
  --allow-unauthenticated \
  --region us-central1 \
  --set-env-vars OPENAI_API_KEY=YOUR_KEY,SERVICE_TOKEN=YOUR_SHARED_SECRET
```

Note: remove `--allow-unauthenticated` if using Cloud Run IAM auth; update the Apps Script to include an Identity Token instead of `x-service-token`.

## Local run

```bash
npm install
OPENAI_API_KEY=sk-... SERVICE_TOKEN=dev-secret npm start
```