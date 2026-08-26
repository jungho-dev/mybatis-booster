// models/MapperModel.ts

import type { JavaCallSiteType, JavaMapperType, JavaMethodType, LogStatementRefType, StatementTagType, XmlBindingType, XmlMapperType, XmlNamedElementType, XmlReferenceType, XmlStatementType, XmlTestExprType, XmlUnescapedLtType } from "@exportTypes";
import { STATEMENT_TAGS } from "@exportTypes";

const NAMESPACE_PATTERN = /<mapper\s[^>]*?namespace\s*=\s*["']([^"']+)["']/;
const STATEMENT_PATTERN = /<(select|insert|update|delete)\b[^>]*?\bid\s*=\s*["']([^"']+)["']/g;
const RESULT_MAP_PATTERN = /<resultMap\b[^>]*?\bid\s*=\s*["']([^"']+)["']/g;
const SQL_FRAGMENT_PATTERN = /<sql\b[^>]*?\bid\s*=\s*["']([^"']+)["']/g;
const XML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const INCLUDE_REF_PATTERN = /<include\b[^>]*?\brefid\s*=\s*["']([^"']+)["']/g;
const RESULT_MAP_ATTR_PATTERN = /\bresultMap\s*=\s*["']([^"']+)["']/;
const EXTENDS_ATTR_PATTERN = /\bextends\s*=\s*["']([^"']+)["']/;
const BINDING_PATTERN = /#\{([^}]*)\}/g;
const BINDING_ROOT_PATTERN = /^[A-Za-z_$][\w$]*/;
const FOREACH_TAG_PATTERN = /<foreach\b[^>]*>/g;
const BIND_NAME_PATTERN = /<bind\b[^>]*?\bname\s*=\s*["']([^"']+)["']/g;
const ITEM_ATTR_PATTERN = /\bitem\s*=\s*["']([^"']+)["']/;
const INDEX_ATTR_PATTERN = /\bindex\s*=\s*["']([^"']+)["']/;
const COLLECTION_ATTR_PATTERN = /\bcollection\s*=\s*["']([^"']+)["']/;
const DATABASE_ID_ATTR_PATTERN = /\bdatabaseId\s*=\s*["']([^"']+)["']/;
const RESULT_ATTR_PATTERN = /\b(?:resultType|resultMap)\s*=/;
const WHERE_CLAUSE_PATTERN = /<where\b|\bWHERE\b/i;
const NESTED_SELECT_PATTERN = /<(?:association|collection)\b[^>]*?\bselect\s*=\s*["']([^"']+)["']/g;
const TYPED_TOKEN_PATTERN = /\([A-Za-z_$][\w$]*\)\s*$/;
const TEST_ATTR_PATTERN = /<(?:if|when)\b[^>]*?\btest\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const CDATA_PATTERN = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
const INCLUDE_TAG_PATTERN = /<include\b[^>]*?\brefid\s*=\s*["']([^"']+)["'][^>]*?(?:\/>|>[\s\S]*?<\/include>)/g;
const CHOOSE_BLOCK_PATTERN = /<choose\b[^>]*>((?:(?!<choose\b)[\s\S])*?)<\/choose>/;
const WHEN_BLOCK_PATTERN = /<when\b[^>]*>([\s\S]*?)<\/when>/;
const OTHERWISE_BLOCK_PATTERN = /<otherwise\b[^>]*>([\s\S]*?)<\/otherwise>/;
const CONTAINER_TAG_PATTERN = /<(if|when|otherwise|where|set|trim|foreach)\b([^>]*)>((?:(?!<(?:if|when|otherwise|where|set|trim|foreach|choose)\b)[\s\S])*?)<\/\1>/;
const OPEN_ATTR_PATTERN = /\bopen\s*=\s*["']([^"']*)["']/;
const CLOSE_ATTR_PATTERN = /\bclose\s*=\s*["']([^"']*)["']/;
const PREFIX_ATTR_PATTERN = /\bprefix\s*=\s*["']([^"']*)["']/;
const SUFFIX_ATTR_PATTERN = /\bsuffix\s*=\s*["']([^"']*)["']/;
const PREFIX_OVR_PATTERN = /\bprefixOverrides\s*=\s*["']([^"']*)["']/;
const SUFFIX_OVR_PATTERN = /\bsuffixOverrides\s*=\s*["']([^"']*)["']/;
const ESCAPE_REGEX_PATTERN = /[\\^$.*+?()[\]{}|]/g;
const PACKAGE_PATTERN = /^\s*package\s+([\w.]+)\s*;/m;
const INTERFACE_PATTERN = /(?:public\s+)?(?<![@\w$])interface\s+(\w+)/;
const METHOD_PATTERN = /(?:^|[;\r\n])\s*(?:@[\w$.]+(?:\((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^)])*\))?\s*)*(?:(?:public|abstract|default|static|strictfp)\s+)*(?:<[^;{}()]+>\s*)?[\w$][\w$.\s<>,?&[\]]*?(?:\s+|(?<=[>\]]))([\w$]+)\s*\([^;{}]*\)\s*(?:throws\s+[\w$.,\s]+)?\s*(?:;|\{)/g;
const PARAM_ANNOTATION_PATTERN = /@Param\s*\(\s*["']([^"']+)["']\s*\)/;
const SPECIAL_PARAM_PATTERN = /\b(?:RowBounds|ResultHandler)\b/;
const SQL_ANNOTATION_PATTERN = /@(?:Select|Insert|Update|Delete)(?:Provider)?\b/;
const CALL_SITE_PATTERN = /([\w$]+)\s*\.\s*([\w$]+)\s*\(/g;
const WILDCARD_IMPORT_PATTERN = /import\s+([\w.]+)\.\*\s*;/g;
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

// 1-3. 주석 내용을 공백으로 치환 (오프셋 좌표는 유지, 주석 처리된 코드 오탐 방지)
const blankXmlComments = (text: string): string => text.replace(XML_COMMENT_PATTERN, (comment) => ` `.repeat(comment.length));

// 1-4. 속성 매치의 값 시작 오프셋 (매치 끝 - 닫는 따옴표 - 값 길이)
const attrValueOffset = (match: RegExpExecArray): number => match.index + match[0].length - 1 - match[1].length;

// 1-4-1. 닫는 태그 오프셋 (태그명 경계 확인 — </select 가 </selectKey 오인 방지)
const findCloseTagIndex = (text: string, tag: string, from: number): number => {
  const regex = new RegExp(`</${tag}\\s*>`, `g`);
  regex.lastIndex = Math.max(0, from);
  return regex.exec(text)?.index ?? -1;
};

// 1-5. statement 본문 내 #{} 바인딩 수집
const collectBindings = (scanText: string, bodyStart: number, bodyEnd: number, lineStarts: number[]): XmlBindingType[] => {
  const bindings: XmlBindingType[] = [];
  const regex = new RegExp(BINDING_PATTERN.source, `g`);
  regex.lastIndex = bodyStart;
  for (let match = regex.exec(scanText); match && match.index < bodyEnd; match = regex.exec(scanText)) {
    const raw = match[1].trim();
    const root = BINDING_ROOT_PATTERN.exec(raw)?.[0] ?? ``;
    bindings.push({ root, raw, "length": match[0].length, ...offsetToPosition(lineStarts, match.index) });
  }
  return bindings;
};

// 1-6. statement 본문 내 로컬 변수/컴렉션 수집 (foreach item/index/collection, bind name — 중첩 범위는 보수적으로 본문 전체 허용)
const collectStatementVars = (scanText: string, bodyStart: number, bodyEnd: number, lineStarts: number[]): { localVars: string[]; collections: XmlBindingType[] } => {
  const vars = new Set<string>();
  const collections: XmlBindingType[] = [];
  const foreachRegex = new RegExp(FOREACH_TAG_PATTERN.source, `g`);
  foreachRegex.lastIndex = bodyStart;
  for (let match = foreachRegex.exec(scanText); match && match.index < bodyEnd; match = foreachRegex.exec(scanText)) {
    const item = ITEM_ATTR_PATTERN.exec(match[0])?.[1];
    const index = INDEX_ATTR_PATTERN.exec(match[0])?.[1];
    item && vars.add(item);
    index && vars.add(index);
    const collectionAttr = COLLECTION_ATTR_PATTERN.exec(match[0]);
    if (collectionAttr?.[1]) {
      const raw = collectionAttr[1];
      const root = BINDING_ROOT_PATTERN.exec(raw.trim())?.[0] ?? ``;
      const offset = match.index + collectionAttr.index + collectionAttr[0].length - 1 - raw.length;
      collections.push({ root, raw, "length": raw.length, ...offsetToPosition(lineStarts, offset) });
    }
  }
  const bindRegex = new RegExp(BIND_NAME_PATTERN.source, `g`);
  bindRegex.lastIndex = bodyStart;
  for (let match = bindRegex.exec(scanText); match && match.index < bodyEnd; match = bindRegex.exec(scanText)) {
    vars.add(match[1]);
  }
  return { "localVars": [...vars], collections };
};

// 1-7. XML mapper 파싱 (namespace 없으면 mapper 파일이 아님)
export const parseXmlMapper = (fsPath: string, text: string): XmlMapperType | null => {
  const scanText = blankXmlComments(text);
  const namespaceMatch = NAMESPACE_PATTERN.exec(scanText);
  if (!namespaceMatch?.[1]) {
    return null;
  }
  const lineStarts = buildLineStarts(text);
  const statements: XmlStatementType[] = [];
  const resultMaps: XmlNamedElementType[] = [];
  const fragments: XmlNamedElementType[] = [];
  const references: XmlReferenceType[] = [];
  const statementRegex = new RegExp(STATEMENT_PATTERN.source, `g`);
  const resultMapRegex = new RegExp(RESULT_MAP_PATTERN.source, `g`);
  const fragmentRegex = new RegExp(SQL_FRAGMENT_PATTERN.source, `g`);
  const includeRegex = new RegExp(INCLUDE_REF_PATTERN.source, `g`);
  const rawStatements: Array<{ tag: StatementTagType; id: string; index: number }> = [];
  for (let match = statementRegex.exec(scanText); match; match = statementRegex.exec(scanText)) {
    const tag = match[1] as StatementTagType;
    STATEMENT_TAGS.includes(tag) && rawStatements.push({ tag, "id": match[2], "index": match.index });
  }
  rawStatements.forEach((raw, order) => {
    // 닫혀 있지 않은 중간 편집 상태에서 다음 statement 영역을 침범하지 않도록 본문을 상한 처리
    const limit = rawStatements[order + 1]?.index ?? scanText.length;
    const tagEnd = scanText.indexOf(`>`, raw.index);
    const bodyStart = tagEnd < 0 ? limit : Math.min(tagEnd + 1, limit);
    const selfClosing = tagEnd > 0 && scanText[tagEnd - 1] === `/`;
    const closeIndex = selfClosing ? bodyStart : findCloseTagIndex(scanText, raw.tag, bodyStart);
    const bodyEnd = closeIndex < 0 ? limit : Math.min(closeIndex, limit);
    const openTag = scanText.slice(raw.index, bodyStart);
    const bodyEndSafe = Math.max(bodyStart, bodyEnd);
    const statementVars = collectStatementVars(scanText, bodyStart, bodyEndSafe, lineStarts);
    // select 결과 매핑 보유 여부 (resultType/resultMap 속성)
    const hasResult = RESULT_ATTR_PATTERN.test(openTag);
    // update/delete 필터 보유 여부 (정적 WHERE 또는 <where> 동적 절)
    const hasWhere = WHERE_CLAUSE_PATTERN.test(scanText.slice(bodyStart, bodyEndSafe));
    statements.push({
      "id": raw.id,
      "tag": raw.tag,
      ...offsetToPosition(lineStarts, raw.index),
      // 커서 위치가 이 statement 소유인지 판정하기 위한 종료 라인 (닫는 태그 라인)
      "endLine": offsetToPosition(lineStarts, Math.max(raw.index, bodyEndSafe)).line,
      "databaseId": DATABASE_ID_ATTR_PATTERN.exec(openTag)?.[1] ?? ``,
      hasResult,
      hasWhere,
      "bindings": collectBindings(scanText, bodyStart, bodyEndSafe, lineStarts),
      "collections": statementVars.collections,
      "localVars": statementVars.localVars,
    });
    const resultMapAttr = RESULT_MAP_ATTR_PATTERN.exec(openTag);
    if (resultMapAttr?.[1]) {
      const offset = raw.index + resultMapAttr.index + resultMapAttr[0].length - 1 - resultMapAttr[1].length;
      references.push({ "kind": `resultMap`, "value": resultMapAttr[1], "length": resultMapAttr[1].length, ...offsetToPosition(lineStarts, offset) });
    }
  });
  for (let match = resultMapRegex.exec(scanText); match; match = resultMapRegex.exec(scanText)) {
    resultMaps.push({ "id": match[1], "tag": `resultMap`, ...offsetToPosition(lineStarts, match.index) });
    const tagEnd = scanText.indexOf(`>`, match.index);
    const openTag = scanText.slice(match.index, tagEnd < 0 ? scanText.length : tagEnd + 1);
    const extendsAttr = EXTENDS_ATTR_PATTERN.exec(openTag);
    if (extendsAttr?.[1]) {
      const offset = match.index + extendsAttr.index + extendsAttr[0].length - 1 - extendsAttr[1].length;
      references.push({ "kind": `resultMap`, "value": extendsAttr[1], "length": extendsAttr[1].length, ...offsetToPosition(lineStarts, offset) });
    }
  }
  for (let match = fragmentRegex.exec(scanText); match; match = fragmentRegex.exec(scanText)) {
    fragments.push({ "id": match[1], "tag": `sql`, ...offsetToPosition(lineStarts, match.index) });
  }
  for (let match = includeRegex.exec(scanText); match; match = includeRegex.exec(scanText)) {
    references.push({ "kind": `include`, "value": match[1], "length": match[1].length, ...offsetToPosition(lineStarts, attrValueOffset(match)) });
  }
  const testExprs: XmlTestExprType[] = [];
  const testRegex = new RegExp(TEST_ATTR_PATTERN.source, `g`);
  for (let match = testRegex.exec(scanText); match; match = testRegex.exec(scanText)) {
    const value = match[1] ?? match[2] ?? ``;
    const offset = match.index + match[0].length - 1 - value.length;
    testExprs.push({ value, "length": value.length, ...offsetToPosition(lineStarts, offset) });
  }
  const selectRefs: string[] = [];
  const nestedSelectRegex = new RegExp(NESTED_SELECT_PATTERN.source, `g`);
  for (let match = nestedSelectRegex.exec(scanText); match; match = nestedSelectRegex.exec(scanText)) {
    selectRefs.push(match[1]);
  }
  return {
    fsPath,
    fragments,
    "namespace": namespaceMatch[1],
    "namespaceLine": offsetToPosition(lineStarts, namespaceMatch.index).line,
    references,
    resultMaps,
    selectRefs,
    statements,
    testExprs,
  };
};

// 2-0. Java 주석을 공백으로 치환 (문자열/문자 리터럴 보존, 오프셋 좌표 유지 — 주석 처리된 메서드 오탐 방지)
const blankJavaComments = (text: string): string => {
  const chars = text.split(``);
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === `"` || char === `'`) {
      i += 1;
      while (i < text.length && text[i] !== char) {
        i += text[i] === `\\` ? 2 : 1;
      }
      i += 1;
      continue;
    }
    if (char === `/` && text[i + 1] === `/`) {
      while (i < text.length && text[i] !== `\n` && text[i] !== `\r`) {
        chars[i] = ` `;
        i += 1;
      }
      continue;
    }
    if (char === `/` && text[i + 1] === `*`) {
      chars[i] = ` `;
      chars[i + 1] = ` `;
      i += 2;
      while (i < text.length && !(text[i] === `*` && text[i + 1] === `/`)) {
        chars[i] = text[i] === `\n` || text[i] === `\r` ? text[i] : ` `;
        i += 1;
      }
      if (i < text.length) {
        chars[i] = ` `;
        chars[i + 1] = ` `;
        i += 2;
      }
      continue;
    }
    i += 1;
  }
  return chars.join(``);
};

