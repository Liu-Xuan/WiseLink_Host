import type { DocumentSemanticProfile } from '../../../../../../shared/document-semantic-map.interface';

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

/** Any family can retain its author's structure; verified family rules extend this same contract. */
export const GENERIC_SEMANTIC_PROFILE: DocumentSemanticProfile = {
  profileRef: 'generic.author-sections.v1',
  roles: [],
};
