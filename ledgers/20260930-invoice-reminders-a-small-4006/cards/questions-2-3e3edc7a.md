# Questions before the spec (round 2)

Run 20260930-invoice-reminders-a-small-4006. Your request:
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

**Q-6** Is 'overdue' a status saved on the invoice (for example by a daily job), or is it worked out from the due date each time the list loads?
  A. Computed at query time from due date and today's date   ← recommended: Nothing goes stale, and there are no writes to the client's existing invoice records.
  B. Stored flag set by a scheduled daily job
  (why it matters: Decides whether the system writes to existing invoice data and needs a scheduler.)

**Q-7** Where are reminder history records stored, given that invoices live in the client's existing system?
  A. New table in the same Postgres database, referencing invoice ID   ← recommended: This is the simplest way to join history with invoice data for the list and detail screens.
  B. Separate Postgres schema/database owned by this app
  (why it matters: New writes to the client's database and a schema migration.)

**Q-8** Is a failed send recorded in the append-only reminder history, and does a later successful send clear the failure shown on the invoice?
  A. Every attempt (success or failure) is a history entry; the latest status is shown   ← recommended: This fits the immutable, append-only history already agreed and keeps a single audit trail.
  B. Failures are stored separately and stay visible permanently
  (why it matters: Shapes the data written and what staff see on the invoice.)

Assumed unless you say otherwise:
- ASM-10: Should the 7-day overdue threshold be a fixed constant or a setting that can be changed? → assumed: Configurable setting, defaulting to 7 days
- ASM-11: Which date and timezone decide when an invoice is '7 days past due', and is 'days overdue' (used in the filter) counted from the due date or from when the invoice became overdue? → assumed: Calendar days in the business's local timezone, counted from the due date
- ASM-12: Which email service sends the reminders, and what sender address should they come from? → assumed: To be decided; abstract behind an interface with SMTP default
- ASM-13: What counts as 'cannot be delivered': only errors when the email is handed to the mail service, or also later bounces and rejections? → assumed: Only immediate send errors from the mail service
- ASM-14: Should the invoice detail screen also have a 'Send reminder' button when the invoice is overdue? → assumed: Yes, same action and in-progress disabling as the list
- ASM-15: What wording and format should the reminder email use, and should the amount show a currency symbol? → assumed: Fixed plain template with invoice number, amount in local currency, due date

Answer with letters or your own words:
  factory answer 20260930-invoice-reminders-a-small-4006 3e3edc7a Q-6=A Q-7=A Q-8=A
  (use quotes for words: Q-6="only for guest checkouts")

Card hash: 3e3edc7a