CREATE TABLE customer_branches (
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  preferences JSONB,
  PRIMARY KEY (customer_id, branch_id)
);
CREATE INDEX customer_branches_branch_idx ON customer_branches(branch_id, customer_id);

CREATE TABLE patient_branches (
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  PRIMARY KEY (patient_id, branch_id)
);
CREATE INDEX patient_branches_branch_idx ON patient_branches(branch_id, patient_id);
