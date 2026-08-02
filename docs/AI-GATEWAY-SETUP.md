# Gravity Arena AI Gateway — Phase 1

## Endpoint

After the branch is deployed to Vercel, the WhatsApp callback endpoint is:

`https://<deployment-domain>/api/whatsapp-webhook`

## Meta webhook fields

- **Callback URL:** the endpoint above
- **Verify token:** the exact value configured as `WHATSAPP_VERIFY_TOKEN` in Vercel
- Subscribe to the WhatsApp **messages** webhook field.

## Required Vercel environment variables

1. `WHATSAPP_VERIFY_TOKEN` — create a long random value; it is shared only between Meta and the gateway.
2. `WHATSAPP_ACCESS_TOKEN` — production system-user access token with WhatsApp messaging permissions.
3. `WHATSAPP_PHONE_NUMBER_ID` — Meta's Phone Number ID, not the visible telephone number.
4. `META_GRAPH_VERSION` — defaults to `v23.0` and should be reviewed when Meta retires API versions.
5. `HERMES_API_URL` — an OpenAI-compatible `/chat/completions` endpoint.
6. `HERMES_MODEL` — exact model identifier accepted by that endpoint.
7. `HERMES_API_KEY` — optional if the endpoint requires bearer authentication.
8. `HERMES_SYSTEM_PROMPT` — optional approved Gravity Arena customer-service prompt.

## Important local-desktop limitation

A model running only on a private desktop cannot be reached by Vercel. For testing, expose an authenticated HTTPS model endpoint through a secure tunnel, or use a hosted OpenAI-compatible model endpoint. Do not expose an unauthenticated local model port directly to the internet.

## Phase 1 acceptance test

1. Deploy the feature branch to a Vercel preview deployment.
2. Add the environment variables to that preview environment.
3. Enter the preview callback URL and verify token in Meta, then select **Verify and save**.
4. Subscribe to `messages`.
5. Send a WhatsApp test message from a permitted test number.
6. Confirm the webhook returns HTTP 200 and the sender receives either an AI response or the safe fallback response.
7. Do not publish the Meta app or switch customer traffic until the Founder approves the response quality and escalation rules.

## Phase 2 controls

Before production scale, add webhook-signature validation, idempotency storage, asynchronous queueing, conversation storage with retention controls, Brevo lead capture, human handoff, rate limits, monitoring, and an approved knowledge base.
