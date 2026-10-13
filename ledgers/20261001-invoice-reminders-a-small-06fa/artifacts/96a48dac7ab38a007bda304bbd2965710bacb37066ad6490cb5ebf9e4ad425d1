# Questions before the spec (round 1)

Run 20261001-invoice-reminders-a-small-06fa. Your request:
> # Invoice reminders
> 
> A small web app for a bakery wholesaler. Staff see which customer invoices are overdue and send a reminder by email.
> 
> ## Requirements
> 
> - When an invoice is 7 days past its due date, the system shall mark it overdue and show it on the overdue list.
> - When staff press "Send reminder" on an overdue invoice, the system shall email the customer a reminder with the invoice number, amount and due date.
> - The system shall record each reminder sent, with who sent it and when, and show the history on the invoice.
> - If an email cannot be delivered, the system shall show the failure on the invoice and keep it on the overdue list.
> - Staff shall be able to filter the overdue list by customer and by days overdue.
> 
> ## Screens
> 
> - Overdue list (table, filters, a "Send reminder" button per row)
> - Invoice detail (amount, due date, reminder history, delivery failures)
> 
> ## Out of scope
> 
> Payments, customer logins, SMS reminders.
> 
> ## Stack
> 
> Client's existing .NET 8 API with a React front end. Postgres.

**Q-1** Who can view the overdue list and send reminders, and where do staff accounts come from?
  A. Any authenticated staff user, using the existing API's authentication   ← recommended: The request names no roles, and reusing the existing login gives us the sender's identity for history.
  B. Only staff with a specific role (e.g. accounts)
  C. New staff accounts managed in this app
  (why it matters: Decides who can see invoices and send emails to customers.)

**Q-2** Is an invoice exactly 7 days past its due date overdue, or does it only become overdue from day 8?
  A. Overdue from day 7 (today >= due date + 7)   ← recommended: "When an invoice is 7 days past its due date" reads most naturally as the 7th day itself.
  B. Overdue from day 8 (today > due date + 7)
  (why it matters: Decides which invoices get the overdue status and can be sent reminders.)

**Q-3** Does reminder history record only successful sends, or every attempt including failures?
  A. Every attempt, each with a delivery status (sent / failed + reason)   ← recommended: Keeping one record per attempt makes it easy to show who tried, when, and why it failed.
  B. Only successful sends; failures are stored separately
  (why it matters: Changes the data model and what the invoice history shows.)

**Q-4** Payments are out of scope, so how does an invoice leave the overdue list (for example, once it is paid)?
  A. A paid/closed status in the existing invoice data removes it automatically   ← recommended: Without a way off the list, it only ever grows. Reusing existing payment status adds no payment features.
  B. Staff can manually mark an invoice resolved in this app
  C. It stays on the list until the due date changes
  (why it matters: Decides which invoices appear on the overdue list and whether this app changes invoice status.)

**Q-5** Can staff send another reminder for an invoice that was already reminded, and how do we stop accidental double clicks?
  A. Repeat reminders allowed at any time; only accidental double submits are blocked   ← recommended: Follow-up reminders are normal. Blocking double submits stops accidental duplicate emails without limiting staff.
  B. Repeat reminders allowed, but a warning shows if one was sent in the last 24 hours
  C. Only one reminder per invoice per day
  (why it matters: Controls how many emails go out to customers and how many history records are written.)

Assumed unless you say otherwise:
- ASM-1 (high risk, confirm on the approval card): Where do invoices and customers come from? The request mentions the client's existing .NET 8 API, but no repository was found. → assumed: They already exist in the client's API and Postgres database; we read them from there
- ASM-2: Is the overdue status saved by a scheduled job, or worked out from the due date each time it is needed? → assumed: Worked out from due date and today's date each time it is queried
- ASM-3: Is the 7-day overdue threshold fixed in code or a configuration setting? → assumed: Configuration setting, default 7
- ASM-4: How is 'days overdue' counted for display and filtering? → assumed: Days since the due date
- ASM-5: What kind of input is the days-overdue filter? → assumed: Fixed buckets (7–30, 31–60, 61–90, 90+)
- ASM-6 (high risk, confirm on the approval card): Which email service sends reminders, and what counts as a delivery failure? → assumed: Transactional provider (e.g. SendGrid/Postmark) with send errors plus bounces reported later by webhook
- ASM-7: Which address does a reminder go to, and what if the customer has none or several? → assumed: One billing email on the customer record; sending is blocked with an error if it is missing
- ASM-8: Who supplies the reminder email wording and the from address? → assumed: Client provides wording; template stored in config
- ASM-9: Which timezone is used to decide what day it is for the overdue calculation? → assumed: The business's local timezone (configured)

Answer with letters or your own words:
  factory answer 20261001-invoice-reminders-a-small-06fa 52b1998c Q-1=A Q-2=A Q-3=A Q-4=A Q-5=A
  (use quotes for words: Q-1="only for guest checkouts")

Card hash: 52b1998c