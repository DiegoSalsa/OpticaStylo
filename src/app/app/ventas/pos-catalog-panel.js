"use client";

import Icon from "@/components/ui/icon";
import { ADULT_BIRTH_DATE_CUTOFF, customerDetails } from "./pos-form-model";

export default function PosCatalogPanel({ model }) {
  const {
    activeCategory,
    addConfiguredLens,
    addProduct,
    attachPrescription,
    canEdit,
    chooseCustomer,
    choosePatient,
    createCustomer,
    createPatient,
    customer,
    customerSearch,
    customers,
    lensOptions,
    money,
    newCustomer,
    newPatient,
    offersPrescriptionAttachment,
    patient,
    patientBirthDate,
    patientSearch,
    patients,
    pending,
    productSearch,
    products,
    scanSku,
    scannerRef,
    selectedLensId,
    selectedLensMountId,
    setActiveCategory,
    setCustomerSearch,
    setNewCustomer,
    setNewPatient,
    setPatientBirthDate,
    setPatientSearch,
    setProductSearch,
    setSelectedLensId,
    setSelectedLensMountId,
    soldFrames,
  } = model;

  return (
    <section className="pos-workspace">
      <article className="app-card pos-section">
        <div className="pos-title">
          <span>1</span>
          <div>
            <h2>Cliente opcional</h2>
            <p>
              Úsalo para historial o contacto; la venta rápida no exige
              registro.
            </p>
          </div>
          <button
            className="text-button"
            disabled={!canEdit}
            onClick={() => setNewCustomer((value) => !value)}
            type="button"
          >
            {newCustomer ? "Cerrar" : "+ Crear cliente"}
          </button>
        </div>
        {newCustomer ? (
          <form className="quick-customer" onSubmit={createCustomer}>
            <label className="field">
              <span>RUT opcional</span>
              <input name="rut" placeholder="12.345.678-5" />
            </label>
            <label className="field">
              <span>Nombre</span>
              <input name="firstNames" placeholder="Nombre completo" required />
            </label>
            <button
              className="app-button app-button--primary"
              disabled={pending}
              type="submit"
            >
              Crear y seleccionar
            </button>
          </form>
        ) : (
          <>
            {customer && (
              <div className="selected-customer">
                <span>
                  <Icon name="check" size={17} />
                </span>
                <div>
                  <strong>
                    {customer.firstNames} {customer.lastNames}
                  </strong>
                  <small>{customerDetails(customer)}</small>
                </div>
                <button
                  disabled={!canEdit}
                  onClick={() => chooseCustomer(null)}
                  type="button"
                >
                  Cambiar
                </button>
              </div>
            )}
            {!customer && (
              <>
                <div className="search-field">
                  <Icon name="search" size={18} />
                  <input
                    aria-label="Buscar cliente"
                    onChange={(event) => setCustomerSearch(event.target.value)}
                    placeholder="Buscar por nombre, RUT, correo o teléfono"
                    value={customerSearch}
                  />
                </div>
                <div className="result-list">
                  {customers.loading ? (
                    <p>Cargando clientes…</p>
                  ) : customers.error ? (
                    <p className="inline-error">{customers.error}</p>
                  ) : (
                    customers.items.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => chooseCustomer(item)}
                        type="button"
                      >
                        <span>
                          {item.firstNames} {item.lastNames}
                        </span>
                        <small>{customerDetails(item)}</small>
                      </button>
                    ))
                  )}
                </div>
                <p className="prescription-hint">
                  Puedes continuar sin seleccionar un cliente.
                </p>
              </>
            )}
          </>
        )}
      </article>
      {attachPrescription && offersPrescriptionAttachment && (
        <article className="app-card pos-section">
          <div className="pos-title">
            <span>2</span>
            <div>
              <h2>Paciente</h2>
              <p>
                Se mantiene separado del cliente y solo se usa para la receta.
              </p>
            </div>
            <button
              className="text-button"
              disabled={!canEdit}
              onClick={() => setNewPatient((value) => !value)}
              type="button"
            >
              {newPatient ? "Cerrar" : "+ Registrar paciente"}
            </button>
          </div>
          {newPatient ? (
            <form className="quick-patient" onSubmit={createPatient}>
              <label className="field">
                <span>RUT</span>
                <input name="rut" required />
              </label>
              <label className="field">
                <span>Fecha de nacimiento</span>
                <input
                  name="birthDate"
                  onChange={(event) => setPatientBirthDate(event.target.value)}
                  required
                  type="date"
                  value={patientBirthDate}
                />
              </label>
              <label className="field">
                <span>Nombres</span>
                <input name="firstNames" required />
              </label>
              <label className="field">
                <span>Apellidos</span>
                <input name="lastNames" required />
              </label>
              <label className="field">
                <span>Teléfono</span>
                <input name="phone" required />
              </label>
              <label className="field">
                <span>Correo</span>
                <input name="email" required type="email" />
              </label>
              <label className="field field-wide">
                <span>Dirección</span>
                <input name="address" required />
              </label>
              {patientBirthDate &&
                patientBirthDate > ADULT_BIRTH_DATE_CUTOFF && (
                  <fieldset className="pos-guardian-fields">
                    <legend>Responsable del paciente menor de edad</legend>
                    <label className="field">
                      <span>RUT responsable</span>
                      <input name="guardianRut" required />
                    </label>
                    <label className="field">
                      <span>Parentesco</span>
                      <input name="guardianRelationship" required />
                    </label>
                    <label className="field">
                      <span>Nombres</span>
                      <input name="guardianFirstNames" required />
                    </label>
                    <label className="field">
                      <span>Apellidos</span>
                      <input name="guardianLastNames" required />
                    </label>
                    <label className="field">
                      <span>Teléfono</span>
                      <input name="guardianPhone" required />
                    </label>
                    <label className="field">
                      <span>Correo</span>
                      <input name="guardianEmail" required type="email" />
                    </label>
                  </fieldset>
                )}
              <button
                className="app-button app-button--primary"
                disabled={pending}
                type="submit"
              >
                Registrar y seleccionar
              </button>
            </form>
          ) : (
            <>
              <div className="search-field">
                <Icon name="search" size={18} />
                <input
                  aria-label="Buscar paciente"
                  onChange={(event) => setPatientSearch(event.target.value)}
                  placeholder="Buscar paciente por nombre o RUT"
                  value={patientSearch}
                />
              </div>
              {patient ? (
                <div className="selected-customer">
                  <span>
                    <Icon name="check" size={17} />
                  </span>
                  <div>
                    <strong>
                      {patient.firstNames} {patient.lastNames}
                    </strong>
                    <small>{patient.rut} · paciente de la receta</small>
                  </div>
                  <button
                    disabled={!canEdit}
                    onClick={() => choosePatient(null)}
                    type="button"
                  >
                    Cambiar
                  </button>
                </div>
              ) : (
                <div className="result-list">
                  {patients.loading ? (
                    <p>Cargando pacientes…</p>
                  ) : patients.error ? (
                    <p className="inline-error">{patients.error}</p>
                  ) : (
                    patients.items.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => choosePatient(item)}
                        type="button"
                      >
                        <span>
                          {item.firstNames} {item.lastNames}
                        </span>
                        <small>
                          {item.rut} · {item.email}
                        </small>
                      </button>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </article>
      )}
      <article className="app-card pos-section">
        <div className="pos-title">
          <span>
            {attachPrescription && offersPrescriptionAttachment ? 3 : 2}
          </span>
          <div>
            <h2>Productos</h2>
            <p>
              Catálogo rápido con precios controlados. La disponibilidad es
              simulada hasta integrar inventario.
            </p>
          </div>
        </div>
        <form className="scanner-field" onSubmit={scanSku}>
          <Icon name="receipt" size={18} />
          <input
            aria-label="Ingresar SKU con escáner"
            placeholder="Escanear SKU y presionar Enter"
            ref={scannerRef}
          />
          <button
            className="app-button app-button--primary"
            disabled={!canEdit}
            type="submit"
          >
            Agregar
          </button>
        </form>
        <div className="search-field">
          <Icon name="search" size={18} />
          <input
            aria-label="Buscar productos"
            onChange={(event) => setProductSearch(event.target.value)}
            placeholder="Buscar marcos, accesorios o SKU"
            value={productSearch}
          />
        </div>
        <div
          className="product-categories"
          aria-label="Filtrar catálogo por categoría"
        >
          <button
            className={activeCategory === "ALL" ? "active" : ""}
            onClick={() => setActiveCategory("ALL")}
            type="button"
          >
            Todo
          </button>
          {[...new Set(products.items.map((item) => item.category))].map(
            (category) => (
              <button
                className={activeCategory === category ? "active" : ""}
                key={category}
                onClick={() => setActiveCategory(category)}
                type="button"
              >
                {category === "FRAME"
                  ? "Marcos"
                  : category === "PRESCRIPTION_LENS"
                    ? "Lentes"
                    : category === "TREATMENT"
                      ? "Tratamientos"
                      : category === "ACCESSORY"
                        ? "Accesorios"
                        : "Otros"}
              </button>
            ),
          )}
        </div>
        <div className="product-results">
          {products.loading ? (
            <p>Cargando productos…</p>
          ) : products.error ? (
            <p className="inline-error">{products.error}</p>
          ) : (
            products.items
              .filter(
                (item) =>
                  item.isActive &&
                  item.category !== "PRESCRIPTION_LENS" &&
                  (activeCategory === "ALL" ||
                    item.category === activeCategory),
              )
              .map((item) => (
                <button
                  disabled={!canEdit}
                  key={item.id}
                  onClick={() => addProduct(item)}
                  type="button"
                >
                  <span className="product-symbol">
                    <Icon
                      name={item.category === "FRAME" ? "eye" : "package"}
                    />
                  </span>
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {item.sku}
                      {item.requiresPrescription ? " · Receta opcional" : ""}
                      {item.availability?.source === "MOCK"
                        ? " · Disponibilidad simulada"
                        : ""}
                      {item.isTestData ? " · Dato de prueba" : ""}
                    </small>
                  </span>
                  <b>{money.format(item.unitPriceCents)}</b>
                  <em>+</em>
                </button>
              ))
          )}
        </div>
        <div className="lens-configuration">
          <div>
            <strong>Cristales para una montura</strong>
            <p>
              Se agregan como opción del marco vendido o de la montura del
              cliente; no se venden sueltos.
            </p>
          </div>
          {lensOptions.loading ? (
            <p>Cargando opciones de cristales…</p>
          ) : lensOptions.error ? (
            <p className="inline-error">{lensOptions.error}</p>
          ) : lensOptions.items.length ? (
            <>
              <label className="field">
                <span>Opción de cristales</span>
                <select
                  disabled={!canEdit}
                  onChange={(event) => setSelectedLensId(event.target.value)}
                  value={selectedLensId}
                >
                  <option value="">Seleccionar opción</option>
                  {lensOptions.items
                    .filter((item) => item.isActive)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {money.format(item.unitPriceCents)}
                        {item.isTestData ? " · Datos de prueba" : ""}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                <span>Montura para los cristales</span>
                <select
                  disabled={!canEdit}
                  onChange={(event) =>
                    setSelectedLensMountId(event.target.value)
                  }
                  value={selectedLensMountId}
                >
                  <option value="">Montura del cliente</option>
                  {soldFrames.map((frame) => (
                    <option key={frame.id} value={frame.id}>
                      Montura vendida: {frame.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="lens-configuration-actions">
                <button
                  className="app-button app-button--primary"
                  disabled={!canEdit}
                  onClick={addConfiguredLens}
                  type="button"
                >
                  Agregar cristales
                </button>
              </div>
            </>
          ) : (
            <p>No hay opciones de cristales configuradas para esta caja.</p>
          )}
        </div>
      </article>
    </section>
  );
}
