# Questions before the spec (round 2)

Run 20261005-automotive-parts-customer-orde-674c. Your request:
> # Automotive Parts Customer Ordering Portal
> 
> ## 1. Product Overview
> 
> A web-based B2B ordering portal for a mid-size automotive parts distributor.
> 
> The portal allows automotive workshops, dealerships, fleet operators, and other approved business customers to browse the distributor's parts catalogue, check customer-specific pricing and stock availability, place and track orders, and download invoices.
> 
> Distributor office staff manage customers, orders, inventory visibility, pricing, invoices, and operational reporting.
> 
> Administrators manage users, catalogue data, compatibility information, customer accounts, pricing structures, and system configuration.
> 
> There is no existing application code. The technology stack has not yet been decided.
> 
> ---
> 
> ## 2. Product Goals
> 
> The primary goals are:
> 
> - Replace phone/email-based parts ordering with a self-service ordering portal.
> - Allow customers to quickly find parts using part numbers, product names, categories, and vehicle information.
> - Show each customer their applicable pricing.
> - Show current stock availability based on the distributor's ERP stock feed.
> - Reduce manual order-entry work for office staff.
> - Give customers visibility into order status and invoices.
> - Provide staff with operational order queues and delivery information.
> - Provide management with basic sales and product reporting.
> - Maintain an auditable history of orders, invoices, customer accounts, and catalogue changes.
> 
> ---
> 
> # 3. User Roles
> 
> ## 3.1 Customer Buyer
> 
> A purchasing contact belonging to a customer company.
> 
> Capabilities:
> 
> - Sign in.
> - Reset password.
> - View the catalogue.
> - Search for products.
> - Filter products by category.
> - Search by part number/product code.
> - Search by vehicle.
> - View product details.
> - View customer-specific pricing.
> - View stock status.
> - Add products to a basket.
> - Modify quantities.
> - Save baskets as templates.
> - Reorder previous orders.
> - Place orders.
> - Select an available delivery date.
> - Add an optional order note.
> - View their company's orders.
> - View order status and timeline.
> - Cancel eligible orders.
> - View their company's addresses.
> - View invoices.
> - Download invoice PDFs.
> - See invoice payment status.
> 
> A buyer must never be able to see another customer's orders, invoices, pricing, addresses, or account information.
> 
> ---
> 
> ## 3.2 Customer Account Manager
> 
> An optional customer-side role for larger customers.
> 
> Capabilities:
> 
> - Everything a Buyer can do.
> - View orders placed by other users within the same customer company.
> - View company invoices.
> - Manage or select company delivery addresses if permitted.
> - View company-level order history.
> 
> Whether this role is required for the first release is an open point.
> 
> ---
> 
> ## 3.3 Office Staff
> 
> Distributor order-desk staff.
> 
> Capabilities:
> 
> - Sign in.
> - View all customers.
> - Search customers.
> - View customer details.
> - View all orders.
> - Filter orders by customer, date, and status.
> - Open and edit orders.
> - Confirm orders.
> - Amend quantities before confirmation.
> - Reject orders.
> - Create orders on behalf of customers.
> - Update order statuses.
> - View stock information.
> - View customer pricing.
> - View invoices.
> - Mark invoices as paid.
> - Record payment dates.
> - Export delivery lists.
> - View operational reports.
> 
> ---
> 
> ## 3.4 Administrator
> 
> One or more users responsible for system administration.
> 
> Capabilities:
> 
> - Manage staff accounts.
> - Manage customer users.
> - Deactivate users.
> - Manage customer accounts.
> - Manage products.
> - Manage categories.
> - Manage product images.
> - Manage vehicle compatibility data.
> - Manage customer price lists.
> - Assign price lists to customers.
> - Configure system settings.
> - View administrative history/audit information.
> 
> ---
> 
> # 4. Authentication and Access
> 
> ## 4.1 Sign In
> 
> Users sign in using:
> 
> - Email address.
> - Password.
> 
> The system should provide:
> 
> - Sign-in validation.
> - Invalid credentials messaging.
> - Account status checking.
> - Session management.
> - Sign-out.
> - Protection against unauthorized access.
> 
> ---
> 
> ## 4.2 Password Reset
> 
> A user can request a password reset using their email address.
> 
> Flow:
> 
> 1. User selects "Forgot password".
> 2. User enters their email.
> 3. System sends a password reset email.
> 4. User opens the reset link.
> 5. User chooses a new password.
> 6. System confirms the password change.
> 7. User can sign in using the new password.
> 
> The exact reset-token expiry period is an open point.
> 
> ---
> 
> ## 4.3 User Invitations
> 
> Administrators can invite:
> 
> - Customer buyers.
> - Customer account managers.
> - Office staff.
> 
> Invitation flow:
> 
> 1. Admin enters the user's details.
> 2. System creates an invitation.
> 3. System sends an email.
> 4. User opens the invitation.
> 5. User sets their password.
> 6. User's account becomes active.
> 
> Invitation expiry and resend behaviour are open points.
> 
> ---
> 
> ## 4.4 Failed Login Protection
> 
> After 5 consecutive failed sign-in attempts:
> 
> - The account is locked for 15 minutes.
> - The user is informed that the account has been temporarily locked.
> - Further login attempts are blocked during the lock period.
> - Successful authentication after the lock period restores access.
> 
> The exact handling of password-reset requests while an account is locked is an open point.
> 
> ---
> 
> ## 4.5 User Deactivation
> 
> An administrator can deactivate a user.
> 
> A deactivated user:
> 
> - Cannot sign in.
> - Cannot place new orders.
> - Retains historical order/invoice records.
> - Does not have their historical records deleted.
> 
> ---
> 
> # 5. Customer and Company Management
> 
> ## 5.1 Customer Company
> 
> Each customer company should have:
> 
> - Company name.
> - Customer/account number.
> - Primary contact.
> - Contact email.
> - Contact phone.
> - Billing address.
> - One or more delivery addresses.
> - Assigned price list.
> - Active/inactive status.
> - Associated users.
> - Order history.
> - Invoice history.
> 
> The exact customer fields are an open point.
> 
> ---
> 
> ## 5.2 Delivery Addresses
> 
> A customer can have multiple delivery addresses.
> 
> Each address may contain:
> 
> - Address name/label.
> - Address line 1.
> - Address line 2.
> - City.
> - State/region.
> - Postal/ZIP code.
> - Country.
> - Contact person.
> - Contact phone.
> 
> The customer can select an eligible delivery address during checkout.
> 
> Whether customers can create/edit their own addresses or must request changes from staff is an open point.
> 
> ---
> 
> # 6. Product Catalogue
> 
> ## 6.1 Product
> 
> Each product can contain:
> 
> - Product name.
> - Internal product ID.
> - Manufacturer part number.
> - Distributor product code.
> - Description.
> - Category.
> - Manufacturer/brand.
> - Unit of sale.
> - Pack size.
> - Product image.
> - Active/retired status.
> - Customer price.
> - Stock status.
> - Vehicle compatibility information.
> 
> ---
> 
> ## 6.2 Product Categories
> 
> Products are organized into categories.
> 
> Examples:
> 
> - Engine parts.
> - Brake system.
> - Suspension.
> - Steering.
> - Electrical.
> - Filters.
> - Cooling system.
> - Transmission.
> - Exhaust.
> - Body parts.
> - Workshop consumables.
> 
> Administrators can:
> 
> - Create categories.
> - Edit categories.
> - Retire categories.
> - Assign products to categories.
> 
> Whether nested categories are required is an open point.
> 
> ---
> 
> # 7. Catalogue Browsing
> 
> ## 7.1 Catalogue List
> 
> Customers can browse products.
> 
> Each product card/list row should show:
> 
> - Product image.
> - Product name.
> - Product code.
> - Manufacturer.
> - Unit/pack size.
> - Customer-specific price.
> - Stock status.
> - Add-to-basket action.
> 
> ---
> 
> ## 7.2 Search
> 
> Customers can search by:
> 
> - Product name.
> - Product code.
> - Manufacturer part number.
> - Manufacturer/brand.
> 
> Search should support partial matches.
> 
> Exact search behaviour and ranking are open points.
> 
> ---
> 
> ## 7.3 Category Filtering
> 
> Customers can filter the catalogue by category.
> 
> The system should allow the customer to:
> 
> - Select a category.
> - Change category.
> - Clear the category filter.
> 
> ---
> 
> ## 7.4 Vehicle Search
> 
> Customers can optionally search for compatible parts by vehicle.
> 
> Vehicle selection may include:
> 
> - Make.
> - Model.
> - Year.
> - Engine.
> - Fuel type.
> - Variant/trim.
> 
> The system then displays products marked as compatible with that vehicle.
> 
> The source and granularity of vehicle compatibility data are open points.
> 
> ---
> 
> # 8. Product Detail
> 
> A product detail page should display:
> 
> - Product image.
> - Product name.
> - Product code.
> - Manufacturer.
> - Description.
> - Unit.
> - Pack size.
> - Customer-specific price.
> - Stock status.
> - Vehicle compatibility.
> - Quantity selector.
> - Add-to-basket action.
> 
> If a product is out of stock:
> 
> - The product remains visible.
> - The customer is informed that it is out of stock.
> - The customer cannot place an unavailable quantity unless backorders are explicitly supported.
> 
> Backorders are out of scope unless separately agreed.
> 
> ---
> 
> # 9. Stock Availability
> 
> The distributor's ERP provides stock data through a nightly CSV file.
> 
> The portal only reads the imported stock data.
> 
> The portal must not directly modify ERP stock.
> 
> Each product should have a stock status:
> 
> - In stock.
> - Low stock.
> - Out of stock.
> 
> The exact quantity thresholds for "low stock" are an open point.
> 
> ---
> 
> ## 9.1 Stock Import
> 
> A scheduled process imports the ERP CSV.
> 
> The process should:
> 
> 1. Receive or access the CSV.
> 2. Validate the file.
> 3. Validate product identifiers.
> 4. Import stock quantities.
> 5. Update product stock status.
> 6. Record import success/failure.
> 7. Make the latest successful data available to the portal.
> 
> The exact file delivery mechanism is an open point.
> 
> ---
> 
> ## 9.2 Invalid Stock Files
> 
> If an ERP file is invalid:
> 
> - The previous valid stock data should remain available.
> - The failed import should be logged.
> - Staff/admin should be able to see that the import failed.
> - The system should not replace valid stock information with corrupt/incomplete data.
> 
> ---
> 
> # 10. Customer-Specific Pricing
> 
> Each customer is assigned a price list.
> 
> A price list contains product prices.
> 
> A customer should see only the price applicable to their assigned price list.
> 
> Example:
> 
> - Standard price list.
> - Workshop A price list.
> - Fleet customer price list.
> - Dealer price list.
> 
> Administrators can:
> 
> - Create price lists.
> - Edit prices.
> - Assign a price list to a customer.
> - Change a customer's assigned price list.
> - Deactivate a price list.
> 
> The pricing model is currently assumed to contain one price per product per price list.
> 
> Volume pricing, promotional pricing, discounts, tax-inclusive/exclusive pricing, and effective dates are open points.
> 
> ---
> 
> # 11. Basket
> 
> Customers can add products to a basket.
> 
> Basket functionality:
> 
> - Add product.
> - Change quantity.
> - Remove product.
> - View line price.
> - View line total.
> - View basket subtotal.
> - Select delivery address.
> - Select delivery date.
> - Add order note.
> - Review availability before checkout.
> 
> The basket should persist appropriately if the customer navigates away.
> 
> Whether baskets persist across sessions is an open point.
> 
> ---
> 
> # 12. Checkout
> 
> The checkout flow should include:
> 
> 1. Basket review.
> 2. Customer/delivery information.
> 3. Delivery address selection.
> 4. Delivery date selection.
> 5. Optional order note.
> 6. Stock validation.
> 7. Price validation.
> 8. Final order review.
> 9. Order submission.
> 10. Confirmation.
> 
> The customer should see the final order details before submitting.
> 
> ---
> 
> # 13. Delivery Date Rules
> 
> The earliest available delivery date is:
> 
> - If the order is placed before 14:00, the next working day.
> - If the order is placed at or after 14:00, the working day after the next working day.
> 
> Example:
> 
> If Monday is a working day:
> 
> - Monday 13:00 -> Tuesday delivery.
> - Monday 15:00 -> Wednesday delivery.
> 
> Working days exclude configured non-working days.
> 
> The handling of public holidays is an open point.
> 
> The system timezone is an open point.
> 
> ---
> 
> # 14. Order Submission
> 
> After the customer submits an order:
> 
> - An order number is generated.
> - Order lines are stored.
> - Prices are stored as order-time prices.
> - Delivery information is stored.
> - The order status becomes `Received`.
> - The customer can view the order.
> - Office staff see the order in their queue.
> 
> Changing a future price list must not change prices on existing orders.
> 
> ---
> 
> # 15. Repeat Previous Order
> 
> A customer can repeat a previous order with one action.
> 
> The system should:
> 
> 1. Load the previous order lines.
> 2. Add available products to a new basket.
> 3. Flag products that are no longer available.
> 4. Recalculate prices using the customer's current applicable price list.
> 5. Allow the customer to modify quantities.
> 6. Require normal checkout before creating the new order.
> 
> Repeating an order does not directly create a new order without customer confirmation.
> 
> ---
> 
> # 16. Saved Basket Templates
> 
> Customers can save a basket as a named template.
> 
> Example:
> 
> `Weekly Workshop Order`
> 
> Template functionality:
> 
> - Create template.
> - Name template.
> - View templates.
> - Open template.
> - Add template items to basket.
> - Change quantities.
> - Remove template.
> - Handle unavailable products.
> 
> Template products should use current pricing when added to a new basket.
> 
> Whether templates are shared across users within a company is an open point.
> 
> ---
> 
> # 17. Order Statuses
> 
> Orders use the following statuses:
> 
> 1. Received.
> 2. Confirmed.
> 3. Picking.
> 4. Out for delivery.
> 5. Delivered.
> 6. Cancelled.
> 
> The system should maintain an order status timeline.
> 
> Each status transition should record:
> 
> - Status.
> - Date/time.
> - User/system that performed the transition.
> 
> ---
> 
> # 18. Customer Order History
> 
> Customers can see their orders.
> 
> The list should support:
> 
> - Order number.
> - Order date.
> - Delivery date.
> - Delivery address.
> - Total.
> - Status.
> 
> Filtering by date/status is recommended but exact filter requirements are an open point.
> 
> ---
> 
> # 19. Order Detail
> 
> The order detail page should display:
> 
> - Order number.
> - Order date.
> - Customer.
> - Delivery address.
> - Requested delivery date.
> - Current status.
> - Status timeline.
> - Products.
> - Quantities.
> - Unit prices.
> - Line totals.
> - Order total.
> - Order note.
> - Staff amendments, where applicable.
> 
> ---
> 
> # 20. Customer Order Cancellation
> 
> A customer can cancel an order only while the order is in `Received` status.
> 
> Once the order becomes `Confirmed`:
> 
> - The customer cannot cancel it through the portal.
> - The customer must contact the distributor office.
> 
> The exact cancellation confirmation flow is an open point.
> 
> ---
> 
> # 21. Order Confirmation Email
> 
> When an order is confirmed:
> 
> - The buyer receives an email.
> - The email contains the order number.
> - The email contains relevant order information.
> - If staff changed quantities, the customer is informed of the changes.
> 
> The exact email templates are an open point.
> 
> ---
> 
> # 22. Out-for-Delivery Email
> 
> When an order status changes to `Out for delivery`:
> 
> - The buyer receives an email.
> - The email identifies the order.
> - The email indicates that the order is out for delivery.
> 
> The system does not provide route planning.
> 
> ---
> 
> # 23. Office Order Queue
> 
> Office staff have an order-management screen.
> 
> The queue should show:
> 
> - Order number.
> - Customer.
> - Order date.
> - Requested delivery date.
> - Order total.
> - Current status.
> 
> Staff can filter by:
> 
> - Customer.
> - Date.
> - Status.
> 
> Staff can open an order to perform permitted actions.
> 
> ---
> 
> # 24. Staff Order Editing
> 
> Staff can edit an order before confirmation.
> 
> Possible changes:
> 
> - Product quantity.
> - Product line removal.
> - Delivery date, where permitted.
> - Delivery address, where permitted.
> - Order note.
> 
> If quantities are changed:
> 
> - The customer should receive an email explaining the change.
> - The order should retain an audit history of the amendment.
> 
> The exact amendment rules are an open point.
> 
> ---
> 
> # 25. Staff Order Confirmation
> 
> Staff can confirm a received order.
> 
> Confirmation should:
> 
> - Validate product availability.
> - Validate customer information.
> - Lock the order from customer cancellation.
> - Set status to `Confirmed`.
> - Record who confirmed it.
> - Record confirmation date/time.
> - Send the confirmation email.
> 
> ---
> 
> # 26. Staff Order Rejection
> 
> Staff can reject an order.
> 
> A rejected order should:
> 
> - Become `Cancelled`.
> - Record a cancellation/rejection reason.
> - Record who rejected it.
> - Record the date/time.
> - Notify the customer.
> 
> Whether a separate `Rejected` status is needed is an open point.
> 
> ---
> 
> # 27. Staff-Created Orders
> 
> Staff can create an order on behalf of a customer, for example when the customer phones the office.
> 
> The flow should allow staff to:
> 
> 1. Select a customer.
> 2. Select a delivery address.
> 3. Add products.
> 4. Set quantities.
> 5. Review customer-specific pricing.
> 6. Select delivery date.
> 7. Add notes.
> 8. Submit the order.
> 
> The system should record that the order was created by staff.
> 
> The customer should be able to see the order in their normal order history.
> 
> ---
> 
> # 28. Delivery List Export
> 
> Staff can export the day's delivery list as CSV.
> 
> The export should contain information required by drivers, potentially including:
> 
> - Order number.
> - Customer.
> - Delivery address.
> - Contact information.
> - Delivery date.
> - Order lines or package summary.
> - Notes.
> - Delivery status.
> 
> The exact CSV columns are an open point.
> 
> ---
> 
> # 29. Invoices
> 
> An invoice is automatically created when an order becomes `Delivered`.
> 
> Invoice information should include:
> 
> - Invoice number.
> - Customer.
> - Billing address.
> - Order number.
> - Invoice date.
> - Invoice lines.
> - Quantities.
> - Prices.
> - Total.
> - Payment status.
> 
> ---
> 
> # 30. Invoice Status
> 
> Invoices can have:
> 
> - Paid.
> - Unpaid.
> - Overdue.
> 
> The rules for determining overdue status are an open point.
> 
> ---
> 
> # 31. Invoice PDF
> 
> Customers can:
> 
> - View invoices.
> - Download invoices as PDF.
> 
> Staff can also view invoices.
> 
> The invoice PDF should contain the required billing and order information.
> 
> Whether an existing client invoice template must be reproduced is an open point.
> 
> ---
> 
> # 32. Invoice Payment
> 
> Staff can mark an invoice as paid.
> 
> When marking paid, staff record:
> 
> - Payment date.
> - User who recorded the payment.
> 
> Payment method is an open point.
> 
> The portal does not take online card payments in this phase.
> 
> ---
> 
> # 33. Admin Product Management
> 
> Administrators can:
> 
> - Add products.
> - Edit products.
> - Retire products.
> - Change product information.
> - Assign categories.
> - Upload product images.
> - Manage manufacturer information.
> - Manage product codes.
> - Manage compatibility information.
> 
> Retired products should remain available in historical orders.
> 
> ---
> 
> # 34. Product Image Management
> 
> Administrators can upload a product image.
> 
> The system should:
> 
> - Validate supported image types.
> - Validate reasonable file size limits.
> - Store the image.
> - Display it in the catalogue.
> - Allow replacement where permitted.
> 
> The exact image dimensions, formats, and storage mechanism are open points.
> 
> ---
> 
> # 35. Vehicle Compatibility Management
> 
> Administrators can associate products with vehicles.
> 
> Compatibility data may include:
> 
> - Make.
> - Model.
> - Model year.
> - Engine.
> - Variant.
> 
> A product can be compatible with multiple vehicles.
> 
> The exact compatibility-data import/management approach is an open point.
> 
> ---
> 
> # 36. Price List Management
> 
> Administrators can:
> 
> - Create price lists.
> - Rename price lists.
> - Add products.
> - Set product prices.
> - Edit product prices.
> - Remove products.
> - Assign price lists to customers.
> - Deactivate price lists.
> 
> Existing orders retain their original prices.
> 
> ---
> 
> # 37. User Administration
> 
> Administrators can:
> 
> - Invite users.
> - View users.
> - Deactivate users.
> - Reactivate users where permitted.
> - Change user role.
> - Associate users with customer companies.
> - View account status.
> 
> Historical records must not be deleted when a user is deactivated.
> 
> ---
> 
> # 38. Staff Dashboard
> 
> The staff dashboard should provide an operational overview.
> 
> Potential information:
> 
> - New orders.
> - Orders awaiting confirmation.
> - Orders being picked.
> - Orders out for delivery.
> - Today's deliveries.
> - Outstanding invoices.
> - Failed ERP stock imports.
> 
> The exact dashboard widgets are an open point.
> 
> ---
> 

