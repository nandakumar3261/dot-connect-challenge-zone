# DoT Connect 2026 — Challenge Zone

A student **registration, result-recording, permission, and leaderboard** system for the
DoT Connect 2026 Challenge Zone (Sept 1–12, 2026). It does **not** run the challenges
themselves — volunteers evaluate participants on the agreed setup/platform and enter the
official result here.

Four independent challenges: **Speed Cube 🧩 · Chess Puzzle Rush ♟️ · Keyboard Killers ⌨️ · Debug Challenge 🐞**.
Everything runs from **one server, one port** (Node.js + Express + MongoDB).

---

## 1. Prerequisites
- Node.js v18+ (tested on v22)
- MongoDB running locally (`mongod`), default port 27017

## 2. Set up and run
```bash
cd backend
npm install
cp .env.example .env          # then edit JWT_SECRET + seed admin values
npm run seed-admin            # creates the first administrator account
npm start
```
You'll see `DoT Connect Challenge Zone running on http://localhost:5000`.

Run the logic tests any time with `npm test`.

## 3. Open in a browser
- **Public leaderboard (TV / QR target):** http://localhost:5000/
- **Staff sign-in (volunteers & admins):** http://localhost:5000/staff/login.html

Volunteers and administrators use the same sign-in; each lands on the console for their role.

---

## 4. Roles (§3)
- **Volunteer** — SEARCH / REGISTER / RECORD, but only for the challenges an admin has
  authorised them for. Sees a *masked* mobile number.
- **Administrator** — everything: manage students & volunteers, assign/revoke permissions,
  correct or invalidate results, link roll numbers, export data, and view leaderboards.
- **Public / Student viewer** — the leaderboard only. No private contact details are ever shown.

## 5. How a volunteer works a stall (§6, §7, §8, §9)
1. **Search** a student by permanent roll number, DoT Connect ID, or name.
2. The profile shows basic details + a **participation history** across all four challenges,
   with the current best per challenge.
3. **Register** if there's no profile yet. If the student has no permanent roll number, a
   **DoT Connect ID** (e.g. `DOT26-0001`) is generated automatically. When the university
   later assigns a roll number, an admin **links** it to the same profile — no new record.
4. **Record**: pick a challenge (only your authorised ones appear), enter the official
   result, save. If the student already has a result, you're **warned** and shown their best.
   An inferior new result never replaces a superior one — the best result stays on the board.

### What each challenge records (§8)
| Challenge | Fields recorded | Ranking (§13) |
|---|---|---|
| Speed Cube | official time (s) | lower time is better |
| Chess Puzzle Rush | puzzles solved · time (s) · mistakes | more puzzles → *(tie-breaks provisional)* |
| Keyboard Killers | WPM · accuracy % | higher WPM, accuracy tie-breaker |
| Debug Challenge | provisional score | *(format & rule to be finalised)* |

## 6. Leaderboard (§11, §12, §15)
- Opens on **All Challenges** by default: the **Top 10 of each** of the four challenges on one
  page, tuned for a large TV. The four boards are independent — there is no combined ranking.
- A **selector** switches to a detailed per-challenge board with academic details, full
  performance, and record time.
- Mobile-friendly for QR access. **Mobile numbers never appear** on any public view.

## 7. Administrator dashboard
- **Students** — full roster, link a permanent roll number, edit or delete.
- **Results** — filter by challenge/status; **correct** a mistyped result or **invalidate** one
  (the next-best attempt is automatically promoted).
- **Volunteers & permissions** — create accounts and tick the challenges each may record.
  Speed Cube and Chess are separate permissions even though they may share a stall (§2, §10).
- **Exports** — download students (with mobile, for prize contact) and results (never with
  mobile) as CSV.

---

## 8. Where things live / changing rules later
All four challenges — their recorded fields, units, and ranking rules — are defined in **one
file**: `backend/challengeConfig.js`. The Debug Challenge format and the Chess/Typing
tie-breaks are marked *provisional* there (see the requirements' "Open Decisions", §21); when
the organisers finalise them, edit that file only and the whole app — validation, ranking,
leaderboards, the record form, and permission lists — follows.

## 9. Project layout
```
backend/
  challengeConfig.js     # single source of truth: the 4 challenges + rules
  app.js / server.js     # express app + bootstrap (one port serves everything)
  lib/ranking.js         # comparator + "best result" rule (§9, §13)
  lib/mask.js            # mobile masking (§5, §15)
  models/                # User, Student, Result, Counter (DoT ID sequence)
  middleware/auth.js     # requireAuth / requireAdmin / per-challenge permission
  routes/                # auth, students, results, volunteers, public, exportData
  test/                  # logic.test.js (npm test) + integration.test.js (needs MongoDB)
staff-web/               # sign-in, volunteer console, admin dashboard
public-web/              # public leaderboard (TV + QR)
```

## 10. Notes on scope (§20)
The app does not run the Rubik's timer, Chess.com Puzzle Rush, or typing tests, and needs no
integration with external platforms. Volunteers enter the official results after each attempt.
Final winners for each challenge are announced **after** the event period — leading on the day
you participate does not declare you a winner.
