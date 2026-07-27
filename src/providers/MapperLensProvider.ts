// providers/MapperLensProvider.ts

import { vscode } from "@exportLibs";
import { logger } from "@exportScripts";
import type { JavaMapperType, MapperIndexServiceType, XmlMapperType, XmlStatementType } from "@exportTypes";

// ------------------------------------------------------------------------------
// 1. Java/XML mapper CodeLens
// ------------------------------------------------------------------------------
export const MapperLensProvider = (indexService: MapperIndexServiceType) => {
  // 0. 변수 설정 ----------------------------------------------------------------------------
  const changeEmitter = new vscode.EventEmitter<void>();

  // 1-1. CodeLens 활성화 여부
  const isLensEnabled = (): boolean => vscode.workspace.getConfiguration(`Mybatis-Booster`).get<boolean>(`codeLensEnabled`, true);

  // 1-2. 단일 라인 range 생성
  const lineRange = (line: number): vscode.Range => new vscode.Range(line, 0, line, 0);

  // 1-3. Java mapper 문서에 XML 점프 렌즈 생성 (동일 namespace 분할 파일 전체에서 statement 탐색)
  const buildJavaLenses = (javaMapper: JavaMapperType, xmlMappers: XmlMapperType[]): vscode.CodeLens[] => {
    const statementsById = new Map<string, { fsPath: string; statement: XmlStatementType }>();
    for (const mapper of xmlMappers) {
      for (const statement of mapper.statements) {
        !statementsById.has(statement.id) && statementsById.set(statement.id, { "fsPath": mapper.fsPath, statement });
      }
    }
    const lenses: vscode.CodeLens[] = [];
    lenses.push(new vscode.CodeLens(lineRange(javaMapper.interfaceLine), {
      "command": `Mybatis-Booster.openlocation`,
      "title": `$(arrow-right) Go to XML Mapper`,
      "arguments": [xmlMappers[0].fsPath, xmlMappers[0].namespaceLine],
    }));
    for (const method of javaMapper.methods) {
      const entry = statementsById.get(method.name);
      if (!entry && (method.hasSqlAnnotation || method.hasBody)) {
        continue;
      }
      lenses.push(new vscode.CodeLens(lineRange(method.line), entry ? {
            "command": `Mybatis-Booster.openlocation`,
            "title": `$(arrow-right) Go to XML (${entry.statement.tag})`,
            "arguments": [entry.fsPath, entry.statement.line],
          } : {
            "command": `Mybatis-Booster.createxmlstatement`,
            "title": `$(add) Create XML statement`,
            "arguments": [xmlMappers[0].fsPath, method.name],
          }));
    }
    return lenses;
  };

  // 1-4. XML mapper 문서에 Java 점프 렌즈 생성
  const buildXmlLenses = (xmlMapper: XmlMapperType, javaMapper: JavaMapperType, javaPath: string): vscode.CodeLens[] => {
    const methodsByName = new Map(javaMapper.methods.map((method) => [method.name, method]));
    const lenses: vscode.CodeLens[] = [];
    lenses.push(new vscode.CodeLens(lineRange(xmlMapper.namespaceLine), {
      "command": `Mybatis-Booster.openlocation`,
      "title": `$(arrow-right) Go to Java Mapper`,
      "arguments": [javaPath, javaMapper.interfaceLine],
    }));
    for (const statement of xmlMapper.statements) {
      const method = methodsByName.get(statement.id);
      lenses.push(new vscode.CodeLens(lineRange(statement.line), method ? {
            "command": `Mybatis-Booster.openlocation`,
            "title": `$(arrow-right) Go to Java Method`,
            "arguments": [javaPath, method.line],
          } : {
            "command": `Mybatis-Booster.createjavamethod`,
            "title": `$(add) Create Java method`,
            "arguments": [javaPath, statement.id, statement.tag],
          }));
    }
    return lenses;
  };

  // 2-1. Java CodeLens 공급자
  const javaLens: vscode.CodeLensProvider = {
    "onDidChangeCodeLenses": changeEmitter.event,
    "provideCodeLenses": (document: vscode.TextDocument): vscode.CodeLens[] => {
      if (!isLensEnabled()) {
        return [];
      }
      const javaMapper = indexService.getJavaMapper(document);
      if (!javaMapper) {
        return [];
      }
      const namespace = `${javaMapper.packageName}.${javaMapper.interfaceName}`;
      const xmlMappers = indexService.findXmlByNamespace(namespace);
      if (xmlMappers.length === 0) {
        return [];
      }
      logger(`debug`, `javaLens - ${namespace} -> ${xmlMappers[0].fsPath}`);
      return buildJavaLenses(javaMapper, xmlMappers);
    },
  };

  // 2-2. XML CodeLens 공급자
  const xmlLens: vscode.CodeLensProvider = {
    "onDidChangeCodeLenses": changeEmitter.event,
    "provideCodeLenses": async (document: vscode.TextDocument): Promise<vscode.CodeLens[]> => {
      if (!isLensEnabled()) {
        return [];
      }
      const xmlMapper = indexService.syncDoc(document);
      if (!xmlMapper) {
        return [];
      }
      const indexed = await indexService.findJavaByNamespace(xmlMapper.namespace);
      if (!indexed) {
        return [];
      }
      logger(`debug`, `xmlLens - ${xmlMapper.namespace} -> ${indexed.uri.fsPath}`);
      return buildXmlLenses(xmlMapper, indexed.mapper, indexed.uri.fsPath);
    },
  };

  // 3-1. 렌즈 갱신/정리
  const refresh = (): void => changeEmitter.fire();
  const dispose = (): void => changeEmitter.dispose();

  // 99. return -----------------------------------------------------------------------------
  return { javaLens, xmlLens, refresh, dispose };
};
