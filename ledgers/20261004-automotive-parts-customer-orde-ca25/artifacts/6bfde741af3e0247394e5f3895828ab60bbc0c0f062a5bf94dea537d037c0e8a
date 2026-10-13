# Questions before the spec (round 2)

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

**Q-6** Orders can't be amended, but cancellation is in scope. Who can cancel an order, and up to which point?
  A. Customer users and Staff can cancel until the order is dispatched; after that only Staff can
  B. Customer users can cancel only before Staff start processing it; Staff can cancel until dispatch   ← recommended: Without amendments, cancel-and-reorder is the only way to fix an order, so customers need a safe window to do it.
  C. Only Staff and Admin can cancel orders
  (why it matters: It changes order state and who is allowed to change it.)

**Q-7** What can Admin do that Staff cannot?
  A. Admin only: products, price lists, staff/admin users and the audit view. Staff: orders, customers and customer users   ← recommended: This follows the separate 'Staff experience' and 'Admin experience' items and matches earlier answers: staff create customer accounts, and audit is admin-only.
  B. Admin only: audit view and staff/admin users. Staff can also manage products and price lists
  C. Staff and Admin are the same except for the audit view
  (why it matters: It sets permissions on pricing, product data and user data.)

**Q-8** Payment status is tracked by hand. Who changes it, and what values can it have?
  A. Staff and Admin set it on each invoice: Unpaid / Paid   ← recommended: This is the smallest manual tracking that still matches the 'Payment status' scope item.
  B. Staff and Admin set it on each invoice: Unpaid / Part-paid / Paid / Overdue
  C. Only Admin sets it on each invoice: Unpaid / Paid
  D. Set on the order rather than the invoice: Unpaid / Paid
  (why it matters: It decides who can write money-related data and what customers see on their invoices.)

Assumed unless you say otherwise:
- ASM-25 (high risk, confirm on the approval card): Data is shared at company level. Can a customer user belong to more than one company? → assumed: No, each customer user belongs to exactly one company
- ASM-26: Users sign in with email and password on accounts that Staff or Admin create. How do they set their first password and reset a forgotten one? → assumed: Email and password, with a reset link by email; no social or single sign-on.
- ASM-27: How long are audit-history entries kept? → assumed: Who created and last changed each record, and when; no full audit trail.

Answer with letters or your own words:
  factory answer 20261004-automotive-parts-customer-orde-ca25 b0d07355 Q-6=A Q-7=A Q-8=A
  (use quotes for words: Q-6="only for guest checkouts")

Card hash: b0d07355