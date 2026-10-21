# CRM API guide for n8n

Base URL examples below use `https://YOUR_API_HOST`. Replace it with the deployed CRM backend URL. Public endpoints default to `restaurant-1` when `restaurantId` is omitted.

If `N8N_API_KEY` is configured on the backend, send this header on every endpoint documented here:

```http
x-api-key: YOUR_N8N_API_KEY
```

The key is optional only when the backend environment variable is unset. Keep it in n8n credentials/environment variables; do not put it in a browser or public frontend.

## Dashboard notifications

Dashboard notifications are saved per restaurant and pushed to connected CRM sessions on the `dashboard-notification` Socket.IO event. The dashboard loads the latest 50 notifications and supports unread counts and read status.

Authenticated endpoints:

- `GET /api/dashboard/notifications?limit=50`
- `PATCH /api/dashboard/notifications/:id/read`
- `PATCH /api/dashboard/notifications/read-all`
- `POST /api/dashboard/notifications/handoff` with `{ "sourceKey": "request-id", "phone": "customer-phone", "name": "Customer", "message": "Customer message", "type": "human_agent" }`

New standard, wedding, and corporate bookings; booking cancellations; explicit customer venue/date selections; customer-declined/no-booking workflow outcomes; and human-agent/frustration handoffs create notifications. CRM handoff submissions are authenticated and deduplicated by request ID.

## Import the n8n workflows

The editable workflow export is stored in the [`n8n-workflows`](./n8n-workflows) folder:

- [`restaurant-whatsapp-ai-bot.json`](./n8n-workflows/restaurant-whatsapp-ai-bot.json): the WhatsApp conversation and booking workflow shared for this CRM. This import copy is inactive. Review its CRM base URL, phone number ID, and WhatsApp/Gemini/Mistral/MongoDB credentials, and test menu replies with the media saved for each CRM category before activation. The AI receives live menu data directly from the CRM; category replies send configured images, PDFs, videos, and voice notes from the CRM menu. Before creating a booking, the workflow checks configured availability for supported categories and room inventory; Corporate requests are saved pending without claiming venue availability.
- [`N8N_CREDENTIALS.md`](./n8n-workflows/N8N_CREDENTIALS.md): safe checklist of required n8n credential types, environment variables, and post-import settings. It intentionally contains no secret values.
- [`BACKEND_ENV_SETUP.md`](./BACKEND_ENV_SETUP.md): separate guide to the CRM backend's private environment variables. Backend secrets belong on the backend host, not in n8n credentials.

Import the workflow JSON into n8n, assign credentials in n8n, and test the workflow before activating it. Keep credentials in n8n's credential store rather than adding API keys to these files. Menus and prices are managed in the CRM; uploaded menu media is stored in Cloudinary and its URL is saved with the CRM menu. The WhatsApp workflow's AI Agent fetches its live system prompt and menu context from the CRM; after importing this updated workflow, make sure the `N8N_API_KEY` environment variable is available to n8n and matches the backend.

The backend also needs `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` to upload CRM menu assets and archive incoming WhatsApp images, videos, and PDFs. Configure `N8N_API_KEY` both in the backend and as an n8n environment variable; the workflow reads it from `$env.N8N_API_KEY`. Configure the WhatsApp Cloud API credential in n8n for sending replies and menu media.

## Buffet menus and live time slots

The CRM menu editor contains the Hi-Tea Buffet, Wedding Special, Dinner Buffet, Corporate Menu, and Rooms (Family Staycation) pages. Buffet dishes, wedding packages/venues/extras, corporate meals, room catalog entries, prices, and menu time labels are kept as structured editable values. Hi-Tea price is intentionally left unset until staff enters it. Public menu data is available from `GET /api/menu/public?restaurantId=restaurant-1`; it includes the live menu text, hotel contact details, and room check-in/check-out/duration. This endpoint accepts the configured `N8N_API_KEY`.

`GET /api/slots/availability`, `GET /api/slots/availability/date`, and `GET /api/slots/public` use the matching Hi-Tea Buffet, Dinner Buffet, or Wedding menu windows when checking customer bookings. The authenticated calendar endpoint `GET /api/slots?month=YYYY-MM` also returns `slotConfigs` so the CRM calendar shows the configured windows. The Corporate 9:00 AM–5:00 PM period and the Rooms check-in/check-out/duration are customer-facing schedule details; corporate hall availability and room inventory continue to use their own calendar/inventory endpoints.

Update buffet or Wedding windows in Menu → Menu details using ranges such as `3:00 PM to 5:00 PM`. These ranges must be valid, non-overlapping times; the saved schedule immediately applies to future availability checks and the calendar. Historical slot records are matched to new windows by time overlap, but existing bookings are not changed. Review dates with existing bookings after changing a schedule. The room staycation is currently seeded at Rs. 13,500 + Tax, check-in/check-out at 2:00 PM, and an editable 22-hour duration.

