# Protected scope request: answers to paste

Partner Dashboard → Apps → **adiy-payment-plans** → **API access**. Request each section below. For
**Protected customer data**, choose the fields listed and paste the matching answers.

---

## Subscriptions (`read_own_subscription_contracts`, `write_own_subscription_contracts`)

**What does your app do?**
A-DIY Payment Plans is a private app used only by A-DIY (a-diy.com), a merchant selling DIY deck
kits. It lets customers pay for an order in 4, 6 or 8 equal monthly payments with no fees or
interest. The order ships once it is paid in full.

**Why do you need this scope?**
Customers choose a Pay-in-N purchase option (a subscription selling plan with a fixed number of
monthly billing cycles) on the product page. Checkout charges the first payment and creates the
subscription contract. The app then:
- updates the contract so each later billing is a payment-only line (no product, no shipping)
  that references the original order;
- creates one billing attempt per month until the plan is paid off, with an idempotency key for
  each attempt;
- expires the contract when the plan is complete, or cancels it if the original order is
  cancelled.

The app only reads and changes contracts it created through its own selling plans. Customers
accept the payment-plan terms, including authorization for the future monthly charges, before
checkout.

## Customer payment methods (`read_customer_payment_methods`)

**Why do you need this scope?**
To show staff whether a plan's payment method is still valid or has been revoked or expired before
a monthly payment is due, so they can ask the customer to update it before a charge fails. We
don't store card details.

## All orders (`read_all_orders`)

**Why do you need this scope?**
Payment plans run for up to 8 months, longer than the default 60-day order window. The app must
read the original order for the whole plan so it can keep fulfillment on hold until the plan is
paid in full, release it afterwards, and stop billing if the order is cancelled.

## Protected customer data

**Fields:** Name, Email. (Level 2)

**Why?**
Staff need to see who each payment plan belongs to on the plans dashboard, and the app sends
payment reminders, receipts and failed-payment notices to the customer's email (through the
merchant's Klaviyo account).

**Data protection answers (for the checklist)**
- Only the minimum data is processed: order ID, customer ID, name, email and plan amounts.
- Data is stored in a managed Postgres database (Render), encrypted at rest and in transit.
- Access is limited to A-DIY staff through the Shopify admin (the app is embedded and authenticated).
- The app handles `customers/redact` and `shop/redact` by removing or deleting customer data.
- Data is kept only while the plan is active plus the merchant's accounting retention period.
- There is no sale or sharing of data with third parties, apart from sending notification events to
  the merchant's own Klaviyo account.
