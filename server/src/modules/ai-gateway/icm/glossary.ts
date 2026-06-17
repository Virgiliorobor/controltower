// Canonical Spanish glossary terms (from icm_spec/_catalog/customs_glossary_es_en.md), lowercased.
// The Draft Validator uses this to enforce the bilingual-completeness rule: if a captured canonical term is a
// glossary term, BOTH canonical_term_es and canonical_term_en must be stored (data_model_rules check 6).
// This is the code-side bridge of the same glossary the interview prompt carries.

export const GLOSSARY_TERMS: string[] = [
  // Documents
  'pedimento',
  'factura comercial',
  'lista de empaque',
  'packing list',
  'carta porte',
  'cfdi carta porte',
  'certificado de origen',
  'orden de compra',
  'permiso',
  'nom',
  'comprobante de pago',
  'acta de reconocimiento',
  'incidencia',
  'acuse',
  'registro de recepción de mercancía',
  'expediente de importación',
  'encargo conferido',
  // Parties
  'agente aduanal',
  'agencia aduanal',
  'proveedor',
  'transportista',
  'aduana',
  'sat',
  'coordinador de comercio exterior',
  'trade-compliance',
  'recepción',
  'almacén de planta',
  // Concepts
  'fracción arancelaria',
  'régimen',
  'immex',
  'semáforo',
  'semáforo fiscal',
  'mecanismo de selección automatizado',
  'desaduanamiento libre',
  'reconocimiento aduanero',
  'rectificación',
  'modulación',
  'incoterms',
  'igi',
  'dta',
  'iva',
  'tigie',
];
