# Gravity Arena Launch List Backend

Production-ready Vercel serverless endpoint for adding launch-list signups to
Brevo.

## Endpoint

`POST /api/launch-list`

Example request:

```json
{
  "email": "pilot@example.com",
  "firstName": "Avi",
  "lastName": "Pilot",
  "consent": true,
  "website": ""
}
```

`website` is a honeypot field. Keep it visually hidden from people and leave it
empty. Submissions that populate it receive a generic success response but are
not sent to Brevo.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `BREVO_API_KEY` | Yes | Brevo API v3 key |
| `BREVO_MASTER_LIST_ID` | Yes | Numeric Brevo list ID |
| `ALLOWED_ORIGINS` | No | Comma-separated origins; defaults to the apex and `www` Gravity Arena domains |
| `BREVO_DOI_TEMPLATE_ID` | No | Enables Brevo double opt-in when set to a numeric template ID |
| `BREVO_DOI_REDIRECT_URL` | No | Redirect after double opt-in confirmation |

Set secrets in Vercel Project Settings. Never commit `.env` or an API key.

## Local checks

```bash
npm run check
npm test
```

The implementation uses only Node.js built-ins and the Brevo HTTPS API, so
there are no runtime package dependencies.

## Frontend configuration

The Gravity Arena landing page should submit JSON to:

```text
https://gravity-arena-launch-list-backend.vercel.app/api/launch-list
```

Send `Content-Type: application/json`. Treat any `2xx` response with `ok: true`
as success.

## Deployment

1. Import this GitHub repository into Vercel.
2. Add the required environment variables for Production and Preview.
3. Deploy.
4. Test CORS preflight, invalid input, honeypot behavior and a real controlled
   signup.

For stronger abuse protection at scale, enable Vercel Firewall rate limiting
for `POST /api/launch-list`. In-memory rate limiting is intentionally avoided
because serverless instances do not share reliable state.
