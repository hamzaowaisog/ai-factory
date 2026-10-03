# Warehouse inventory backend

- API-key authentication for all calls.
- Product records: SKU, name, price, stock level, reorder level. Create, list, get, update and delete.
- Stock level changes only via adjustments that carry a reason; adjustments form an audit trail, listable per product.
- Low stock (below the reorder level) triggers an email to the purchasing team.
- No front end.
