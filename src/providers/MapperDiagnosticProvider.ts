// providers/MapperDiagnosticProvider.ts

import { vscode } from "@exportLibs";
import { findUnescapedLt } from "@exportModels";
import { logger } from "@exportScripts";
import type { JavaMapperType, JavaMethodType, MapperIndexServiceType, XmlMapperType, XmlReferenceType } from "@exportTypes";

const DIAGNOSTIC_SOURCE = `Mybatis`;
const PARAM_INDEX_PATTERN = /^(?:param|arg)\d+$/;
const DYNAMIC_VALUE_PATTERN = /\$\{/;
const CHAR_LITERAL_PATTERN = /(?:==|!=)\s*'([^'])'(?!\s*\.)|'([^'])'(?!\s*\.)\s*(?:==|!=)/;
const BUILTIN_BINDINGS = new Set([`_parameter`, `_databaseId`]);

interface NamedItemLocation {
  id: string;
  line: number;
  column: number;
}

interface TokenLocation {
  line: number;
  column: number;
  length: number;
}

// ------------------------------------------------------------------------------
// 1. XML mapper 정합성 진단
// ------------------------------------------------------------------------------
export const MapperDiagnosticProvider = (indexService: MapperIndexServiceType) => {
  // 0. 변수 설정 ----------------------------------------------------------------------------
  const collection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);

  // 1-1. 진단 활성화 여부
  const isEnabled = (): boolean => vscode.workspace.getConfiguration(`Mybatis-Booster`).get<boolean>(`languageFeaturesEnabled`, true);

  // 1-2. 진단 생성 헬퍼 (기본 severity 는 Warning, 파싱 실패급은 Error 로 승격)
  const buildDiagnostic = (range: vscode.Range, message: string, code: string, severity: vscode.DiagnosticSeverity = vscode.DiagnosticSeverity.Warning): vscode.Diagnostic => {
    const diagnostic = new vscode.Diagnostic(range, message, severity);
    diagnostic.source = DIAGNOSTIC_SOURCE;
    diagnostic.code = code;
    return diagnostic;
  };

  // 1-2-1. 진단 코드 필터 (diagnosticsEnabled=false 면 전체 억제, disabledDiagnosticCodes 는 코드 제외)
  const filterEnabled = (diagnostics: vscode.Diagnostic[]): vscode.Diagnostic[] => {
    const config = vscode.workspace.getConfiguration(`Mybatis-Booster`);
    if (!config.get<boolean>(`diagnosticsEnabled`, true)) {
      return [];
    }
    const disabled = new Set(config.get<string[]>(`disabledDiagnosticCodes`, []));
    return disabled.size === 0 ? diagnostics : diagnostics.filter((item) => !disabled.has(String(item.code)));
  };

  // 1-3. 요소 시작 라인 range 생성
  const lineRange = (document: vscode.TextDocument, item: { line: number; column: number }): vscode.Range => {
    const safeLine = Math.max(0, Math.min(item.line, document.lineCount - 1));
    const line = document.lineAt(safeLine);
    return line.range.isEmpty ? new vscode.Range(safeLine, item.column, safeLine, item.column + 1) : line.range;
  };

  // 1-4. 토큰 range 생성 (값/바인딩 위치 기반)
  const tokenRange = (document: vscode.TextDocument, item: TokenLocation): vscode.Range => {
    const safeLine = Math.max(0, Math.min(item.line, document.lineCount - 1));
    return new vscode.Range(safeLine, item.column, safeLine, item.column + Math.max(1, item.length));
  };

  // 2-1. 미사용 statement 진단 (Java 메서드 미존재 — 부모 메서드를 볼 수 없는 상속 인터페이스는 오탐 방지차 제외)
  const buildUnusedDiagnostics = (document: vscode.TextDocument, xmlMapper: XmlMapperType, javaMapper: JavaMapperType): vscode.Diagnostic[] => {
    if (javaMapper.hasParent) {
      return [];
    }
    const methods = new Set(javaMapper.methods.map((method) => method.name));
    // resultMap의 중첩 select(association/collection)가 호출하는 statement는 사용 중으로 취급.
    // 참조가 다른 파일에 있어도 잡히도록 인덱스의 교차 파일 역인덱스를 사용함
    return xmlMapper.statements.filter((statement) => !methods.has(statement.id) && !indexService.hasSelectRef(xmlMapper.namespace, statement.id)).map((statement) => buildDiagnostic(
      lineRange(document, statement),
      `Unused MyBatis statement: no Java mapper method '${statement.id}()' found.`,
      `unused-mybatis-statement`,
    ));
  };

  // 2-1-1. XML statement 없는 Java 추상 메서드 진단 (어노테이션 SQL/본문 있는 메서드 제외)
  const buildMissingDiagnostics = (document: vscode.TextDocument, javaMapper: JavaMapperType, xmlMappers: XmlMapperType[]): vscode.Diagnostic[] => {
    const statementIds = new Set(xmlMappers.flatMap((mapper) => mapper.statements.map((statement) => statement.id)));
    return javaMapper.methods.filter((method) => !method.hasSqlAnnotation && !method.hasBody && !statementIds.has(method.name)).map((method) => buildDiagnostic(
      lineRange(document, { "line": method.line, "column": 0 }),
      `Missing MyBatis statement: no XML statement with id '${method.name}' found.`,
      `missing-mybatis-statement`,
    ));
  };

  // 2-1-2. 오버로드 메서드 진단 (MyBatis 는 메서드명으로 매핑해 동명 오버로드를 구분 못 함)
  const buildOverloadedDiagnostics = (document: vscode.TextDocument, javaMapper: JavaMapperType): vscode.Diagnostic[] => {
    const byName = new Map<string, JavaMethodType[]>();
    for (const method of javaMapper.methods) {
      const list = byName.get(method.name) ?? [];
      list.push(method);
      byName.set(method.name, list);
    }
    const diagnostics: vscode.Diagnostic[] = [];
    for (const sameName of byName.values()) {
      if (sameName.length < 2) {
        continue;
      }
      for (const method of sameName) {
        diagnostics.push(buildDiagnostic(
          lineRange(document, { "line": method.line, "column": 0 }),
          `Overloaded mapper method '${method.name}()': MyBatis maps statements by method name and cannot distinguish overloads.`,
          `mybatis-overloaded-method`,
        ));
      }
    }
    return diagnostics;
  };

  // 2-2. 중복 id 그룹 수집 헬퍼
  const pushDuplicates = <T extends NamedItemLocation>(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[], label: string, items: T[], keyOf: (item: T) => string): void => {
    const byKey = new Map<string, T[]>();
    for (const item of items) {
      const key = keyOf(item);
      const list = byKey.get(key) ?? [];
      list.push(item);
      byKey.set(key, list);
    }
    for (const sameKeyItems of byKey.values()) {
      if (sameKeyItems.length < 2) {
        continue;
      }
      for (const item of sameKeyItems) {
        diagnostics.push(buildDiagnostic(lineRange(document, item), `Duplicate ${label} id '${item.id}' in this mapper.`, `duplicate-mybatis-id`));
      }
    }
  };

  // 2-2-1. 중복 id 진단 (statement는 databaseId 변형을 합법 케이스로 허용, 동일 파일 내)
  const buildDuplicateDiagnostics = (document: vscode.TextDocument, xmlMapper: XmlMapperType): vscode.Diagnostic[] => {
    const diagnostics: vscode.Diagnostic[] = [];
    pushDuplicates(document, diagnostics, `statement`, xmlMapper.statements, (item) => JSON.stringify([item.id, item.databaseId]));
    pushDuplicates(document, diagnostics, `resultMap`, xmlMapper.resultMaps, (item) => item.id);
    pushDuplicates(document, diagnostics, `sql fragment`, xmlMapper.fragments, (item) => item.id);
    return diagnostics;
  };

  // 2-3. refid/resultMap 참조 해석 (자기 namespace 우선, 그다음 정규화된 교차 namespace)
  const resolveReference = (xmlMapper: XmlMapperType, reference: XmlReferenceType): boolean => {
    const itemsOf = (mapper: XmlMapperType) => reference.kind === `include` ? mapper.fragments : mapper.resultMaps;
    const sameNs = indexService.findXmlByNamespace(xmlMapper.namespace);
    const pool = sameNs.length > 0 ? sameNs : [xmlMapper];
    if (pool.some((mapper) => itemsOf(mapper).some((item) => item.id === reference.value))) {
      return true;
    }
    const dot = reference.value.lastIndexOf(`.`);
    if (dot <= 0) {
      return false;
    }
    const namespace = reference.value.slice(0, dot);
    const id = reference.value.slice(dot + 1);
    return indexService.findXmlByNamespace(namespace).some((mapper) => itemsOf(mapper).some((item) => item.id === id));
  };

  // 2-4. 미존재 참조 진단 (동적 참조 ${}는 해석 불가 → 검증 제외)
  const buildReferenceDiagnostics = (document: vscode.TextDocument, xmlMapper: XmlMapperType): vscode.Diagnostic[] => {
    const diagnostics: vscode.Diagnostic[] = [];
    for (const reference of xmlMapper.references) {
      if (DYNAMIC_VALUE_PATTERN.test(reference.value) || resolveReference(xmlMapper, reference)) {
        continue;
      }
      const message = reference.kind === `include` ? `Unknown SQL fragment: '${reference.value}'.` : `Unknown resultMap: '${reference.value}'.`;
      diagnostics.push(buildDiagnostic(tokenRange(document, reference), message, `unknown-mybatis-reference`));
    }
    return diagnostics;
  };

  // 2-5. #{} 바인딩 검증 (모든 파라미터가 @Param을 가질 때만 — 미지정 파라미터는 속성 접근 규칙을 예측할 수 없어 오탐 방지차 제외)
  const buildBindingDiagnostics = (document: vscode.TextDocument, xmlMapper: XmlMapperType, javaMapper: JavaMapperType): vscode.Diagnostic[] => {
    const diagnostics: vscode.Diagnostic[] = [];
    const methodsByName = new Map(javaMapper.methods.map((method) => [method.name, method]));
    for (const statement of xmlMapper.statements) {
      const method = methodsByName.get(statement.id);
      if (!method?.allParamsNamed) {
        continue;
      }
      const allowed = new Set([...method.paramNames, ...statement.localVars]);
      const available = method.paramNames.length > 0 ? method.paramNames.join(`, `) : `(no parameters)`;
      const isKnownRoot = (root: string): boolean => allowed.has(root) || BUILTIN_BINDINGS.has(root) || PARAM_INDEX_PATTERN.test(root);
      for (const binding of statement.bindings) {
        if (!binding.raw) {
          diagnostics.push(buildDiagnostic(tokenRange(document, binding), `Empty MyBatis binding '#{}'.`, `unknown-mybatis-binding`));
          continue;
        }
        if (!binding.root || isKnownRoot(binding.root)) {
          continue;
        }
        diagnostics.push(buildDiagnostic(tokenRange(document, binding), `Unknown MyBatis binding: '${binding.root}'. Available parameters: ${available}.`, `unknown-mybatis-binding`));
      }
      for (const collection of statement.collections) {
        if (!collection.root || DYNAMIC_VALUE_PATTERN.test(collection.raw) || isKnownRoot(collection.root)) {
          continue;
        }
        diagnostics.push(buildDiagnostic(tokenRange(document, collection), `Unknown foreach collection: '${collection.root}'. Available parameters: ${available}.`, `unknown-mybatis-binding`));
      }
    }
    return diagnostics;
  };

  // 2-5-1. <if test> OGNL 단일문자 리터럴 비교 진단 (Character는 String과 항상 불일치)
  const buildTestExprDiagnostics = (document: vscode.TextDocument, xmlMapper: XmlMapperType): vscode.Diagnostic[] => {
    const diagnostics: vscode.Diagnostic[] = [];
    for (const testExpr of xmlMapper.testExprs) {
      const match = CHAR_LITERAL_PATTERN.exec(testExpr.value);
      if (!match) {
        continue;
      }
      const literal = match[1] ?? match[2];
      diagnostics.push(buildDiagnostic(tokenRange(document, testExpr), `OGNL char literal: '${literal}' is a Character, so comparison with a String is always false. Use double quotes, e.g. test='col == "${literal}"'.`, `mybatis-ognl-char-literal`));
    }
    return diagnostics;
  };

  // 2-5-2. update/delete 필터 누락 진단 (WHERE 없이 전체 행 변경 위험)
  const buildMissingWhereDiagnostics = (document: vscode.TextDocument, xmlMapper: XmlMapperType): vscode.Diagnostic[] => xmlMapper.statements.filter((statement) => (statement.tag === `update` || statement.tag === `delete`) && !statement.hasWhere).map((statement) => buildDiagnostic(
    lineRange(document, statement),
    `MyBatis ${statement.tag} '${statement.id}' has no WHERE clause; it affects every row.`,
    `mybatis-missing-where`,
  ));

  // 2-5-3. select 결과 매핑 누락 진단 (resultType/resultMap 둘 다 없음)
  const buildSelectResultDiagnostics = (document: vscode.TextDocument, xmlMapper: XmlMapperType): vscode.Diagnostic[] => xmlMapper.statements.filter((statement) => statement.tag === `select` && !statement.hasResult).map((statement) => buildDiagnostic(
    lineRange(document, statement),
    `MyBatis select '${statement.id}' declares neither resultType nor resultMap.`,
    `mybatis-select-no-result`,
  ));

  // 2-5-4. 이스케이프 누락 '<' 진단 (CDATA 밖 비교 연산자는 XML 파싱 실패 유발)
  const buildUnescapedLtDiagnostics = (document: vscode.TextDocument): vscode.Diagnostic[] => findUnescapedLt(document.getText()).map((item) => buildDiagnostic(
    tokenRange(document, item),
    `Unescaped '<' in mapper XML. Wrap the SQL in <![CDATA[ ... ]]> or write &lt;.`,
    `mybatis-unescaped-lt`,
    vscode.DiagnosticSeverity.Error,
  ));

  // 2-6. namespace 불일치 진단 (동일 interface명이 다른 패키지에 있고, 그 후보가 아직
  // 자기 XML mapper를 갖지 않을 때만 — 이미 짝이 맞은 후보/XML 전용 mapper 오탐 방지)
  const buildNamespaceDiagnostics = (document: vscode.TextDocument, xmlMapper: XmlMapperType): vscode.Diagnostic[] => {
    const simpleName = xmlMapper.namespace.split(`.`).at(-1) ?? ``;
    const named = simpleName ? indexService.findJavaBySimpleName(simpleName) : [];
    const candidates = named.filter((namespace) => indexService.findXmlByNamespace(namespace).length === 0);
    if (candidates.length === 0) {
      return [];
    }
    const range = lineRange(document, { "line": xmlMapper.namespaceLine, "column": 0 });
    return [buildDiagnostic(range, `Namespace '${xmlMapper.namespace}' does not match any Java mapper interface. Did you mean '${candidates[0]}'?`, `mybatis-namespace-mismatch`)];
  };

  // 3-0. Java mapper 문서 진단 적용 (동일 namespace의 XML mapper가 있을 때만 — 일반 인터페이스 오탐 방지)
  const applyJava = (document: vscode.TextDocument): void => {
    if (!isEnabled()) {
      collection.delete(document.uri);
      return;
    }
    const javaMapper = indexService.getJavaMapper(document);
    if (!javaMapper) {
      collection.delete(document.uri);
      return;
    }
    const namespace = `${javaMapper.packageName}.${javaMapper.interfaceName}`;
    const xmlMappers = indexService.findXmlByNamespace(namespace);
    if (xmlMappers.length === 0) {
      collection.delete(document.uri);
      return;
    }
    const diagnostics = [
      ...buildMissingDiagnostics(document, javaMapper, xmlMappers),
      ...buildOverloadedDiagnostics(document, javaMapper),
    ];
    collection.set(document.uri, filterEnabled(diagnostics));
    logger(`debug`, `diagnostic - ${diagnostics.length} java issues in ${document.uri.fsPath}`);
  };

  // 3-1. XML/Java 문서 진단 라우팅
  const apply = async (document?: vscode.TextDocument): Promise<void> => {
    const target = document ?? vscode.window.activeTextEditor?.document;
    if (target?.languageId === `java`) {
      applyJava(target);
      return;
    }
    if (target?.languageId !== `xml`) {
      return;
    }
    if (!isEnabled()) {
      collection.delete(target.uri);
      return;
    }
    const xmlMapper = indexService.syncDoc(target);
    if (!xmlMapper) {
      collection.delete(target.uri);
      return;
    }
    const startVersion = target.version;
    const diagnostics: vscode.Diagnostic[] = [
      ...buildDuplicateDiagnostics(target, xmlMapper),
      ...buildReferenceDiagnostics(target, xmlMapper),
      ...buildTestExprDiagnostics(target, xmlMapper),
      ...buildMissingWhereDiagnostics(target, xmlMapper),
      ...buildSelectResultDiagnostics(target, xmlMapper),
      ...buildUnescapedLtDiagnostics(target),
    ];
    const indexed = await indexService.findJavaByNamespace(xmlMapper.namespace);
    if (target.isClosed || target.version !== startVersion) {
      return;
    }
    if (indexed) {
      diagnostics.push(...buildUnusedDiagnostics(target, xmlMapper, indexed.mapper));
      diagnostics.push(...buildBindingDiagnostics(target, xmlMapper, indexed.mapper));
    }
    else {
      diagnostics.push(...buildNamespaceDiagnostics(target, xmlMapper));
    }
    collection.set(target.uri, filterEnabled(diagnostics));
    logger(`debug`, `diagnostic - ${diagnostics.length} issues in ${target.uri.fsPath}`);
  };

  // 3-2. 진단 정리
  const clear = (document?: vscode.TextDocument): void => {
    const target = document ?? vscode.window.activeTextEditor?.document;
    target ? collection.delete(target.uri) : collection.clear();
  };

  // 3-3. 열린 XML/Java 문서 전체 진단 적용
  const applyOpenDocuments = async (): Promise<void> => {
    const documents = vscode.workspace.textDocuments.filter((document) => document.languageId === `xml` || document.languageId === `java`);
    await Promise.all(documents.map((document) => apply(document)));
  };

  // 3-4. 정리
  const dispose = (): void => collection.dispose();

  // 99. return -----------------------------------------------------------------------------
  return { apply, applyOpenDocuments, clear, dispose };
};