The editable n8n workflow `n8n-workflows/restaurant-whatsapp-ai-bot.json` maps the live room timings and hotel contact fields into its CRM menu context. Re-import the workflow in n8n after updating the deployed copy.

## Manage the WhatsApp AI Agent prompt

The AI Agent system prompt is editable in the CRM sidebar under **AI Agent Prompt**. The editor saves revisions in the restaurant settings record, keeps up to 20 previous versions, and allows restoring a prior version or resetting to the original prompt extracted from the existing workflow.

The workflow node `Get live AI Agent prompt` calls:

`GET /api/settings/agent-prompt/public?restaurantId=restaurant-1`

It sends `x-api-key: $env.N8N_API_KEY`. This endpoint always requires a configured backend `N8N_API_KEY`; without it the request fails closed. The CRM editor endpoints are authenticated:

- `GET /api/settings/agent-prompt`
- `PUT /api/settings/agent-prompt` with `{ "content": "..." }`
- `POST /api/settings/agent-prompt/reset`

After deploying the backend and frontend, import/update `n8n-workflows/restaurant-whatsapp-ai-bot.json` in n8n and activate the updated workflow. The prompt is fetched for each workflow execution, while service closures, live menus, and room type context continue to be appended from the CRM. A failed prompt request stops that AI execution instead of silently running an outdated prompt.

## Automatic and manual follow-up reminders

If the customer clearly says they will book, decide, pay, or visit later, asks staff to wait, or promises to reply later, the AI outputs a `create_reminder` action. The workflow records the original WhatsApp message timestamp; the backend reads the restaurant's current follow-up delay from CRM settings and schedules from that timestamp. The default is 1,440 minutes (24 hours); admins can set 1 minute through 43,200 minutes (30 days) in **Follow-up Reminders**. The live timing is injected into the AI prompt for its acknowledgement, and the scheduling API returns the actual configured duration. A timing change applies to newly created automatic reminders; existing pending reminders keep their scheduled time unless staff reschedule them. The CRM displays Pakistan-local due times and live countdowns, plus today/tomorrow/this-week agendas. Duplicate webhook deliveries are ignored using the WhatsApp message ID. A new customer message cancels that customer's still-pending follow-up before normal AI handling, so the bot does not send a stale reminder after the conversation resumes.

The n8n-only endpoints `POST /api/reminders/from-whatsapp` and `POST /api/reminders/customer-replied` require `x-api-key`. The first schedules the reminder; the second cancels pending reminders for a customer who has replied. The CRM list/create/complete/reschedule/delete endpoints require admin authentication. Reminders appear in Pending until sent, then under Sent / completed. Failed sends are shown under Failed and can be retried by rescheduling. Queue jobs use Redis and pending jobs are recovered after a backend restart.

Example n8n request:

```json
{
  "restaurantId": "restaurant-1",
  "fromNumber": "923001234567",
  "customerName": "Ayesha",
  "reason": "booking_later",
  "customerMessage": "Kal booking karwaungi",
  "receivedAt": "2026-10-12T16:00:00.000Z",
  "sourceMessageId": "wamid.example"
}
```

`sourceMessageId` makes webhook retries idempotent. For authenticated CRM use, `POST /api/reminders/create` accepts a Pakistan-local `reminderDate` (`YYYY-MM-DD`) and `reminderTime` (`HH:mm` or `h:mm AM/PM`). `GET /api/reminders`, `PATCH /api/reminders/:id/complete`, `PATCH /api/reminders/:id/reschedule`, and `DELETE /api/reminders/:id` are tenant-scoped to the logged-in admin. Human message sending and AI reply suggestions are also authenticated.

Authenticated timing configuration:

- `GET /api/reminders/settings` returns `delayMinutes`, `delayLabel`, and allowed min/max values.
- `PUT /api/reminders/settings` with `{ "delayMinutes": 120 }` updates the delay (1–43,200 minutes).
- Both endpoints require CRM admin authentication. n8n does not pass or cache the duration; every new webhook reminder reads the current backend setting.

If a scheduled follow-up fires within the original customer message's 24-hour service window, the backend sends a free-form WhatsApp message. If it fires at or after the window closes, it uses an approved WhatsApp template. Configure a Meta-approved template whose body has one text variable (`{{1}}`) for the generated follow-up, and set `WHATSAPP_REMINDER_TEMPLATE_NAME` and `WHATSAPP_REMINDER_TEMPLATE_LANGUAGE` whenever the selected delay can outlast the window. Also configure `MISTRAL_API_KEY`, WhatsApp Cloud credentials, `REDIS_HOST`/`REDIS_PORT`, and the same `N8N_API_KEY` in n8n and the backend. If these are missing or Meta rejects delivery, the reminder is marked Failed rather than falsely marked sent.