**Q-6** Buyers see all of their company's orders (answer Q-2). Can a Buyer also cancel or repeat a Received order that a colleague placed, or that staff created for the company?
  A. Any Buyer of the company may cancel or repeat any company order that is eligible   ← recommended: Follows the company-wide visibility already agreed, with no per-user ownership checks.
  B. Only the Buyer who placed the order may cancel it; any Buyer may repeat it
  C. Buyers may only view colleagues' orders, not cancel or repeat them
  (why it matters: Controls who can change order state.)

**Q-7** With no Customer Account Manager in the first release (answer Q-1), can Buyers add or edit their company's delivery addresses, or do only staff/admins manage them?
  A. Only staff/admins manage addresses; Buyers choose from existing ones   ← recommended: Smallest scope. The 'manage addresses if permitted' ability belonged to the role that was dropped.
  B. Buyers can add and edit their company's addresses
  (why it matters: Decides who can write customer address data.)

**Q-8** For an inactive customer company (answer Q-5), can staff still move its open orders forward, create new orders for it, and have invoices created when its orders are delivered?
  A. Open orders continue as normal and invoices are still created; staff cannot create new orders for the company   ← recommended: Stays consistent with 'cannot order' while not leaving existing work stranded.
  B. Open orders continue and staff may still create new orders
  C. Open orders are frozen until the company is reactivated
  (why it matters: Controls order writes and whether invoices are created.)

