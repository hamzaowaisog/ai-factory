# Questions before the spec (round 2)

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

**Q-6** Should 'overdue' be worked out each time from the due date and paid status, or saved as a status on the invoice record?
  A. Worked out each time; nothing is written to invoices   ← recommended: This avoids writing to the client's existing invoice table and stays correct once an invoice is paid (Q-4).
  B. Saved as a flag/status by a scheduled job
  C. Saved when someone opens the list
  (why it matters: Decides whether we write to existing invoice data and need a background job.)

**Q-7** Where does the customer's email address come from, and what happens if there isn't one or there are several?
  A. Single email field on the existing customer record; block sending if missing   ← recommended: It's the simplest option, and it uses existing data.
  B. Existing customer record; send to all listed contacts
  C. Staff enter or confirm the address at send time
  (why it matters: Decides who receives emails containing invoice details.)

**Q-8** What counts as a 'delivery failure' that gets recorded with a reason?
  A. Only errors returned at send time (rejected by SMTP/provider)
  B. Send-time errors plus later bounces reported back by the provider   ← recommended: Many real failures are bounces that arrive after the send. It also matches the 'failed + reason' answer (Q-3).
  C. Also a missing or invalid customer email address
  (why it matters: Changes how a history record's status gets updated later and what staff see.)

Assumed unless you say otherwise:
- ASM-10: Should the 7-day threshold be fixed in the code or a setting? → assumed: App setting (config file/env)
- ASM-11: Which timezone defines 'today' when checking due date + 7 days? → assumed: The business's local timezone (fixed setting)
- ASM-12: How should emails be sent? → assumed: The client's existing email service/SMTP relay
- ASM-13 (high risk, confirm on the approval card): How should accidental double submits be blocked (from Q-5)? → assumed: Client disable plus a server-side check that rejects a second send for the same invoice within a short window (e.g. 60s)
- ASM-14: How should the 'days overdue' filter work, and what is it counted from? → assumed: Preset ranges past due date (7–14, 15–30, 30+)
- ASM-15: Who decides the wording, sender address and language of the reminder email? → assumed: A fixed template we draft, approved by the client
- ASM-16: Can reminders only be sent from the overdue list, or also from the invoice detail screen (for example, to retry after a failure)? → assumed: Both overdue list and invoice detail

Answer with letters or your own words:
  factory answer 20261001-invoice-reminders-a-small-06fa 888454f3 Q-6=A Q-7=A Q-8=A
  (use quotes for words: Q-6="only for guest checkouts")

Card hash: 888454f3