// 2-0-1. 문자열/문자 리터럴 내용을 공백으로 치환 (중괄호 짝 계산용)
const blankJavaStrings = (text: string): string => {
  const chars = text.split(``);
  let i = 0;
  while (i < text.length) {
    const quote = text[i];
    if (quote === `"` || quote === `'`) {
      i += 1;
      while (i < text.length && text[i] !== quote) {
        chars[i] = ` `;
        if (text[i] === `\\` && i + 1 < text.length) {
          chars[i + 1] = ` `;
          i += 2;
        }
        else {
          i += 1;
        }
      }
      i += 1;
      continue;
    }
    i += 1;
  }
  return chars.join(``);
};

// 2-0-2. 여는 중괄호부터 짝이 맞는 닫는 중괄호 다음 위치 반환 (default/static 메서드 본문 스킵용)
const skipBraceBlock = (text: string, openIndex: number): number => {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === `{`) {
      depth += 1;
    }
    else if (text[i] === `}`) {
      depth -= 1;
      if (depth === 0) {
        return i + 1;
      }
    }
  }
  return text.length;
};

// 2-0-3. 최상위 interface 선언 탐색 (중첩 타입/문자열 리터럴 오탐 방지)
const findTopLevelInterface = (braceScanText: string): { index: number; name: string; bodyStart: number } | undefined => {
  const regex = new RegExp(INTERFACE_PATTERN.source, `g`);
  let cursor = 0;
  let depth = 0;
  for (let match = regex.exec(braceScanText); match; match = regex.exec(braceScanText)) {
    while (cursor < match.index) {
      const char = braceScanText[cursor];
      if (char === `{`) {
        depth += 1;
      }
      else if (char === `}`) {
        depth -= 1;
      }
      cursor += 1;
    }
    const bodyStart = braceScanText.indexOf(`{`, match.index);
    if (depth === 0 && bodyStart >= 0) {
      return { "index": match.index, "name": match[1], bodyStart };
    }
  }
  return undefined;
};

