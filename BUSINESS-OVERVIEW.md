# 3% Club — What It Is and What It Does

A guide for management. No technical knowledge needed.

---

## 1. In one paragraph

You have lists of phone numbers. Most of those people are not interested, and
finding out which ones are costs your team hours of typing the same message
over and over. This system does that part: it messages every number, asks the
questions you decide, and hands you back only the people who said "yes, call
me". Everyone else is left alone, permanently. Your CRM team then works that
short list instead of the long one.

---

## 2. What it is not

This is deliberately **not** a CRM. It does not track staff, score performance,
manage a pipeline, or hold customer records after they leave the funnel. Those
belong to the CRM team's own system. This one has a single job: narrow a list.

---

## 3. How it works, start to finish

**Step 1 — You build a funnel.**
A funnel is the conversation, laid out as a list of steps: send a message, ask
a question, wait, mark them qualified, stop. You choose the wording, the
questions, and where each answer leads — including the answer that never comes:
a question says how many days to wait for a reply and where the silent number
goes next. A stop step says what the number is finally left as, so "Not
interested" and "No response" are counted rather than guessed. A funnel cannot
go live until it has a "Mark qualified" step, because a funnel that can never
qualify anyone produces nothing.

**Step 2 — You upload numbers.**
Paste a list, or load a CSV. Before anything is sent, the system shows you
exactly what it read:

- how many numbers are ready to send to
- which rows it rejected, with the row number and the reason
- how many duplicates it removed
- **how many numbers had +91 assumed** because they were written without a
  country code

That last figure matters: it is the one step that can message the wrong person,
so it is stated plainly rather than buried. Nothing is sent until you have
looked at this and pressed the button.

**Step 3 — The batch runs.**
The numbers go through the funnel you picked. The funnel version is frozen at
that moment, so editing the funnel afterwards cannot change what a batch
already running sends. You can pause or stop it at any time; a stop takes
effect immediately, not at the end of the run.

**Step 4 — People answer.**
Whoever says yes is marked **Qualified**. Whoever says no is marked **Not
interested** and the funnel stops for them — no further messages, ever. Whoever
says nothing is marked **No response** after the wait you configure.

**Step 5 — You export.**
The Qualified screen lists everyone who asked to be contacted. Export it as a
CSV for the CRM team. Every export marks the rows it handed over, so the next
"export new only" never gives them the same number twice.

---

## 4. The five states a number can be in

| State | Meaning |
|---|---|
| Not started | Uploaded, not yet put through a funnel |
| In funnel | Currently being messaged |
| Qualified | Asked to be contacted — this is the output |
| Not interested | Said no. The system will not message them again |
| No response | Never replied within the configured window |

---

## 5. The five screens

| Screen | What it is for |
|---|---|
| **Batches** | What is running now, where you upload numbers, and where every number has reached in the funnel |
| **Qualified** | The output list and its CSV export |
| **Funnels** | The library of conversations, and the builder |
| **Templates** | The approved message wording |
| **Settings** | The emergency stop, and the words that opt a number out |

---

## 6. Who can do what

Two roles.

| | Admin | Viewer |
|---|---|---|
| See batches, qualified list, funnels, templates, inbox | Yes | Yes |
| Upload numbers and run batches | Yes | No |
| Build and activate funnels | Yes | No |
| Export the qualified list | Yes | Yes |
| Reply in the inbox | Yes | No |
| Change settings, pause everything | Yes | No |

Permissions are enforced by the system on every request, not by hiding buttons.

---

## 7. Safety

- **Nothing sends without review.** A batch cannot be created until the parsed
  list has been checked on screen.
- **A "no" is final.** The funnel stops for that number and does not restart.
- **Opt-outs are honoured.** A number that has opted out is added to the batch
  with the reason recorded, and never messaged — so the count still adds up
  when someone asks why it was skipped.
- **Emergency stop.** Settings has a single switch that halts every funnel and
  every timer. Runs keep their place and resume where they stopped.
- **Everything is recorded.** Who uploaded what, who started which batch, who
  exported which rows, and when.

---

## 8. Decisions the system is waiting on

These live in Settings. Each one states what happens while it is unset.

| Decision | While it is unset |
|---|---|
| No-response wait | Any funnel with a no-response branch cannot go live |
| Reporting timezone | Date boundaries use the server's timezone |
| Opt-out keywords | Nobody is suppressed by replying STOP |
| Send window | Messages can go out at any hour |
| Default country for bare numbers | Set to IN — numbers without a country code are read as Indian mobiles |

---

## 9. What still stands between this and a live launch

See `PRODUCTION.md`. The short version: an approved WhatsApp provider account
with approved message templates, the decisions above, and backups. The
software is not the blocker.
