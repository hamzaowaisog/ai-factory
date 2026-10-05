# Questions before the spec (round 2)

Run 20261005-automotive-parts-customer-orde-674c. Your request:
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

**Q-6** Who can cancel an order, and up to which point?
  A. Customers and staff can cancel before dispatch   ← recommended: This uses the same cut-off as amendments and keeps the state rules simple.
  B. Customers can cancel only before staff start processing; staff can cancel before dispatch
  C. Only staff can cancel
  (why it matters: Decides who can change order state.)

**Q-7** Now that staff can amend orders before dispatch: when is the invoice created automatically, and what happens to it if an order is amended?
  A. Invoice is created on dispatch, so amendments before dispatch never touch an invoice   ← recommended: This is the least effort and fits 'amend before dispatch'.
  B. Invoice is created on order placement and is regenerated after an amendment
  C. Invoice is created on order placement, and an amendment issues a credit note plus a new invoice
  (why it matters: Changes when financial records are written and whether invoices can change.)

**Q-8** How does the ERP stock CSV reach the portal, and how often?
  A. An admin uploads the CSV manually through the portal
  B. A scheduled job picks the file up from SFTP or file storage
  C. Assume a daily scheduled pickup, stated as an assumption   ← recommended: This matches the 'Scheduled jobs' item in the checklist and keeps the estimate moving.
  (why it matters: Changes how stock data is written, plus the integration and import-testing effort.)

Assumed unless you say otherwise:
- ASM-22: The request says unresolved items in the 'Open Questions' section must be clarified or turned into assumptions, but that section isn't included. How should the estimate handle them? → assumed: List each unresolved item as an explicit assumption in the estimate
- ASM-23: What format and unit should the itemised estimate use? → assumed: Person-days per checklist item as a low/high range, with totals per section
- ASM-24: The stack must support 'the expected scale', but no figures are given. What volumes should the proposal and estimate assume? → assumed: Up to 1,000 users and 100,000 records in the first year.
- ASM-25: Are there any constraints on the hosting or cloud platform the proposal may recommend? → assumed: One cloud region, in the client's cloud account.
- ASM-26: Does the 7-year retention apply only to orders and invoices, or also to audit history? → assumed: Who created and last changed each record, and when; no full audit trail.
- ASM-27: Which sign-in approach should the estimate and proposal assume? → assumed: Email and password, with a reset link by email; no social or single sign-on.
- ASM-28: Which browsers and devices should the browser and responsive testing cover? → assumed: The latest two versions of Chrome, Edge, Safari and Firefox.
- ASM-29: Is there an accessibility level to estimate for? → assumed: WCAG 2.1 AA on the main flows.
- ASM-30: Which languages does the portal need to support? → assumed: English only, left to right.

Answer with letters or your own words:
  factory answer 20261005-automotive-parts-customer-orde-674c 48ff3aa2 Q-6=A Q-7=A Q-8=A
  (use quotes for words: Q-6="only for guest checkouts")

Card hash: 48ff3aa2