// The 12-step INFERRED cross-border IMMEX import (MX←US) process, encoded from process_map.md.
// EVERY step ships with confidence=INFERRED — this is a domain-derived hypothesis built to be CORRECTED by a
// real operator (that correction is the product's intended use). The seed marks the process status=draft.
// Handoffs encode the real structure: the Step 8 semáforo BRANCH (verde→10 / rojo→9) and the Step 6→5 rework LOOP.

import type { Classification, DocFormat, DocType, HandoffKind, PartyKind, StepType } from '@prisma/client';

export interface SeedParty {
  key: string;
  name: string;
  role: string;
  party_kind: PartyKind;
  organization?: string;
  key_person_risk?: boolean;
  notes_es?: string;
}

export interface SeedStep {
  sequence_index: number;
  title_es: string;
  title_en: string;
  description_es: string;
  trigger_es: string;
  action_es: string;
  reason_es: string;
  step_type: StepType;
  classification: Classification;
  common_issues_es: string;
  responsible_party_key: string;
  inputs_es: string[];
  outputs_es: string[];
  documents: { name: string; doc_type: DocType; format: DocFormat; canonical_term_es: string; canonical_term_en: string }[];
}

export interface SeedHandoff {
  from_index: number;
  to_index: number;
  kind: HandoffKind;
  condition_es?: string;
  condition_en?: string;
}

export const SEED_PROCESS = {
  title_es: 'Importación IMMEX Transfronteriza (MX ← US)',
  title_en: 'Cross-Border IMMEX Import (MX ← US)',
  description_es:
    'Importación temporal de insumos a México bajo el programa IMMEX, desde la orden de compra al proveedor estadounidense hasta el archivo del expediente de importación. Mapa semilla INFERIDO, por confirmar con un operador real.',
  description_en:
    'Temporary import of inputs into Mexico under the IMMEX program, from the purchase order to the US supplier through to archiving the import file. INFERRED seed map, to be confirmed by a real operator.',
  domain: 'IMMEX import MX←US',
};

export const SEED_PARTIES: SeedParty[] = [
  {
    key: 'coordinador_comex',
    name: 'Coordinador de Comercio Exterior',
    role: 'Coordinador de Comercio Exterior / Foreign-Trade Coordinator',
    party_kind: 'internal_editor',
    organization: 'Planta IMMEX',
    key_person_risk: true,
    notes_es:
      'Concentra el conocimiento por fracción arancelaria y de qué documentos requiere cada importación — riesgo de persona clave.',
  },
  {
    key: 'compras',
    name: 'Compras / Purchasing',
    role: 'Comprador / Buyer',
    party_kind: 'internal_editor',
    organization: 'Planta IMMEX',
  },
  {
    key: 'cumplimiento',
    name: 'Cumplimiento Comercial',
    role: 'Trade Compliance',
    party_kind: 'internal_editor',
    organization: 'Planta IMMEX',
  },
  {
    key: 'recibo',
    name: 'Recibo / Almacén',
    role: 'Receiving / Warehouse',
    party_kind: 'internal_editor',
    organization: 'Planta IMMEX',
  },
  {
    key: 'finanzas',
    name: 'Finanzas (Importador)',
    role: 'Finance — authorizes funds',
    party_kind: 'internal_viewer',
    organization: 'Planta IMMEX',
  },
  {
    key: 'proveedor_us',
    name: 'Proveedor Estadounidense',
    role: 'US Supplier',
    party_kind: 'external',
    organization: 'Proveedor (US)',
    notes_es: 'Parte externa; se almacena nombre/contacto, no es un usuario del sistema.',
  },
  {
    key: 'agente_aduanal',
    name: 'Agente Aduanal',
    role: 'Customs Broker / Agente Aduanal',
    party_kind: 'external',
    organization: 'Agencia aduanal',
    key_person_risk: true,
    notes_es:
      'Presenta el pedimento bajo encargo conferido; clave para resolver incidencias en reconocimiento aduanero.',
  },
  {
    key: 'aduana',
    name: 'Aduana (SAT)',
    role: 'Autoridad aduanera / Customs Authority',
    party_kind: 'external',
    organization: 'SAT / Aduana',
  },
  {
    key: 'transportista',
    name: 'Transportista',
    role: 'Carrier / Transportista',
    party_kind: 'external',
    organization: 'Línea de transporte',
  },
];

