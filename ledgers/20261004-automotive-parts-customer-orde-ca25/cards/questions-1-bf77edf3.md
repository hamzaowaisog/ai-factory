# Questions before the spec (round 1)

Run 20261004-automotive-parts-customer-orde-ca25. Your request:
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

**Q-1** 'Order amendments' and 'Payments' appear in the backend checklist, but the scope summary lists only 'Payment status' and no amendments. Are they in the first release?
  A. Neither: payment status is tracked manually and orders can't be amended   ← recommended: The final scope summary is the authoritative list for the first release.
  B. Staff can amend orders before dispatch; no online payments
  C. Both order amendments and online payment taking are in scope
  (why it matters: Affects money handling and changes to order data.)

**Q-2** What does the audit history record, and who can view it?
  A. Changes to orders, prices, products and users (who, when, what); admin-only view   ← recommended: This covers the key business changes without logging everything.
  B. Same, viewable by staff and admin
  C. Also log sign-ins and exports
  (why it matters: Decides which data is written and who can see it.)

**Q-3** Which user roles are there?
  A. Customer user, Staff, Admin   ← recommended: These are the three roles the scope implies.
  B. Customer user and Customer admin (manages own company's users), Staff, Admin
  C. Also a customer approver role for order sign-off
  (why it matters: Defines permissions throughout the system.)

**Q-4** Within one customer company, can every user see all of the company's orders, invoices and templates?
  A. Yes, all data is shared at company level   ← recommended: Company-level isolation is the simplest rule and matches B2B ordering.
  B. Each user sees only their own orders and templates; invoices are company-wide
  C. Configurable per company
  (why it matters: Decides who sees which orders and invoices.)

**Q-5** How do customer users get accounts and sign in?
  A. Staff/admin create accounts and users sign in with email + password   ← recommended: In a B2B portal with negotiated pricing, staff control who gets access.
  B. Customers self-register and staff approve them
  C. Single sign-on via an external identity provider
  (why it matters: Controls who can get into the system.)

Assumed unless you say otherwise:
- ASM-1: Sections 74 (estimation checklist) and 75 (technology stack) describe estimation and proposal work, not product features. Should they be treated as deliverables to produce, or only as background for the build? → assumed: Background only: build the section 76 scope and treat 74/75 as guidance
- ASM-2: The request points to an 'Open Questions' section that isn't included. How should those unresolved items be handled? → assumed: Proceed, recording each gap found here as an explicit assumption
- ASM-3 (high risk, confirm on the approval card): How is invoice payment status updated? → assumed: One payment provider (Stripe), cards only; card data stays with the provider.
- ASM-4 (high risk, confirm on the approval card): At what point is an invoice created automatically? → assumed: When staff mark the order dispatched
- ASM-5 (high risk, confirm on the approval card): Which order statuses exist, and up to which status can a customer cancel? → assumed: Placed → Processing → Dispatched → Delivered, plus Cancelled; customer can cancel only while Placed
- ASM-6 (high risk, confirm on the approval card): How does the ERP stock CSV reach the system, and how often? → assumed: Admin uploads the file manually in the admin area
- ASM-7 (high risk, confirm on the approval card): If an ERP import file has some bad rows or unknown SKUs, what happens? → assumed: Reject the whole file and keep the previous stock levels
- ASM-8 (high risk, confirm on the approval card): Can customers order more than the stock on hand? → assumed: Yes, with a backorder warning
- ASM-9: Are the delivery scheduling rules (cut-off times, delivery days, blackout dates) fixed in code or editable by admins? → assumed: Stored as configuration values set at deployment
- ASM-10 (high risk, confirm on the approval card): If a product has no price on a customer's price list, what does the customer see? → assumed: A default/base list price
- ASM-11 (high risk, confirm on the approval card): When a repeat order or saved template is loaded into the basket, which prices apply? → assumed: Current prices for that customer
- ASM-12: Must the delivery CSV export follow a fixed layout required by a courier or logistics system? → assumed: No: use a reasonable column set we define
- ASM-13: Which reports are needed in the first release? → assumed: On-screen lists with filters and CSV export; no custom report builder.
- ASM-14: Which events send emails, and to whom? → assumed: Email only, from fixed templates; no SMS or push.
- ASM-15 (high risk, confirm on the approval card): What happens to order and invoice records after 7 years? → assumed: Keep them indefinitely; only block deletion before 7 years
- ASM-16 (high risk, confirm on the approval card): Is there existing data to bring in at launch? → assumed: No; the system starts empty, with seed data for set-up.
- ASM-17 (high risk, confirm on the approval card): Where does product master data (names, categories, vehicle compatibility, images) come from? → assumed: Maintained by admins in the portal; ERP supplies stock only
- ASM-18: How is vehicle compatibility defined? → assumed: Make / model / year range linked to each product
- ASM-19: Which languages and currencies does the product support? → assumed: English only, left to right.
- ASM-20: Which browsers are supported? → assumed: The latest two versions of Chrome, Edge, Safari and Firefox.
- ASM-21: What scale is expected (customers, users, products, orders per day)? → assumed: Up to 1,000 users and 100,000 records in the first year.
- ASM-22: Where is it hosted? → assumed: One cloud region, in the client's cloud account.
- ASM-23: What accessibility level is required? → assumed: WCAG 2.1 AA on the main flows.
- ASM-24: What does 'Account/address management' cover for customers? → assumed: Addresses are managed by staff only; customers pick from them at checkout

Answer with letters or your own words:
  factory answer 20261004-automotive-parts-customer-orde-ca25 bf77edf3 Q-1=A Q-2=A Q-3=A Q-4=A Q-5=A
  (use quotes for words: Q-1="only for guest checkouts")

Card hash: bf77edf3