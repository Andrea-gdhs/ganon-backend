ALTER TABLE evaluations
  ADD COLUMN IF NOT EXISTS supplier_response_status VARCHAR,
  ADD COLUMN IF NOT EXISTS supplier_response_text TEXT,
  ADD COLUMN IF NOT EXISTS supplier_response_signer_name VARCHAR,
  ADD COLUMN IF NOT EXISTS supplier_response_signature_file_path VARCHAR,
  ADD COLUMN IF NOT EXISTS supplier_response_at TIMESTAMPTZ;

ALTER TABLE evaluations
  ADD CONSTRAINT evaluations_supplier_response_status_check
  CHECK (
    supplier_response_status IS NULL OR
    supplier_response_status IN ('accepted', 'review_requested')
  );