// 2-1. 메서드 파라미터 파싱 (@Param 이름, 특수 파라미터 제외)
const parseMethodParams = (methodText: string, nameEnd: number): Pick<JavaMethodType, `paramNames` | `paramCount` | `allParamsNamed`> => {
  const unparsed = { "paramNames": [] as string[], "paramCount": 0, "allParamsNamed": false };
  const open = methodText.indexOf(`(`, nameEnd);
  if (open < 0 || /\S/.test(methodText.slice(nameEnd, open))) {
    return unparsed;
  }
  let depth = 0;
  let close = -1;
  for (let i = open; i < methodText.length; i++) {
    const char = methodText[i];
    if (char === `(`) {
      depth += 1;
    }
    else if (char === `)`) {
      depth -= 1;
    }
    if (depth === 0) {
      close = i;
      break;
    }
  }
  if (close < 0) {
    return unparsed;
  }
  const paramsText = methodText.slice(open + 1, close).trim();
  if (!paramsText) {
    return { "paramNames": [], "paramCount": 0, "allParamsNamed": true };
  }
  const segments: string[] = [];
  let segDepth = 0;
  let segStart = 0;
  for (let i = 0; i < paramsText.length; i++) {
    const char = paramsText[i];
    if (char === `(` || char === `<` || char === `[`) {
      segDepth += 1;
    }
    else if (char === `)` || char === `>` || char === `]`) {
      segDepth -= 1;
    }
    if (char === `,` && segDepth === 0) {
      segments.push(paramsText.slice(segStart, i));
      segStart = i + 1;
    }
  }
  segments.push(paramsText.slice(segStart));
  const paramNames: string[] = [];
  let paramCount = 0;
  let allParamsNamed = true;
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed || SPECIAL_PARAM_PATTERN.test(trimmed)) {
      continue;
    }
    paramCount += 1;
    const named = PARAM_ANNOTATION_PATTERN.exec(trimmed);
    if (named?.[1]) {
      paramNames.push(named[1]);
    }
    else {
      allParamsNamed = false;
    }
  }
  return { paramNames, paramCount, allParamsNamed };
};

