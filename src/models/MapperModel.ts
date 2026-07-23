// models/MapperModel.ts

import type { JavaMapperType, JavaMethodType, StatementTagType, XmlMapperType, XmlNamedElementType, XmlStatementType } from "@exportTypes";
import { STATEMENT_TAGS } from "@exportTypes";

const NAMESPACE_PATTERN = /<mapper\s[^>]*?namespace\s*=\s*["']([^"']+)["']/;
const STATEMENT_PATTERN = /<(select|insert|update|delete)\b[^>]*?\bid\s*=\s*["']([^"']+)["']/g;
const RESULT_MAP_PATTERN = /<resultMap\b[^>]*?\bid\s*=\s*["']([^"']+)["']/g;
const SQL_FRAGMENT_PATTERN = /<sql\b[^>]*?\bid\s*=\s*["']([^"']+)["']/g;
const PACKAGE_PATTERN = /^\s*package\s+([\w.]+)\s*;/m;
const INTERFACE_PATTERN = /(?:public\s+)?interface\s+(\w+)/;
const METHOD_PATTERN = /[\w$<][\w$.<>,\s[\]?]*?\s+([\w$]+)\s*\([^)]*\)\s*(?:throws\s+[\w$.,\s]+)?;/g;
const ANNOTATION_PATTERN = /@Mapper\b/;
const JAVA_RESERVED = new Set([`if`, `while`, `for`, `switch`, `new`, `return`, `super`, `this`]);

// 1-1. 라인 시작 오프셋 테이블 생성
const buildLineStarts = (text: string): number[] => {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    text.charCodeAt(i) === 10 && lineStarts.push(i + 1);
  }
  return lineStarts;
};

// 1-2. 오프셋 -> 0-based 라인/컴럼 변환 (이진 탐색)
const offsetToPosition = (lineStarts: number[], offset: number): { line: number; column: number } => {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (lineStarts[mid] <= offset) {
      low = mid;
    }
    else {
      high = mid - 1;
    }
  }
  return { "line": low, "column": offset - lineStarts[low] };
};

// 1-3. XML mapper 파싱 (namespace 없으면 mapper 파일이 아님)
export const parseXmlMapper = (fsPath: string, text: string): XmlMapperType | null => {
  const namespaceMatch = NAMESPACE_PATTERN.exec(text);
  if (!namespaceMatch?.[1]) {
    return null;
  }
  const lineStarts = buildLineStarts(text);
  const statements: XmlStatementType[] = [];
  const resultMaps: XmlNamedElementType[] = [];
  const fragments: XmlNamedElementType[] = [];
  const statementRegex = new RegExp(STATEMENT_PATTERN.source, `g`);
  const resultMapRegex = new RegExp(RESULT_MAP_PATTERN.source, `g`);
  const fragmentRegex = new RegExp(SQL_FRAGMENT_PATTERN.source, `g`);
  for (let match = statementRegex.exec(text); match; match = statementRegex.exec(text)) {
    const tag = match[1] as StatementTagType;
    STATEMENT_TAGS.includes(tag) && statements.push({ "id": match[2], tag, ...offsetToPosition(lineStarts, match.index) });
  }
  for (let match = resultMapRegex.exec(text); match; match = resultMapRegex.exec(text)) {
    resultMaps.push({ "id": match[1], "tag": `resultMap`, ...offsetToPosition(lineStarts, match.index) });
  }
  for (let match = fragmentRegex.exec(text); match; match = fragmentRegex.exec(text)) {
    fragments.push({ "id": match[1], "tag": `sql`, ...offsetToPosition(lineStarts, match.index) });
  }
  return {
    fsPath,
    fragments,
    "namespace": namespaceMatch[1],
    "namespaceLine": offsetToPosition(lineStarts, namespaceMatch.index).line,
    resultMaps,
    statements,
  };
};

// 1-4. Java mapper 인터페이스 파싱 (경량 정규식 기반)
export const parseJavaMapper = (text: string): JavaMapperType | null => {
  const packageMatch = PACKAGE_PATTERN.exec(text);
  const interfaceMatch = INTERFACE_PATTERN.exec(text);
  if (!packageMatch?.[1] || !interfaceMatch?.[1]) {
    return null;
  }
  const bodyStart = text.indexOf(`{`, interfaceMatch.index);
  if (bodyStart < 0) {
    return null;
  }
  const lineStarts = buildLineStarts(text);
  const body = text.slice(bodyStart);
  const methods: JavaMethodType[] = [];
  const methodRegex = new RegExp(METHOD_PATTERN.source, `g`);
  for (let match = methodRegex.exec(body); match; match = methodRegex.exec(body)) {
    const name = match[1];
    !JAVA_RESERVED.has(name) && methods.push({ name, "line": offsetToPosition(lineStarts, bodyStart + match.index).line });
  }
  return {
    "packageName": packageMatch[1],
    "interfaceName": interfaceMatch[1],
    "interfaceLine": offsetToPosition(lineStarts, interfaceMatch.index).line,
    "hasMapperAnnotation": ANNOTATION_PATTERN.test(text),
    methods,
  };
};