export const SEED_STEPS: SeedStep[] = [
  {
    sequence_index: 1,
    title_es: 'Emisión de orden de compra al proveedor extranjero (US)',
    title_en: 'Purchase order issued to foreign (US) supplier',
    description_es: 'El coordinador emite una PO al proveedor estadounidense con cantidad, precio e Incoterms.',
    trigger_es:
      'Se identifica una necesidad de material/producción y el artículo existe en el programa IMMEX con su fracción arancelaria.',
    action_es:
      'El coordinador de comercio exterior o de compras emite la PO al proveedor US especificando cantidad, precio, Incoterms y punto de entrega.',
    reason_es:
      'Establece la transacción comercial sobre la que se construye toda la importación; los términos de la PO determinan valoración, flete y documentos posteriores.',
    step_type: 'DOCUMENTATION',
    classification: 'REPETITIVE',
    common_issues_es:
      'Fracción arancelaria no registrada en el programa IMMEX; Incoterm equivocado genera disputas de flete/valoración.',
    responsible_party_key: 'compras',
    inputs_es: ['Necesidad de material', 'Cotización/catálogo del proveedor', 'Fracción arancelaria aprobada', 'Autorización del programa IMMEX'],
    outputs_es: ['Orden de compra (PO) emitida'],
    documents: [
      { name: 'Orden de Compra', doc_type: 'PurchaseOrder', format: 'PDF', canonical_term_es: 'Orden de compra', canonical_term_en: 'Purchase Order' },
    ],
  },
  {
    sequence_index: 2,
    title_es: 'El proveedor embarca y emite documentos comerciales',
    title_en: 'Supplier ships goods and issues commercial documents',
    description_es: 'El proveedor US produce/surte la mercancía y emite factura comercial y packing list.',
    trigger_es: 'El proveedor recibe y acepta la PO.',
    action_es:
      'El proveedor US produce/surte la mercancía, emite la factura comercial y el packing list, y entrega el embarque al transportista según el Incoterm.',
    reason_es:
      'La factura comercial es la base legal del valor en aduana y la clasificación; el packing list concilia el contenido físico con la factura.',
    step_type: 'TRANSFORMATION',
    classification: 'CRITICAL',
    common_issues_es:
      'Factura sin datos que la aduana requiere (sin fracción, sin país de origen, valores unitarios agregados); packing list que no cuadra con la factura.',
    responsible_party_key: 'proveedor_us',
    inputs_es: ['Orden de compra (PO) emitida'],
    outputs_es: ['Factura comercial', 'Packing list', 'Mercancía en tránsito a la frontera'],
    documents: [
      { name: 'Factura Comercial', doc_type: 'CommercialInvoice', format: 'PDF', canonical_term_es: 'Factura comercial', canonical_term_en: 'Commercial Invoice' },
      { name: 'Packing List', doc_type: 'PackingList', format: 'PDF', canonical_term_es: 'Lista de empaque', canonical_term_en: 'Packing List' },
    ],
  },
  {
    sequence_index: 3,
    title_es: 'Recepción y armado del paquete documental de importación',
    title_en: 'Receive and assemble the import document package',
    description_es: 'El coordinador reúne todos los documentos que la importación requiere en un paquete completo.',
    trigger_es: 'Se reciben factura comercial y packing list del proveedor; el embarque está en movimiento.',
    action_es:
      'El coordinador de comercio exterior arma el paquete: factura, packing list, documento de transporte/carta porte, certificado de origen (si aplica T-MEC) y permisos de regulación no arancelaria (NOMs).',
    reason_es:
      'El despacho aduanero requiere un set documental completo y consistente; armarlo antes de la frontera evita que el embarque se detenga en el cruce.',
    step_type: 'DOCUMENTATION',
    classification: 'REPETITIVE',
    common_issues_es:
      'Falta un permiso o certificado de origen, descubierto recién en la frontera (riesgo de persona clave); versiones de documentos que no coinciden.',
    responsible_party_key: 'coordinador_comex',
    inputs_es: ['Factura comercial', 'Packing list', 'Documento de transporte', 'Requisitos de regulación no arancelaria'],
    outputs_es: ['Paquete documental de importación completo'],
    documents: [
      { name: 'Certificado de Origen / T-MEC', doc_type: 'CertificateOfOrigin', format: 'PDF', canonical_term_es: 'Certificado de origen', canonical_term_en: 'Certificate of Origin' },
      { name: 'Permiso / NOM', doc_type: 'Permit_NOM', format: 'PDF', canonical_term_es: 'Permiso / NOM', canonical_term_en: 'Permit / NOM' },
    ],
  },
  {
    sequence_index: 4,
    title_es: 'Transmisión de instrucciones y documentos al agente aduanal',
    title_en: 'Transmit instructions and documents to the customs broker',
    description_es: 'El coordinador envía el paquete e instrucciones al agente aduanal bajo encargo conferido.',
    trigger_es: 'Paquete documental completo; se conoce el ETA del embarque a la frontera.',
    action_es:
      'El coordinador envía el paquete y las instrucciones de importación al agente aduanal bajo el encargo conferido; confirma el régimen (importación temporal IMMEX) y los datos del programa a citar.',
    reason_es:
      'Por ley el pedimento se presenta vía agente aduanal; es el handoff formal del importador al agente y el punto donde los errores del paquete se vuelven problema de la presentación.',
    step_type: 'COMMUNICATION',
    classification: 'CRITICAL',
    common_issues_es:
      'Régimen citado incorrecto (definitivo vs. temporal) → impuestos erróneos y problema de cumplimiento IMMEX; datos del programa no entregados al agente.',
    responsible_party_key: 'coordinador_comex',
    inputs_es: ['Paquete documental de importación completo', 'Número de programa IMMEX', 'Encargo conferido'],
    outputs_es: ['Agente aduanal instruido con documentos para este embarque'],
    documents: [
      { name: 'Hoja de instrucción de importación', doc_type: 'Other', format: 'PDF', canonical_term_es: 'Instrucción de importación', canonical_term_en: 'Import instruction sheet' },
    ],
  },
  {
    sequence_index: 5,
    title_es: 'El agente clasifica, valora y elabora el pedimento',
    title_en: 'Broker classifies, values, and drafts the pedimento',
    description_es: 'El agente verifica clasificación, valor y régimen, y elabora el pedimento con los montos calculados.',
    trigger_es: 'El agente aduanal recibe instrucciones y documentos.',
    action_es:
      'El agente verifica la fracción arancelaria, el valor en aduana, los ajustes por Incoterm, los impuestos aplicables (IGI) y el tratamiento de IVA bajo el régimen temporal IMMEX; elabora el pedimento.',
    reason_es:
      'El pedimento es EL documento aduanero legal de la importación; debe ser correcto antes del pago y la presentación — transforma documentos comerciales en una declaración legal.',
    step_type: 'TRANSFORMATION',
    classification: 'CRITICAL',
    common_issues_es:
      'Fracción mal clasificada → tasa de impuesto errónea y posible multa; error de valoración; régimen mal capturado; error de transcripción de factura a pedimento.',
    responsible_party_key: 'agente_aduanal',
    inputs_es: ['Paquete documental de importación completo', 'Tarifa TIGIE', 'Datos del programa IMMEX'],
    outputs_es: ['Pedimento elaborado (borrador)'],
    documents: [
      { name: 'Pedimento (borrador)', doc_type: 'Pedimento', format: 'XML', canonical_term_es: 'Pedimento', canonical_term_en: 'Customs declaration (pedimento)' },
    ],
  },
  {
    sequence_index: 6,
    title_es: 'El importador revisa y aprueba el pedimento (bucle de corrección)',
    title_en: 'Importer reviews and approves the draft pedimento (rework loop)',
    description_es: 'El coordinador revisa clasificación, valor y régimen contra los documentos fuente; aprueba o devuelve con correcciones.',
    trigger_es: 'El agente envía el pedimento borrador para confirmación del importador.',
    action_es:
      'El coordinador (o cumplimiento) revisa clasificación, valor, régimen, cantidades y la referencia al programa IMMEX contra los documentos fuente; aprueba para proceder o lo devuelve al agente con correcciones.',
    reason_es:
      'Último punto de control bajo el nombre del importador antes de que la declaración sea legalmente vinculante; el importador carga la responsabilidad de cumplimiento IMMEX aunque el agente presente.',
    step_type: 'VERIFICATION',
    classification: 'CRITICAL',
    common_issues_es:
      'Aprobación de trámite sin revisión real (riesgo de persona clave); errores detectados aquí generan un bucle de regreso al paso 5 y retrasan el cruce.',
    responsible_party_key: 'cumplimiento',
    inputs_es: ['Pedimento elaborado (borrador)', 'Paquete documental de importación completo'],
    outputs_es: ['Pedimento aprobado', 'Solicitud de corrección (si se devuelve)'],
    documents: [
      { name: 'Pedimento (borrador)', doc_type: 'Pedimento', format: 'XML', canonical_term_es: 'Pedimento', canonical_term_en: 'Customs declaration (pedimento)' },
    ],
  },
  {
    sequence_index: 7,
    title_es: 'Pago de contribuciones (modulación / pago del pedimento)',
    title_en: 'Pay duties and taxes (pedimento payment)',
    description_es: 'Se pagan las contribuciones aplicables contra el pedimento y se confirma su validación.',
    trigger_es: 'Pedimento aprobado por el importador.',
    action_es:
      'Se pagan las contribuciones aplicables por el canal bancario/SAT contra el pedimento; se valida y confirma el estatus "pagado". Bajo IMMEX el IGI suele diferirse/exentarse, pero DTA e IVA aplican según la certificación.',
    reason_es:
      'Aduana no libera mercancía contra un pedimento sin pagar/validar; el pago es la compuerta entre una declaración y un cruce.',
    step_type: 'TRANSFORMATION',
    classification: 'AUTOMATABLE',
    common_issues_es:
      'Fondos insuficientes / retraso de autorización detienen el embarque; tratamiento fiscal incorrecto para el nivel de certificación IMMEX.',
    responsible_party_key: 'agente_aduanal',
    inputs_es: ['Pedimento aprobado', 'Autorización de pago', 'Canal de pago bancario/SAT'],
    outputs_es: ['Pedimento pagado y validado'],
    documents: [
      { name: 'Pedimento (pagado)', doc_type: 'Pedimento', format: 'XML', canonical_term_es: 'Pedimento pagado', canonical_term_en: 'Paid pedimento' },
      { name: 'Comprobante de pago', doc_type: 'PaymentReceipt', format: 'PDF', canonical_term_es: 'Comprobante de pago', canonical_term_en: 'Payment receipt' },
    ],
  },
  {
    sequence_index: 8,
    title_es: 'Cruce aduanero y selección: semáforo fiscal (verde / rojo)',
    title_en: 'Customs crossing & selection: green light / red light',
    description_es: 'Se presenta la mercancía a Aduana y el mecanismo de selección automatizado devuelve verde o rojo.',
    trigger_es: 'La mercancía llega al cruce fronterizo con el pedimento pagado presentado.',
    action_es:
      'La mercancía se presenta a Aduana y el mecanismo de selección automatizado (semáforo fiscal) devuelve VERDE — desaduanamiento libre, o ROJO — reconocimiento aduanero.',
    reason_es:
      'La compuerta de control legal que decide si la mercancía se libera de inmediato o se inspecciona; es una bifurcación impulsada por sistema, no un juicio humano.',
    step_type: 'ROUTING',
    classification: 'AUTOMATABLE',
    common_issues_es:
      'Semáforo en rojo con documentos débiles → retraso por inspección y posible hallazgo de discrepancia; transporte mal posicionado en el cruce.',
    responsible_party_key: 'aduana',
    inputs_es: ['Pedimento pagado y validado', 'Mercancía física en el cruce'],
    outputs_es: ['Resultado de selección: verde o rojo'],
    documents: [],
  },
  {
    sequence_index: 9,
    title_es: 'Reconocimiento aduanero (rama de semáforo rojo)',
    title_en: 'Customs inspection (red-light branch only)',
    description_es: 'Aduana inspecciona física y/o documentalmente el embarque; el agente responde a discrepancias.',
    trigger_es: 'Semáforo en rojo devuelto en el paso 8.',
    action_es:
      'Aduana (o la unidad de inspección autorizada) inspecciona física y/o documentalmente el embarque; el agente/importador responde a cualquier discrepancia.',
    reason_es:
      'Verificación de que la mercancía física coincide con la clasificación, el valor, la cantidad y el origen declarados; el punto de auditoría de toda la declaración.',
    step_type: 'VERIFICATION',
    classification: 'CRITICAL',
    common_issues_es:
      'Discrepancia → multas, pedimento de rectificación, retraso; alta dependencia del agente para resolver rápido; mercancía retenida en el recinto.',
    responsible_party_key: 'aduana',
    inputs_es: ['Mercancía física', 'Pedimento pagado y validado', 'Paquete documental de importación completo'],
    outputs_es: ['Embarque liberado tras inspección', 'Acta de incidencia (si aplica)'],
    documents: [
      { name: 'Acta de inspección', doc_type: 'InspectionActa', format: 'PDF', canonical_term_es: 'Acta de reconocimiento', canonical_term_en: 'Inspection record' },
    ],
  },
  {
    sequence_index: 10,
    title_es: 'Liberación y transporte terrestre a la planta IMMEX',
    title_en: 'Release and inland transport to the IMMEX plant',
    description_es: 'El transportista mueve la mercancía liberada del cruce a la planta bajo carta porte.',
    trigger_es: 'Mercancía liberada (semáforo verde, o liberada tras inspección).',
    action_es:
      'El transportista mueve la mercancía liberada del cruce a la planta bajo un documento de transporte (carta porte); el coordinador monitorea el ETA.',
    reason_es:
      'Mueve físicamente la importación liberada a donde se necesita; la carta porte (CFDI carta porte) es el documento de transporte legalmente requerido dentro de México.',
    step_type: 'TRANSFORMATION',
    classification: 'REPETITIVE',
    common_issues_es:
      'Carta porte faltante/incorrecta → detención en carretera; ETA no visible → recepción no preparada; daño en tránsito.',
    responsible_party_key: 'transportista',
    inputs_es: ['Mercancía liberada', 'Carta porte', 'Asignación de transportista'],
    outputs_es: ['Mercancía en tránsito y llegando a la planta'],
    documents: [
      { name: 'Carta Porte / CFDI Carta Porte', doc_type: 'CartaPorte', format: 'XML', canonical_term_es: 'Carta porte', canonical_term_en: 'Bill of lading / Carta Porte' },
    ],
  },
  {
    sequence_index: 11,
    title_es: 'Recepción en planta y conciliación contra documentos',
    title_en: 'Receive goods at the plant and reconcile against documents',
    description_es: 'Recibo verifica cantidad y condición contra packing list y pedimento, y registra lo recibido.',
    trigger_es: 'La mercancía llega al andén de la planta.',
    action_es:
      'Recibo verifica cantidad y condición contra el packing list y el pedimento; registra las cantidades recibidas y reporta cualquier faltante/daño.',
    reason_es:
      'Confirma que la importación declarada es la importación que realmente llegó; la conciliación es el puente al control de inventarios/Anexo 24 (módulo posterior).',
    step_type: 'VERIFICATION',
    classification: 'REPETITIVE',
    common_issues_es:
      'Cantidad recibida ≠ cantidad declarada → discrepancia de inventario y cumplimiento; recibo no conciliado al pedimento específico → trazabilidad rota.',
    responsible_party_key: 'recibo',
    inputs_es: ['Mercancía física', 'Packing list', 'Pedimento pagado y validado', 'Orden de compra (PO) emitida'],
    outputs_es: ['Registro de recepción confirmado'],
    documents: [
      { name: 'Registro de recepción', doc_type: 'GoodsReceipt', format: 'XLS', canonical_term_es: 'Acuse de recibo de mercancía', canonical_term_en: 'Goods-receipt record' },
    ],
  },
  {
    sequence_index: 12,
    title_es: 'Archivo del expediente de importación y registro',
    title_en: 'Archive the import file and record the import',
    description_es: 'El coordinador arma y archiva el expediente completo y registra la importación contra el programa IMMEX.',
    trigger_es: 'Mercancía recibida y conciliada.',
    action_es:
      'El coordinador/cumplimiento arma y archiva el expediente completo (pedimento, factura, packing list, carta porte, certificados/permisos, comprobante de pago) y registra la importación contra el programa IMMEX.',
    reason_es:
      'La ley mexicana exige conservar el expediente completo del pedimento para auditoría (típicamente 5 años); es el paso de documentación que hace defendible la importación y alimenta el inventario IMMEX.',
    step_type: 'DOCUMENTATION',
    classification: 'REPETITIVE',
    common_issues_es:
      'Expediente incompleto descubierto recién en auditoría ("pregúntale a tres personas / enterrado en correos"); expediente no vinculado al número de pedimento → no se puede recuperar.',
    responsible_party_key: 'cumplimiento',
    inputs_es: ['Set documental completo del embarque', 'Registro de recepción confirmado'],
    outputs_es: ['Expediente de importación archivado y recuperable'],
    documents: [
      { name: 'Expediente de importación', doc_type: 'Expediente', format: 'PDF', canonical_term_es: 'Expediente', canonical_term_en: 'Import file' },
    ],
  },
];

