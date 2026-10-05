# Questions before the spec (round 1)

Run 20261005-automotive-parts-customer-orde-674c. Your request:
> # 39. Reporting
> 
> Staff can view reports for a selected date range.
> 
> Required reports:
> 
> ### Orders per Day
> 
> Shows:
> 
> - Date.
> - Number of orders.
> - Order value.
> 
> ### Top Products
> 
> Shows:
> 
> - Product.
> - Quantity sold.
> - Revenue.
> 
> ### Revenue per Customer
> 
> Shows:
> 
> - Customer.
> - Number of orders.
> - Revenue.
> 
> The exact revenue calculation rules are an open point.
> 
> ---
> 
> # 40. Report Filters
> 
> Reports should support:
> 
> - Start date.
> - End date.
> 
> Additional filtering by customer/product/category may be considered but is not explicitly required.
> 
> ---
> 
> # 41. Report Export
> 
> Reports can be downloaded as CSV.
> 
> The CSV should contain the same core information presented in the report.
> 
> Exact column ordering and formatting are open points.
> 
> ---
> 
> # 42. Audit History
> 
> Important business actions should be auditable.
> 
> Potential audit events:
> 
> - User invited.
> - User deactivated.
> - Product created.
> - Product changed.
> - Product retired.
> - Price changed.
> - Customer price list changed.
> - Order created.
> - Order amended.
> - Order confirmed.
> - Order cancelled.
> - Order status changed.
> - Invoice created.
> - Invoice marked paid.
> - ERP import succeeded.
> - ERP import failed.
> 
> The exact retention and visibility of audit logs are open points.
> 
> ---
> 
> # 43. Notifications
> 
> Required email notifications:
> 
> 1. User invitation.
> 2. Password reset.
> 3. Order confirmation.
> 4. Order amendment.
> 5. Order out for delivery.
> 6. Order cancellation/rejection, where applicable.
> 
> The email provider will be the client's existing email provider.
> 
> The provider and integration method are currently unknown.
> 
> ---
> 
> # 44. Email Provider
> 
> The application must integrate with the client's existing email provider.
> 
> Open points:
> 
> - Provider.
> - SMTP/API availability.
> - Authentication mechanism.
> - Sender address.
> - Reply-to address.
> - Email templates.
> - Delivery tracking.
> - Bounce handling.
> 
> ---
> 
> # 45. ERP Stock Integration
> 
> The ERP supplies stock through a nightly CSV file.
> 
> The portal:
> 
> - Reads the file.
> - Imports stock.
> - Does not write stock back to ERP.
> - Does not perform inventory transactions in the ERP.
> 
> Open points:
> 
> - How the file is delivered.
> - Exact CSV format.
> - Product identifier.
> - Stock quantity field.
> - File frequency.
> - Time of import.
> - Error notification mechanism.
> - Whether historical stock imports must be retained.
> 
> ---
> 
> # 46. Data Retention
> 
> Order and invoice data must be retained for 7 years.
> 
> Historical records should remain accessible according to the user's permissions.
> 
> Deleting a user must not delete historical order or invoice records.
> 
> The legal requirements around other data types are an open point.
> 
> ---
> 
> # 47. Responsive Design
> 
> All pages must be usable on phones.
> 
> The buyer experience is expected to be primarily mobile.
> 
> The system should also support:
> 
> - Tablet.
> - Desktop.
> 
> The exact supported browser/device matrix is an open point.
> 
> ---
> 
> # 48. Performance
> 
> Expected scale:
> 
> - Approximately 300 buyers.
> - Approximately 15 staff.
> - Up to 150 orders per day.
> 
> The system should provide reasonable response times for:
> 
> - Catalogue browsing.
> - Search.
> - Product detail.
> - Basket operations.
> - Checkout.
> - Order history.
> - Staff order queue.
> 
> Exact performance targets are an open point.
> 
> ---
> 
> # 49. Security
> 
> The application should implement standard web security controls, including:
> 
> - Secure authentication.
> - Password hashing.
> - Authorization by role.
> - Customer-level data isolation.
> - Secure sessions.
> - Protection against unauthorized API access.
> - Input validation.
> - File upload validation.
> - Protection against common web vulnerabilities.
> - Secure password-reset tokens.
> - HTTPS in production.
> 
> Specific security standards and penetration-testing requirements are open points.
> 
> ---
> 
> # 50. Data Isolation
> 
> Customer users must never access another customer's:
> 
> - Orders.
> - Invoices.
> - Addresses.
> - Pricing.
> - Users.
> - Account information.
> 
> Authorization must be enforced server-side and must not rely only on frontend restrictions.
> 
> ---
> 
> # 51. Accessibility
> 
> The portal should be designed with accessible web practices in mind.
> 
> Potential requirements include:
> 
> - Keyboard navigation.
> - Appropriate labels.
> - Accessible form controls.
> - Readable contrast.
> - Meaningful validation messages.
> - Screen-reader-compatible structure.
> 
> The exact accessibility compliance target is an open point.
> 
> ---
> 
> # 52. Error Handling
> 
> The application should provide user-friendly error handling.
> 
> Examples:
> 
> - Invalid login.
> - Expired password-reset link.
> - Product no longer available.
> - Stock import failure.
> - Failed order submission.
> - Email delivery failure.
> - Invalid CSV.
> - Missing product.
> - Session expiration.
> 
> Users should not see raw server errors or sensitive technical information.
> 
> ---
> 
> # 53. Empty States
> 
> The UI should provide appropriate empty states for:
> 
> - No search results.
> - Empty basket.
> - No orders.
> - No invoices.
> - No saved templates.
> - No matching products.
> - No report results.
> 
> ---
> 
> # 54. Loading States
> 
> The application should provide appropriate loading feedback for:
> 
> - Catalogue loading.
> - Search.
> - Product details.
> - Basket updates.
> - Checkout.
> - Order submission.
> - Invoice generation/download.
> - Reports.
> - Staff queues.
> 
> ---
> 
> # 55. Main Customer Screens
> 
> Required customer-facing screens:
> 
> 1. Sign in.
> 2. Forgot password.
> 3. Reset password.
> 4. Catalogue.
> 5. Product detail.
> 6. Vehicle search.
> 7. Basket.
> 8. Checkout.
> 9. Order confirmation.
> 10. My orders.
> 11. Order detail.
> 12. Invoice list.
> 13. Invoice detail.
> 14. Saved basket templates.
> 15. Account/company details.
> 16. Delivery addresses.
> 
> ---
> 
> # 56. Main Staff Screens
> 
> Required staff-facing screens:
> 
> 1. Staff sign in.
> 2. Dashboard.
> 3. Order queue.
> 4. Order detail/editor.
> 5. Customer list.
> 6. Customer detail.
> 7. Customer orders.
> 8. Customer invoices.
> 9. Delivery export.
> 10. Reports.
> 11. Invoice management.
> 
> ---
> 
> # 57. Main Admin Screens
> 
> Required admin screens:
> 
> 1. Admin dashboard.
> 2. Users.
> 3. User detail.
> 4. Customers.
> 5. Customer detail.
> 6. Products.
> 7. Product editor.
> 8. Categories.
> 9. Vehicle compatibility.
> 10. Price lists.
> 11. Price list editor.
> 12. System/import status.
> 13. Audit history.
> 
> ---
> 
> # 58. Order Lifecycle
> 
> Expected order lifecycle:
> 
> ```text
> Customer submits order
>         |
>         v
>      Received
>         |
>         v
>      Confirmed
>         |
>         v
>       Picking
>         |
>         v
>  Out for Delivery
>         |
>         v
>      Delivered
>         |
>         v
>  Invoice Created
> ```
> 
> Cancellation can occur before confirmation:
> 
> ```text
> Received -> Cancelled
> ```
> 
> Staff rejection/cancellation may also occur according to business rules.
> 
> ---
> 
> # 59. Invoice Lifecycle
> 
> Expected invoice lifecycle:
> 
> ```text
> Order Delivered
>        |
>        v
> Invoice Created
>        |
>        +----> Unpaid
>        |
>        +----> Paid
>        |
>        +----> Overdue
> ```
> 
> Exact overdue rules are an open point.
> 
> ---
> 
> # 60. Suggested Core Data Entities
> 
> The implementation will likely require entities similar to:
> 
> - User
> - Role
> - Customer
> - CustomerUser
> - Address
> - Product
> - Category
> - Manufacturer
> - Vehicle
> - ProductVehicleCompatibility
> - PriceList
> - PriceListItem
> - CustomerPriceList
> - StockItem
> - StockImport
> - Basket
> - BasketItem
> - BasketTemplate
> - BasketTemplateItem
> - Order
> - OrderItem
> - OrderStatusHistory
> - Invoice
> - InvoiceItem
> - Payment
> - AuditLog
> - EmailNotification
> 
> This is a conceptual list for estimation and is not a final database schema.
> 
> ---
> 
> # 61. API Areas
> 
> The backend will likely require API functionality for:
> 
> ## Authentication
> 
> - Sign in.
> - Sign out.
> - Password reset.
> - Invitation acceptance.
> - Session/account status.
> 
> ## Catalogue
> 
> - Products.
> - Categories.
> - Product details.
> - Search.
> - Vehicle compatibility.
> 
> ## Basket
> 
> - Get basket.
> - Add item.
> - Update quantity.
> - Remove item.
> - Clear basket.
> 
> ## Checkout
> 
> - Validate basket.
> - Get delivery options.
> - Submit order.
> 
> ## Orders
> 
> - Customer order list.
> - Customer order detail.
> - Repeat order.
> - Cancel order.
> - Staff order list.
> - Staff order detail.
> - Staff order edit.
> - Confirm.
> - Reject.
> - Status updates.
> - Staff-created order.
> 
> ## Invoices
> 
> - Invoice list.
> - Invoice detail.
> - PDF generation/download.
> - Mark paid.
> 
> ## Administration
> 
> - Users.
> - Customers.
> - Products.
> - Categories.
> - Price lists.
> - Vehicle compatibility.
> - Imports.
> - Audit logs.
> 
> ## Reports
> 
> - Orders per day.
> - Top products.
> - Revenue by customer.
> - CSV exports.
> 
> ---
> 
> # 62. Background Jobs / Scheduled Tasks
> 
> The system may require background processing for:
> 
> - Nightly ERP stock import.
> - Email sending.
> - Invoice generation.
> - Invoice overdue status updates.
> - Cleanup of expired password-reset tokens.
> - Cleanup/expiration of invitations.
> - Other scheduled maintenance tasks.
> 
> Exact scheduling and infrastructure are open points.
> 
> ---
> 
> # 63. File Storage
> 
> The application needs storage for:
> 
> - Product images.
> - Invoice PDFs.
> - Potentially ERP CSV files.
> - Potentially generated report files.
> 
> The storage provider is an open point.
> 
> ---
> 
> # 64. PDF Generation
> 
> Invoice PDFs must be generated or stored so that customers can download them.
> 
> Questions requiring confirmation:
> 
> - Is there an existing invoice template?
> - Must the portal reproduce the exact template?
> - What branding is required?
> - What paper/page size is required?
> - Does the invoice need tax information?
> - Does the invoice need a sequential numbering scheme provided by another system?
> 
> ---
> 
> # 65. CSV Import Requirements
> 
> The ERP stock CSV should be validated before processing.
> 
> Potential validation:
> 
> - Required headers exist.
> - Product codes exist.
> - Quantities are numeric.
> - No invalid negative quantities unless explicitly supported.
> - Duplicate product identifiers are detected.
> - Unknown product identifiers are reported.
> - File is not empty.
> 
> Import results should indicate:
> 
> - Number of records received.
> - Number successfully processed.
> - Number rejected.
> - Error details.
> 
> ---
> 
> # 66. CSV Export Requirements
> 
> Exports should:
> 
> - Use consistent column names.
> - Include a header row.
> - Use a consistent date/time format.
> - Use a consistent number format.
> - Be downloadable by authorized users only.
> 
> ---
> 
> # 67. Business Rules Summary
> 
> The following rules are mandatory unless changed during clarification:
> 
> 1. Customers see only their own company data.
> 2. Customer pricing comes from an assigned price list.
> 3. Stock is read from the ERP CSV.
> 4. The portal does not update ERP stock.
> 5. Stock is imported nightly.
> 6. Earliest delivery depends on whether the order is before or after 14:00.
> 7. Customers can repeat previous orders.
> 8. Customers can save named basket templates.
> 9. Customers can cancel only before confirmation.
> 10. Staff can edit orders before confirmation.
> 11. Customers are notified when confirmed.
> 12. Customers are notified when out for delivery.
> 13. Invoice creation happens when an order is delivered.
> 14. Staff can mark invoices paid.
> 15. Historical records remain after user deactivation.
> 16. Order and invoice data are retained for 7 years.
> 17. Online payments are not included.
> 18. Native mobile applications are not included.
> 19. Delivery route planning is not included.
> 20. Returns and credit notes are not included.
> 
> ---
> 
> # 68. Out of Scope
> 
> The following are explicitly outside the first phase:
> 
> - Online card payments.
> - Native iOS application.
> - Native Android application.
> - Multi-language support.
> - Delivery route planning.
> - Returns management.
> - Credit notes.
> - Direct ERP inventory write-back.
> - Automated driver route optimization.
> - Customer self-service returns.
> - Marketplace functionality.
> 
> Unless separately approved, advanced pricing features such as promotions, coupons, volume discounts, tiered pricing, and contract-specific pricing are also outside the initial scope.
> 
> ---
> 
> # 69. Open Questions
> 
> The following requirements should be clarified before final estimation or treated explicitly as assumptions.
> 
> ## Account and Authentication
> 
> - Is customer self-registration allowed?
> - What password policy is required?
> - How long should reset links remain valid?
> - How long should invitations remain valid?
> - Is MFA required?
> - Is staff SSO required?
> - What happens after repeated account lockouts?
> 
> ## Customers
> 
> - What customer/company fields are required?
> - Can customers create their own delivery addresses?
> - Can customer users see each other's orders?
> - Is a customer account manager role required?
> 
> ## Catalogue
> 
> - Are categories flat or hierarchical?
> - What product attributes are required?
> - Are products allowed to have variants?
> - Are substitute products required?
> - Are discontinued products searchable?
> 
> ## Vehicle Compatibility
> 
> - Where does compatibility data come from?
> - Is there a third-party vehicle database?
> - How is compatibility data imported?
> - How frequently does compatibility data change?
> - How precise does vehicle matching need to be?
> 
> ## Pricing
> 
> - Are prices tax-inclusive or tax-exclusive?
> - Are discounts required?
> - Is volume pricing required?
> - Are promotional prices required?
> - Are price effective dates required?
> - Can a customer have multiple price lists?
> - Does pricing vary by delivery location?
> 
> ## Stock
> 
> - What is the ERP?
> - How is the nightly CSV delivered?
> - What is the exact CSV schema?
> - What does "low stock" mean?
> - Are reserved quantities included?
> - Can customers order out-of-stock products?
> - Is backordering required?
> 
> ## Ordering
> 
> - Can customers order quantities above available stock?
> - Can staff override stock restrictions?
> - Can staff change delivery dates?
> - Can staff partially fulfill an order?
> - Are partial shipments required?
> - Are split deliveries required?
> - Are minimum order values required?
> - Are order cut-off times configurable?
> 
> ## Delivery
> 
> - What defines a working day?
> - What are the public holidays?
> - Are delivery dates customer-specific?
> - Are delivery slots required?
> - Are delivery charges required?
> - Are delivery zones required?
> 
> ## Invoices
> 
> - What invoice template is required?
> - Who generates invoice numbers?
> - Are taxes/VAT required?
> - How is overdue status calculated?
> - Are credit notes required in a future phase?
> - Does the ERP also contain invoices?
> 
> ## Payments
> 
> - What payment methods are recorded?
> - Is payment information imported from an accounting system?
> - Should staff manually mark all payments?
> 
> ## Email
> 
> - What provider is used?
> - SMTP or API?
> - What sender address should be used?
> - What email templates are required?
> - Are emails queued asynchronously?
> - Is delivery/bounce tracking required?
> 
> ## Hosting
> 
> - Is the client's cloud required?
> - Which cloud provider?
> - Who manages production infrastructure?
> - What environments are required?
> - Is a staging environment required?
> 
> ## Security
> 
> - Is MFA required?
> - Is penetration testing required?
> - Are there specific compliance requirements?
> - What audit-log retention is required?
> - Are IP restrictions required for staff?
> 
> ## Reporting
> 
> - What exactly counts as revenue?
> - Are taxes included?
> - Are cancelled orders excluded?
> - Are reports required in real time?
> - What additional filters are required?
> 
> ---
> 
> # 70. Environments
> 
> The expected environments are likely:
> 
> - Local development.
> - Development/test.
> - Staging/UAT.
> - Production.
> 
> The exact deployment strategy is not yet defined.
> 
> ---
> 
> # 71. Testing Requirements
> 
> The project should include testing for:
> 
> ## Authentication
> 
> - Successful login.
> - Invalid login.
> - Account lockout.
> - Password reset.
> - Invitation acceptance.
> - Deactivated accounts.
> 
> ## Authorization
> 
> - Customer isolation.
> - Staff access.
> - Admin access.
> - Unauthorized API access.
> 
> ## Catalogue
> 
> - Product listing.
> - Search.
> - Category filtering.
> - Vehicle compatibility.
> - Retired products.
> - Product images.
> 
> ## Pricing
> 
> - Correct price list.
> - Price changes.
> - Existing order price preservation.
> - Customer isolation.
> 
> ## Stock
> 
> - Valid import.
> - Invalid import.
> - Duplicate products.
> - Unknown products.
> - Out-of-stock products.
> - Low-stock status.
> 
> ## Basket and Checkout
> 
> - Add/remove/update.
> - Quantity validation.
> - Delivery-date rules.
> - Address selection.
> - Order submission.
> - Duplicate submission prevention.
> 
> ## Orders
> 
> - Order creation.
> - Confirmation.
> - Staff editing.
> - Customer cancellation.
> - Reordering.
> - Status transitions.
> - Email notifications.
> 
> ## Invoices
> 
> - Automatic invoice creation.
> - Invoice PDF.
> - Invoice visibility.
> - Payment status.
> - Marking invoice paid.
> 
> ## Reporting
> 
> - Date filtering.
> - Correct totals.
> - CSV exports.
> 
> ---
> 
> # 72. Acceptance Criteria Examples
> 
> ## Customer Isolation
> 
> Given a buyer belongs to Customer A,
> 
> When they request orders,
> 
> Then only Customer A's orders are returned.
> 
> They must not be able to retrieve Customer B's orders by modifying an ID in a URL or API request.
> 
> ---
> 
> ## Customer Pricing
> 
> Given Customer A is assigned Price List A,
> 
> When Customer A views Product X,
> 
> Then the price from Price List A is displayed.
> 
> If the price list changes later, previously placed orders retain their original price.
> 
> ---
> 
> ## Delivery Date
> 
> Given the current day is a working day:
> 
> - An order submitted before 14:00 gets the next working day as the earliest delivery date.
> - An order submitted at or after 14:00 gets the following working day as the earliest delivery date.
> 
> ---
> 
> ## Order Cancellation
> 
> Given an order has status `Received`,
> 
> When the customer cancels it,
> 
> Then the order becomes `Cancelled`.
> 
> Given an order has status `Confirmed`,
> 
> When the customer attempts to cancel it,
> 
> Then cancellation through the portal is not allowed.
> 
> ---
> 
> ## Invoice Creation
> 
> Given an order is marked `Delivered`,
> 
> When the delivery status is successfully saved,
> 
> Then an invoice is automatically created for that order.
> 
> ---
> 
> # 73. Suggested Delivery Phases
> 
> The following is a planning structure only and should not be treated as an estimate.
> 
> ## Phase 1 — Foundation
> 
> - Project setup.
> - Authentication.
> - User roles.
> - Database.
> - Base application layout.
> - Environment configuration.
> - CI/CD foundation.
> 
> ## Phase 2 — Customer Catalogue
> 
> - Product catalogue.
> - Categories.
> - Search.
> - Product detail.
> - Customer pricing.
> - Stock display.
> 
> ## Phase 3 — Ordering
> 
> - Basket.
> - Checkout.
> - Delivery dates.
> - Addresses.
> - Order creation.
> - Order history.
> - Repeat orders.
> - Basket templates.
> 
> ## Phase 4 — Staff Operations
> 
> - Staff dashboard.
> - Order queue.
> - Order editing.
> - Order confirmation.
> - Order cancellation/rejection.
> - Staff-created orders.
> - Delivery export.
> 
> ## Phase 5 — Invoicing
> 
> - Invoice generation.
> - Invoice list.
> - Invoice details.
> - PDF generation.
> - Payment status.
> - Staff payment recording.
> 
> ## Phase 6 — Administration
> 
> - Product management.
> - Categories.
> - Price lists.
> - Customer management.
> - User management.
> - Vehicle compatibility.
> 
> ## Phase 7 — Integrations and Reporting
> 
> - ERP stock import.
> - Email integration.
> - Reports.
> - CSV exports.
> - Audit logs.
> 
> ## Phase 8 — QA and Production
> 
> - Integration testing.
> - Security testing.
> - Regression testing.
> - UAT.
> - Production deployment.
> - Monitoring.
> - Documentation.
> 
> ---
> 

