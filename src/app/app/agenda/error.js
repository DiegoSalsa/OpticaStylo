"use client";

export default function AgendaError({ reset }) {
  return (
    <section className="app-card" role="alert">
      <h1>No se pudo mostrar Agenda</h1>
      <p>Puedes volver a intentar la carga o continuar en otro módulo.</p>
      <button className="app-button" onClick={reset} type="button">Reintentar</button>
    </section>
  );
}
