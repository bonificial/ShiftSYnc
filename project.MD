# Priority Soft - Full-Stack Developer Assessment

## Project: ShiftSync — Multi-Location Staff Scheduling Platform

---

## Overview

Build a web-based shift scheduling platform for a fictional restaurant group ("Coastal Eats") that operates **4 locations** across **2 time zones**. The platform must handle the inherent complexity of real-world workforce scheduling while remaining intuitive for both managers and staff.

---

## Business Context

Coastal Eats struggles with:

- Staff frequently calling out with no coverage  
- Overtime costs spiraling due to poor visibility  
- Employees complaining about unfair shift distribution  
- Managers at different locations hoarding "good" employees  
- No central view of who's working where and when  

Your solution must address these pain points.

---

## Core Functional Requirements

### 1. User Management & Roles

**Three user types exist:**

| Role | Description |
|------|-------------|
| **Admin** | Corporate oversight across all locations |
| **Manager** | Runs one or more specific locations |
| **Staff** | Works shifts at one or more locations |

- Staff members can be certified to work at multiple locations  
- Staff have **skills** (e.g., "bartender", "line cook", "server", "host")  
- Staff have **availability windows** they set themselves (recurring weekly + one-off exceptions)  
- Managers can only see/manage locations they're assigned to  
- Admins see everything  

---

### 2. Shift Scheduling

**Managers must be able to:**

- Create shifts with: location, date/time, required skill, and headcount needed  
- Assign specific staff to shifts manually  
- Publish a week's schedule (making it visible to staff)  
- Unpublish/edit a schedule before a configurable cutoff (default: 48 hours before the shift)  

**The system must enforce:**

- No double-booking (same person, overlapping times, even across locations)  
- Minimum **10 hours** between the end of one shift and start of another for the same person  
- Staff can only be assigned to shifts requiring skills they possess  
- Staff can only be assigned to locations they're certified for  
- Staff can only be assigned during their available hours  

**When a constraint is violated:**

- The system must **clearly explain which rule was broken and why**  
- The system should **suggest alternatives** when possible  
  - Example: “Sarah is unavailable, but John and Maria have the required skill and availability”  

---

### 3. Shift Swapping & Coverage

**Staff can:**

- Request to swap a shift with another qualified staff member  
- Offer a shift up for grabs ("drop request")  
- Pick up available shifts they're qualified for  

**Swap/coverage workflow:**

1. Staff A requests swap or drop  
2. If swap: Staff B must accept  
3. Manager must approve the final change  
4. All parties are notified at each step  
5. Original assignment remains until manager approval  

**Edge case requirements:**

- If a swap is pending and the manager edits that shift, the swap request is automatically cancelled with notification  
- A staff member cannot have more than **3 pending swap/drop requests** at once  
- Drop requests expire **24 hours** before the shift starts if unclaimed  

---

### 4. Overtime & Labor Law Compliance

**The system must track and warn about:**

- Weekly hours approaching **40 hours** (warning at 35+)  
- Daily hours exceeding:
  - **8 hours** (warning)  
  - **12 hours** (hard block)  
- **6th consecutive day** worked in a week (warning)  
- **7th consecutive day** worked in a week:
  - Requires manager override with documented reason  

**Overtime visualization:**

- Dashboard showing projected overtime costs for the week  
- Highlight which assignments push staff into overtime  
- Ability to simulate “what-if” scenarios before confirming assignments  

---

### 5. Schedule Fairness Analytics

**The system must provide:**

- Distribution report showing hours assigned per staff member over a selected period  
- "Desirable shift" tracking:
  - Friday/Saturday evenings tagged as premium  
- Fairness score showing equitable distribution of premium shifts  
- Visibility into:
  - Under-scheduled staff  
  - Over-scheduled staff relative to desired hours  

---

### 6. Real-Time Features

- Schedule updates visible **without refreshing** when published or modified  
- Real-time notifications for:
  - Swap requests  
  - Swap approvals/rejections  
- Live “on-duty now” dashboard showing active staff per location  
- Conflict detection:
  - If two managers assign the same staff simultaneously, one sees an immediate conflict  

---

### 7. Notifications & Communication

**Staff receive notifications for:**

- New shift assignments  
- Shift changes  
- Swap request updates  
- Schedule publication  

**Managers receive notifications for:**

- Swap/drop approvals required  
- Overtime warnings  
- Staff availability changes  

**Additional requirements:**

- Configurable notification preferences:
  - In-app only  
  - In-app + email (simulated)  
- Persistent notification center:
  - Read/unread states  
  - Historical visibility  

---

### 8. Calendar & Time Handling

- All times must be stored and processed consistently across timezones  
- Users see times in the **location's timezone**  
- Recurring availability must correctly handle daylight saving transitions  
- Overnight shifts must be treated as a single shift:
  - Example: 11pm → 3am  

---

### 9. Audit Trail

- Log all schedule changes:
  - Who made the change  
  - When it occurred  
  - Before and after state  
- Managers can view shift history  
- Admins can export audit logs by:
  - Date range  
  - Location  

---

## Evaluation Scenarios

The evaluator will test your system with these scenarios:

1. **The Sunday Night Chaos**  
   A staff member calls out at 6pm Sunday for a 7pm shift.  
   Evaluate how quickly coverage is found.

2. **The Overtime Trap**  
   A manager unknowingly schedules a 52-hour week for a staff member.  
   Evaluate system warnings and prevention.

3. **The Timezone Tangle**  
   A staff member works across Pacific and Eastern locations with availability "9am–5pm".  
   Evaluate timezone handling.

4. **The Simultaneous Assignment**  
   Two managers assign the same bartender at the same time.  
   Evaluate conflict resolution.

5. **The Fairness Complaint**  
   A staff member claims bias in premium shift assignment.  
   Evaluate analytics and reporting.

6. **The Regret Swap**  
   A swap is requested but not yet approved. One party withdraws.  
   Evaluate system behavior.

---

## Deliverables

1. **Working Application**  
   - Deployed to a publicly accessible URL  

2. **Source Code**  
   - Public GitHub repository with commit history  

3. **Seed Data**  
   - Realistic dataset including:
     - Multiple locations  
     - Staff with varied skills  
     - Existing schedules with edge cases  

4. **Brief Documentation**  
   - Login instructions per role  
   - Known limitations  
   - Assumptions made  

5. Submission must be sent before or at the **72-hour deadline**

---

## Evaluation Criteria

| Area | Weight |
|------|--------|
| Constraint enforcement correctness | 25% |
| Edge case handling | 20% |
| Real-time functionality | 15% |
| User experience & clarity of feedback | 15% |
| Data integrity under concurrent operations | 15% |
| Code organization & maintainability | 10% |

---

## Intentional Ambiguities

The following are deliberately unspecified:

- Handling historical data after staff de-certification  
- Interaction between "desired hours" and availability  
- Whether all shifts count equally toward consecutive day calculations  
- Behavior when a shift is edited after swap approval  
- Handling locations that span timezone boundaries  

Document all decisions clearly.

---

## Time Limit

**72 hours** from receipt of this document.

---

Good luck.