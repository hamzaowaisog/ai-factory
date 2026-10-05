# Questions before the spec (round 1)

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

**Q-1** What is the deliverable for this request: the itemised estimate and technology proposal (sections 74–75), or building the first-release portal described in section 76?
  A. Produce the itemised estimate and technology proposal only   ← recommended: Sections 74–75 ask for estimates and a proposal, and section 76 says the open items must be settled before the final estimate.
  B. Build the first-release portal as scoped in section 76
  C. Both: estimate and proposal first, then build after client sign-off
  (why it matters: Decides whether any software gets built at all.)

**Q-2** Does 'Payments' mean the portal takes money online, or only records an invoice's payment status?
  A. Track payment status only (unpaid/paid/overdue), updated manually by staff   ← recommended: The scope summary lists 'Payment status' but no payment gateway, so status tracking is the smallest reading.
  B. Track status, updated from an ERP/accounting import
  C. Take online card payments through a payment provider
  (why it matters: Involves money and possibly a payment provider integration.)

**Q-3** The backend checklist includes 'Order amendments', but the scope summary does not. Are order amendments part of the first release, and who can make them?
  A. Out of scope; customers cancel and re-order instead
  B. Staff can amend orders before dispatch   ← recommended: The item appears in the checklist, and limiting it to staff before dispatch is the smallest version that includes it.
  C. Both customers and staff can amend orders before dispatch
  (why it matters: Changes order data and totals.)

**Q-4** Which roles exist, and are there roles within a customer company, such as a company admin or a buyer who needs approval?
  A. Three roles only: customer user, staff, admin   ← recommended: The request names customers, staff and admin only.
  B. Add a company-admin customer role that manages its own company's users
  C. Add buyer/approver roles with order approval
  (why it matters: Determines who sees and does what.)

**Q-5** Can staff manage customer/company records and users, or is that admin-only?
  A. Staff manage customers/companies; only admins manage users, products and price lists   ← recommended: The checklist lists customer management among the staff screens and lists product, price-list and user management separately.
  B. Only admins manage customers, users, products and price lists
  C. Staff and admins have the same management rights
  (why it matters: Permissions.)

Assumed unless you say otherwise:
- ASM-1: The 'Open Questions' section that the request refers to is not included. How should those items be handled? → assumed: Treat the questions raised here as the open questions and record any unanswered ones as assumptions
- ASM-2 (high risk, confirm on the approval card): At what point in an order's life is the invoice created automatically? → assumed: When the order is dispatched
- ASM-3 (high risk, confirm on the approval card): Which order states allow cancellation, and who can cancel? → assumed: Customer or staff can cancel until the order is dispatched
- ASM-4 (high risk, confirm on the approval card): How do customer users get accounts and sign in? → assumed: Email and password, with a reset link by email; no social or single sign-on.
- ASM-5 (high risk, confirm on the approval card): How does the ERP stock CSV reach the portal, and how often? → assumed: A scheduled job collects the file from an SFTP/shared location (frequency configurable)
- ASM-6 (high risk, confirm on the approval card): If an ERP import file has bad rows or unknown SKUs, what happens? → assumed: Reject the whole file, keep the previous stock, and log or alert
- ASM-7 (high risk, confirm on the approval card): Is the ERP CSV the source of stock only, or of product data as well? Are products created in the portal? → assumed: ERP gives stock quantities only; products are maintained in portal admin
- ASM-8 (high risk, confirm on the approval card): What happens when a customer orders more than the available stock? → assumed: Block the quantity above stock with a message
- ASM-9 (high risk, confirm on the approval card): How do customer-specific prices work when a product has no entry in the customer's price list? → assumed: One price list per company, falling back to a default list price
- ASM-10 (high risk, confirm on the approval card): How should invoices handle VAT/tax, currency and invoice numbering? → assumed: One currency, one standard VAT rate, sequential invoice numbers
- ASM-11: What are the delivery scheduling rules, and who maintains them? → assumed: A cut-off time, delivery weekdays and blackout dates, all configurable by admin
- ASM-12 (high risk, confirm on the approval card): Do saved basket templates belong to one user or to the whole company? → assumed: Per user
- ASM-13 (high risk, confirm on the approval card): What happens to order and invoice records after seven years? → assumed: Keep them indefinitely; just never delete them before 7 years
- ASM-14: Which actions does the audit history record, and who can view it? → assumed: Who created and last changed each record, and when; no full audit trail.
- ASM-15: Which events send an email, and to whom? → assumed: Email only, from fixed templates; no SMS or push.
- ASM-16: Which reports are needed? → assumed: On-screen lists with filters and CSV export; no custom report builder.
- ASM-17 (high risk, confirm on the approval card): Is there existing data to bring in at launch, such as customers, products, price lists or past orders? → assumed: No; the system starts empty, with seed data for set-up.
- ASM-18: What is the 'expected scale': roughly how many companies, users, products and orders per day? → assumed: Up to 1,000 users and 100,000 records in the first year.
- ASM-19: Are there constraints on hosting or the cloud provider? → assumed: One cloud region, in the client's cloud account.
- ASM-20: Which browsers and devices must the 'Browser testing' cover? → assumed: The latest two versions of Chrome, Edge, Safari and Firefox.
- ASM-21: What is 'File storage' used for, and what files can be uploaded? → assumed: Images and PDFs up to 10 MB each, kept in cloud storage.

Answer with letters or your own words:
  factory answer 20261005-automotive-parts-customer-orde-674c e86dd151 Q-1=A Q-2=A Q-3=A Q-4=A Q-5=A
  (use quotes for words: Q-1="only for guest checkouts")

Card hash: e86dd151