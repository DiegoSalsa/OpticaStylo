"use client";
import usePaginatedResource from "@/components/internal/use-paginated-resource";
import Pagination from "@/components/internal/pagination";
import PrescriptionDetails from "./prescription-details";
export default function CustomerPrescriptions({customerId}){
  const list=usePaginatedResource(`/api/external-prescriptions?customerId=${customerId}`);
  return <section className="app-card"><h3>Historial de recetas comerciales</h3>
    <p>Recetas externas y de compras autorizadas. Las atenciones clínicas se consultan en su ficha.</p>
    {list.status==="loading"?<p role="status">Cargando recetas…</p>:list.status==="ready"&&!list.items.length?<p>Sin recetas comerciales registradas.</p>:list.items.map(prescription=><PrescriptionDetails endpoint={`/api/external-prescriptions/${prescription.id}`} key={prescription.id} label={`Ver receta del ${new Date(prescription.createdAt).toLocaleDateString("es-CL")}`}/>)}
    <Pagination {...list} label="recetas comerciales"/>
  </section>;
}