**Q-1** Who can view and export reports?
  A. Staff and admin   ← recommended: Reports are listed as a staff screen, and admins normally have at least staff rights.
  B. Admin only
  C. Staff only
  (why it matters: Decides who sees revenue data.)

**Q-2** How does an invoice become Overdue?
  A. A daily scheduled job marks Unpaid invoices Overdue once invoice date plus a configurable payment term (default 30 days) has passed   ← recommended: Overdue status updates are listed as a background job, and a single configurable term is the simplest rule.
  B. Staff set Overdue by hand
  C. Overdue is worked out at display time and never stored
  D. There is no Overdue status in phase 1
  (why it matters: Changes invoice payment status that customers and staff see.)

**Q-3** When is the invoice created relative to saving the Delivered status?
  A. In the same transaction as the Delivered status save, so either both succeed or neither does   ← recommended: The acceptance criteria say the invoice is created when the delivery status is saved, and this avoids needing a queue.
  B. Queued as a background job after the status is saved
  (why it matters: Writes invoice records, which are financial data.)

**Q-4** Is 'Invoice Created' an order status?
  A. No; Delivered is the order's final status and the invoice is a linked record   ← recommended: The invoice has its own lifecycle, so a separate order status would duplicate it.
  B. Yes; the order moves on to an 'Invoice Created' status
  (why it matters: Changes stored order statuses.)