## Targeted WhatsApp offer broadcasts

The CRM **Targeted Broadcast** page is staff-authenticated; it is not an n8n endpoint. The customer-page broadcast button has been moved there. It builds a live audience from tenant-scoped chat history and saved bookings, matching the selected category and, optionally, an exact CRM item. It does not offer an all-customers segment. Audience preview returns item choices and counts:

- `GET /api/customers/broadcast/audiences?category=Hi-Tea%20Buffet&item=...`
- `POST /api/customers/broadcast` with `{ "category": "Hi-Tea Buffet", "item": "Chef Special", "message": "Offer text", "imageUrl": "" }`

Both require CRM admin authentication. The backend re-calculates and validates the audience again immediately before sending. Messages can be sent as free-form text/image only when the customer has messaged within the last 24 hours. For older conversations, configure `WHATSAPP_BROADCAST_TEMPLATE_NAME` and `WHATSAPP_BROADCAST_TEMPLATE_LANGUAGE` for a Meta-approved template with one body text variable (`{{1}}`). Mixed audiences use free-form delivery within the window and the template outside it; an image campaign is rejected if any matching customer is outside the window because an image-header template is not configured. Send marketing campaigns only to customers who have agreed to receive them.

## Customer inquiry learning

Customer Inquiries in the CRM includes a bot-learning library. Staff can teach the bot from a customer inquiry by reviewing/editing the suggested response, setting its category, and saving it as active or paused. Only active entries are returned to n8n. Pausing or deleting an entry removes it from subsequent AI executions; it does not change old chats.

The WhatsApp workflow fetches approved active entries on every execution from:

`GET /api/inquiry-learning/public?restaurantId=restaurant-1`

It sends the same `x-api-key: $env.N8N_API_KEY` header as the live prompt endpoint. The endpoint fails closed if the key is missing or incorrect and returns only the question, approved answer, category, and update time for active entries (up to 200). CRM staff manage the entries using the authenticated endpoints:

- `GET /api/inquiry-learning`
- `POST /api/inquiry-learning` with `{ "question": "...", "answer": "...", "category": "...", "sourceChatId": "...", "isActive": true }`
- `PUT /api/inquiry-learning/:id` with the complete `question`, `answer`, `category`, `sourceChatId`, and `isActive` values
- `DELETE /api/inquiry-learning/:id`

The workflow tells the AI to use learning only when relevant and to prioritize current CRM menu prices, room rates, availability, and closures over learned answers. Deploy the backend and frontend, then import/update and activate `n8n-workflows/restaurant-whatsapp-ai-bot.json` in n8n for saved learning to affect the live WhatsApp bot. A failed learning fetch routes the execution to the workflow's human-agent fallback.

## Read menu and active offers

`GET /api/menus/public?restaurantId=restaurant-1`

Optional query parameters:

- `category`: `Hi-Tea Buffet`, `Dinner Buffet`, `Wedding Package`, `Pool/Gym`, `Rooms`, `D'Fusion Revolving Restaurant: A La Carte Menu`, `À la carte / Restaurant Reservation`, or `Auditorium / Movie Night + Hi-Tea`
- `restaurantId`: tenant identifier

Without `category`, `data` is an array. With `category`, `data` is one menu object or `null`. Each menu includes `activeOffers`, `hasActiveOffer`, and `whatsappText`; offers outside their active date range are excluded from `activeOffers`. The `Wedding Package` menu can also include `weddingPackages` (per-person prices and inclusions) and `weddingVenues` (hall capacity and rental charges); active wedding packages and venues are included in `whatsappText` for customer replies.

```bash
curl -H "x-api-key: YOUR_N8N_API_KEY" \
  "https://YOUR_API_HOST/api/menus/public?restaurantId=restaurant-1&category=Hi-Tea%20Buffet"
```

Example response:

```json
{
  "success": true,
  "data": {
    "category": "Hi-Tea Buffet",
    "title": "Hi-Tea Buffet",
    "price": 2500,
    "activeOffers": [],
    "hasActiveOffer": false,
    "whatsappText": "Hi-Tea Buffet\nRs 2500"
  }
}
```

## Check category availability

`GET /api/slots/availability`

Required query parameters:

- `date`: `YYYY-MM-DD`
- `time`: 24-hour `HH:mm`, for example `17:30`
- `persons`: positive integer

