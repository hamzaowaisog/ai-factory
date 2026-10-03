# Inventory API

A REST API, no user interface. Products have a SKU, name, price and stock quantity; the API supports creating, reading, updating and deleting products. Stock is changed only through stock adjustments, each with a reason; every adjustment is kept in an audit log that can be listed per product. When a product's stock drops below its reorder level, the API emails the purchasing team. Callers authenticate with an API key.