// 2-2. Java mapper 인터페이스 파싱 (최상위 interface 본문 한정, 주석/문자열 블랭킹 후 스캔)
export const parseJavaMapper = (text: string): JavaMapperType | null => {
  const scanText = blankJavaComments(text);
  const braceScanText = blankJavaStrings(scanText);
  const packageMatch = PACKAGE_PATTERN.exec(braceScanText);
  const declared = findTopLevelInterface(braceScanText);
  if (!packageMatch?.[1] || !declared) {
    return null;
  }
  const lineStarts = buildLineStarts(text);
  const bodyStart = declared.bodyStart;
  // 인터페이스 닫는 중괄호까지로 본문을 한정 — 파일 뒤쪽 타입의 메서드 오수집 방지
  const bodyEnd = skipBraceBlock(braceScanText, bodyStart);
  const body = scanText.slice(bodyStart, bodyEnd);
  const braceScanBody = braceScanText.slice(bodyStart, bodyEnd);
  const declText = scanText.slice(declared.index, bodyStart);
  const methods: JavaMethodType[] = [];
  const methodRegex = new RegExp(METHOD_PATTERN.source, `gd`);
  // 멤버 경계(depth 1의 ; }) 와 중괄호 깊이를 단일 순차 스캔으로 추적
  const boundaries = [0];
  let scanCursor = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  const advanceTo = (offset: number): void => {
    while (scanCursor < offset) {
      const char = braceScanBody[scanCursor];
      scanCursor += 1;
      if (char === `(`) {
        parenDepth += 1;
        continue;
      }
      if (char === `)`) {
        parenDepth -= 1;
        continue;
      }
      if (parenDepth > 0) {
        continue;
      }
      if (char === `{`) {
        braceDepth += 1;
        continue;
      }
      if (char === `}`) {
        braceDepth -= 1;
        braceDepth === 1 && boundaries.push(scanCursor - 1);
        continue;
      }
      char === `;` && braceDepth === 1 && boundaries.push(scanCursor - 1);
    }
  };
  for (let match = methodRegex.exec(body); match; match = methodRegex.exec(body)) {
    const name = match[1];
    const hasBody = match[0].endsWith(`{`);
    const nameStart = match.indices?.[1]?.[0] ?? match.index + match[0].lastIndexOf(name);
    const nameIndex = nameStart - match.index;
    // 본문 내부 문장(throw/위임 호출 등)을 메서드로 오인하지 않도록 중괄호 짝까지 스킵
    const declEnd = hasBody ? skipBraceBlock(braceScanBody, methodRegex.lastIndex - 1) : match.index + match[0].length;
    if (hasBody) {
      methodRegex.lastIndex = declEnd;
    }
    advanceTo(nameStart);
    // depth 1이 아니면 중첩 타입 멤버이므로 mapper 메서드가 아님
    if (braceDepth !== 1 || JAVA_RESERVED.has(name)) {
      continue;
    }
    // 어노테이션 구간은 직전 멤버 경계까지 — 중첩 괄호 어노테이션에서도 @Select 유실 없음
    const declStart = boundaries.at(-1) ?? 0;
    const annotations = braceScanBody.slice(declStart + 1, nameStart);
    const leading = annotations.length - annotations.trimStart().length;
    methods.push({
      name,
      "line": offsetToPosition(lineStarts, bodyStart + nameStart).line,
      "startLine": offsetToPosition(lineStarts, bodyStart + declStart + 1 + leading).line,
      "endLine": offsetToPosition(lineStarts, bodyStart + Math.max(nameStart, declEnd - 1)).line,
      "hasSqlAnnotation": SQL_ANNOTATION_PATTERN.test(annotations),
      hasBody,
      ...parseMethodParams(match[0], nameIndex + name.length),
    });
  }
  return {
    "packageName": packageMatch[1],
    "interfaceName": declared.name,
    "interfaceLine": offsetToPosition(lineStarts, declared.index).line,
    "hasMapperAnnotation": ANNOTATION_PATTERN.test(braceScanText.slice(0, bodyStart)),
    "hasParent": /\bextends\b/.test(stripGenericSections(declText)),
    methods,
  };
};