Optional: `category` (`Hi-Tea Buffet`, `Dinner Buffet`, `Pool/Gym`, `Wedding`, `Rooms`, `D'Fusion Revolving Restaurant: A La Carte Menu`, `À la carte / Restaurant Reservation`, or `Auditorium / Movie Night + Hi-Tea`; defaults to `Hi-Tea Buffet`) and `restaurantId` (defaults to `restaurant-1`). Availability uses the category's configured seat capacity and active bookings; the CRM does not assign or track tables. A requested time earlier than the current restaurant-local time is unavailable for today's date.

The standard category windows are:

- `Hi-Tea Buffet`: `15:00–17:00`, `17:00–19:00`, and `19:00–21:00` (`3–5 PM`, `5–7 PM`, `7–9 PM`)
- `Dinner Buffet`: `19:00–20:30` and `21:00–22:30` (`7–8:30 PM`, `9–10:30 PM`)
- `Auditorium / Movie Night + Hi-Tea`: `09:00–17:00`, `10:00–12:00`, `14:00–16:00`, and `18:00–20:00`
- `À la carte / Restaurant Reservation`: open dining flow; availability is checked against table and time-slot capacity in the reservation calendar rather than a single fixed buffet block

```bash
curl -H "x-api-key: YOUR_N8N_API_KEY" \
  "https://YOUR_API_HOST/api/slots/availability?restaurantId=restaurant-1&date=2026-06-20&time=17%3A30&persons=4&category=Hi-Tea%20Buffet"
```

Example available response:

```json
{
  "success": true,
  "available": true,
  "reason": "",
  "date": "2026-06-20",
  "time": "17:30",
  "slot": {
    "id": "TIME_SLOT_ID",
    "label": "5 PM - 7 PM",
    "startTime": "17:00",
    "endTime": "19:00",
    "status": "available",
    "booked": 3,
    "capacity": 15,
    "seatsLeft": 12
  },
  "alternatives": []
}
```

If no capacity/slot is available, `available` is `false`, `reason` explains why, and `alternatives` may contain up to three suggested slots.

## Check all slots for a date and party size

`GET /api/slots/availability/date`

Required query parameters:

- `date`: `YYYY-MM-DD`
- `persons`: positive integer

Optional: `category` (`Hi-Tea Buffet`, `Dinner Buffet`, `Pool/Gym`, `Wedding`, or `Rooms`; defaults to `Hi-Tea Buffet`) and `restaurantId` (defaults to `restaurant-1`). The CRM uses the authenticated route `/api/slots/availability/date/admin`; this public route accepts the configured `N8N_API_KEY`.

```bash
curl -H "x-api-key: YOUR_N8N_API_KEY" \
  "https://YOUR_API_HOST/api/slots/availability/date?restaurantId=restaurant-1&date=2026-06-20&persons=4&category=Hi-Tea%20Buffet"
```

The response includes the three fixed time slots for that category and date, even when that date has not been configured yet. Each slot has `available`, `status`, and `seatsLeft`; `openSlots` is the number of slots that can accommodate the requested party size. For today's date, slots that have already started in `SLOT_TIMEZONE` are returned as unavailable.

## Configure room types and date-range availability

Rooms use a separate nightly inventory flow; do not use the fixed buffet/event time slots for room stays. Add each real room type, its actual nightly rate, and total inventory in the CRM's Availability → Rooms page. Daily blocked inventory is subtracted from active reservations.

### Public room type list

`GET /api/rooms/types/public?restaurantId=restaurant-1`

Returns active room types, including their MongoDB `_id` (use as `roomTypeId`), name, nightly `baseRate`, total room count, optional `maxGuestsPerRoom`, description, and amenities. This endpoint accepts the configured `N8N_API_KEY`.

### Check a stay before booking

`GET /api/rooms/availability/check`

Required query parameters:

- `checkInDate`: `YYYY-MM-DD`
- `checkOutDate`: `YYYY-MM-DD`, later than check-in
- `roomTypeId`: ID from the room type list
- `rooms`: positive whole number (defaults to `1`)
- `guests`: optional positive whole number; checked against the room type's configured maximum guest capacity when one is set
- `restaurantId`: optional tenant identifier (defaults to `restaurant-1`)

```bash
curl -H "x-api-key: YOUR_N8N_API_KEY" \
  "https://YOUR_API_HOST/api/rooms/availability/check?restaurantId=restaurant-1&checkInDate=2026-06-20&checkOutDate=2026-06-22&roomTypeId=ROOM_TYPE_ID&rooms=1"
```

The response reports availability for every night in the stay. An unavailable response can include up to three alternatives (another configured room type for the same dates or nearby dates). WhatsApp room booking payloads must include `roomTypeId`, `roomType`, `checkOutDate`, and `numberOfRooms`; the backend rechecks inventory and calculates the total as configured nightly rate × room count × nights, then sets the 20% advance.

