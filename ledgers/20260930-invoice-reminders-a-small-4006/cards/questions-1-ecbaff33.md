# Questions before the spec (round 1)

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

**Q-1** Who can view the screens and send reminders, and how do staff sign in?
  A. Any authenticated staff user, using the existing API's authentication   ← recommended: The request names one staff role and an existing API.
  B. Only certain roles (e.g. accounts) can send; all staff can view
  C. A new login system for this app
  (why it matters: Permissions over who can email customers.)

**Q-2** Which email address receives the reminder, and what happens if the customer has several contacts or none?
  A. The customer's single billing email from the existing record; if missing, the send is blocked with an error   ← recommended: This is the simplest option and every reading already assumes an on-file address.
  B. All contacts on the customer record
  C. Staff choose or enter the recipient when sending
  (why it matters: Decides who receives emails about money owed.)

**Q-3** Can reminder history entries be edited or deleted?
  A. No, they are append-only and immutable   ← recommended: History is an audit trail of customer contact.
  B. Admins can delete entries
  (why it matters: Decides whether stored records can be changed.)

**Q-4** Payments are out of scope. So how does an invoice come off the overdue list once it is paid or closed?
  A. The existing system's invoice status (paid/cancelled) is read and closed invoices drop off automatically   ← recommended: This keeps payment handling out of scope and stops paid customers getting reminders.
  B. Staff mark an invoice as paid/resolved in this app
  C. Invoices never leave the list in this version
  (why it matters: Decides which invoices can get reminder emails sent to customers.)

**Q-5** How should repeated sends be guarded against?
  A. Disable the button while a send is in progress only
  B. Also block or warn if a reminder was already sent within a cooldown (e.g. 24h)   ← recommended: This stops double-clicks and also stops different staff sending duplicate emails to the same customer.
  C. No guard
  (why it matters: Controls outbound customer emails.)

Assumed unless you say otherwise:
- ASM-1 (high risk, confirm on the approval card): Where do invoices and customers come from? Are they already stored in the client's existing .NET 8 API / Postgres database, or does this app create and own them? → assumed: Invoices and customers already exist in the client's API/database; this app reads them and adds overdue and reminder data
- ASM-2: Should the 7-day overdue threshold be fixed in code or a configuration setting? And how are days counted (calendar days, in which time zone)? → assumed: Configurable setting, default 7 calendar days, business time zone
- ASM-3: What does 'days overdue' mean in the list and its filter: days since the due date, or days since the invoice was marked overdue (due date + 7)? → assumed: Days since the due date
- ASM-4: How should the days-overdue filter work? → assumed: Preset buckets (7–30, 31–60, 60+)
- ASM-5 (high risk, confirm on the approval card): Which email service sends reminders, and how is 'cannot be delivered' detected? → assumed: Transactional email provider (e.g. SendGrid/Postmark) with bounce webhooks; both send errors and later bounces count as failures
- ASM-6: Does a send attempt that fails at once (e.g. provider error, no email) still create a reminder history entry? → assumed: Yes, every attempt is logged with its outcome (sent/failed/bounced)
- ASM-7: Can staff open the invoice detail screen from the overdue list? → assumed: Yes, clicking the invoice number or row opens the detail screen
- ASM-8: Should the invoice detail screen also have a 'Send reminder' button for overdue invoices? → assumed: Yes, when the invoice is overdue
- ASM-9: Does the reminder email need a specific template, sender name/address, or currency format? → assumed: A simple fixed template from a configured sender address, amounts in GBP/local currency

Answer with letters or your own words:
  factory answer 20260930-invoice-reminders-a-small-4006 ecbaff33 Q-1=A Q-2=A Q-3=A Q-4=A Q-5=A
  (use quotes for words: Q-1="only for guest checkouts")

Card hash: ecbaff33