# A-DIY Rewards Portal: plan

Customers upload video/photo reviews of their deck and earn Amazon gift cards, and refer
friends for a $300 / $300 reward. It is built as a module of this app (same Render service,
database, Shopify connection and admin), with a customer-facing portal on the storefront.

Decisions below were agreed with Imran on 2026-09-29.

---

## 1. Login
- **Shopify new customer accounts** (switched on 2026-09-29): customers sign in with an emailed
  6-digit code, with no passwords. Anyone who has ordered with that email can sign in, including guest orders.
- Portal at **`a-diy.com/apps/rewards`** via a Shopify **App Proxy**, so it renders on the store's
  domain. Shopify passes the signed-in customer's ID with each request (`logged_in_customer_id`,
  HMAC-signed), so the app never handles passwords or codes. Signed-out visitors are sent to the
  Shopify sign-in and returned to the portal.
- The portal lists the customer's **eligible orders**: delivered, or fulfilled more than
  **21 days** ago (about 15% of LTL shipments are never marked delivered), and not
  cancelled or fully refunded. Payment-plan orders qualify once delivered (they ship after
  the final payment).

## 2. Uploads → Google Drive
- Files go **directly from the customer's browser into Google Drive** (resumable uploads,
  so large phone videos survive dropped connections). The server only creates the upload session.
- Destination: the **"Customer Reviews"** Shared Drive, organised as
  `YYYY-MM / #<order> – <customer> / <reward type> / <files>`; approved submissions are moved
  into an `Approved` subfolder for marketing.
- Google access: **OAuth ("Connect Google Drive" button in the app admin)**. The org policy
  blocks service-account keys. Google Cloud project **"Drive API"** (`drive-api-510202`,
  org a-diy.com): Drive API enabled, consent screen **"A-DIY Reviews"** (Internal), OAuth client
  **"A-DIY Reviews portal"** with redirect `https://adiy-payment-plans.onrender.com/google/callback`.
  `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are set in Render. Connect with an account that is
  Manager/Content manager on the Shared Drive (ideally a shared mailbox, not a person).
- Accepted: **video and photos** (Drive previews iPhone MOV/HEVC and HEIC natively).
  Limits (adjustable): video ≤ 2 GB / 15 min, ≤ 3 per submission; photos ≤ 25 MB, ≤ 20 per submission.
- One open submission per reward type per order; "needs changes" re-opens the same submission.
- **Content-use agreement** checkbox on every submission (licence to use/edit/publish in
  marketing; customer owns it and has consent of anyone shown; FTC-compliant wording that the
  reward doesn't depend on the review being positive). Store who accepted which version and when.
  **Final text needs legal sign-off.**

## 3. Rewards and review queue
- **Reward list is fully editable** in the admin: add, edit, reorder, deactivate. Each has name,
  customer-facing "what we're looking for", fixed amount or min–max range, and a per-order
  limit. A **per-order cap** applies across all types.
  Starting list: Full video walkthrough **$200** · Simple video review **$100** ·
  Photo set **$25–$50** · per-order cap **$300**.
- **Review queue** for staff: submissions oldest first with Drive media embedded, the note and
  a link to the order. **Approve** (amount pre-filled, editable within the range), **Needs changes**
  (message to the customer) or **Reject** (reason). Every action is logged with staff member and time.
  **Staff can approve any amount** (revisit later).
- Approved rewards are **Pending for 7 days**, then **Available**. A refund or cancellation of the
  order in that window cancels the reward automatically.
- Customer sees Pending / Available / Requested / Cashed out, with history.

## 4. Cash out: manual Amazon eGift cards
- Customer requests a cash-out (**$25 minimum**, up to the available balance) and confirms the
  email. The amount moves to **Requested** (reserved).
- Staff "Cash-out requests" queue: buy an **Amazon eGift card on amazon.com with the customer's email
  as recipient** (Amazon delivers it), then **Mark as sent** (optional Amazon order #) or **Cancel**
  (returns funds to the balance). Customer emailed on each step.
- **All staff can process cash-outs.** Gift-card codes never pass through the app.
- Dashboard: requested-and-waiting total, monthly sent, and export for the accountant.
- Later: Tremendous/Tango API can automate the purchase step. **W-9 / tax forms: skipped for now.**

## 5. Referrals: $300 off for the friend / $300 reward for the referrer
- Each eligible customer (same eligibility as the portal) gets a personal code and link
  (`a-diy.com/discount/<CODE>?redirect=/`) with copy/share buttons, and a list of referrals.
- Friend's discount: **$300 off, first order only, once per customer, minimum order $2,000**.
  **Works with payment plans** (comes off the total). Doesn't stack with Pay in full (Shopify
  applies the better one). Implemented as one Shopify discount with a code per referrer; "first
  order only" via a customer segment (`number_of_orders = 0`). **Verify segment eligibility for
  guest checkouts during the build.** Shopify Functions aren't an option (custom apps need Plus).
- Referrer's **$300** is Pending until the friend's order is **delivered + 30 days** (and, for
  payment plans, fully paid), then Available and cashed out like review rewards.
- Fraud checks: self-referral (email / shipping address / phone match), not-a-first-order,
  spikes. Flagged cases go to staff.
- **No cap** on referrals per customer.

---

## Build phases
1. **Base:** App Proxy portal with Shopify sign-in, eligible orders, Google Drive connect +
   resumable uploads, submissions, content agreement, staff review queue.
2. **Rewards:** editable reward list, balance history (pending → available with the 7-day hold,
   refund reversal), manual cash-out requests + staff queue.
3. **Referrals:** codes and links, discount, order webhooks, 30-day qualification, fraud flags.
4. **Polish:** customer and staff emails, content library in admin, exports, soft launch.

## Open items (Imran)
- Legal: content-use agreement + FTC disclosure wording; Rewards & Referral Terms page.
- "Customer Reviews" Shared Drive exists, and the account that will click **Connect Google Drive**
  is a Manager/Content manager on it.
- Email for notifications: Klaviyo flows (events from the app) or a transactional sender.