### CRM room management endpoints

These endpoints require the normal CRM admin authentication:

- `GET /api/rooms/types` — list room types.
- `POST /api/rooms/types` — create a room type (`name`, `baseRate`, `totalRooms`; optional `description`, `amenities`).
- `PUT /api/rooms/types/:id` — update a room type.
- `DELETE /api/rooms/types/:id` — deactivate a room type without deleting booking history.
- `GET /api/rooms/availability/month?month=YYYY-MM` — monthly availability and reservation counts per type.
- `PUT /api/rooms/availability` — update a date's blocked inventory (`roomTypeId`, `date`, `blockedRooms`, optional `note`).

```json
{
  "success": true,
  "data": {
    "date": "2026-06-20",
    "category": "Hi-Tea Buffet",
    "persons": 4,
    "dayStatus": "available",
    "openSlots": 3,
    "timeSlots": [
      {
        "label": "3 PM - 5 PM",
        "startTime": "15:00",
        "endTime": "17:00",
        "status": "available",
        "booked": 3,
        "capacity": 15,
        "seatsLeft": 12,
        "available": true,
        "reason": ""
      },
      {
        "label": "5 PM - 7 PM",
        "startTime": "17:00",
        "endTime": "19:00",
        "status": "available",
        "booked": 3,
        "capacity": 15,
        "seatsLeft": 12,
        "available": true,
        "reason": ""
      },
      {
        "label": "7 PM - 9 PM",
        "startTime": "19:00",
        "endTime": "21:00",
        "status": "available",
        "booked": 3,
        "capacity": 15,
        "seatsLeft": 12,
        "available": true,
        "reason": ""
      }
    ]
  }
}
```

## Read the Hi-Tea schedule

`GET /api/slots/hitea-schedule`

Optional query parameters: `from` (`YYYY-MM-DD`, defaults to today in `SLOT_TIMEZONE`), `days` (integer 1–31, defaults to 7), and `restaurantId`.

```bash
curl -H "x-api-key: YOUR_N8N_API_KEY" \
  "https://YOUR_API_HOST/api/slots/hitea-schedule?restaurantId=restaurant-1&from=2026-06-20&days=7"
```

Response shape:

```json
{
  "success": true,
  "data": [
    {
      "date": "2026-06-20",
      "status": "available",
      "timeSlots": [
        {
          "label": "3 PM - 5 PM",
          "startTime": "15:00",
          "endTime": "17:00",
          "status": "available",
          "seatsLeft": 12,
          "booked": 3,
          "capacity": 15
        },
        {
          "label": "5 PM - 7 PM",
          "startTime": "17:00",
          "endTime": "19:00",
          "status": "available",
          "seatsLeft": 12,
          "booked": 3,
          "capacity": 15
        },
        {
          "label": "7 PM - 9 PM",
          "startTime": "19:00",
          "endTime": "21:00",
          "status": "available",
          "seatsLeft": 12,
          "booked": 3,
          "capacity": 15
        }
      ]
    }
  ]
}
```

## Create a WhatsApp booking

`POST /api/bookings/from-whatsapp` with `Content-Type: application/json`.

`fromNumber` is required. `bookingData` can be an object (recommended) or a JSON-encoded object string. Booking requests are stored without assigning a physical table.

```bash
curl -X POST "https://YOUR_API_HOST/api/bookings/from-whatsapp" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_N8N_API_KEY" \
  -d '{
    "fromNumber": "923001234567",
    "restaurantId": "restaurant-1",
    "bookingData": {
      "customerName": "Ayesha",
      "customerPhone": "923001234567",
      "bookingCategory": "Hi-Tea Buffet",
      "package": "Hi-Tea Buffet",
      "selectedItems": [
        { "name": "Family Hi-Tea Package", "quantity": 1, "unitPrice": 10000, "notes": "" }
      ],
      "bookingDetails": [
        { "label": "Occasion", "value": "Birthday" }
      ],
      "numberOfPersons": 4,
      "bookingDate": "2026-06-20",
      "bookingTime": "17:30",
      "totalAmount": 10000,
      "advanceAmount": 2000,
      "paymentMethod": "bank transfer",
      "paymentScreenshotUrl": "",
      "offerApplied": "",
      "specialRequests": ""
    }
  }'
```

Success response uses `{ "success": true, "message": "...", "data": <booking> }`. The created WhatsApp booking starts with `pending` status.
`bookingCategory` identifies the configured menu category; `package` and `selectedItems` retain the exact customer selection, while `bookingDetails` stores confirmed category-specific answers. Do not send guessed item prices or details.

## Attach a payment screenshot

