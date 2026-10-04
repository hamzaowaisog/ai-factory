# Stock service (backend only)

Build an HTTP JSON service for our warehouse. It manages products (SKU, name, price, quantity on hand) with full create/read/update/delete. Quantities may not be edited directly: clients post a stock adjustment with a reason, and the service records every adjustment so the history of a product can be fetched. If quantity falls under the product's reorder threshold, send an email to purchasing. Access is by API key.
