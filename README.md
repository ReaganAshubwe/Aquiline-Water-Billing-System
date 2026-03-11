# Aqualine Water Billing Company

Web-based water billing system with customer registration, MPESA payment processing (live or simulated), token generation, SMS notifications, and an admin dashboard.

## Features

- Customer registration and account tracking
- MPESA payment flow:
  - STK push via Daraja (live mode)
  - Simulation mode when credentials are not provided
- Manual payment submission (receipt code) with admin approval/rejection
- Automatic water token generation based on pricing rules
- SMS token delivery:
  - Africa's Talking integration (optional)
  - Simulation mode fallback
- Admin tools:
  - Customer list and spend/activity summary
  - Pending manual payment review
  - Integration status visibility
  - Inactive account cleanup

## Tech Stack

- Node.js
- Express
- Vanilla JavaScript frontend
- JSON file storage (`data/db.json`)

## Quick Start

### 1) Install dependencies

```bash
npm install
```

### 2) Initialize local database (first run)

```bash
cp data/db.seed.json data/db.json
```

### 3) Start the app

```bash
npm start
```

### 3) Open in browser

- Customer UI: http://localhost:3000
- Admin UI: http://localhost:3000/admin.html

## Admin Access

- Default local admin key: `AQUALINE_ADMIN_2026`
- Override with environment variable:

```bash
ADMIN_KEY=your_secure_key npm start
```

Admin APIs require `x-admin-key` header (or `Authorization: Bearer <key>`).

## Environment Configuration

Create a `.env` file in the project root (optional). If values are missing, the app falls back to simulation where supported.

### MPESA (Daraja)

Set these for live MPESA processing:

- `MPESA_ENABLED=true`
- `MPESA_ENV=sandbox` or `MPESA_ENV=live`
- `MPESA_CONSUMER_KEY`
- `MPESA_CONSUMER_SECRET`
- `MPESA_SHORTCODE`
- `MPESA_PASSKEY`
- `MPESA_CALLBACK_URL`
- `MPESA_TILL_NUMBER` (optional, shown in manual payment instructions)

Callback endpoint:

- `/api/payments/mpesa/callback`

### SMS (Africa's Talking)

Set these for live SMS sending:

- `SMS_ENABLED=true`
- `SMS_PROVIDER=africastalking`
- `SMS_API_KEY`
- `SMS_USERNAME`
- `SMS_SENDER_ID` (optional)

## Pricing Model

- `KES 10` per litre
- `KES 10,000` per 1000 litres

Litres are calculated using floor division based on selected unit type.

## Core API Endpoints

### Public

- `GET /api/pricing`
- `GET /api/payment-instructions`
- `POST /api/customers/register`
- `POST /api/payments/mpesa`
- `POST /api/payments/manual-submit`
- `POST /api/payments/mpesa/callback`

### Admin (requires admin key)

- `GET /api/admin/auth-check`
- `GET /api/admin/integration-status`
- `GET /api/admin/customers`
- `GET /api/admin/payments`
- `GET /api/admin/payments/pending-manual`
- `POST /api/admin/payments/:paymentId/manual-approve`
- `POST /api/admin/payments/:paymentId/manual-reject`
- `DELETE /api/admin/customers/inactive?years=2`

## Data Storage

This project uses a local JSON file database:

- `data/db.json`

Tracked seed template:

- `data/db.seed.json`

`data/db.json` is ignored by Git so local/runtime data is not committed.

Best suited for local development and demos.

## Notes

- If MPESA or SMS credentials are not configured, related flows automatically run in simulation mode.
- Inactive customer cleanup defaults to accounts inactive for 2+ years.
