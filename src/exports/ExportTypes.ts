// exports/ExportTypes.ts

import type { MybatisCommand } from "@exportCommands";
import type { MapperCodeActionProvider, MapperDiagnosticProvider, MapperLanguageProvider, MapperLensProvider, SqlDecorationProvider } from "@exportProviders";
import type { MapperIndexService, SqlLogService } from "@exportServices";

// XML statement 태그 ---------------------------------------------------------------
export const STATEMENT_TAGS = [`select`, `insert`, `update`, `delete`] as const;
export type StatementTagType = (typeof STATEMENT_TAGS)[number];

// XML mapper 인터페이스 -------------------------------------------------------------
export interface XmlBindingType {
  root: string;
  raw: string;
  line: number;
  column: number;
  length: number;
}
export interface XmlReferenceType {
  kind: `include` | `resultMap`;
  value: string;
  line: number;
  column: number;
  length: number;
}
export interface XmlStatementType {
  id: string;
  tag: StatementTagType;
  line: number;
  endLine: number;
  column: number;
  databaseId: string;
  hasResult: boolean;
  hasWhere: boolean;
  bindings: XmlBindingType[];
  collections: XmlBindingType[];
  localVars: string[];
}
export interface XmlUnescapedLtType {
  line: number;
  column: number;
  length: number;
}
export interface XmlTestExprType {
  value: string;
  line: number;
  column: number;
  length: number;
}
export interface XmlNamedElementType {
  id: string;
  tag: string;
  line: number;
  column: number;
}
export interface XmlMapperType {
  fsPath: string;
  fragments: XmlNamedElementType[];
  namespace: string;
  namespaceLine: number;
  references: XmlReferenceType[];
  resultMaps: XmlNamedElementType[];
  selectRefs: string[];
  statements: XmlStatementType[];
  testExprs: XmlTestExprType[];
}

// Java mapper 인터페이스 ------------------------------------------------------------
export interface JavaMethodType {
  name: string;
  line: number;
  startLine: number;
  endLine: number;
  paramNames: string[];
  paramCount: number;
  allParamsNamed: boolean;
  hasSqlAnnotation: boolean;
  hasBody: boolean;
}
export interface JavaCallSiteType {
  receiver: string;
  method: string;
}
export interface LogStatementRefType {
  simpleName: string;
  methodId: string;
}
export interface JavaMapperType {
  packageName: string;
  interfaceName: string;
  interfaceLine: number;
  hasMapperAnnotation: boolean;
  hasParent: boolean;
  methods: JavaMethodType[];
}

// commands -----------------------------------------------------------------------
export type MybatisCommandType = ReturnType<typeof MybatisCommand>;

// providers ----------------------------------------------------------------------
export type MapperCodeActionProviderType = ReturnType<typeof MapperCodeActionProvider>;
export type MapperDiagnosticProviderType = ReturnType<typeof MapperDiagnosticProvider>;
export type MapperLanguageProviderType = ReturnType<typeof MapperLanguageProvider>;
export type MapperLensProviderType = ReturnType<typeof MapperLensProvider>;
export type SqlDecoProviderType = ReturnType<typeof SqlDecorationProvider>;

// services -----------------------------------------------------------------------
export type MapperIndexServiceType = ReturnType<typeof MapperIndexService>;
export type SqlLogServiceType = ReturnType<typeof SqlLogService>;
