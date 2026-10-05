# Questions before the spec (round 1)

Run 20261004-automotive-parts-customer-orde-b5d2. Your request:
> # 74. Estimation Checklist
> 
> For estimation purposes, estimate each of the following separately rather than estimating only by screen count.
> 
> ## Product / UX
> 
> - Requirements clarification.
> - UX flows.
> - Responsive layouts.
> - Design system/components.
> - Customer experience.
> - Staff experience.
> - Admin experience.
> - Error/empty/loading states.
> 
> ## Frontend
> 
> - Authentication.
> - Customer catalogue.
> - Search/filtering.
> - Vehicle search.
> - Product detail.
> - Basket.
> - Checkout.
> - Orders.
> - Order detail.
> - Templates.
> - Invoices.
> - Account/address management.
> - Staff dashboard.
> - Staff order management.
> - Customer management.
> - Admin product management.
> - Price lists.
> - User management.
> - Reports.
> - CSV downloads.
> 
> ## Backend
> 
> - Authentication.
> - Authorization.
> - User management.
> - Customer management.
> - Product management.
> - Categories.
> - Vehicle compatibility.
> - Pricing.
> - Stock.
> - Basket.
> - Templates.
> - Orders.
> - Order state transitions.
> - Order amendments.
> - Invoices.
> - Payments.
> - Reports.
> - Audit logs.
> - Notifications.
> - File storage.
> 
> ## Integrations
> 
> - ERP CSV import.
> - Email provider.
> - PDF generation.
> - File storage.
> - Hosting/deployment.
> 
> ## QA
> 
> - Unit testing.
> - API testing.
> - Frontend testing.
> - Integration testing.
> - End-to-end testing.
> - Permission testing.
> - Customer data-isolation testing.
> - Import testing.
> - Responsive testing.
> - Browser testing.
> - UAT support.
> - Regression testing.
> 
> ## DevOps
> 
> - Development environment.
> - Staging environment.
> - Production environment.
> - CI/CD.
> - Database deployment.
> - Scheduled jobs.
> - Monitoring.
> - Logging.
> - Backups.
> - Error tracking.
> 
> ## Documentation
> 
> - Technical documentation.
> - API documentation.
> - Deployment documentation.
> - Admin documentation.
> - User documentation.
> - Operational runbook.
> 
> ---
> 
> # 75. Technology Stack
> 
> Not decided.
> 
> The implementation team should propose:
> 
> - Frontend framework.
> - Backend framework.
> - Database.
> - Authentication approach.
> - File storage.
> - Email integration.
> - PDF generation approach.
> - Hosting/cloud platform.
> - CI/CD.
> - Monitoring/logging.
> 
> The chosen technology should support the expected scale and the 7-year data-retention requirement.
> 
> ---
> 
> # 76. Final Scope Summary
> 
> The first release is a responsive B2B automotive-parts ordering portal with:
> 
> - Customer authentication.
> - Role-based access.
> - Customer/company management.
> - Product catalogue.
> - Product search.
> - Category filtering.
> - Vehicle compatibility search.
> - Customer-specific pricing.
> - ERP stock import.
> - Basket.
> - Checkout.
> - Delivery scheduling rules.
> - Order placement.
> - Order history.
> - Order tracking.
> - Order cancellation.
> - Repeat orders.
> - Saved basket templates.
> - Staff order management.
> - Staff-created orders.
> - Delivery CSV export.
> - Automated invoice creation.
> - Invoice PDFs.
> - Payment status.
> - Product administration.
> - Price-list administration.
> - User administration.
> - Reporting.
> - CSV exports.
> - Email notifications.
> - Audit history.
> - Responsive mobile-first buyer experience.
> - Seven-year order/invoice retention.
> 
> The exact effort depends heavily on the unresolved items listed in the Open Questions section. For estimation, those items should either be clarified with the client or explicitly converted into assumptions before producing the final estimate.

**Q-1** How do customer users get accounts and sign in?
  A. Staff/admin create accounts and invite users by email; users sign in with email and password   ← recommended: In a B2B portal, accounts are tied to known companies, and invite-only is the simplest way to do that.
  B. Customers self-register and staff approve them before they get access
  C. Single sign-on with an external identity provider
  (why it matters: It controls who can get access to customer-specific prices and orders.)

**Q-2** Does 'Payment status' mean taking online payments at checkout, or only recording invoice payment status?
  A. Only record invoice payment status (unpaid/paid/overdue), updated by staff; no online payment   ← recommended: B2B parts ordering usually runs on account terms, and the scope only says 'payment status'.
  B. Record status and import payments from the ERP/accounting system
  C. Take card payments online at checkout through a payment provider
  (why it matters: This involves money and possibly an external payment provider.)

**Q-3** 'Order amendments' is in the backend checklist but not in the scope summary. Can orders be amended after they are placed, and by whom?
  A. Staff only, before dispatch   ← recommended: It keeps the checklist item while limiting who can change placed orders.
  B. Customers and staff, before dispatch
  C. No amendments in release 1; cancel and re-order instead
  (why it matters: Amendments change order contents and prices.)