// 2-3. 제네릭 구간 제거 (<T extends X> 바운드를 상속으로 오인하지 않도록)
const stripGenericSections = (declText: string): string => {
  let stripped = declText;
  for (let guard = 0; guard < 5 && stripped.includes(`<`); guard++) {
    stripped = stripped.replace(/<[^<>]*>/g, ``);
  }
  return stripped;
};

// 3-1. 커서 위치의 mapper 호출식 탐지 (receiver.method( 형태)
export const findCallSiteAt = (lineText: string, character: number): JavaCallSiteType | undefined => {
  const regex = new RegExp(CALL_SITE_PATTERN.source, `g`);
  for (let match = regex.exec(lineText); match; match = regex.exec(lineText)) {
    if (character >= match.index && character <= match.index + match[0].length) {
      return { "receiver": match[1], "method": match[2] };
    }
  }
  return undefined;
};

// 3-2. 리시버 식별자의 선언 타입 해석 (호출 지점 직전 선언 우선 — 지역 변수 섀도잉 반영)
export const resolveReceiverType = (text: string, receiver: string, beforeOffset?: number): string | undefined => {
  const declRegex = new RegExp(`\\b([A-Z][\\w$]*)(?:<[^;{}()=]*>)?\\s+${receiver}\\s*[;=,)]`, `g`);
  const scanText = blankJavaComments(text);
  let first: string | undefined;
  let nearest: string | undefined;
  for (let match = declRegex.exec(scanText); match; match = declRegex.exec(scanText)) {
    first = first ?? match[1];
    if (beforeOffset === undefined || match.index >= beforeOffset) {
      break;
    }
    nearest = match[1];
  }
  return nearest ?? first;
};

