import ScrollableRegion from "./scrollable-region";

export default function ScrollableTable({ children, label }) {
  return (
    <ScrollableRegion
      data-scroll-table=""
      hint="Desplaza la tabla para ver todas las columnas."
      label={label}
    >
      {children}
    </ScrollableRegion>
  );
}
