// exports/ExportTypes.ts

import type { MybatisCommand } from "@exportCommands";
import type { MapperLanguageProvider, MapperLensProvider, SqlDecorationProvider } from "@exportProviders";
import type { MapperIndexService, SqlLogService } from "@exportServices";

// XML statement 태그 ---------------------------------------------------------------
export const STATEMENT_TAGS = [`select`, `insert`, `update`, `delete`] as const;
export type StatementTagType = (typeof STATEMENT_TAGS)[number];

// XML mapper 인터페이스 -------------------------------------------------------------
export interface XmlStatementType {
  id: string;
  tag: StatementTagType;
  line: number;
  column: number;
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
  resultMaps: XmlNamedElementType[];
  statements: XmlStatementType[];
}

// Java mapper 인터페이스 ------------------------------------------------------------
export interface JavaMethodType {
  name: string;
  line: number;
}
export interface JavaMapperType {
  packageName: string;
  interfaceName: string;
  interfaceLine: number;
  hasMapperAnnotation: boolean;
  methods: JavaMethodType[];
}

// commands -----------------------------------------------------------------------
export type MybatisCommandType = ReturnType<typeof MybatisCommand>;

// providers ----------------------------------------------------------------------
export type MapperLanguageProviderType = ReturnType<typeof MapperLanguageProvider>;
export type MapperLensProviderType = ReturnType<typeof MapperLensProvider>;
export type SqlDecoProviderType = ReturnType<typeof SqlDecorationProvider>;

// services -----------------------------------------------------------------------
export type MapperIndexServiceType = ReturnType<typeof MapperIndexService>;
export type SqlLogServiceType = ReturnType<typeof SqlLogService>;