**Q-5** What is recorded when staff mark an invoice paid?
  A. Paid status, payment date and the staff user   ← recommended: It's the minimum needed for audit and display.
  B. Also payment method and reference
  C. Status only
  (why it matters: Payment data is money.)

Assumed unless you say otherwise:
- ASM-1: What should a failed sign-in tell the user? → assumed: Email and password, with a reset link by email; no social or single sign-on.
- ASM-2 (high risk, confirm on the approval card): How should the system stop the same order being submitted twice? → assumed: Disable the submit button while the request is in progress, and reject a second submit of a basket that has already been turned into an order
- ASM-3: Is 'Staff sign in' a separate login from customer sign-in? → assumed: Email and password, with a reset link by email; no social or single sign-on.
- ASM-4: Is the invoice PDF generated once and stored, or generated on every download? → assumed: Generated when the invoice is created, stored, and the same file served on every download (regenerated only if missing)
- ASM-5 (high risk, confirm on the approval card): What counts as 'order value' and 'revenue' in the reports? → assumed: On-screen lists with filters and CSV export; no custom report builder.
- ASM-6: Which date decides whether an order falls inside the report's date range? → assumed: On-screen lists with filters and CSV export; no custom report builder.
- ASM-7: What happens when a report is opened without a date range? → assumed: On-screen lists with filters and CSV export; no custom report builder.
- ASM-8 (high risk, confirm on the approval card): Who can see audit history, and how long is it kept? → assumed: Who created and last changed each record, and when; no full audit trail.
- ASM-9 (high risk, confirm on the approval card): If writing the audit entry fails, what happens to the business action? → assumed: Who created and last changed each record, and when; no full audit trail.
- ASM-10: What happens when an email fails to send? → assumed: Email only, from fixed templates; no SMS or push.
- ASM-11: Where do the email provider settings (host, credentials, sender and reply-to address) live? → assumed: Email only, from fixed templates; no SMS or push.
- ASM-12: Who receives order emails (confirmation, amendment, out for delivery, cancellation)? → assumed: Email only, from fixed templates; no SMS or push.
- ASM-13 (high risk, confirm on the approval card): How does the nightly ERP CSV reach the portal? → assumed: The ERP drops the file into a configured folder or storage location, which the import job reads
- ASM-14 (high risk, confirm on the approval card): When some rows in the stock CSV are invalid, what gets applied? → assumed: Reject the whole file only if headers are missing or it is empty; otherwise apply valid rows and report rejected rows
- ASM-15 (high risk, confirm on the approval card): What happens to products that aren't in the night's stock file? → assumed: Leave their stock unchanged
- ASM-16: Is the nightly import time fixed in code or configurable? → assumed: Configurable schedule with a default (e.g. 02:00 local time)
- ASM-17: How is a failed stock import reported? → assumed: Shown on the System/Import status screen and written to the audit log
- ASM-18 (high risk, confirm on the approval card): In which statuses can staff reject or cancel an order? → assumed: Received and Confirmed only (before Picking)
- ASM-19 (high risk, confirm on the approval card): How are working days, the 14:00 cutoff and the timezone defined for earliest delivery? → assumed: Monday–Friday, with the 14:00 cutoff and the business timezone held as configuration; no holiday list in phase 1
- ASM-20: What earliest delivery date does an order submitted on a non-working day get? → assumed: The second working day after submission, the same as an after-cutoff order
- ASM-21 (high risk, confirm on the approval card): Which roles exist, and can users of the same customer company see each other's orders and invoices? → assumed: Two roles: an administrator and a standard user.
- ASM-22 (high risk, confirm on the approval card): Can a user ever be hard-deleted? → assumed: No; users are only deactivated and keep their links to orders and invoices
- ASM-23 (high risk, confirm on the approval card): Are prices and invoices tax-exclusive, and does the invoice show VAT? → assumed: Prices are tax-exclusive and the invoice shows VAT at a single configurable rate
- ASM-24 (high risk, confirm on the approval card): How are prices handled when repeating an order or using a basket template? → assumed: Current price-list prices are used; retired products are skipped with a notice
- ASM-25: How long do reset links and invitations stay valid, and is that fixed or configurable? → assumed: Configurable, defaulting to 1 hour for reset links and 7 days for invitations
- ASM-26: What does 'low stock' mean? → assumed: A single configurable threshold quantity
- ASM-27: What format should CSV exports use? → assumed: UTF-8, comma-separated, ISO 8601 dates, '.' as the decimal separator, columns in the on-screen order
- ASM-28: Which browsers are supported? → assumed: The latest two versions of Chrome, Edge, Safari and Firefox.
- ASM-29: What accessibility level is required? → assumed: WCAG 2.1 AA on the main flows.
- ASM-30: Which files can users upload? → assumed: Images and PDFs up to 10 MB each, kept in cloud storage.
- ASM-31: Where is the system hosted? → assumed: One cloud region, in the client's cloud account.
- ASM-32: Which environments are set up? → assumed: Two: staging and production, with a build pipeline.
- ASM-33 (high risk, confirm on the approval card): Is there existing data to import (customers, products, price lists)? → assumed: No; the system starts empty, with seed data for set-up.
- ASM-34: Which language and currency does the single-language product use? → assumed: English only, left to right.
- ASM-35: Light mode, dark mode or both? → assumed: Light mode only.
- ASM-36: Must the product work offline? → assumed: No; online only.
- ASM-37: What does catalogue search match on? → assumed: Search by name or title with simple filters; no full-text search engine.

Answer with letters or your own words:
  factory answer 20261005-automotive-parts-customer-orde-674c 4275795a Q-1=A Q-2=A Q-3=A Q-4=A Q-5=A
  (use quotes for words: Q-1="only for guest checkouts")

Card hash: 4275795a