// 3-3. 타입 단순명 -> FQCN 후보 (명시 import > 동일 패키지 > 와일드카드 import 순)
export const resolveTypeCandidates = (text: string, typeName: string): string[] => {
  const candidates: string[] = [];
  // 주석 처리된 import 를 후보로 올리지 않도록 블랭킹 후 스캔
  const scanText = blankJavaComments(text);
  const explicit = new RegExp(`import\\s+([\\w.]+)\\.${typeName}\\s*;`).exec(scanText)?.[1];
  explicit && candidates.push(`${explicit}.${typeName}`);
  const packageName = PACKAGE_PATTERN.exec(scanText)?.[1];
  packageName && candidates.push(`${packageName}.${typeName}`);
  const wildcardRegex = new RegExp(WILDCARD_IMPORT_PATTERN.source, `g`);
  for (let match = wildcardRegex.exec(scanText); match; match = wildcardRegex.exec(scanText)) {
    candidates.push(`${match[1]}.${typeName}`);
  }
  return [...new Set(candidates)];
};

// 4-1. 정규식 메타문자 이스케이프
const escapeRegex = (value: string): string => value.replace(ESCAPE_REGEX_PATTERN, `\\$&`);

// 4-2. 문서 텍스트에서 statement 원문 XML 추출
export const extractStatementXml = (text: string, statementId: string, tag: StatementTagType): string | undefined => {
  const scanText = blankXmlComments(text);
  const openRegex = new RegExp(`<${tag}\\b[^>]*?\\bid\\s*=\\s*["']${escapeRegex(statementId)}["']`);
  const match = openRegex.exec(scanText);
  if (!match) {
    return undefined;
  }
  const tagEnd = scanText.indexOf(`>`, match.index);
  if (tagEnd < 0) {
    return undefined;
  }
  if (scanText[tagEnd - 1] === `/`) {
    return text.slice(match.index, tagEnd + 1);
  }
  const closeIndex = findCloseTagIndex(scanText, tag, tagEnd + 1);
  if (closeIndex < 0) {
    return undefined;
  }
  const closeEnd = scanText.indexOf(`>`, closeIndex);
  return text.slice(match.index, closeEnd < 0 ? scanText.length : closeEnd + 1);
};

// 4-3. 문서 텍스트에서 sql fragment 본문 추출
export const extractSqlFragment = (text: string, fragmentId: string): string | undefined => {
  const scanText = blankXmlComments(text);
  const openRegex = new RegExp(`<sql\\b[^>]*?\\bid\\s*=\\s*["']${escapeRegex(fragmentId)}["']`);
  const match = openRegex.exec(scanText);
  if (!match) {
    return undefined;
  }
  const tagEnd = scanText.indexOf(`>`, match.index);
  if (tagEnd < 0) {
    return undefined;
  }
  if (scanText[tagEnd - 1] === `/`) {
    return ``;
  }
  const closeIndex = findCloseTagIndex(scanText, `sql`, tagEnd + 1);
  return closeIndex < 0 ? undefined : text.slice(tagEnd + 1, closeIndex);
};

