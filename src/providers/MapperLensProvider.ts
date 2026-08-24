// providers/MapperLensProvider.ts

import { vscode } from "@exportLibs";
import { logger } from "@exportScripts";
import type { JavaMapperType, JavaMethodType, MapperIndexServiceType, XmlMapperType, XmlStatementType } from "@exportTypes";

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

  // 1-4. XML statement 렌즈 명령 결정
  // - 짝 메서드 > 메서드 생성 > SQL 미리보기 순으로 내려감
  // - javaPath 가 빈 값이면 Java 짝이 없는 mapper 이므로 생성 명령을 걸 대상이 없음
  const xmlStatementCommand = (xmlMapper: XmlMapperType, statement: XmlStatementType, method: JavaMethodType | undefined, javaPath: string): vscode.Command => {
    if (method) {
      return {
        "command": `Mybatis-Booster.openlocation`,
        "title": `$(arrow-right) Go to Java Method`,
        "arguments": [javaPath, method.line],
      };
    }
    if (javaPath) {
      return {
        "command": `Mybatis-Booster.createjavamethod`,
        "title": `$(add) Create Java method`,
        "arguments": [javaPath, statement.id, statement.tag],
      };
    }
    return {
      "command": `Mybatis-Booster.previewsql`,
      "title": `$(eye) Preview SQL`,
      "arguments": [xmlMapper.fsPath, statement.id],
    };
  };

  // 1-5. XML mapper 문서에 Java 점프 렌즈 생성
  // - namespace 가 Java FQCN 이 아닌 레거시 mapper 도 렌즈를 유지함
  const buildXmlLenses = (xmlMapper: XmlMapperType, javaMapper: JavaMapperType | null, javaPath: string): vscode.CodeLens[] => {
    const methodsByName = new Map<string, JavaMethodType>((javaMapper?.methods ?? []).map((method) => [method.name, method]));
    const lenses: vscode.CodeLens[] = [];
    lenses.push(new vscode.CodeLens(lineRange(xmlMapper.namespaceLine), javaMapper ? {
          "command": `Mybatis-Booster.openlocation`,
          "title": `$(arrow-right) Go to Java Mapper`,
          "arguments": [javaPath, javaMapper.interfaceLine],
        } : {
          // 빈 command 는 클릭 불가 라벨로 표시됨
          "command": ``,
          "title": `$(file-code) XML-only mapper`,
        }));
    for (const statement of xmlMapper.statements) {
      lenses.push(new vscode.CodeLens(lineRange(statement.line), xmlStatementCommand(xmlMapper, statement, methodsByName.get(statement.id), javaPath)));
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
      logger(`debug`, `xmlLens - ${xmlMapper.namespace} -> ${indexed?.uri.fsPath ?? `(no java mapper)`}`);
      return buildXmlLenses(xmlMapper, indexed?.mapper ?? null, indexed?.uri.fsPath ?? ``);
    },
  };

  // 3-1. 렌즈 갱신/정리
  const refresh = (): void => changeEmitter.fire();
  const dispose = (): void => changeEmitter.dispose();

  // 99. return -----------------------------------------------------------------------------
  return { javaLens, xmlLens, refresh, dispose };
};
