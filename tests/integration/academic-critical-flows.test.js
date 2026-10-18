import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { prisma } from "../../src/db/prisma.js";
import { createAppointment, updateAppointment, changeAppointmentStatus, getAppointment, getAppointmentHistory } from "../../src/services/appointment-service.js";
import { getProfessionalAvailability, setProfessionalOverride, createProfessionalScheduleBlock, replaceProfessionalSchedule } from "../../src/services/schedule-service.js";
import { getMedicalRecord, updateMedicalRecord, createEncounter, getEncounter, updateEncounter, finalizeEncounter, addEncounterAddendum, getPatientClinicalHistory } from "../../src/services/clinical-service.js";
import { createPrescription, updatePrescription, getPrescription, getPrescriptionList } from "../../src/services/prescription-service.js";
import { createSale, confirmSale, registerSalePayment, issueSaleReceipt, grantDiscountAuthorization } from "../../src/services/sale-service.js";
import { openCashRegister, closeCashRegister, registerCashMovement } from "../../src/services/cash-register-service.js";
import { ids, seedAcademicData } from "../fixtures/academic-data.js";
import { ids as catalog } from "../../scripts/seed-store-e2e.mjs";
import { createSuccessResponse } from "../../src/utils/api-response.js";

const currentDate = new Date("2029-12-01T00:00:00Z");
const dependencies = { currentDate, timeZone: "America/Santiago" };
const optical = {rightEye:{sphere:-1,cylinder:-0.5,axis:90,addition:null},leftEye:{sphere:-1.25,cylinder:0,axis:null,addition:null},pupillaryDistance:62,fulfillmentNotes:"Demostración enteramente ficticia"};
const rejectsCode = (operation, code) => assert.rejects(operation, (error) => error.code === code);
const booking = (date,time="09:00",patientId=ids.patient,professionalId=ids.professional) => ({patientId,professionalId,startAt:`${date}T${time}:00-03:00`});

