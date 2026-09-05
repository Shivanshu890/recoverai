# RecoverAI — AI Revenue Recovery Agent

**Razorpay AI Buildathon · AI Revenue Recovery**

> Find lost revenue. Understand why. Recover it automatically.

RecoverAI turns failed payment attempts into a bounded recovery workflow:

**DETECT → DIAGNOSE → DECIDE → ACT → VERIFY → AUDIT**

## What is implemented

- 50,000-row synthetic merchant transaction dataset
- Revenue-at-risk and recoverable-pool dashboard
- Failure diagnosis and recovery segmentation
- Bounded policy engine:
  - maximum 2 retries
  - 24-hour customer contact cooldown
  - ₹15,000 high-value threshold → human review
  - 7-day transaction age limit for auto-retry
  - success stops recovery
- Recovery plan simulator
- Execute Recovery workflow
- Razorpay Test Mode Payment Link creation when credentials are configured
- Razorpay webhook endpoint with HMAC signature validation + event id handling
- AI Copilot using OpenAI Responses API when OPENAI_API_KEY is configured
- Deterministic fallback Copilot so the demo still works without an API key
- Transaction decision explanations
- Audit trail
- Evaluation-friendly metrics and synthetic historical recovery labels

## Run

### 1. Backend
```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

### 2. Frontend
```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL shown in the terminal.

## Optional integrations

### OpenAI
Set:
- `OPENAI_API_KEY`
- `OPENAI_MODEL=gpt-5.6-luna`

The AI layer is grounded with merchant state and explicit policy constraints. It is not the source of truth for safety decisions; the deterministic policy engine is.

### Razorpay Test Mode
Set:
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`

RecoverAI can create Payment Links for eligible recovery cases. The demo deliberately caps real Test Mode Payment Link calls because Razorpay documents a 30-link Test Mode limit per business.

Configure a public webhook URL pointing to:
`/api/webhooks/razorpay`

Do not commit secrets.

## Suggested 5-minute demo

1. Show ₹ revenue at risk and the recoverable pool.
2. Explain why the largest failure causes are recoverable.
3. Open Recovery Plan and change the high-value threshold.
4. Generate a plan and show how actions are allocated.
5. Click Execute Recovery.
6. Open Audit Trail and prove every action is recorded.
7. Ask Copilot: "Which failure pattern should I attack first?"
8. If Razorpay Test Mode is configured, show a Payment Link generated for an eligible transaction.
9. Explain the safety boundary: AI recommends; policy engine decides what is allowed.

## Architecture

Frontend: React + Vite + Recharts

Backend: Node.js + Express

Data: synthetic CSV for the buildathon demo

AI: OpenAI Responses API, with deterministic fallback

Payments: Razorpay Test Mode Payment Links + webhooks

## Important

The included transaction outcomes are synthetic. `historical_recovered` is a benchmark label for evaluation, not a claim about real merchant performance.

## Judge-facing architecture

```text
Razorpay payment/webhook events
          ↓
      DETECT layer
          ↓
   DIAGNOSE / AI layer
          ↓
  DECISION + POLICY GATE
      ↙         ↘
  ACT           HUMAN REVIEW
   ↓
VERIFY via webhook / API
   ↓
AUDIT + METRICS
```

The important design choice is that the LLM does **not** get unrestricted authority to move money. The AI proposes a recovery strategy, while a deterministic policy gate decides whether that strategy is permitted.

Razorpay documents Payment Links as API-created URLs for collecting payments and documents webhook events such as `payment_link.paid`; Razorpay recommends webhooks for asynchronous automation and server-side verification. OpenAI's GPT-5.6 Luna supports the Responses API and function calling.

## Demo-mode honesty

Numbers labelled as historical, precision, lift, or recovery outcomes are **synthetic benchmark/demo metrics**. They must be described as such during the pitch. The application never represents synthetic data as real Razorpay merchant performance.
