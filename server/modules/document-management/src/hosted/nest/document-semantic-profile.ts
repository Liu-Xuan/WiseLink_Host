import type { DocumentSemanticProfile, DocumentSemanticProfileSelection } from '../../../../../../shared/document-semantic-map.interface';

/** Known peer FTD sections retain a level below document/issue headings; plugin Markdown emphasis is not hierarchy.
 * FTD aliases reused from family-section-topology.builder, without its legacy parser or closure rules. */
export const BOEING_FTD_SEMANTIC_PROFILE: DocumentSemanticProfile = {
  profileRef: 'boeing.ftd.sections.v1',
  roles: [
    ['revision_description', 'Revision Description'],
    ['applicability', 'Applicability'],
    ['description', 'Description'],
    ['background', 'Background'],
    ['status', 'Status'],
    ['interim_action', 'Interim Action'],
    ['final_action', 'Final Action'],
    ['milestones', 'Milestones'],
    ['operator_action', 'Operator Action'],
    ['reference_categories', 'Reference Categories'],
    ['related_categories', 'Related Categories'],
    ['references', 'References'],
    ['attachments', 'Attachments'],
    ['parts_list', 'Parts List'],
    ['part_information', 'Part Information'],
    ['supplier_information', 'Supplier Information'],
    ['affected_documents', 'Affected Documents'],
    ['additional_information', 'Additional Information'],
  ].map(([key, title]) => ({
    roleKey: `ftd.${key}`,
    aliases: [title],
    headingLevel: 2,
  })),
};

/** Explicit Boeing airframe profile; never dispatch every SB into an Airbus-specific parser. */
export const BOEING_AIRFRAME_SB_SEMANTIC_PROFILE: DocumentSemanticProfile = {
  profileRef: 'boeing.airframe-sb.sections.v1',
  roles: [
    ['revision', 'Revision Transmittal Sheet'],
    ['summary', 'Summary'],
    ['planning', 'Planning Information'],
    ['material', 'Material Information'],
    ['accomplishment', 'Accomplishment Instructions'],
    ['appendix', 'Appendix'],
    ['effectivity', 'Effectivity'],
    ['reason', 'Reason'],
    ['compliance', 'Compliance'],
    ['manpower', 'Manpower'],
    ['weight_balance', 'Weight and Balance'],
    ['electrical_load', 'Electrical Load Data'],
    ['references', 'References'],
    ['publication', 'Publications Affected'],
    ['interchangeability', 'Interchangeability of Parts'],
    ['material_requirements', 'Parts Necessary for Each Airplane'],
    ['tooling', 'Special Tooling Necessary to do this Service Bulletin'],
  ].map(([key, title]) => ({ roleKey: `sb.${key}`, aliases: [title] })),
};

/** TFU roles describe observed Airbus support sections, not execution or closure. */
export const AIRBUS_TFU_SEMANTIC_PROFILE: DocumentSemanticProfile = {
  profileRef: 'airbus.tfu.sections.v1',
  roles: [
    ['revision_description', 'Purpose / Reason for revision'],
    ['engineering_support', 'Engineering Support'],
    ['status', 'Status'],
    ['description', 'Description / Operational Impact'],
    ['investigation', 'Root Cause / Investigation'],
    ['interim_action', 'Mitigation / Interim Action'],
    ['terminating_action', 'Terminating Action'],
    ['annex', 'Annex'],
    ['general_information', 'General Information'],
    ['technical_parameters', 'Technical parameters'],
    ['attachments', 'Attachments'],
    ['links', 'Links'],
  ].map(([key, title]) => ({ roleKey: `tfu.${key}`, aliases: [title] })),
};

/** Any family can retain its author's structure; verified family rules extend this same contract. */
export const GENERIC_SEMANTIC_PROFILE: DocumentSemanticProfile = {
  profileRef: 'generic.author-sections.v1',
  roles: [],
};


/** Record the existing INDEX dispatch exactly. Registry inputs can have legacy inferred
 * origins; this selector does not establish document, issuer, or airframe authority.
 * SB remains generic: the registry has no trustworthy airframe-subtype/provenance field.
 * No filename, code, OEM label, heading resemblance, or parser finding may upgrade it. */
export function selectDocumentSemanticProfile(input: {
  registeredFamily: string | null;
  registeredIssuer: string | null;
}): { profile: DocumentSemanticProfile; selection: DocumentSemanticProfileSelection } {
  const { registeredFamily: family, registeredIssuer: issuer } = input;
  if (family === 'TFU' && issuer === 'AIRBUS') {
    return {
      profile: AIRBUS_TFU_SEMANTIC_PROFILE,
      selection: {
        policyVersion: 'registered-airbus-tfu-dispatch.v1', reason: 'REGISTERED_METADATA_TEMPLATE',
        registeredIdentity: { family, issuer }, evidenceSourceRefIds: [],
      },
    };
  }
  const selected = family === 'FTD' && issuer === 'BOEING';
  let reason: DocumentSemanticProfileSelection['reason'];
  if (selected) reason = 'REGISTERED_METADATA_TEMPLATE';
  else if (family === null || !family.trim() || family === 'UNKNOWN') reason = 'UNKNOWN_FAMILY';
  else if (family !== 'FTD' && family !== 'SB') reason = 'UNSUPPORTED_FAMILY';
  else if (issuer === null || !issuer.trim() || issuer === 'UNKNOWN') reason = 'UNKNOWN_ISSUER';
  else if (issuer !== 'BOEING') reason = 'UNSUPPORTED_ISSUER';
  else reason = 'UNSUPPORTED_LAYOUT';
  return {
    profile: selected ? BOEING_FTD_SEMANTIC_PROFILE : GENERIC_SEMANTIC_PROFILE,
    selection: {
      policyVersion: 'registered-metadata-existing-dispatch.v1', reason,
      registeredIdentity: { family, issuer }, evidenceSourceRefIds: [],
    },
  };
}
