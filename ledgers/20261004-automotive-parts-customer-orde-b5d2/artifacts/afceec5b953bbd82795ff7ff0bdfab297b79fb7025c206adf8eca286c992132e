# Questions before the spec (round 2)

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

**Q-6** Which user roles exist, and within a customer company can different users see or do different things (for example, a buyer versus a company admin who manages the company's users and addresses)?
  A. Three roles: customer user, staff, admin; all users of one customer company see all of that company's orders, invoices and templates   ← recommended: This is the smallest set that covers customer, staff and admin experiences and the company-level data isolation the request mentions.
  B. Four roles: customer buyer, customer company admin, staff, admin
  C. Customer users see only the orders they placed themselves; staff and admin see everything
  (why it matters: Decides who can see which orders, invoices and prices.)

**Q-7** Who can cancel an order, and up to what point?
  A. Customers can cancel their own company's orders while Placed; staff can cancel any order before dispatch   ← recommended: Lets customers fix mistakes themselves, without letting them cancel orders staff are already working on.
  B. Only staff can cancel, before dispatch
  C. Customers and staff can cancel any time before dispatch
  (why it matters: Changes order data and decides who is allowed to do it.)

**Q-8** How is stock shown to customers, and can they order more than the stock on hand?
  A. Show in stock / low / out of stock, and allow orders above stock (backorder)   ← recommended: Imported stock can be out of date, so blocking orders on it could turn away valid orders.
  B. Show in stock / low / out of stock, and block quantities above stock
  C. Show exact quantities, and block quantities above stock
  (why it matters: Controls whether orders can be placed.)

Assumed unless you say otherwise:
- ASM-24 (high risk, confirm on the approval card): How does the ERP stock data arrive, and how often? → assumed: Admin uploads an ERP stock CSV by hand whenever needed
- ASM-25: What are the delivery scheduling rules applied at checkout? → assumed: The customer picks a delivery date from the next working days, after a fixed daily cut-off time set in configuration
- ASM-26 (high risk, confirm on the approval card): What are the order statuses, and which changes between them are allowed? → assumed: Placed → Processing → Dispatched → Delivered, with Cancelled possible before Dispatched
- ASM-27 (high risk, confirm on the approval card): How does customer-specific pricing work? → assumed: Each customer is assigned one price list; products not on it fall back to the standard list price
- ASM-28 (high risk, confirm on the approval card): When is an invoice created automatically, and what happens to it if staff amend the order? → assumed: One invoice is created when the order is dispatched; amendments are only allowed before dispatch, so invoices never change
- ASM-29: Is 'overdue' set by staff, or worked out automatically from the invoice due date? → assumed: Staff set all three statuses by hand
- ASM-30 (high risk, confirm on the approval card): Since the one-off import covers only products, customers and price lists, how do categories and vehicle compatibility data get into the system? → assumed: Categories and vehicle compatibility are included as columns in the product CSV import
- ASM-31: Which events send email notifications, and to whom? → assumed: Email only, from fixed templates; no SMS or push.
- ASM-32: Who is the delivery CSV export for, and how is it produced? → assumed: Staff download it on demand for a chosen delivery date, in a fixed column layout we define
- ASM-33: Which reports are needed in the first release? → assumed: On-screen lists with filters and CSV export; no custom report builder.
- ASM-34 (high risk, confirm on the approval card): What does seven-year retention mean in practice? → assumed: Keep orders and invoices for at least seven years and never delete them automatically
- ASM-35: The request mentions 'expected scale'. How many customers, users, products and orders per day are expected? → assumed: Up to 1,000 users and 100,000 records in the first year.
- ASM-36 (high risk, confirm on the approval card): Which currency and tax rules apply to prices and invoices? → assumed: A single currency, with prices shown excluding VAT and VAT added at a single standard rate on invoices

Answer with letters or your own words:
  factory answer 20261004-automotive-parts-customer-orde-b5d2 946f8e26 Q-6=A Q-7=A Q-8=A
  (use quotes for words: Q-6="only for guest checkouts")

Card hash: 946f8e26