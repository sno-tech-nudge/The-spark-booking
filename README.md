# the*spark centre — booking app (v1 prototype)

Live seat and room booking for the*spark Pullur Centre (127 open-plan seats, 10 rooms and booths).
It's a validation prototype: it covers the booking core end to end but isn't polished yet.

## What's in v1

| Area | What works |
|---|---|
| **Seat booking** | Live floor map of 127 seats (Zones A–D). Morning, afternoon or full day, up to 2 weeks ahead. Seats change colour for everyone the instant they're booked. |
| **No double bookings** | Enforced by Postgres exclusion constraints, so two bookings can never overlap on the same seat or room, however many people click at once. A full day blocks both halves. A person can't hold two desks at the same time. |
| **Members** | Book under their plan. Flexi and Fixed get unlimited desk days. Limited gets 12 days a month, and extra days become overage. Room hours come out of the plan first, then overage. |
| **Public / day pass** | Anyone signs up with an email code, picks a seat, and it's held for 8 minutes while they pay through Razorpay or the demo checkout. Their details are saved. Day passes don't include rooms. |
| **Rooms** | Hour-by-hour room grid. Members-only booths and lounge, the 2-hour podcast minimum, standard hours 9am–6pm, and 8am–10pm for Fixed Desk (after-hours rule). |
| **Check-in / out** | Members check in on the day; staff can check anyone in from the admin panel. |
| **Admin** | Live occupancy board, bookings by date (cancel, block a seat or room), members (add by email, plan, fixed seat, pause or end), day-pass guest list, prices, and 30-day reports (occupancy, revenue, overage, room use). |

Prices and rules come from *requirements for coworking mgmt s/w* and are all editable in **Admin → Pricing**.
Assumptions to confirm: the half-day pass is ₹300; room prices are per hour; included room hours are 5 (Flexi and Fixed) and 2 (Limited).

## Stack

- **Next.js 16** on Vercel
- **Supabase**: Postgres, email-code sign-in, and Realtime for the live seat map
- **Razorpay** for day-pass payments (a demo checkout is used until keys are added)

All booking logic lives in Postgres functions (`supabase/migrations/0001_init.sql`). The app calls them; the database decides. Row-level security keeps people's bookings private. The public seat map reads an anonymous `occupancy` table.

## Setup (about 10 minutes)

1. **Create a Supabase project** (region: Mumbai).
2. Copy `.env.example` to `.env.local` and fill in the Supabase URL, anon key, service role key, `DATABASE_URL` (Connect → Session pooler) and `ADMIN_EMAILS`.
3. Create the database:
   ```bash
   npm install
   npm run db:setup
   ```
4. **Sign-in emails.** In Supabase → Authentication → Emails → *Magic Link*, add `{{ .Token }}` to the template so the email includes a 6-digit code as well as the link. Under URL Configuration, set the Site URL to your Vercel URL and add `http://localhost:3000/**` and `https://YOUR-APP.vercel.app/**` as redirect URLs. Supabase's built-in email sender is rate-limited; add your own SMTP before real use.
5. **Vercel:** import the GitHub repo and add the same env vars, except `DATABASE_URL` and `ADMIN_EMAILS`, which aren't needed at runtime.
6. Run locally with `npm run dev` and open http://localhost:3000.

## Tests

```bash
npm run test:db      # 42 rule checks against the real schema in an in-memory Postgres
npm run test:race    # N people grab the same seats at the same instant on your Supabase DB; must end with 0 overlaps
```

## Not in v1 yet

Events and RSVPs, event-space booking, community board, invoices and Zoho Books, org/team plans, coupons, documents, waitlists, notifications, support tickets, Razorpay webhooks and refunds. Refunds are flagged in the data but processed manually.