test("validación crítica PostgreSQL dedicado: agenda, clínica y POS", {skip:process.env.ACADEMIC_ISOLATION !== "true"}, async(t)=>{
  try {
    const actors = await seedAcademicData();
    const {admin,sales,professional,otherProfessional} = actors;
    let appointment, encounter, prescription, replacement, quotation, paymentSale;
    const draft = {customerId:ids.customer,items:[{productId:catalog.accessory,quantity:2}]};

    await t.test("AG-01 disponibilidad conserva jornada, pausa y America/Santiago en verano e invierno",async()=>{
      for(const [date,start] of [["2030-01-07","2030-01-07T12:00:00.000Z"],["2030-07-08","2030-07-08T13:00:00.000Z"]]) {
        const availability = await getProfessionalAvailability(ids.professional,new URLSearchParams({date}),admin,dependencies);
        assert.equal(availability.timeZone,"America/Santiago");
        assert.equal(availability.slots[0].startAt,start);
        assert.equal(availability.slots.length,16);
        assert.equal(availability.slots.some((slot)=>new Date(slot.startAt).getTime()===new Date(`${date}T13:00:00${date.includes("07-08")?"-04:00":"-03:00"}`).getTime()),false);
      }
    });
    await t.test("AG-02 excepción cerrada y bloqueo retiran cupos persistidos",async()=>{
      await setProfessionalOverride(ids.professional,"2030-01-08",{isWorking:false},professional);
      assert.equal((await getProfessionalAvailability(ids.professional,new URLSearchParams({date:"2030-01-08"}),admin,dependencies)).slots.length,0);
      await createProfessionalScheduleBlock(ids.professional,{startAt:"2030-01-09T10:00:00-03:00",endAt:"2030-01-09T11:00:00-03:00",reason:"Bloqueo sintético"},professional,dependencies);
      const available = await getProfessionalAvailability(ids.professional,new URLSearchParams({date:"2030-01-09"}),admin,dependencies);
      assert.equal(available.slots.length,14);
      await rejectsCode(()=>createAppointment(booking("2030-01-09","10:00"),admin,dependencies),"APPOINTMENT_TIME_NOT_AVAILABLE");
    });
    await t.test("AG-03 un profesional no modifica la jornada ni consulta reserva ajena",async()=>{
      await rejectsCode(()=>replaceProfessionalSchedule(ids.professional,{days:[]},otherProfessional),"INSUFFICIENT_PERMISSIONS");
      appointment = await createAppointment(booking("2030-01-10"),admin,dependencies);
      await rejectsCode(()=>getAppointment(appointment.id,otherProfessional),"APPOINTMENT_NOT_FOUND");
    });
    await t.test("AG-04 reprogramación conserva integridad al rechazar conflicto y registra historial",async()=>{
      await createAppointment(booking("2030-01-10","10:00",ids.otherPatient),admin,dependencies);
      await rejectsCode(()=>updateAppointment(appointment.id,{startAt:"2030-01-10T10:00:00-03:00"},admin,dependencies),"APPOINTMENT_TIME_NOT_AVAILABLE");
      assert.equal((await getAppointment(appointment.id,admin)).startAt.toISOString(),"2030-01-10T12:00:00.000Z");
      appointment = await updateAppointment(appointment.id,{startAt:"2030-01-10T09:30:00-03:00"},admin,dependencies);
      assert.equal((await getAppointmentHistory(appointment.id,admin)).events.filter((event)=>event.eventType==="RESCHEDULED").length,1);
    });
    await t.test("AG-05 cancelación libera cupo y no permite finalización directa",async()=>{
      await rejectsCode(()=>changeAppointmentStatus(appointment.id,{status:"COMPLETED"},admin),"APPOINTMENT_COMPLETION_REQUIRES_FINALIZED_ENCOUNTER");
      await changeAppointmentStatus(appointment.id,{status:"CANCELLED",cancellationReason:"Cancelación sintética"},admin,dependencies);
      assert.ok((await getProfessionalAvailability(ids.professional,new URLSearchParams({date:"2030-01-10"}),admin,dependencies)).slots.some((slot)=>slot.startAt==="2030-01-10T12:30:00.000Z"));
    });
    await t.test("AG-06 dos solicitudes que observaron el mismo cupo crean solo una reserva y un par de avisos",async()=>{
      let arrived = 0, release;
      const barrier = new Promise((resolve)=>{release=resolve;});
      const getAvailability = async(...args)=>{const result=await getProfessionalAvailability(...args);if(++arrived===2)release();await barrier;return result;};
      const results = await Promise.allSettled([ids.patient,ids.otherPatient].map((patient)=>createAppointment(booking("2030-01-11","09:00",patient),admin,{...dependencies,getProfessionalAvailability:getAvailability})));
      const success = results.filter((result)=>result.status==="fulfilled");
      const failures = results.filter((result)=>result.status==="rejected");
      assert.equal(success.length,1);assert.equal(failures.length,1);
      assert.equal(failures[0].reason.code,"APPOINTMENT_TIME_NOT_AVAILABLE");
      assert.equal(await prisma.appointments.count({where:{professional_id:ids.professional,start_at:new Date("2030-01-11T12:00:00Z")}}),1);
      assert.equal(await prisma.transactional_email_outbox.count({where:{appointment_id:success[0].value.id}}),2);
      assert.equal(await prisma.appointment_events.count({where:{appointment_id:success[0].value.id,event_type:"CREATED"}}),1);
    });
    await t.test("CL-01 ADMIN aislado y profesional no asignado no leen ficha",async()=>{
      appointment = await createAppointment(booking("2030-01-12"),admin,dependencies);
      await rejectsCode(()=>getMedicalRecord(ids.patient,admin),"INSUFFICIENT_PERMISSIONS");
      await rejectsCode(()=>getMedicalRecord(ids.patient,otherProfessional),"CLINICAL_ACCESS_NOT_ASSIGNED");
      assert.equal((await getMedicalRecord(ids.patient,professional)).record,null);
    });
    await t.test("CL-02 llegada requerida, borrador único y reserva ajena protegida",async()=>{
      await rejectsCode(()=>createEncounter({appointmentId:appointment.id,reasonForVisit:"Prueba ficticia"},professional),"APPOINTMENT_NOT_CHECKED_IN");
      await changeAppointmentStatus(appointment.id,{status:"CHECKED_IN"},professional,dependencies);
      await rejectsCode(()=>createEncounter({appointmentId:appointment.id,reasonForVisit:"Prueba ficticia"},otherProfessional),"CLINICAL_ACCESS_NOT_ASSIGNED");
      encounter = await createEncounter({appointmentId:appointment.id,reasonForVisit:"Prueba ficticia"},professional);
      await rejectsCode(()=>createEncounter({appointmentId:appointment.id,reasonForVisit:"Duplicado"},professional),"CLINICAL_ENCOUNTER_ALREADY_EXISTS");
      assert.equal(await prisma.clinical_encounters.count({where:{appointment_id:appointment.id}}),1);
      await rejectsCode(()=>getEncounter(encounter.id,otherProfessional),"CLINICAL_ENCOUNTER_NOT_FOUND");
    });
    await t.test("CL-03 antecedentes conservan revisiones reales sin duplicar un guardado idéntico",async()=>{
      await updateMedicalRecord(ids.patient,{allergies:"Sin alergias; dato ficticio"},professional);
      await updateMedicalRecord(ids.patient,{allergies:"Corrección ficticia"},professional);
      await updateMedicalRecord(ids.patient,{allergies:"Corrección ficticia"},professional);
      const record = await getMedicalRecord(ids.patient,professional);
      assert.equal(record.revisions.length,2);assert.equal(record.revisions[1].allergies,"Sin alergias; dato ficticio");
      const payload=await createSuccessResponse(record).json();
      assert.equal(typeof payload.data.revisions[0].id,"string");
    });
    await t.test("CL-04 no finaliza borrador incompleto ni admite adenda prematura",async()=>{
      await rejectsCode(()=>finalizeEncounter(encounter.id,professional,dependencies),"INCOMPLETE_CLINICAL_ENCOUNTER");
      await rejectsCode(()=>addEncounterAddendum(encounter.id,{reason:"Prueba",content:"Prueba"},professional),"CLINICAL_ENCOUNTER_NOT_FINALIZED");
      assert.equal((await getEncounter(encounter.id,professional)).status,"DRAFT");
      assert.equal((await getAppointment(appointment.id,admin)).status,"CHECKED_IN");
    });
    await t.test("CL-05 receta exige datos válidos y mantiene borrador privado frente a ventas",async()=>{
      await rejectsCode(()=>createPrescription(encounter.id,{...optical,rightEye:{...optical.rightEye,axis:null}},professional),"INVALID_CLINICAL_DATA");
      prescription = await createPrescription(encounter.id,optical,professional,dependencies);
      await rejectsCode(()=>getPrescription(prescription.id,sales),"PRESCRIPTION_NOT_FOUND");
      prescription = await updatePrescription(prescription.id,{pupillaryDistance:63},professional);
      assert.equal(prescription.pupillaryDistance,63);assert.equal(prescription.version,1);
    });
    await t.test("CL-06 finalización atómica vuelve inmutable la atención y completa la reserva",async()=>{
      await updateEncounter(encounter.id,{examination:"Examen enteramente sintético",diagnosis:"Diagnóstico ficticio para ensayo"},professional);
      await finalizeEncounter(encounter.id,professional,dependencies);
      assert.equal((await getEncounter(encounter.id,professional)).status,"FINALIZED");
      assert.equal((await getAppointment(appointment.id,admin)).status,"COMPLETED");
      await rejectsCode(()=>updateEncounter(encounter.id,{diagnosis:"Alteración"},professional),"CLINICAL_ENCOUNTER_IMMUTABLE");
      await rejectsCode(()=>updatePrescription(prescription.id,{pupillaryDistance:65},professional),"PRESCRIPTION_IMMUTABLE");
      assert.equal((await getEncounter(encounter.id,professional)).diagnosis,"Diagnóstico ficticio para ensayo");
    });
    await t.test("CL-07 adenda conserva autor y original; otro profesional no agrega adendas",async()=>{
      await rejectsCode(()=>addEncounterAddendum(encounter.id,{reason:"Ajena",content:"Ajena"},otherProfessional),"CLINICAL_ACCESS_NOT_ASSIGNED");
      const addendum = await addEncounterAddendum(encounter.id,{reason:"Aclaración ficticia",content:"Contenido sintético adicional"},professional);
      assert.equal(addendum.authoredBy.id,ids.professional);
      const saved = await getEncounter(encounter.id,professional);
      assert.equal(saved.addenda.length,1);assert.equal(saved.diagnosis,"Diagnóstico ficticio para ensayo");
      assert.equal((await getPatientClinicalHistory(ids.patient,professional)).encounters.some((item)=>item.id===encounter.id),true);
      await rejectsCode(()=>getPatientClinicalHistory(ids.patient,otherProfessional),"CLINICAL_ACCESS_NOT_ASSIGNED");
    });
    await t.test("CL-08 reemplazo exige motivo y conserva versión anulada; ventas recibe solo activa sin metadatos internos",async()=>{
      await rejectsCode(()=>createPrescription(encounter.id,optical,professional,dependencies),"PRESCRIPTION_REPLACEMENT_REASON_REQUIRED");
      replacement = await createPrescription(encounter.id,{...optical,replacementReason:"Corrección ficticia"},professional,dependencies);
      assert.equal(replacement.version,2);assert.equal(replacement.replacedPrescriptionId,prescription.id);
      assert.equal((await getPrescription(prescription.id,professional)).status,"VOIDED");
      const visible = await getPrescriptionList(new URLSearchParams({patientId:ids.patient}),sales);
      assert.equal(visible.length,1);assert.equal(visible[0].id,replacement.id);
      for(const key of ["encounterId","replacementReason","professionalId","encounterStatus"]) assert.equal(Object.hasOwn(visible[0],key),false);
    });
    await t.test("POS-01 cantidades y precios del servidor; cotización confirmada no se edita como nueva",async()=>{
      await rejectsCode(()=>createSale({...draft,items:[{productId:catalog.accessory,quantity:0}]},sales),"INVALID_SALE_DATA");
      quotation = await createSale({...draft,items:[{productId:catalog.accessory,quantity:2,unitPriceCents:1}],totalCents:1},sales);
      assert.equal(quotation.totalCents,10000);assert.equal(quotation.status,"QUOTATION");
      quotation = await confirmSale(quotation.id,sales);assert.equal(quotation.status,"PENDING");
      await rejectsCode(()=>confirmSale(quotation.id,sales),"SALE_NOT_CONFIRMABLE");
    });
    await t.test("POS-02 venta y abono con clave repetida no duplican persistencia",async()=>{
      const key = "academic-sale-idempotency";
      const first = await createSale({...draft,operation:"SALE"},sales,{requestKey:key});
      const again = await createSale({...draft,operation:"SALE"},sales,{requestKey:key});
      assert.equal(first.id,again.id);
      const partial = {amountCents:4000,paymentMethod:"BANK_TRANSFER",reference:"Abono ficticio"};
      await registerSalePayment(first.id,partial,sales,{requestKey:"academic-payment-idempotency"});
      paymentSale = await registerSalePayment(first.id,partial,sales,{requestKey:"academic-payment-idempotency"});
      assert.equal(paymentSale.paidCents,4000);assert.equal(paymentSale.balanceCents,6000);assert.equal(paymentSale.payments.length,1);
    });
    await t.test("POS-03 sobrepago y cambio de medio conservan saldo y caja sin mutación",async()=>{
      await rejectsCode(()=>registerSalePayment(paymentSale.id,{amountCents:7000,paymentMethod:"BANK_TRANSFER",reference:"Prueba"},sales),"PAYMENT_EXCEEDS_BALANCE");
      await rejectsCode(()=>registerSalePayment(paymentSale.id,{amountCents:1000,paymentMethod:"CASH",cashReceivedCents:1000},sales),"PAYMENT_METHOD_MISMATCH");
      assert.equal(await prisma.sale_payments.count({where:{sale_id:paymentSale.id}}),1);
    });
    await t.test("POS-04 comprobante parcial y final sin envío; repetir emisión conserva número",async()=>{
      const partial = await issueSaleReceipt(paymentSale.id,{paymentId:paymentSale.payments[0].id},sales);
      assert.equal((await issueSaleReceipt(paymentSale.id,{paymentId:paymentSale.payments[0].id},sales)).id,partial.id);
      paymentSale = await registerSalePayment(paymentSale.id,{amountCents:6000,paymentMethod:"BANK_TRANSFER",reference:"Saldo ficticio"},sales);
      assert.equal(paymentSale.balanceCents,0);assert.equal(paymentSale.status,"PAID");
      const final = await issueSaleReceipt(paymentSale.id,{},sales);
      assert.equal(final.type,"FINAL");
      assert.equal(await prisma.transactional_email_outbox.count({where:{sale_id:paymentSale.id,status:"SENT"}}),0);
    });
    await t.test("POS-05 descuento requiere concesión válida y deja trazabilidad del supervisor",async()=>{
      await rejectsCode(()=>createSale({...draft,discount:{amountCents:1000,reason:"Prueba",authorizationId:ids.patient}},sales),"DISCOUNT_AUTHORIZATION_INVALID");
      const credentials=JSON.parse(await readFile("tmp/academic-validation/demo-credentials.json","utf8"));
      const grant=await grantDiscountAuthorization({amountCents:1000,reason:"Descuento sintético",authorizerEmail:"academic-administrador@example.invalid",authorizerPassword:credentials.password},sales);
      const discounted = await createSale({...draft,discount:{amountCents:1000,reason:"Descuento sintético",authorizationId:grant.id}},sales);
      assert.equal(discounted.totalCents,9000);assert.equal(discounted.discount.authorizedBy.id,ids.admin);
      assert.equal(await prisma.sale_events.count({where:{sale_id:discounted.id,event_type:"DISCOUNT_AUTHORIZED"}}),1);
      await rejectsCode(()=>createSale({...draft,discount:{amountCents:1000,reason:"Descuento sintético",authorizationId:grant.id}},sales),"DISCOUNT_AUTHORIZATION_INVALID");
    });
    await t.test("POS-06 efectivo necesita caja; movimiento y arqueo son calculados en servidor",async()=>{
      const sale = await createSale({...draft,operation:"SALE"},sales);
      await rejectsCode(()=>registerSalePayment(sale.id,{amountCents:10000,paymentMethod:"CASH",cashReceivedCents:12000},sales),"CASH_REGISTER_CLOSED");
      const cash = await openCashRegister({openingAmountCents:1000,openingNotes:"Fondo ficticio"},sales);
      await rejectsCode(()=>openCashRegister({openingAmountCents:0},sales),"CASH_REGISTER_ALREADY_OPEN");
      await registerSalePayment(sale.id,{amountCents:10000,paymentMethod:"CASH",cashReceivedCents:12000},sales);
      await registerCashMovement(cash.id,{movementType:"MANUAL_OUT",amountCents:500,reason:"Retiro ficticio"},sales);
      const closed=await closeCashRegister(cash.id,{closingCountedCents:10400,closingNotes:"Arqueo ficticio"},sales);
      assert.equal(closed.expectedAmountCents,10500);assert.equal(closed.differenceCents,-100);
      await rejectsCode(()=>registerCashMovement(cash.id,{movementType:"MANUAL_IN",amountCents:100,reason:"Prueba"},sales),"CASH_REGISTER_CLOSED");
    });
    await t.test("POS-07 profesional clínico no crea venta ni registra caja; receta ajena y anulada rechazadas",async()=>{
      await rejectsCode(()=>createSale(draft,professional),"INSUFFICIENT_PERMISSIONS");
      await rejectsCode(()=>openCashRegister({openingAmountCents:0},professional),"INSUFFICIENT_PERMISSIONS");
      await rejectsCode(()=>createSale({...draft,patientId:ids.otherPatient,prescriptionId:replacement.id},sales),"PRESCRIPTION_PATIENT_MISMATCH");
      await rejectsCode(()=>createSale({...draft,patientId:ids.patient,prescriptionId:prescription.id},sales),"PRESCRIPTION_NOT_USABLE");
      const correct = await createSale({...draft,patientId:ids.patient,prescriptionId:replacement.id},sales);
      assert.equal(correct.prescription.id,replacement.id);
    });
    await t.test("POS-08 Mercado Pago no se acredita como abono manual ni se habilita por omitir proveedores",async()=>{
      await rejectsCode(()=>registerSalePayment(quotation.id,{amountCents:1000,paymentMethod:"MERCADO_PAGO"},sales),"INVALID_SALE_DATA");
      assert.equal(await prisma.payment_attempts.count(),0);
      for(const key of ["MERCADO_PAGO_ACCESS_TOKEN","CLOUDINARY_API_SECRET","OPENAI_API_KEY","RESEND_API_KEY"]) assert.equal(process.env[key],"");
    });
  } finally { await prisma.$disconnect(); }
});