Assumed unless you say otherwise:
- ASM-32: Invoices only exist once an order is Delivered. Should the customer's invoice list show every invoice their company has, with no extra filtering by order status, or should invoices also appear (for example as 'pending') on orders that are not yet Delivered? → assumed: Invoice list shows every existing invoice for the company; orders that are not yet Delivered simply have no invoice
- ASM-33: Who receives the order emails (confirmation, quantity change, out for delivery, rejection or cancellation), including for orders staff create on a customer's behalf? → assumed: The Buyer who placed the order; for orders staff create, the company's contact email
- ASM-34: When staff cancel an order that is already Confirmed, Picking or Out for delivery (answer Q-3), does it work like a rejection, with a reason recorded and the customer emailed? → assumed: Same as rejection: reason required, who and when recorded, customer emailed
- ASM-35: When staff change the delivery date before confirmation (answer Q-4), is the 14:00 cutoff worked out from the original order time or from the time of the edit? And is the customer told about date or address changes? → assumed: Cutoff is worked out from the time of the edit; only quantity changes trigger an email
- ASM-36: Should the 14:00 order cutoff, the non-working days and the system timezone be settings an admin can change, or fixed in code? → assumed: Admin-configurable system settings
- ASM-37: Should the lockout rule (5 failed attempts, 15-minute lock) be configurable or fixed? → assumed: Fixed constants in code

Answer with letters or your own words:
  factory answer 20261005-automotive-parts-customer-orde-674c e6eec2d4 Q-6=A Q-7=A Q-8=A
  (use quotes for words: Q-6="only for guest checkouts")

Card hash: e6eec2d4