export { ACTIVITI_TARGET_VERSION, assembleProject, type AssembledProject, type DmnFileInput, type ProcessFileInput, type ProjectFile, type ProjectInput } from './assemble';
export * from './extensions';
export { DEFAULT_MAPPING, MULTI_INSTANCE_USER_TASK_MAPPING, defaultMappingType, wantsDefaultMapping, type MappingHostFacts } from './defaultMappings';
export * from './connectors';
export { diffBpmn, diffExtensions, type BpmnDiffOptions } from './semantic-diff';
export { diffDmn, type DmnDiffOptions } from './dmn/diff';
export { describeDmn, resolveDecisionIn, splitLiterals, type DecisionDescription, type DecisionKind, type DmnDescription, type InputDescription, type OutputDescription, type RuleDescription } from './dmn/describe';
export { feelTypeName, normalizeDmn, type NormalizeChange, type NormalizeOptions, type NormalizeResult } from './dmn/normalize';
export { detectDmnVersion, DMN_NS_13, type DmnVersion } from './dmn/xml';
export { findUnknownFields, FREE, listShapes, RUNTIME_MODEL, RUNTIME_VERSION, stripUnknownFields, unknownFieldWarning, type MapShape, type ObjectShape, type Shape } from './runtime-model';
export { assertBpmnExportable, ExportVerificationError, verifyBpmnXml, type VerifyResult, type Violation, type ViolationCode } from './verify';

export * from './project/kinds';
export * from './project/paths';
export * from './project/model';
export * from './project/templates';
export * from './project/workspace';
export * from './storage';

export * from './import/camunda';
