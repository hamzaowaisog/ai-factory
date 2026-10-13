# Questions before the spec (round 1)

Run 20261004-automotive-parts-customer-orde-609c. Your request:
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

**Q-1** Does the first release take payments online, or does it only record and show each invoice's payment status?
  A. Track payment status only (staff mark invoices paid/unpaid/overdue); no online payment   ← recommended: The scope summary says 'Payment status', not payment processing.
  B. Take card payments online through a payment provider
  C. Track status that is synced from the ERP or accounting system
  (why it matters: Decides whether money is taken and whether a payment provider is needed.)

**Q-2** The Backend checklist includes 'Order amendments', but the scope summary does not. Can orders be edited after they are placed in the first release?
  A. No amendments; customers cancel and re-order instead   ← recommended: Amendments are not in the final scope summary.
  B. Staff can amend orders before dispatch
  C. Customers and staff can amend orders before dispatch
  (why it matters: Changes order data after placement, and possibly invoices.)

**Q-3** How do customer users get accounts and sign in?
  A. Staff/admin create accounts and send an invite; users sign in with email and password   ← recommended: It suits a B2B portal where companies are managed by staff.
  B. Customers register themselves and staff approve them
  C. Single sign-on with an external identity provider
  (why it matters: Controls who can get into the portal.)

**Q-4** Which roles exist? Are there roles inside a customer company, such as company admin or buyer?
  A. Three roles only: customer user, staff, admin   ← recommended: These are the only roles the scope implies.
  B. Customer user, customer company admin, staff, admin
  C. Also add buyer/approver roles for order approval
  (why it matters: Decides who can see and do what.)

**Q-5** Can every staff member see and act on every customer, or only on the accounts assigned to them?
  A. All staff can see all customers and orders   ← recommended: This avoids building account-assignment rules.
  B. Staff are limited to the customer accounts assigned to them
  (why it matters: Changes which data staff can see.)

Assumed unless you say otherwise:
- ASM-1 (high risk, confirm on the approval card): At which order state is the invoice created automatically? → assumed: When the order is dispatched
- ASM-2 (high risk, confirm on the approval card): What are the order states, and up to which state can a customer cancel an order themselves? → assumed: Placed → Processing → Dispatched → Delivered (plus Cancelled); customers can cancel only while Placed
- ASM-3 (high risk, confirm on the approval card): How does the ERP stock CSV reach the portal, and how often? → assumed: ERP drops the file in an SFTP/storage location; a scheduled job imports it at a configurable interval
- ASM-4 (high risk, confirm on the approval card): If some rows in an ERP import file are bad (malformed rows or unknown SKUs), what happens? → assumed: Reject the whole file, keep the previous stock, and log or alert the error
- ASM-5 (high risk, confirm on the approval card): Can customers order more than the stock currently available? → assumed: Block quantities above available stock
- ASM-6 (high risk, confirm on the approval card): What does a customer see for a product that has no price on their company's price list? → assumed: Fall back to a default/base price list
- ASM-7: Are the delivery scheduling rules (cut-off times, delivery days, blackout dates) fixed in code or set by admins? → assumed: Fixed values in configuration files
- ASM-8 (high risk, confirm on the approval card): Is there existing data to bring in at launch (customers, products, price lists, vehicle compatibility, past orders)? → assumed: No; the system starts empty, with seed data for set-up.
- ASM-9 (high risk, confirm on the approval card): What happens to order and invoice records once they are 7 years old, and can they be deleted before then? → assumed: Keep them indefinitely and never hard-delete them (cancelled orders and products are soft-deleted only)
- ASM-10: Which events send emails, and to whom? → assumed: Email only, from fixed templates; no SMS or push.
- ASM-11: Which actions go into the audit history, and who can see it? → assumed: Who created and last changed each record, and when; no full audit trail.
- ASM-12: Which reports are needed? → assumed: On-screen lists with filters and CSV export; no custom report builder.
- ASM-13: What is the 'expected scale' (customers, users, products, orders per day)? → assumed: Up to 1,000 users and 100,000 records in the first year.
- ASM-14: Are there any constraints on hosting (cloud provider, region, data residency)? → assumed: One cloud region, in the client's cloud account.
- ASM-15: Which browsers must be supported? → assumed: The latest two versions of Chrome, Edge, Safari and Firefox.
- ASM-16: What accessibility level is required? → assumed: WCAG 2.1 AA on the main flows.
- ASM-17: Which languages, currencies and tax rules must be supported? → assumed: English only, left to right.
- ASM-18: Are saved basket templates private to each user, or shared by all users in the same company? → assumed: Private to the user who created them
- ASM-19: What files can be uploaded, apart from the ERP CSV? → assumed: Images and PDFs up to 10 MB each, kept in cloud storage.
- ASM-20: The request refers to an 'Open Questions' section that was not provided. Should it be supplied, or should the answers to these questions serve as the stated assumptions? → assumed: Treat the answers to these questions as the documented assumptions

Answer with letters or your own words:
  factory answer 20261004-automotive-parts-customer-orde-609c c93e0524 Q-1=A Q-2=A Q-3=A Q-4=A Q-5=A
  (use quotes for words: Q-1="only for guest checkouts")

Card hash: c93e0524