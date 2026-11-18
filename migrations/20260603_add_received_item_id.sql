ALTER TABLE receipt_lines
  ADD COLUMN IF NOT EXISTS received_item_id VARCHAR;

COMMENT ON COLUMN receipt_lines.received_item_id IS
  'Item identifier actually received, used to verify supplier item fulfillment.';