**Q-4** What does the audit history record, and who can see it?
  A. Order status changes and staff-created orders, plus admin changes to products, prices and users, with actor and timestamp; visible to admin only   ← recommended: It covers the actions that matter without logging everything.
  B. The same events, visible to staff and admin
  C. Every create, update and delete on all records, including logins, visible to admin
  (why it matters: It decides what history is kept and who can see it.)

**Q-5** Is there existing data to bring in at launch (customers, users, products, vehicle compatibility, price lists, historical orders)?
  A. Only products, customers and price lists, as a one-off CSV import   ← recommended: The portal cannot launch without catalogue and pricing data, while old orders can stay in the ERP.
  B. No migration; data is entered through the admin screens
  C. Full migration, including historical orders and invoices
  (why it matters: It writes the initial data.)

Assumed unless you say otherwise:
- ASM-1 (high risk, confirm on the approval card): Which user roles does the first release have? → assumed: Two roles: an administrator and a standard user.
- ASM-2 (high risk, confirm on the approval card): What can staff do compared with admin? In particular, can staff manage customer/company records, see the audit history and run reports? → assumed: Staff: orders, staff-created orders, customer/company management, delivery CSV and reports. Admin: everything staff can do plus products, price lists, users and audit history
- ASM-3 (high risk, confirm on the approval card): At which order state is the invoice created automatically? → assumed: When the order is dispatched
- ASM-4 (high risk, confirm on the approval card): What are the order states, and up to which state can a customer cancel? → assumed: Placed → Processing → Dispatched → Delivered, plus Cancelled; customers can cancel only while the order is Placed
- ASM-5 (high risk, confirm on the approval card): How does the ERP stock CSV reach the system, and how often? → assumed: A scheduled job picks up the file from an agreed location (e.g. SFTP or a storage bucket) at a set interval
- ASM-6 (high risk, confirm on the approval card): When an ERP import file has some bad rows or unknown SKUs, what should happen? → assumed: Reject the whole file, keep the previous stock, and log or report the errors
- ASM-7 (high risk, confirm on the approval card): What happens when a customer orders more than the available stock? → assumed: Block it: quantity cannot exceed available stock
- ASM-8: Should delivery scheduling rules (cut-off times, delivery days, blackout dates, lead times) be fixed values or editable by admin? → assumed: Stored as configuration that admin can edit
- ASM-9 (high risk, confirm on the approval card): How is customer-specific pricing modelled, and what happens if a product has no price for the customer's list? → assumed: One price list per company, falling back to a default/base price list
- ASM-10: Are saved basket templates personal to one user or shared across all users in a company? → assumed: Shared by all users in the same company
- ASM-11: 'Account/address management' is in the frontend checklist but not in the scope summary. Can customers manage delivery addresses themselves? → assumed: Customers can view addresses and pick one at checkout; staff manage the addresses
- ASM-12 (high risk, confirm on the approval card): When admin removes a product that appears on past orders, what happens? → assumed: Products can only be deactivated (hidden), never hard-deleted
- ASM-13 (high risk, confirm on the approval card): What happens to order and invoice data after 7 years? → assumed: Keep it indefinitely; no automatic deletion in release 1
- ASM-14: Which events send email notifications, and to whom? → assumed: Email only, from fixed templates; no SMS or push.
- ASM-15: Which reports are needed? → assumed: On-screen lists with filters and CSV export; no custom report builder.
- ASM-16: Who uses the delivery CSV export, and is its format fixed? → assumed: Our own defined column set (order ref, customer, address, delivery date, items, quantities)
- ASM-17: Where does vehicle compatibility data (make/model/year to part) come from? → assumed: Maintained by admin in the portal (manual entry or CSV upload)
- ASM-18: What scale should the stack be sized for? → assumed: Up to 1,000 users and 100,000 records in the first year.
- ASM-19: Which browsers must be supported (browser testing is in the QA checklist)? → assumed: The latest two versions of Chrome, Edge, Safari and Firefox.
- ASM-20: Which languages and currencies are supported? → assumed: English only, left to right.
- ASM-21: What accessibility level is required? → assumed: WCAG 2.1 AA on the main flows.
- ASM-22: Are there any limits on hosting (cloud provider, data residency)? → assumed: One cloud region, in the client's cloud account.
- ASM-23: The request refers to an Open Questions section that was not included. How should the estimate deal with it? → assumed: Client provides the Open Questions section; until then, the questions here are recorded as assumptions

Answer with letters or your own words:
  factory answer 20261004-automotive-parts-customer-orde-b5d2 3a62d438 Q-1=A Q-2=A Q-3=A Q-4=A Q-5=A
  (use quotes for words: Q-1="only for guest checkouts")

Card hash: 3a62d438