// 4-4. 동적 컨테이너 태그 1개 전개 (where/set/trim/foreach 대표 경로)
const renderContainer = (tag: string, attrs: string, content: string): string => {
  const trimmed = content.trim();
  if (tag === `where`) {
    return trimmed ? `WHERE ${trimmed.replace(/^(?:AND|OR)\b\s*/i, ``)}` : ``;
  }
  if (tag === `set`) {
    return trimmed ? `SET ${trimmed.replace(/,\s*$/, ``)}` : ``;
  }
  if (tag === `trim`) {
    const prefix = PREFIX_ATTR_PATTERN.exec(attrs)?.[1] ?? ``;
    const suffix = SUFFIX_ATTR_PATTERN.exec(attrs)?.[1] ?? ``;
    const prefixOvr = PREFIX_OVR_PATTERN.exec(attrs)?.[1];
    const suffixOvr = SUFFIX_OVR_PATTERN.exec(attrs)?.[1];
    let body = trimmed;
    if (prefixOvr) {
      body = body.replace(new RegExp(`^(?:${prefixOvr.split(`|`).map((piece) => escapeRegex(piece.trim())).join(`|`)})\\s*`, `i`), ``);
    }
    if (suffixOvr) {
      body = body.replace(new RegExp(`\\s*(?:${suffixOvr.split(`|`).map((piece) => escapeRegex(piece.trim())).join(`|`)})$`, `i`), ``);
    }
    return body ? `${prefix} ${body} ${suffix}`.trim() : ``;
  }
  if (tag === `foreach`) {
    const open = OPEN_ATTR_PATTERN.exec(attrs)?.[1] ?? ``;
    const close = CLOSE_ATTR_PATTERN.exec(attrs)?.[1] ?? ``;
    return `${open}${trimmed}${close}`;
  }
  return content;
};

// 4-5. statement XML -> 미리보기 SQL 렌더링 (동적 태그를 대표 경로로 전개, choose는 첫 분기)
export const renderPreviewSql = (statementXml: string, fragments: Map<string, string>): string => {
  let sql = blankXmlComments(statementXml);
  sql = sql.replace(new RegExp(CDATA_PATTERN.source, `g`), `$1`);
  const openEnd = sql.indexOf(`>`);
  const closeStart = sql.lastIndexOf(`</`);
  if (openEnd >= 0 && closeStart > openEnd) {
    sql = sql.slice(openEnd + 1, closeStart);
  }
  else if (openEnd >= 0) {
    sql = ``;
  }
  for (let depth = 0; depth < 5; depth++) {
    let replaced = false;
    sql = sql.replace(new RegExp(INCLUDE_TAG_PATTERN.source, `g`), (_whole, refid: string) => {
      replaced = true;
      return fragments.get(refid) ?? fragments.get(refid.split(`.`).at(-1) ?? refid) ?? ``;
    });
    if (!replaced) {
      break;
    }
  }
  for (const tag of [`bind`, `selectKey`]) {
    sql = sql.replace(new RegExp(`<${tag}\\b[^>]*/>`, `g`), ``);
    sql = sql.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, `g`), ``);
  }
  for (let guard = 0; guard < 50; guard++) {
    const chooseMatch = new RegExp(CHOOSE_BLOCK_PATTERN.source).exec(sql);
    if (!chooseMatch) {
      break;
    }
    const inner = chooseMatch[1];
    const branch = new RegExp(WHEN_BLOCK_PATTERN.source).exec(inner)?.[1] ?? new RegExp(OTHERWISE_BLOCK_PATTERN.source).exec(inner)?.[1] ?? ``;
    sql = sql.slice(0, chooseMatch.index) + branch + sql.slice(chooseMatch.index + chooseMatch[0].length);
  }
  for (let guard = 0; guard < 200; guard++) {
    const match = new RegExp(CONTAINER_TAG_PATTERN.source).exec(sql);
    if (!match) {
      break;
    }
    sql = sql.slice(0, match.index) + renderContainer(match[1], match[2], match[3]) + sql.slice(match.index + match[0].length);
  }
  sql = sql.replace(/<[^>]*>/g, ` `);
  sql = sql.replaceAll(`&lt;`, `<`).replaceAll(`&gt;`, `>`).replaceAll(`&quot;`, `"`).replaceAll(`&apos;`, `'`).replaceAll(`&amp;`, `&`);
  const lines = sql.split(/\r?\n/).map((line) => line.trimEnd());
  const compact: string[] = [];
  for (const line of lines) {
    if (line.trim() === `` && (compact.length === 0 || compact.at(-1)?.trim() === ``)) {
      continue;
    }
    compact.push(line);
  }
  return compact.join(`\n`).trim();
};

// 4-6. Parameters 라인 토큰 분리 (값 내부 콤마를 타입 접미사 경계 기준으로 병합)
export const splitLogParamTokens = (raw: string): string[] => {
  const tokens: string[] = [];
  let current = ``;
  for (const piece of raw.split(`,`)) {
    current = current ? `${current},${piece}` : piece;
    const trimmed = current.trim();
    if (trimmed === `null` || TYPED_TOKEN_PATTERN.test(trimmed)) {
      tokens.push(current);
      current = ``;
    }
  }
  current.trim() && tokens.push(current);
  return tokens;
};

