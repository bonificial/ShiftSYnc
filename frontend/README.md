# ShiftSync

Multi-location staff scheduling platform built for the Priority Soft Full-Stack Developer Assessment.
Stack: **Next.js 16 · Tailwind v4 · Prisma · PostgreSQL (Supabase) · TypeScript**.

---

## Documentation

| File | What it covers |
|---|---|
| [`DOCUMENTATION.md`](./DOCUMENTATION.md) | Primary reference — credentials, scenario walkthroughs, architecture, limitations, assumptions, ambiguity decisions |
| [`RUNNING_APP.md`](./RUNNING_APP.md) | Quick-start setup guide — install, env vars, DB push, seed, dev server |
| [`project.MD`](./project.MD) | Original assessment specification |
| [`prisma/seed/README.md`](./prisma/seed/README.md) | Seed dataset overview — locations, staff, and edge cases baked in |

---

## DOCUMENTATION.md — section index

1. **[Login Instructions](./DOCUMENTATION.md#1-login-instructions)**
   Full credentials table for every demo account — admin, managers, and all 12 staff across both locations.

2. **[Running the Application](./DOCUMENTATION.md#2-running-the-application)**
   One-page setup summary (see `RUNNING_APP.md` for the extended version).

3. **[Evaluation Scenario Walkthroughs](./DOCUMENTATION.md#3-evaluation-scenario-walkthroughs)**
   Step-by-step guides for all 6 evaluator scenarios:
   - The Sunday Night Chaos
   - The Overtime Trap
   - The Timezone Tangle
   - The Simultaneous Assignment
   - The Fairness Complaint
   - The Regret Swap

4. **[Architecture & Key Decisions](./DOCUMENTATION.md#4-architecture--key-decisions)**
   Framework choices, auth model, timezone strategy, conflict-detection, SSE, human-readable IDs.

5. **[Known Limitations](./DOCUMENTATION.md#5-known-limitations)**
   SSE in multi-instance deployments, desired-hours enforcement, premium shift tagging, pagination.

6. **[Assumptions Made](./DOCUMENTATION.md#6-assumptions-made)**
   10 explicit decisions made where the spec was silent (week definition, availability timezone interpretation, overnight shift counting, etc.).

7. **[Intentional Ambiguities — Documented Decisions](./DOCUMENTATION.md#7-intentional-ambiguities--documented-decisions)**
   All 5 ambiguities from the brief resolved with rationale:
   - Historical data after de-certification
   - Desired hours vs. availability interaction
   - Shift duration and consecutive-day counting
   - Editing a shift after swap approval
   - Locations spanning timezone boundaries

---

## RUNNING_APP.md — section index

- **[What is implemented](./RUNNING_APP.md#what-is-implemented)** — feature checklist
- **[Project Structure](./RUNNING_APP.md#project-structure)** — directory map
- **[Install and run](./RUNNING_APP.md#install-and-run)** — `npm install → db:push → db:seed → dev`
- **[Main API Endpoints](./RUNNING_APP.md#main-api-endpoints)** — full endpoint list
- **[Supabase setup](./RUNNING_APP.md#supabase-setup-values-required-from-you)** — required env vars

---

## Quick start

```bash
cd frontend
cp .env.local.example .env.local   # fill in DATABASE_URL and DIRECT_URL
npm install
npm run db:push
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and use the **Demo accounts** dropdown on the login page to sign in.

---

## Repo structure

```
ShiftSYnc/
├── frontend/
│   ├── prisma/
│   │   ├── schema.prisma          # database schema
│   │   ├── seed/                  # modular realistic seed dataset
│   │   └── seed.ts                # legacy seed (retained for reference)
│   ├── src/
│   │   ├── app/
│   │   │   ├── api/               # all API routes (auth, shifts, swaps, …)
│   │   │   ├── page.tsx           # single-page dashboard
│   │   │   ├── layout.tsx
│   │   │   └── globals.css
│   │   └── lib/
│   │       ├── auth.ts            # session + RBAC
│   │       ├── labor.ts           # overtime / labor law checks
│   │       ├── notify.ts          # central notification helper
│   │       ├── broadcast.ts       # SSE client registry
│   │       ├── expiry.ts          # drop expiry + swap auto-cancel
│   │       ├── tz.ts              # timezone utilities
│   │       └── shiftLabel.ts      # human-readable shift IDs
│   ├── DOCUMENTATION.md
│   ├── RUNNING_APP.md
│   └── project.MD
├── DOCUMENTATION.md               # (same file, also at repo root)
├── RUNNING_APP.md
└── project.MD
```
