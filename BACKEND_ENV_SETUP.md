# CRM Backend Environment Setup

This guide is **only for the CRM backend**. These settings belong in the backend server's private `.env` file or its hosting provider's environment-variable settings. They do not belong in n8n credentials.

Keep `.env` private. Do not send it in chat, commit it to source control, or copy real values into documentation. The existing `.env.example` contains placeholders and is not a replacement for your actual `.env`.

## 1. Required for the backend to run

| Variable | What to put here | Why it is needed |
|---|---|---|
| `MONGODB_URI` | Private MongoDB connection string | Connects the CRM to its database |
| `JWT_SECRET` | A long, random, private signing secret | Signs and verifies CRM login sessions |
| `N8N_API_KEY` | A long, private API key | Protects workflow-to-CRM API requests |

`N8N_API_KEY` must be the **same value** as the `N8N_API_KEY` environment variable configured on the n8n server. Keep the value private in both places.

## 2. Required for WhatsApp messaging from the backend

| Variable | What to put here | Why it is needed |
|---|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | Meta WhatsApp Business phone-number ID | Identifies the WhatsApp sender used by backend API calls |
| `WHATSAPP_ACCESS_TOKEN` | Private Meta WhatsApp Cloud API access token | Authorizes backend message sends |

These backend values are separate from the WhatsApp credentials saved in n8n. Both systems need their own valid configuration for the features they send.

## 3. Required for CRM menu uploads and incoming media

| Variable | What to put here | Why it is needed |
|---|---|---|
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name | Selects the storage account |
| `CLOUDINARY_API_KEY` | Private Cloudinary API key | Authenticates uploads |
| `CLOUDINARY_API_SECRET` | Private Cloudinary API secret | Authenticates uploads |

These values let the CRM upload menu images/PDFs/videos/audio and archive incoming WhatsApp media. Without them, file upload is unavailable; entering an existing public media URL in the CRM can still be used where supported.

## 4. Required for automatic follow-up reminders

| Variable | What to put here | Why it is needed |
|---|---|---|
| `MISTRAL_API_KEY` | Private Mistral API key | Creates the automatic reminder message |
| `REDIS_URL` **or** `REDIS_HOST` and `REDIS_PORT` | Connection to the Redis service | Stores and runs scheduled reminder jobs |

When using a hosted Redis service, set `REDIS_URL`. Otherwise, the backend defaults to `REDIS_HOST=127.0.0.1` and `REDIS_PORT=6379`; Redis must be reachable from the backend for reminders to work reliably.

## 5. Optional settings

| Variable | When to configure it |
|---|---|
| `SLOT_TIMEZONE` | Defaults to `Asia/Karachi`; set only if the business timezone differs |
| `WHATSAPP_REMINDER_TEMPLATE_NAME` | Meta-approved WhatsApp template used when a reminder is sent outside the 24-hour customer-service window |
| `WHATSAPP_REMINDER_TEMPLATE_LANGUAGE` | Template language code; defaults to `en` |
| `WHATSAPP_BROADCAST_TEMPLATE_NAME` | Meta-approved broadcast template for customers outside the 24-hour window |
| `WHATSAPP_BROADCAST_TEMPLATE_LANGUAGE` | Broadcast template language code; defaults to `en` |
| `WHATSAPP_CS_TEAM_NUMBER` | Forwards submitted payment-proof images to the CS team's WhatsApp number |
| `PAYMENT_BANK_NAME` | Bank name shown in payment instructions; defaults to Meezan Bank |
| `PAYMENT_ACCOUNT_TITLE` | Account title shown to customers |
| `PAYMENT_ACCOUNT_NUMBER` | Account number shown to customers |
| `PAYMENT_IBAN` | IBAN shown to customers |

Only configure payment details after verifying them. Do not leave placeholder account details enabled for real bookings.

## 6. Apply and check the settings

1. On the backend host, add/update the environment variables in its private environment settings (or its private `.env` file).
2. Do not replace an existing production `.env` with `.env.example`; add only the missing settings.
3. Restart/redeploy the backend so the new settings are loaded.
4. Check the backend logs for a successful MongoDB connection and no missing-configuration errors.
5. Test login, a CRM menu-media upload, a WhatsApp request, and a scheduled reminder according to the features you enabled.
6. Configure the matching `N8N_API_KEY` in n8n separately. See [`n8n-workflows/N8N_CREDENTIALS.md`](./n8n-workflows/N8N_CREDENTIALS.md).

The backend's actual `.env` file contains secrets. Never paste its contents into a message or commit it.
