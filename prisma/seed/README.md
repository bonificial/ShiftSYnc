# ShiftSync — Seed Data

## What this dataset covers

| Category | Detail |
|---|---|
| Locations | 2 — Harbor View (America/New_York) · Pier Grill (America/Los_Angeles) |
| Users | 15 — 1 admin, 2 managers, 12 staff |
| Skills in use | bartender · server · host · line_cook |
| Shifts | 18+ spanning today, this week, last week |

## Edge cases baked in

| Scenario | How it is seeded |
|---|---|
| **Open slot** | Shift #1 (Harbor View, bartender, today) needs 2 but only Sarah is assigned |
| **Overnight shift** | Kofi assigned 11 PM → 3 AM at Pier Grill |
| **Emergency drop** | John drops a shift starting in ~2 h — `expireStaleDrops` must NOT expire it |
| **Overtime Trap** | Marcus has 36 h already this week; an unassigned 8-h shift waits for him (44 h → hard block) |
| **Consecutive-day streak** | Tom has 6 consecutive days; Sunday assignment triggers 7th-day override modal |
| **Timezone Tangle** | Alex (9–17 availability) is certified at both locations; shifts at both test local-hour checking |
| **Pending SWAP** | Sarah requested a swap with Marcus — awaiting Marcus's acceptance |
| **Open DROP** | Chloe dropped a Pier Grill host shift — available for Nina/Yuki/Kofi to claim |
| **Historical data** | Last-week shifts exist for audit trail & fairness report |

## Running the seed

```bash
cd frontend
npm run db:seed        # wipes and re-seeds the database
```

> **Warning** — the seed script deletes ALL rows first. Never run against production.

## Staff credentials quick-reference

All staff use password `staff123`. Managers use `manager123`. Admin uses `admin123`.

See `/DOCUMENTATION.md` in the project root for the full credentials table.
