// providers/MapperLanguageProvider.ts

import { vscode } from "@exportLibs";
import { logger } from "@exportScripts";
import type { JavaMapperType, MapperIndexServiceType, XmlMapperType, XmlStatementType } from "@exportTypes";

// ------------------------------------------------------------------------------
// 1. Java/XML mapper 언어 기능
// ------------------------------------------------------------------------------
export const MapperLanguageProvider = (indexService: MapperIndexServiceType) => {
  // 1-1. 언어 기능 활성화 여부
  const isEnabled = (): boolean => vscode.workspace.getConfiguration(`Mybatis`).get<boolean>(`languageFeaturesEnabled`, true);

  // 1-2. 안전한 단일 라인 range 생성
  const lineRange = (document: vscode.TextDocument, line: number): vscode.Range => {
    const safeLine = Math.max(0, Math.min(line, document.lineCount - 1));
    const textLine = document.lineAt(safeLine);
    return new vscode.Range(textLine.range.start, textLine.range.end);
  };

  // 1-3. 파일 위치 생성
  const fileLocation = (fsPath: string, line: number): vscode.Location => new vscode.Location(vscode.Uri.file(fsPath), new vscode.Position(Math.max(0, line), 0));

  // 1-4. 커서 라인 기준 Java 메서드 추정
  const findJavaMethod = (javaMapper: JavaMapperType, line: number) => [...javaMapper.methods].reverse().find((method) => method.line <= line);

  // 1-5. 커서 라인 기준 XML statement 추정
  const findXmlStatement = (xmlMapper: XmlMapperType, line: number): XmlStatementType | undefined => [...xmlMapper.statements].reverse().find((statement) => statement.line <= line);

  // 2-1. Java -> XML 정의 이동
  const provideJavaDefinition = (document: vscode.TextDocument, position: vscode.Position): vscode.Location[] => {
    const javaMapper = indexService.getJavaMapper(document);
    if (!javaMapper) {
      return [];
    }
    const namespace = `${javaMapper.packageName}.${javaMapper.interfaceName}`;
    const xmlMapper = indexService.findXmlByNamespace(namespace)[0];
    if (!xmlMapper) {
      return [];
    }
    const method = findJavaMethod(javaMapper, position.line);
    const statement = method ? xmlMapper.statements.find((item) => item.id === method.name) : undefined;
    logger(`debug`, `definition - java ${namespace} -> ${xmlMapper.fsPath}`);
    return [fileLocation(xmlMapper.fsPath, statement ? statement.line : xmlMapper.namespaceLine)];
  };

  // 2-2. XML -> Java 정의 이동
  const provideXmlDefinition = async (document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location[]> => {
    const xmlMapper = indexService.syncDoc(document);
    if (!xmlMapper) {
      return [];
    }
    const javaUri = await indexService.findJavaUri(xmlMapper.namespace);
    if (!javaUri) {
      return [];
    }
    const javaDoc = await vscode.workspace.openTextDocument(javaUri);
    const javaMapper = indexService.getJavaMapper(javaDoc);
    if (!javaMapper) {
      return [];
    }
    const statement = findXmlStatement(xmlMapper, position.line);
    const method = statement ? javaMapper.methods.find((item) => item.name === statement.id) : undefined;
    logger(`debug`, `definition - xml ${xmlMapper.namespace} -> ${javaUri.fsPath}`);
    return [fileLocation(javaUri.fsPath, method ? method.line : javaMapper.interfaceLine)];
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
          return undefined;
        }
        const namespace = `${javaMapper.packageName}.${javaMapper.interfaceName}`;
        const method = findJavaMethod(javaMapper, position.line);
        const xmlMapper = indexService.findXmlByNamespace(namespace)[0];
        const statement = method && xmlMapper ? xmlMapper.statements.find((item) => item.id === method.name) : undefined;
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
      const javaUri = await indexService.findJavaUri(xmlMapper.namespace);
      if (!javaUri) {
        return new vscode.Hover(`Missing Java mapper: \`${xmlMapper.namespace}\``);
      }
      const javaDoc = await vscode.workspace.openTextDocument(javaUri);
      const javaMapper = indexService.getJavaMapper(javaDoc);
      const method = javaMapper?.methods.find((item) => item.name === statement.id);
      const text = method ? `Java mapper method: \`${statement.id}()\`` : `Missing Java mapper method: \`${statement.id}()\``;
      return new vscode.Hover(text);
    },
  };

  // 3-1. XML statement id 자동완성
  const completionProvider: vscode.CompletionItemProvider = {
    "provideCompletionItems": async (document: vscode.TextDocument): Promise<vscode.CompletionItem[]> => {
      if (!isEnabled()) {
        return [];
      }
      const xmlMapper = indexService.syncDoc(document);
      if (!xmlMapper) {
        return [];
      }
      const javaUri = await indexService.findJavaUri(xmlMapper.namespace);
      if (!javaUri) {
        return [];
      }
      const javaDoc = await vscode.workspace.openTextDocument(javaUri);
      const javaMapper = indexService.getJavaMapper(javaDoc);
      if (!javaMapper) {
        return [];
      }
      const existingIds = new Set(xmlMapper.statements.map((statement) => statement.id));
      return javaMapper.methods.filter((method) => !existingIds.has(method.name)).map((method) => {
        const item = new vscode.CompletionItem(method.name, vscode.CompletionItemKind.Method);
        item.detail = `MyBatis mapper method`;
        item.insertText = method.name;
        return item;
      });
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
