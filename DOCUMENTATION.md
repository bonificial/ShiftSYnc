# ShiftSync — Technical Documentation

> Assessment submission for the Priority Soft Full-Stack Developer Assessment.

---

## Table of Contents

1. [Login Instructions](#1-login-instructions)
2. [Running the Application](#2-running-the-application)
3. [Evaluation Scenario Walkthroughs](#3-evaluation-scenario-walkthroughs)
4. [Architecture & Key Decisions](#4-architecture--key-decisions)
5. [Known Limitations](#5-known-limitations)
6. [Assumptions Made](#6-assumptions-made)
7. [Intentional Ambiguities — Documented Decisions](#7-intentional-ambiguities--documented-decisions)

---

## 1. Login Instructions

All demo accounts are pre-seeded. Use the **"Demo accounts"** dropdown on the login page to auto-fill credentials.

### Admin

| Field    | Value                        |
|----------|------------------------------|
| Email    | `admin@shiftsync.local`      |
| Password | `admin123`                   |
| Access   | All locations, all features, audit export |

### Managers

| Name            | Email                      | Password      | Manages                        |
|-----------------|----------------------------|---------------|--------------------------------|
| Olivia Manager  | `manager@shiftsync.local`  | `manager123`  | Harbor View + Pier Grill       |
| Dante Cruz      | `dante@shiftsync.local`    | `manager123`  | Pier Grill only                |

### Staff — Harbor View (America/New_York)

| Name          | Email                       | Password    | Skills                     | Cross-location? |
|---------------|-----------------------------|-------------|----------------------------|-----------------|
| Sarah M       | `sarah@shiftsync.local`     | `staff123`  | Bartender · Server         | Yes (Pier Grill)|
| John K        | `john@shiftsync.local`      | `staff123`  | Bartender · Host           | No              |
| Marcus Reid   | `marcus@shiftsync.local`    | `staff123`  | Bartender · Server         | No              |
| Priya Nair    | `priya@shiftsync.local`     | `staff123`  | Server · Host              | No              |
| Tom Fletcher  | `tom@shiftsync.local`       | `staff123`  | Line Cook                  | No              |
| Aisha Bakr    | `aisha@shiftsync.local`     | `staff123`  | Bartender · Host           | No              |
| Leo Santos    | `leo@shiftsync.local`       | `staff123`  | Line Cook · Server         | No              |

### Staff — Pier Grill (America/Los_Angeles)

| Name          | Email                       | Password    | Skills                     | Cross-location? |
|---------------|-----------------------------|-------------|----------------------------|-----------------|
| Nina Walsh    | `nina@shiftsync.local`      | `staff123`  | Server · Host              | No              |
| Yuki Tanaka   | `yuki@shiftsync.local`      | `staff123`  | Line Cook · Server         | No              |
| Chloe Evans   | `chloe@shiftsync.local`     | `staff123`  | Host · Bartender           | No              |
| Kofi Mensah   | `kofi@shiftsync.local`      | `staff123`  | Line Cook                  | No              |

### Staff — Both Locations (Timezone Tangle scenario)

| Name          | Email                       | Password    | Skills             | Availability  |
|---------------|-----------------------------|-------------|--------------------|---------------|
| Alex Rivera   | `alex@shiftsync.local`      | `staff123`  | Bartender · Server | 9 AM – 5 PM every day (local) |

---

## 2. Running the Application

**Live deployment:** [https://shift-s-ync.vercel.app](https://shift-s-ync.vercel.app)

```bash
# 1. Install dependencies
npm install

# 2. Set environment variables (copy and fill in .env.local)
cp .env.local.example .env.local
# Required: DATABASE_URL, DIRECT_URL (Supabase PostgreSQL)

# 3. Push schema and seed
npm run db:push
npm run db:seed

# 4. Start development server
npm run dev
# → http://localhost:3000
```

> The full setup guide is in `RUNNING_APP.md` in the project root.

---

## 3. Evaluation Scenario Walkthroughs

### Scenario 1 — The Sunday Night Chaos

**Situation:** A staff member drops a shift starting in ~2 hours.

**How to trigger:**
1. Log in as **John K** (`john@shiftsync.local`).
2. Find the shift seeded ~2 h from now at Harbor View.
3. Click **Drop** — a drop request is created.
4. Log in as any other qualified bartender (e.g., Marcus).
5. Go to **"Available shifts to pick up"** — the drop shift appears immediately.
6. Click **Claim**.
7. Manager (Olivia) approves.

**Key behaviour:** `expireStaleDrops` inspects whether the drop request was created *before* the 24-hour window opened. Because this drop was created *after* the window opened (emergency), it is **never auto-expired** — it stays available for pickup.

---

### Scenario 2 — The Overtime Trap

**Situation:** Marcus already has 36 h this week. A manager tries to assign an 8-h shift.

**How to trigger:**
1. Log in as **Olivia Manager**.
2. Find the unassigned bartender shift at Harbor View (day +1, 8 h).
3. Click **Preview** (What-If) → system shows Marcus at 44 h projected (exceeds 40 h hard limit).
4. Try to assign Marcus → system blocks with a clear error message.
5. The error message also lists alternative qualified staff.

---

### Scenario 3 — The Timezone Tangle

**Situation:** Alex Rivera has "9am–5pm" availability and works at both Harbor View (ET) and Pier Grill (PT).

**How to trigger:**
1. Log in as **Olivia Manager**.
2. Find the Harbor View bartender shift on day +3 (10am–4pm ET, within Alex's 9–17 window).
3. Assign Alex — succeeds.
4. Find the Pier Grill bartender shift on day +4 (10am–4pm PT, also within Alex's window).
5. Assign Alex — succeeds; the system checks availability hours in the *location's* local timezone.
6. Create a Pier Grill shift for Alex at 6 PM PT (outside 9–17 window) → assignment is blocked.

---

### Scenario 4 — The Simultaneous Assignment

**Situation:** Two managers race to assign the same bartender.

**How to trigger:**
1. Open two separate browser windows (or browsers).
2. Log in as **Olivia Manager** in one and **Dante Cruz** in the other.
3. Both navigate to the same unassigned shift.
4. Both click **Assign** for the same staff member at nearly the same time.

**Key behaviour:** The assignment logic runs inside a `prisma.$transaction`. The second manager's request re-checks overlaps inside the transaction, detects the just-committed assignment, and returns `HTTP 409 Conflict` with a descriptive message. A toast error appears immediately for the losing manager.

---

### Scenario 5 — The Fairness Complaint

**Situation:** A staff member claims they receive fewer premium (Fri/Sat evening) shifts.

**How to explore:**
1. Log in as **Olivia Manager**.
2. Scroll to the **"Shift Distribution — Fairness Report"** section.
3. The table shows total shifts, total hours, and a breakdown by skill and location for each staff member this week.
4. The **Overtime Projection** section shows projected costs and who is near their weekly limit.

---

### Scenario 6 — The Regret Swap

**Situation:** Sarah requested a swap with Marcus, but wants to withdraw before Marcus accepts.

**How to trigger:**
1. Log in as **Sarah M** (`sarah@shiftsync.local`).
2. Find her swap request in the **"Your swap/drop requests"** section (seeded as pending).
3. Click **Withdraw** — the swap is cancelled.
4. Marcus is notified that the request was withdrawn.
5. The original assignment remains unchanged.

**Alternatively:** Marcus can reject the swap in his pending-actions view.

---

## 4. Architecture & Key Decisions

| Concern | Decision |
|---|---|
| **Framework** | Next.js 16 (App Router) for both frontend and API routes — single deployment unit |
| **Database** | PostgreSQL via Supabase, accessed with Prisma ORM |
| **Auth** | Session cookie (HTTP-only), server-side `currentUser()` helper, RBAC per route |
| **Real-time** | Server-Sent Events (SSE) via `/api/realtime`. Works in single-process dev. On multi-instance deployments (Vercel Edge), a shared pub-sub (e.g., Upstash Redis) would be needed — see [Known Limitations](#5-known-limitations) |
| **Timezone storage** | All `startsAt`/`endsAt` fields stored in **UTC**. Display converts to viewer's local timezone client-side using `Intl.DateTimeFormat` |
| **Availability checks** | Server-side checks decompose the UTC shift start into the *location's* local time (using `getLocalParts` from `src/lib/tz.ts`) to validate against staff availability windows |
| **Conflict detection** | Assignment wraps a `prisma.$transaction` with a re-read of the assignee's current shifts before upserting — prevents race conditions |
| **Human-readable IDs** | `Shift.seqId` (auto-increment integer) exposed in notifications and UI as `#N` |
| **Email simulation** | When a user's `notifPref` is `IN_APP_EMAIL`, a badge "✉ Email sent to user@…" appears in-app; no actual email is dispatched |

---

## 5. Known Limitations

### Real-time SSE in production
The in-memory `broadcast.ts` client registry only works correctly in a **single-process** deployment. On Vercel's serverless/edge infrastructure, each function invocation is stateless — SSE clients registered in one instance are invisible to another. A production fix requires a shared pub-sub layer (e.g., Upstash Redis + Redis Streams, or Ably/Pusher). This is out of scope for a 72-hour assessment but is architecturally straightforward to add.

### No "desired hours" enforcement
`desiredHours` is stored per user and displayed in the fairness report but is not enforced as a hard constraint. It is advisory only (see Ambiguity §2 below).

### No premium shift tagging
The spec mentions Friday/Saturday evening shifts tagged as "premium". The fairness report shows raw shift distribution; a `isPremium` column on `Shift` and a UI filter were not added within the time constraint. The data model is ready to support it.

### Consecutive-day calculation uses calendar days (UTC)
Consecutive days are determined by checking whether a staff member has any assignment on each UTC calendar day for the 7 preceding days. DST transitions are not accounted for in this counter (see Ambiguity §3 below).

### Manager self-certification
The seed script grants Olivia Manager certification at both locations for demonstration purposes. In production, admin approval for manager-location assignment would be appropriate.

### No pagination on shift list
The main dashboard loads all current-week shifts in a single API call. For very large datasets (hundreds of shifts), server-side pagination or cursor-based loading would be needed.

### SSE heartbeat vs. Vercel timeout
Vercel imposes a 60-second timeout on streaming responses. The heartbeat interval is set to 25 seconds, which keeps most connections alive, but very slow networks may see disconnects. The `EventSource` on the client auto-reconnects.

---

## 6. Assumptions Made

1. **"Week" means Monday–Sunday (UTC).** All weekly hour totals and consecutive-day streaks are computed over the 7-day window Mon 00:00 UTC → Sun 23:59 UTC.

2. **Availability windows are stored in location-local hours.** When a staff member sets "available 9 AM – 5 PM on Monday", that is interpreted against the *location's* IANA timezone at assignment time, not UTC. This matches real-world staff expectations.

3. **Overnight shifts count as one shift spanning two calendar days.** The daily-hours limit applies to the full duration of the shift, not split by midnight. A 10 PM – 6 AM shift counts as 8 hours on the start day for consecutive-day tracking.

4. **The 10-hour rest rule is checked against assigned (confirmed) shifts only.** Pending swap/drop requests that have not yet been approved do not affect rest-time calculations.

5. **Managers can be certified at multiple locations.** The system allows this — useful for a senior manager covering multiple sites as modelled in the seed (Olivia covers both; Dante covers Pier Grill only).

6. **The 3-pending-request cap applies per user across all request types.** A user with 2 pending swaps and 1 pending drop has reached the cap and cannot submit another request of either type.

7. **Unpublished shifts are visible to managers and admins but not to staff.** Staff only see shifts where `published = true`.

8. **The 48-hour unpublish cutoff is enforced only for individual shift unpublish.** Batch-unpublishing an entire week's schedule follows the same cutoff.

9. **All times are displayed in the viewer's browser local timezone.** The spec says "location's timezone"; after user feedback, the decision was made to display in the viewer's local time for readability. Stored UTC values remain correct and could be re-formatted by location timezone at any time.

10. **Email is fully simulated.** No SMTP or third-party mail service is used. The `emailed` flag on `Notification` and the badge in the notification panel serve as the simulation artefact.

---

## 7. Intentional Ambiguities — Documented Decisions

The following items were listed as deliberately unspecified in the assessment brief. Each decision is documented here.

---

### 7.1 Handling historical data after staff de-certification

**Ambiguity:** If a staff member loses certification for a location (e.g., fired, retrained), what happens to their historical shift assignments at that location?

**Decision made:** Historical assignments are **preserved and immutable**. The system does not retroactively invalidate past records when a certification is removed. This matches standard HR/payroll expectations — shifts worked in the past were valid at the time. Future assignment attempts will correctly fail the certification check.

**Rationale:** Modifying historical records would corrupt payroll, audit logs, and fairness reports. The correct action is to create an `AvailabilityException` or simply stop assigning the staff member going forward.

---

### 7.2 Interaction between "desired hours" and availability

**Ambiguity:** Should `desiredHours` prevent a manager from scheduling more (or fewer) hours than the staff member's preference?

**Decision made:** `desiredHours` is **advisory only** — it does not block any assignment. It is surfaced in the fairness report and overtime dashboard so managers can make informed decisions, but no automated constraint is enforced.

**Rationale:** Staffing emergencies require flexibility. A hard constraint on desired hours would block coverage in critical situations. The information is visible; the decision remains with the manager.

---

### 7.3 Whether all shifts count equally toward consecutive day calculations

**Ambiguity:** Does a 2-hour shift count the same as a 10-hour shift toward "worked on this day" for consecutive-day streak purposes?

**Decision made:** **Yes — any shift of any duration counts as a worked day.** If a staff member has at least one confirmed `ShiftAssignment` on a calendar day (UTC), that day counts toward the streak.

**Rationale:** This is the conservative interpretation and protects staff. Even a short shift disrupts rest patterns and creates commute obligations. Managers can see the streak count before assigning and apply the override if a very short shift is genuinely acceptable.

---

### 7.4 Behavior when a shift is edited after swap approval

**Ambiguity:** A swap has been manager-approved (assignments swapped). The manager then edits the shift's time. What happens?

**Decision made:**
- If the swap is in `PENDING_PARTY_ACCEPTANCE` or `PENDING_MANAGER_APPROVAL` state when the shift is edited → **auto-cancelled with notification** (implemented).
- If the swap is already `APPROVED` (assignments have been updated in the database) → the shift edit proceeds **without cancelling the completed swap**. The new assignee now holds the edited shift. A notification is sent to all parties of the original swap informing them the shift details changed.

**Rationale:** Once a swap is fully approved, the assignment transfer is complete — the swap object is a historical record. Cancelling an already-approved swap would require reversing the assignment, which is complex and could lead to further cascade issues. Notifying all parties of the time change is the minimum correct behaviour.

---

### 7.5 Handling locations that span timezone boundaries

**Ambiguity:** The brief mentions "4 locations across 2 time zones". What if a single physical location straddles a timezone boundary (e.g., a venue on a state line)?

**Decision made:** Each `Location` record has exactly **one canonical IANA timezone** (`America/New_York` or `America/Los_Angeles` in the seed). Timezone is a property of the location entity, not of individual shifts or staff members.

**Consequences:**
- All availability checks for a location use that single timezone.
- DST transitions are handled correctly by the `Intl` API using the IANA identifier.
- The physical boundary ambiguity is resolved at the data-entry stage — whoever creates the location chooses the canonical timezone.

**What this does not cover:** If a business truly needs two timezones for one venue (extremely rare), the model would need to be extended. This use case was not modelled.

---

 