// 4-7. MyBatis 로그의 Preparing 라인에서 로거명 기반 statement 참조 추출 (Class.method 마지막 쌍)
export const findLogStatementRef = (logText: string): LogStatementRefType | undefined => {
  const line = logText.split(/\r?\n/).find((candidate) => candidate.includes(`Preparing:`));
  if (!line) {
    return undefined;
  }
  const head = line.slice(0, line.indexOf(`Preparing:`));
  const refRegex = /([A-Z][\w$]*)\.([A-Za-z][\w$]*)\b/g;
  let last: LogStatementRefType | undefined;
  for (let match = refRegex.exec(head); match; match = refRegex.exec(head)) {
    last = { "simpleName": match[1], "methodId": match[2] };
  }
  return last;
};

// 5-1. CDATA 구간 공백 치환 (오프셋 좌표 유지, 내부 '<' 오탐 방지)
const blankCdataSections = (text: string): string => text.replace(new RegExp(CDATA_PATTERN.source, `g`), (whole) => ` `.repeat(whole.length));

// 5-2. 이스케이프 누락 '<' 위치 수집 (본문의 비교 연산자 '<' 는 XML 파서가 거부)
// - 태그 시작 '<' 은 다음 문자가 letter/'/'/'!'/'?' 이므로 제외
// - 주석/CDATA 는 공백 치환 후 스캔
export const findUnescapedLt = (text: string): XmlUnescapedLtType[] => {
  const scanText = blankCdataSections(blankXmlComments(text));
  const lineStarts = buildLineStarts(text);
  const results: XmlUnescapedLtType[] = [];
  for (let i = 0; i < scanText.length; i++) {
    if (scanText[i] !== `<`) {
      continue;
    }
    const next = scanText[i + 1];
    if (next !== undefined && /[A-Za-z/!?]/.test(next)) {
      continue;
    }
    results.push({
      "length": next === `=` ? 2 : 1,
      ...offsetToPosition(lineStarts, i),
    });
  }
  return results;
};

// 6-0. 로그 변환 상수 (Preparing/Parameters 마커, 숫자형 래퍼 타입)
const LOG_PREPARING = `Preparing:`;
const LOG_PARAMETERS = `Parameters:`;
const LOG_NUMERIC_TYPES = new Set([`Integer`, `Long`, `Short`, `Byte`, `Double`, `Float`, `BigDecimal`, `BigInteger`, `Boolean`]);

// 6-1. 로그 파라미터 토큰 -> SQL 리터럴 (숫자형은 원값, 그 외 따옴표, null 은 NULL)
const logToLiteral = (token: string): string => {
  const trimmed = token.trim();
  if (!trimmed || trimmed === `null`) {
    return `NULL`;
  }
  const typeStart = trimmed.lastIndexOf(`(`);
  const hasType = typeStart > -1 && trimmed.endsWith(`)`);
  const value = hasType ? trimmed.slice(0, typeStart).trim() : trimmed;
  const type = hasType ? trimmed.slice(typeStart + 1, -1).trim() : ``;
  return LOG_NUMERIC_TYPES.has(type) ? value : `'${value.replaceAll(`'`, `''`)}'`;
};

// 6-2. '?' 플레이스홀더 순차 바인딩 (문자열 리터럴 내부 '?' 는 건너뜀)
const bindLogParameters = (sql: string, tokens: string[]): string => {
  let bound = ``;
  let tokenIndex = 0;
  let inString = false;
  for (const char of sql) {
    if (char === `'`) {
      inString = !inString;
      bound += char;
      continue;
    }
    if (char === `?` && !inString) {
      const token = tokens[tokenIndex];
      tokenIndex += 1;
      bound += token === undefined ? `?` : logToLiteral(token);
      continue;
    }
    bound += char;
  }
  return bound;
};

// 6-3. MyBatis 로그 -> SQL 변환 (Preparing/Parameters 쌍마다 처리, 다중 statement 지원)
export const convertMybatisLog = (logText: string): string | null => {
  const lines = logText.split(/\r?\n/);
  const results: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const prepIndex = lines[i].indexOf(LOG_PREPARING);
    if (prepIndex < 0) {
      continue;
    }
    let sql = lines[i].slice(prepIndex + LOG_PREPARING.length).trim();
    // 다음 Preparing 이전의 첫 Parameters 라인만 이 statement 바인딩으로 사용
    let params: string | undefined;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].includes(LOG_PREPARING)) {
        break;
      }
      const paramIndex = lines[j].indexOf(LOG_PARAMETERS);
      if (paramIndex >= 0) {
        params = lines[j].slice(paramIndex + LOG_PARAMETERS.length).trim();
        break;
      }
    }
    if (params) {
      sql = bindLogParameters(sql, splitLogParamTokens(params));
    }
    results.push(sql);
  }
  return results.length > 0 ? results.join(`;\n\n`) : null;
};
