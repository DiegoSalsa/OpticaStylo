"use client";

import { useState } from "react";
import { formatChileanRut } from "@/utils/chilean-rut";

export default function RutInput({ defaultValue, value, onChange, onBlur, ...props }) {
  const [editing, setEditing] = useState(false);
  const controlled = value !== undefined;

  return (
    <input
      autoCapitalize="characters"
      placeholder="12.345.678-5"
      spellCheck={false}
      {...props}
      defaultValue={formatChileanRut(defaultValue)}
      value={editing ? value : formatChileanRut(value)}
      onChange={(event) => {
        if (controlled) setEditing(true);
        onChange?.(event);
      }}
      onBlur={(event) => {
        if (controlled) setEditing(false);
        else event.currentTarget.value = formatChileanRut(event.currentTarget.value);
        onBlur?.(event);
      }}
    />
  );
}
