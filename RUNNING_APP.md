# ShiftSync - Run Instructions

## What is implemented

- Role-based auth (`ADMIN`, `MANAGER`, `STAFF`)
- Session login/logout with HTTP-only cookie
- Shift creation, assignment endpoint, publication
- Constraint checks on assignment:
  - skill match
  - location certification
  - overlap detection
  - 10-hour minimum rest
  - availability window checks
- Swap/drop request workflow:
  - staff create request
  - target staff accept (for swaps)
  - manager approve/reject
  - max 3 pending requests per staff
- Notifications API with read/unread state
- Overtime and fairness analytics endpoints
- Audit trail endpoint for schedule changes
- Full dashboard UI wired to APIs

## Project Structure

- `frontend/` -> Next.js app (UI + API routes)
- `frontend/src/app/api` -> backend endpoints
- `frontend/src/lib` -> auth, Prisma client, scheduling logic
- `frontend/prisma/schema.prisma` -> database schema
- `frontend/prisma/seed.ts` -> seeded demo data

## Requirements

- Node.js 20+
- npm 10+

## Install and run

```bash
cd frontend
npm install
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

Open: `http://localhost:3000`

## Seeded Login Accounts

- Manager  
  - email: `manager@shiftsync.local`  
  - password: `manager123`

- Admin  
  - email: `admin@shiftsync.local`  
  - password: `admin123`

- Staff  
  - email: `sarah@shiftsync.local`  
  - password: `staff123`

## Main API Endpoints

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/dashboard`
- `GET /api/shifts`
- `POST /api/shifts`
- `POST /api/shifts/:id/assign`
- `POST /api/shifts/:id/publish`
- `GET /api/swaps`
- `POST /api/swaps`
- `POST /api/swaps/:id/accept`
- `POST /api/swaps/:id/approve`
- `GET /api/notifications`
- `POST /api/notifications/:id/read`
- `GET /api/analytics`
- `GET /api/audit`

## Notes

- Data persistence is now via Prisma + PostgreSQL.
- For local setup, copy `frontend/.env.local.example` to `frontend/.env.local` and set real Supabase values.
- Supabase requires SSL; keep `sslmode=require` in connection strings.

## Supabase setup values required from you

You need to provide this from your Supabase project settings:

- database password for user `postgres.jacfcvtoaxgombpiwkqq`

Then set:

- `DATABASE_URL` (pooled connection string with `pgbouncer=true`)
- `DIRECT_URL` (direct connection string without pooling)


