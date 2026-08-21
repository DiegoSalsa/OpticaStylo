-- Impedir distancias pupilares no positivas sin inventar un rango clínico máximo.
ALTER TABLE optical_prescriptions
  ADD CONSTRAINT optical_prescriptions_positive_pupillary_distance
  CHECK (pupillary_distance IS NULL OR pupillary_distance > 0);