// Handoffs: the sequential spine (1→2→…→8), the BRANCH at Step 8 (verde→10 / rojo→9), Step 9→10 after clearance,
// the parallel archiving relationship (11→12 sequential here, archiving is the documentation track), and the
// REWORK LOOP Step 6→5 (corrections returned to the broker).
export const SEED_HANDOFFS: SeedHandoff[] = [
  { from_index: 1, to_index: 2, kind: 'sequential' },
  { from_index: 2, to_index: 3, kind: 'sequential' },
  { from_index: 3, to_index: 4, kind: 'sequential' },
  { from_index: 4, to_index: 5, kind: 'sequential' },
  { from_index: 5, to_index: 6, kind: 'sequential' },
  { from_index: 6, to_index: 5, kind: 'loop', condition_es: 'correcciones → regresa al paso 5', condition_en: 'corrections → return to step 5' },
  { from_index: 6, to_index: 7, kind: 'branch', condition_es: 'aprobado', condition_en: 'approved' },
  { from_index: 7, to_index: 8, kind: 'sequential' },
  { from_index: 8, to_index: 10, kind: 'branch', condition_es: 'VERDE — desaduanamiento libre', condition_en: 'GREEN — free release' },
  { from_index: 8, to_index: 9, kind: 'branch', condition_es: 'ROJO — reconocimiento aduanero', condition_en: 'RED — customs inspection' },
  { from_index: 9, to_index: 10, kind: 'sequential' },
  { from_index: 10, to_index: 11, kind: 'sequential' },
  { from_index: 11, to_index: 12, kind: 'sequential' },
];
