// providers/MapperLanguageProvider.ts

import { vscode } from "@exportLibs";
import { findCallSiteAt, resolveReceiverType, resolveTypeCandidates } from "@exportModels";
import { logger } from "@exportScripts";
import type { JavaMapperType, JavaMethodType, MapperIndexServiceType, XmlMapperType, XmlNamedElementType, XmlStatementType } from "@exportTypes";

const REFERENCE_ATTR_PATTERN = /\b(refid|resultMap|extends)\s*=\s*["']([^"']*)["']/g;
const BINDING_PREFIX_PATTERN = /#\{[\w$]*$/;
const REFID_PREFIX_PATTERN = /\brefid\s*=\s*["'][^"']*$/;
const RESULT_MAP_PREFIX_PATTERN = /\b(?:resultMap|extends)\s*=\s*["'][^"']*$/;
const STATEMENT_ID_PREFIX_PATTERN = /\bid\s*=\s*["'][^"']*$/;

// ------------------------------------------------------------------------------
// 1. Java/XML mapper 언어 기능
// ------------------------------------------------------------------------------
export const MapperLanguageProvider = (indexService: MapperIndexServiceType) => {
  // 1-1. 언어 기능 활성화 여부
  const isEnabled = (): boolean => vscode.workspace.getConfiguration(`Mybatis-Booster`).get<boolean>(`languageFeaturesEnabled`, true);

  // 1-2. 안전한 단일 라인 range 생성
  const lineRange = (document: vscode.TextDocument, line: number): vscode.Range => {
    const safeLine = Math.max(0, Math.min(line, document.lineCount - 1));
    const textLine = document.lineAt(safeLine);
    return new vscode.Range(textLine.range.start, textLine.range.end);
  };

  // 1-3. 파일 위치 생성
  const fileLocation = (fsPath: string, line: number): vscode.Location => new vscode.Location(vscode.Uri.file(fsPath), new vscode.Position(Math.max(0, line), 0));

  // 1-4. 커서 라인 기준 Java 메서드 추정 (역방향 탐색, 배열 복사 없음)
  const findJavaMethod = (javaMapper: JavaMapperType, line: number): JavaMethodType | undefined => {
    for (let i = javaMapper.methods.length - 1; i >= 0; i--) {
      if (javaMapper.methods[i].line <= line) {
        return javaMapper.methods[i];
      }
    }
    return undefined;
  };

  // 1-5. 커서 라인 기준 XML statement 추정 (역방향 탐색, 배열 복사 없음)
  const findXmlStatement = (xmlMapper: XmlMapperType, line: number): XmlStatementType | undefined => {
    for (let i = xmlMapper.statements.length - 1; i >= 0; i--) {
      if (xmlMapper.statements[i].line <= line) {
        return xmlMapper.statements[i];
      }
    }
    return undefined;
  };

  // 1-6. 커서 위치의 refid/resultMap/extends 속성 값 탐지
  const findReferenceAt = (document: vscode.TextDocument, position: vscode.Position): { kind: `include` | `resultMap`; value: string } | undefined => {
    const lineText = document.lineAt(position.line).text;
    const regex = new RegExp(REFERENCE_ATTR_PATTERN.source, `g`);
    for (let match = regex.exec(lineText); match; match = regex.exec(lineText)) {
      const valueStart = match.index + match[0].length - 1 - match[2].length;
      if (position.character >= valueStart && position.character <= valueStart + match[2].length) {
        return { "kind": match[1] === `refid` ? `include` : `resultMap`, "value": match[2] };
      }
    }
    return undefined;
  };

  // 1-7. 참조 대상 위치 해석 (자기 namespace 우선, 그다음 정규화된 교차 namespace)
  const resolveReferenceLocation = (xmlMapper: XmlMapperType, kind: `include` | `resultMap`, value: string): vscode.Location | undefined => {
    const itemsOf = (mapper: XmlMapperType): XmlNamedElementType[] => kind === `include` ? mapper.fragments : mapper.resultMaps;
    const sameNs = indexService.findXmlByNamespace(xmlMapper.namespace);
    const pool = sameNs.length > 0 ? sameNs : [xmlMapper];
    for (const mapper of pool) {
      const item = itemsOf(mapper).find((candidate) => candidate.id === value);
      if (item) {
        return fileLocation(mapper.fsPath, item.line);
      }
    }
    const dot = value.lastIndexOf(`.`);
    if (dot <= 0) {
      return undefined;
    }
    const id = value.slice(dot + 1);
    for (const mapper of indexService.findXmlByNamespace(value.slice(0, dot))) {
      const item = itemsOf(mapper).find((candidate) => candidate.id === id);
      if (item) {
        return fileLocation(mapper.fsPath, item.line);
      }
    }
    return undefined;
  };

  // 1-8. mapper 호출부 해석 (mapper 인터페이스가 아닌 Java 파일 → XML statement)
  const resolveCallSite = (document: vscode.TextDocument, position: vscode.Position): { xmlMapper: XmlMapperType; statement?: XmlStatementType } | undefined => {
    const callSite = findCallSiteAt(document.lineAt(position.line).text, position.character);
    if (!callSite) {
      return undefined;
    }
    const text = document.getText();
    const typeName = resolveReceiverType(text, callSite.receiver);
    if (!typeName) {
      return undefined;
    }
    const namespaces = [...resolveTypeCandidates(text, typeName), ...indexService.findJavaBySimpleName(typeName)];
    for (const namespace of namespaces) {
      const xmlMappers = indexService.findXmlByNamespace(namespace);
      if (xmlMappers.length === 0) {
        continue;
      }
      const found = indexService.findStatementByNamespace(namespace, callSite.method);
      return found ? { "xmlMapper": found.mapper, "statement": found.statement } : { "xmlMapper": xmlMappers[0] };
    }
    return undefined;
  };

  // 2-1. Java -> XML 정의 이동 (mapper 인터페이스가 아니면 호출부 해석 시도)
  const provideJavaDefinition = (document: vscode.TextDocument, position: vscode.Position): vscode.Location[] => {
    const javaMapper = indexService.getJavaMapper(document);
    if (!javaMapper) {
      const resolved = resolveCallSite(document, position);
      if (!resolved) {
        return [];
      }
      logger(`debug`, `definition - call site -> ${resolved.xmlMapper.fsPath}`);
      return [fileLocation(resolved.xmlMapper.fsPath, resolved.statement ? resolved.statement.line : resolved.xmlMapper.namespaceLine)];
    }
    const namespace = `${javaMapper.packageName}.${javaMapper.interfaceName}`;
    const xmlMappers = indexService.findXmlByNamespace(namespace);
    if (xmlMappers.length === 0) {
      return [];
    }
    const method = findJavaMethod(javaMapper, position.line);
    const found = method ? indexService.findStatementByNamespace(namespace, method.name) : undefined;
    logger(`debug`, `definition - java ${namespace} -> ${(found?.mapper ?? xmlMappers[0]).fsPath}`);
    return [found ? fileLocation(found.mapper.fsPath, found.statement.line) : fileLocation(xmlMappers[0].fsPath, xmlMappers[0].namespaceLine)];
  };

  // 2-2. XML -> Java 정의 이동 (refid/resultMap 값 위에서는 해당 정의로 이동)
  const provideXmlDefinition = async (document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location[]> => {
    const xmlMapper = indexService.syncDoc(document);
    if (!xmlMapper) {
      return [];
    }
    const reference = findReferenceAt(document, position);
    if (reference) {
      const location = resolveReferenceLocation(xmlMapper, reference.kind, reference.value);
      return location ? [location] : [];
    }
    const indexed = await indexService.findJavaByNamespace(xmlMapper.namespace);
    if (!indexed) {
      return [];
    }
    const statement = findXmlStatement(xmlMapper, position.line);
    const method = statement ? indexed.mapper.methods.find((item) => item.name === statement.id) : undefined;
    logger(`debug`, `definition - xml ${xmlMapper.namespace} -> ${indexed.uri.fsPath}`);
    return [fileLocation(indexed.uri.fsPath, method ? method.line : indexed.mapper.interfaceLine)];
  };

  // 2-3. Java/XML 정의 공급자
  const definitionProvider: vscode.DefinitionProvider = {
    "provideDefinition": (document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Definition> => {
      if (!isEnabled()) {
        return [];
      }
      return document.languageId === `java` ? provideJavaDefinition(document, position) : provideXmlDefinition(document, position);
    },
  };

  // 2-4. Java/XML 매핑 Hover
  const hoverProvider: vscode.HoverProvider = {
    "provideHover": async (document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> => {
      if (!isEnabled()) {
        return undefined;
      }
      if (document.languageId === `java`) {
        const javaMapper = indexService.getJavaMapper(document);
        if (!javaMapper) {
          const resolved = resolveCallSite(document, position);
          if (!resolved) {
            return undefined;
          }
          const callText = resolved.statement ? `MyBatis XML: \`<${resolved.statement.tag} id="${resolved.statement.id}">\`` : `MyBatis mapper: \`${resolved.xmlMapper.namespace}\``;
          return new vscode.Hover(callText);
        }
        const namespace = `${javaMapper.packageName}.${javaMapper.interfaceName}`;
        const method = findJavaMethod(javaMapper, position.line);
        const statement = method ? indexService.findStatementByNamespace(namespace, method.name)?.statement : undefined;
        const text = statement ? `MyBatis XML: \`<${statement.tag} id="${statement.id}">\`` : `MyBatis namespace: \`${namespace}\``;
        return new vscode.Hover(text);
      }
      const xmlMapper = indexService.syncDoc(document);
      if (!xmlMapper) {
        return undefined;
      }
      const statement = findXmlStatement(xmlMapper, position.line);
      if (!statement) {
        return new vscode.Hover(`MyBatis mapper: \`${xmlMapper.namespace}\``);
      }
      const indexed = await indexService.findJavaByNamespace(xmlMapper.namespace);
      if (!indexed) {
        return new vscode.Hover(`Missing Java mapper: \`${xmlMapper.namespace}\``);
      }
      const method = indexed.mapper.methods.find((item) => item.name === statement.id);
      const text = method ? `Java mapper method: \`${statement.id}()\`` : `Missing Java mapper method: \`${statement.id}()\``;
      return new vscode.Hover(text);
    },
  };

  // 3-1. refid/resultMap id 자동완성 항목 (자기 namespace 풀)
  const buildIdItems = (xmlMapper: XmlMapperType, kind: `include` | `resultMap`): vscode.CompletionItem[] => {
    const itemsOf = (mapper: XmlMapperType): XmlNamedElementType[] => kind === `include` ? mapper.fragments : mapper.resultMaps;
    const sameNs = indexService.findXmlByNamespace(xmlMapper.namespace);
    const pool = sameNs.length > 0 ? sameNs : [xmlMapper];
    const ids = new Set(pool.flatMap((mapper) => itemsOf(mapper).map((item) => item.id)));
    return [...ids].map((id) => {
      const item = new vscode.CompletionItem(id, vscode.CompletionItemKind.Reference);
      item.detail = kind === `include` ? `MyBatis SQL fragment` : `MyBatis resultMap`;
      return item;
    });
  };

  // 3-2. #{} 파라미터 자동완성 항목 (@Param + 로컬 변수)
  const buildBindingItems = async (xmlMapper: XmlMapperType, position: vscode.Position): Promise<vscode.CompletionItem[]> => {
    const statement = findXmlStatement(xmlMapper, position.line);
    if (!statement) {
      return [];
    }
    const indexed = await indexService.findJavaByNamespace(xmlMapper.namespace);
    const method = indexed?.mapper.methods.find((item) => item.name === statement.id);
    const names = new Set([...(method?.paramNames ?? []), ...statement.localVars]);
    return [...names].map((name) => {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Variable);
      item.detail = `MyBatis parameter`;
      return item;
    });
  };

  // 3-3. statement id 자동완성 항목 (미구현 Java 메서드명)
  const buildStatementIdItems = async (xmlMapper: XmlMapperType): Promise<vscode.CompletionItem[]> => {
    const indexed = await indexService.findJavaByNamespace(xmlMapper.namespace);
    if (!indexed) {
      return [];
    }
    const existingIds = new Set(xmlMapper.statements.map((statement) => statement.id));
    return indexed.mapper.methods.filter((method) => !existingIds.has(method.name) && !method.hasSqlAnnotation).map((method) => {
      const item = new vscode.CompletionItem(method.name, vscode.CompletionItemKind.Method);
      item.detail = `MyBatis mapper method`;
      item.insertText = method.name;
      return item;
    });
  };

  // 3-4. XML 컨텍스트별 자동완성 라우팅
  const completionProvider: vscode.CompletionItemProvider = {
    "provideCompletionItems": async (document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[]> => {
      if (!isEnabled()) {
        return [];
      }
      const xmlMapper = indexService.syncDoc(document);
      if (!xmlMapper) {
        return [];
      }
      const prefix = document.lineAt(position.line).text.slice(0, position.character);
      if (BINDING_PREFIX_PATTERN.test(prefix)) {
        return buildBindingItems(xmlMapper, position);
      }
      if (REFID_PREFIX_PATTERN.test(prefix)) {
        return buildIdItems(xmlMapper, `include`);
      }
      if (RESULT_MAP_PREFIX_PATTERN.test(prefix)) {
        return buildIdItems(xmlMapper, `resultMap`);
      }
      if (STATEMENT_ID_PREFIX_PATTERN.test(prefix)) {
        return buildStatementIdItems(xmlMapper);
      }
      return [];
    },
  };

  // 4-1. XML mapper outline 심볼
  const symbolProvider: vscode.DocumentSymbolProvider = {
    "provideDocumentSymbols": (document: vscode.TextDocument): vscode.DocumentSymbol[] => {
      if (!isEnabled()) {
        return [];
      }
      const xmlMapper = indexService.syncDoc(document);
      if (!xmlMapper) {
        return [];
      }
      const mapperSymbol = new vscode.DocumentSymbol(xmlMapper.namespace, `MyBatis mapper`, vscode.SymbolKind.Namespace, lineRange(document, xmlMapper.namespaceLine), lineRange(document, xmlMapper.namespaceLine));
      mapperSymbol.children = [
        ...xmlMapper.resultMaps.map((item) => new vscode.DocumentSymbol(item.id, item.tag, vscode.SymbolKind.Struct, lineRange(document, item.line), lineRange(document, item.line))),
        ...xmlMapper.fragments.map((item) => new vscode.DocumentSymbol(item.id, item.tag, vscode.SymbolKind.Constant, lineRange(document, item.line), lineRange(document, item.line))),
        ...xmlMapper.statements.map((statement) => new vscode.DocumentSymbol(statement.id, statement.tag, vscode.SymbolKind.Method, lineRange(document, statement.line), lineRange(document, statement.line))),
      ];
      return [mapperSymbol];
    },
  };

  // 99. return -----------------------------------------------------------------------------
  return { definitionProvider, hoverProvider, completionProvider, symbolProvider };
};