`POST /api/bookings/payment-screenshot` accepts either a trusted HTTP(S) `url` or an incoming WhatsApp `mediaId`, plus `customerPhone`, `mediaType`, optional `caption`, and `restaurantId`. The backend links payment images/PDFs to the newest matching pending standard, wedding, or corporate booking and stores the media in CRM. If a booking ID is known, the standard-booking endpoint also accepts `POST /api/bookings/{bookingId}/payment-screenshot`.

```bash
curl -X POST "https://YOUR_API_HOST/api/bookings/payment-screenshot" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_N8N_API_KEY" \
  -d '{"mediaId":"WHATSAPP_MEDIA_ID","mediaType":"image","caption":"payment receipt","customerPhone":"923001234567","restaurantId":"restaurant-1"}'
```

On receipt, the booking proof is saved and the customer receives a localized yes/no confirmation question. It is not yet forwarded to CS or eligible for verification. After the customer confirms, the workflow marks standard payment as `verifying`, forwards the proof and booking details to CS, and replies that verification is pending. CS must verify the payment before a standard booking can be confirmed. Wedding/corporate bookings retain their separate signed-agreement and staff-confirmation requirements.

## WhatsApp booking context and payment follow-up

These n8n-only endpoints require `x-api-key`:

- `GET /api/bookings/customer-context?restaurantId=restaurant-1&phone=923001234567` returns matching standard, wedding, and corporate records for the sender. The AI uses this live CRM context to recognize staff-created bookings and not contradict saved booking/payment status.
- `POST /api/bookings/confirm-payment-proof` with `{ "restaurantId": "restaurant-1", "customerPhone": "923001234567", "message": "Yes" }` handles the yes/no response to the uploaded-proof question. A confirmed response forwards the proof to CS; a negative response asks for a correct proof. Unrelated messages return `data.active: false` and continue through normal routing.
- `POST /api/bookings/decline-advance` with `{ "restaurantId": "restaurant-1", "customerPhone": "923001234567", "message": "I cannot pay the advance right now" }` records a customer's decline on the existing pending standard booking, sends the booking details and reason to CS, and returns a localized acknowledgement. It does not create a booking if no pending record exists.

The standard booking is created after the customer confirms the booking request and its required details are collected; a separate promise to pay the advance is not required before saving the pending request. This lets CS see the customer's details if they later decline or need help with the advance. The 20% advance remains unverified until CS checks the submitted proof.

## Look up loyalty status

`GET /api/loyalty/{phone}?restaurantId=restaurant-1&category=Hi-Tea%20Buffet`

`phone` may contain formatting characters; the backend compares normalized digits. Add the optional `category` query parameter to check visits and the reward configured for that menu category; without it, the legacy restaurant-wide loyalty settings and visit count are used. Menu categories without their own saved loyalty settings continue to use the restaurant-wide settings until configured. Response `data` includes `visitCount`, `visitsForReward`, `visitsRemaining`, `rewardText`, `rewardEarned`, `enabled`, and a customer-facing `message`.

```bash
curl -H "x-api-key: YOUR_N8N_API_KEY" \
  "https://YOUR_API_HOST/api/loyalty/923001234567?restaurantId=restaurant-1&category=Hi-Tea%20Buffet"
```

## Backend environment

Configure these on the backend deployment:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string (required by the existing backend). |
| `PORT` | HTTP port; defaults to `5000`. |
| `N8N_API_KEY` | Required shared secret for the live AI prompt, inquiry-learning, and WhatsApp reminder integration endpoints. |
| `SLOT_TIMEZONE` | Timezone used for the schedule's default current date; defaults to `Asia/Karachi`. |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary account name for CRM menu media uploads. |
| `CLOUDINARY_API_KEY` | Cloudinary API key for CRM menu media uploads. |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret for CRM menu media uploads. |
| `REDIS_URL` or `REDIS_HOST` / `REDIS_PORT` | Redis connection for delayed reminders; `REDIS_URL` supports authenticated `redis://` and TLS `rediss://`; otherwise defaults to `127.0.0.1:6379`. |
| `MISTRAL_API_KEY` | Required to generate the scheduled follow-up wording. |
| `WHATSAPP_REMINDER_TEMPLATE_NAME` | Name of the approved Meta template used for 24-hour follow-ups; its body must accept one text parameter. |
| `WHATSAPP_REMINDER_TEMPLATE_LANGUAGE` | Approved template language code; defaults to `en`. |
| `WHATSAPP_BROADCAST_TEMPLATE_NAME` | Approved Meta text campaign template used for opted-in customers outside the 24-hour service window; its body must accept one text parameter. |
| `WHATSAPP_BROADCAST_TEMPLATE_LANGUAGE` | Approved campaign template language code; defaults to `en`. |
| `PAYMENT_BANK_NAME` | Customer-facing bank name; defaults to Meezan Bank. |
| `PAYMENT_ACCOUNT_TITLE` | Verified company account title; required before account details can be shared. |
| `PAYMENT_ACCOUNT_NUMBER` | Optional company account number; provide this or an IBAN. |
| `PAYMENT_IBAN` | Optional company IBAN; provide this or an account number. |
| `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_ACCESS_TOKEN` | WhatsApp Cloud API credentials for booking confirmations, CS, and scheduled follow-ups. |
| `WHATSAPP_CS_TEAM_NUMBER` | Optional CS WhatsApp number that receives customer payment proofs. |

