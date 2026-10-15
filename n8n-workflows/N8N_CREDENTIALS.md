# n8n Setup — WhatsApp Workflow

This file is **only for n8n**. It lists what to configure in n8n after importing [`restaurant-whatsapp-ai-bot.json`](./restaurant-whatsapp-ai-bot.json). Backend settings are documented separately in [`../BACKEND_ENV_SETUP.md`](../BACKEND_ENV_SETUP.md).

## 1. Add credentials in n8n

In n8n, open **Credentials → Add credential**. Create/select the credential types below, then assign them to the nodes named here.

| Credential type in n8n | Assign to node(s) | What it does |
|---|---|---|
| **WhatsApp OAuth API** (`whatsAppTriggerApi`) | `WhatsApp Trigger` | Receives new customer messages |
| **WhatsApp API** (`whatsAppApi`) | WhatsApp send nodes and WhatsApp media/API request nodes | Sends customer replies and menu media |
| **Google Gemini (PaLM) API** (`googlePalmApi`) | `Transcribe a recording` | Transcribes customer voice messages |
| **Mistral Cloud API** (`mistralCloudApi`) | `Mistral Cloud Chat Model` | Generates AI responses |
| **MongoDB** (`mongoDb`) | `MongoDB Chat Memory` | Stores conversation memory for the AI |

Credential display names can be anything. The credential type must match the table. Enter actual tokens, API keys and database details in n8n's protected credential form—not in this file or the workflow JSON.

## 2. Set the n8n environment variable

Configure this variable in the environment where the **n8n service** runs:

| Variable | Set it to |
|---|---|
| `N8N_API_KEY` | The same private key configured on the CRM backend |

The workflow uses it in the `x-api-key` header when it requests CRM data. Restart/redeploy n8n after changing its environment variables if your hosting setup requires it. Never paste the key into a normal workflow field.

## 3. Check workflow connection settings

Before testing, confirm:

- The WhatsApp **Phone Number ID** in the workflow belongs to the WhatsApp Business number connected to your WhatsApp credentials.
- The CRM request nodes use the correct deployed CRM backend URL. This workflow currently points to `https://magenta-yak-337378.hostingersite.com`.
- The CRM backend is running and has the matching `N8N_API_KEY`. See [`../BACKEND_ENV_SETUP.md`](../BACKEND_ENV_SETUP.md) for backend setup.

## 4. Test before activation

Run a test for each of these:

1. A normal incoming text and AI reply.
2. A voice message and transcription.
3. A Hi-Tea menu request with media saved to that menu in the CRM.
4. A booking request and availability check.
5. A request that should go to a human agent.

The imported workflow is inactive. Activate it only after the test executions succeed.

## Menu source

Current menu names, items and prices come directly from the CRM. Menu photos, PDFs, videos and voice notes are sent using public media URLs saved with the CRM menu. Pinecone is not required.