Cloudinary variables are only needed for uploading menu media from the CRM; menu URLs can also be entered directly. n8n does not need Cloudinary credentials.

## Wedding halls and WhatsApp enquiries

Wedding halls use their own per-date inventory and do not use the shared buffet/event time-slot calendar.

### Public wedding data and availability

All endpoints below accept `x-api-key` when `N8N_API_KEY` is configured. The tenant defaults to `restaurant-1`.

- `GET /api/weddings/halls/public?restaurantId=restaurant-1` — active hall names, capacities and rental prices.
- `GET /api/weddings/availability/public?date=2026-09-05&hallName=Orchid%20Hall` — check one hall (`hallId` may be used instead); omit hall to return all halls for that date.
- `POST /api/weddings/availability/check` — same availability check using JSON body `{ "date": "2026-09-05", "hallName": "Orchid Hall" }`.
- `GET /api/weddings/availability/suggest?fromDate=2026-09-05&guests=120&limit=5` — suggest available dates, optionally restricted by `hallId`; `guests` filters halls by configured capacity.
- `GET /api/weddings/enquiries/availability?date=2026-09-05&guests=120` — check all halls for the enquiry and return capacity-matched alternative dates when unavailable.
- `GET /api/weddings/questions` — ordered ten-question wedding enquiry list.

Date values must be real dates in `YYYY-MM-DD` format. Availability statuses are `available`, `booked`, and `blocked`. A confirmed CRM booking reserves its selected date and hall.

### Current WhatsApp booking flow

The shared WhatsApp workflow handles Wedding Package through the same AI booking action as other standard categories. The bot uses the active wedding package and its configured per-person price, collects the event date/time and guest count, quotes the CRM-based total and 20% advance, then creates a normal pending record through `POST /api/bookings/from-whatsapp`. The shared Wedding availability calendar is checked first. Payment screenshots are attached to that standard booking; CS can verify them from the unified Bookings page or the Wedding Payments page.

The legacy `/api/weddings/enquiries/*` endpoints below remain available for existing records or integrations that explicitly use the former question-by-question enquiry workflow. The current WhatsApp workflow no longer calls them, and new standard bookings do not reserve a wedding hall or require the legacy quotation/agreement pipeline.

### CRM wedding pipeline endpoints

These require CRM admin authentication:

- `GET /api/weddings/stages`, `GET /api/weddings/bookings`, `GET /api/weddings/bookings/:id`
- `GET /api/weddings/payment-instructions` — CRM-authenticated account instructions from the existing `PAYMENT_*` backend environment variables; the quotation-sharing draft includes these only when a complete account is configured.
- `POST /api/weddings/bookings`, `PUT /api/weddings/bookings/:id`
- `PATCH /api/weddings/bookings/:id/stage` — stage changes are recorded with actor and timestamp.
- `POST /api/weddings/bookings/:id/quotation` — calculate configured menu × guests, hall rental, selected add-ons, configured tax and the 20% advance.
- `PATCH /api/weddings/bookings/:id/verify-payment` — CS verifies a submitted payment-proof URL.
- `PATCH /api/weddings/bookings/:id/confirm` — requires verified advance and a saved agreement URL; rechecks and reserves the selected hall/date.
- `POST /api/weddings/bookings/:id/reminder` — schedules the pre-event reminder through the CRM reminder queue.
- `PATCH /api/weddings/bookings/:id/follow-up`, `PATCH /api/weddings/bookings/:id/no-booking`
- `PATCH /api/weddings/bookings/:id/ai-replies/:replyId` — mark a stored WhatsApp AI question/reply reviewed.
- `GET /api/weddings/availability/month?month=2026-09`, `PUT /api/weddings/availability`, `PUT /api/weddings/halls/:hallId` — monthly hall calendar, date status and editable hall inventory (CRM auth).

Wedding prices and hall rent are plus tax. The applicable tax rate is not included in the supplied data; no quotation total can be generated until staff enters the approved rate in the Wedding Package menu editor or the quote form. An existing unversioned 0% seed placeholder is cleared during the one-time defaults migration. Hall capacities are editable CRM seed defaults of 300 guests per hall and must be replaced with the hotel's verified capacities. Decor/vendor rates were not supplied; CS must enter the confirmed decor quote in the quotation form.

## Corporate events

Corporate events have their own CRM menu, enquiry flow, pipeline, and calendars. Orchid Hall, Magnolia Hall 1, and Magnolia Hall 2 are shared physical inventory with weddings: either flow sees reservations made by the other. Opera, Palm 1, and Palm 2 are separate boardrooms. The corporate service uses a distinct corporate rate for each venue; it does not reuse wedding hall rental prices.

### Corporate menu and venues

- `GET /api/menus/public?restaurantId=restaurant-1&category=Corporate` returns the active Corporate menu and `whatsappText`.
- `GET /api/corporate/questions` returns the exact greeting, ordered 11 question prompts, and completion message.
- `GET /api/corporate/venues/public?restaurantId=restaurant-1&group=halls` returns active shared corporate halls. Use `group=boardrooms` for Opera, Palm 1, and Palm 2. This endpoint accepts the configured `N8N_API_KEY`.
- `GET /api/corporate/availability/public?restaurantId=restaurant-1&date=2026-09-05&guests=40&group=halls&setupType=Theatre` checks venue status, configured capacity, and optional setup suitability. `group` is `halls` or `boardrooms`; `setupType` must match a CRM-configured setup. The authenticated CRM equivalent is `GET /api/corporate/availability/month?month=2026-09&group=halls` (or `boardrooms`).
- `GET /api/corporate/availability/suggest?restaurantId=restaurant-1&fromDate=2026-09-05&guests=40&group=halls&setupType=Theatre&limit=5` suggests the next dates/venues with an open shared inventory row and enough configured capacity. Optional `hallId` narrows results to a venue.
- `POST /api/corporate/availability/check` accepts the same fields as the public check in a JSON body.

Corporate venue rates and boardroom capacities were not supplied, so they are intentionally blank until staff enters verified values in the Corporate Halls or Board Rooms CRM page. A venue with unknown capacity/rate is not represented as guest-capacity eligible, and quotation/confirmation is blocked until the actual values are configured. The Corporate menu is seeded at Rs. 2,850 per person + tax; the corporate tax percentage is intentionally unset until staff enters the approved rate.

### Current WhatsApp booking flow

The shared WhatsApp workflow handles Corporate through the same AI booking action as other standard categories. The bot uses the active CRM Corporate package/menu and its configured price basis, collects the event date/time and guest count, quotes the CRM-based total and 20% advance, then creates a normal pending record through `POST /api/bookings/from-whatsapp`. Because Corporate uses a separate venue calendar rather than the generic time-slot calendar, the workflow does not claim venue availability; the request remains pending. Payment screenshots are attached to that standard booking; CS can verify them from the unified Bookings page or the Corporate Payments page.

The legacy `/api/corporate/enquiries/*` endpoints remain available for existing records or integrations that explicitly use the former question-by-question enquiry workflow. The current WhatsApp workflow no longer calls them, and new standard bookings do not require the legacy quotation/agreement pipeline.

### Corporate CRM endpoints

These require CRM admin authentication except where stated:

- `GET /api/corporate/stages`, `GET /api/corporate/bookings`, `POST /api/corporate/bookings`, `GET /api/corporate/bookings/:id`, `PUT /api/corporate/bookings/:id`
- `PATCH /api/corporate/bookings/:id/stage` — changes pipeline stage with actor and timestamp.
- `POST /api/corporate/bookings/:id/quotation` — calculates configured menu × guests + corporate venue rate + configured tax, and the 20% advance. It requires a configured venue capacity/rate and approved tax.
- `PATCH /api/corporate/bookings/:id/verify-payment` — CS verifies an attached advance proof.
- `PATCH /api/corporate/bookings/:id/confirm` — requires verified payment and a saved agreement URL, rechecks and reserves the shared venue/date, sends the WhatsApp confirmation, logs it to chat history, and attempts to schedule the pre-event reminder.
- `PATCH /api/corporate/bookings/:id/ai-replies/:replyId` — mark a saved AI reply reviewed.
- `GET /api/corporate/venues`, `PUT /api/corporate/venues/:hallId`, `PUT /api/corporate/availability` — authenticated CRM venue management and per-date status editing.

Incoming payment screenshots are attached to matching corporate bookings by the existing `POST /api/bookings/payment-screenshot` integration, alongside wedding and standard bookings. The customer confirms the upload before the workflow forwards it to CS; payment verification and final event confirmation remain separate staff actions. A failed WhatsApp send is surfaced as a warning and can be retried by CS from Chat History in Agent mode.
