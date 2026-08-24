// commands/MybatisCommand.ts

import { vscode } from "@exportLibs";
import { extractSqlFragment, extractStatementXml, findLogStatementRef, renderPreviewSql } from "@exportModels";
import { logger, notify, showLogOutput } from "@exportScripts";
import type { JavaMethodType, LogStatementRefType, MapperDiagnosticProviderType, MapperIndexServiceType, MapperLensProviderType, SqlDecoProviderType, SqlLogServiceType, XmlMapperType, XmlStatementType } from "@exportTypes";

const REFID_VALUE_PATTERN = /\brefid\s*=\s*["']([^"']+)["']/g;

// ------------------------------------------------------------------------------
// 1. Mybatis 명령
// ------------------------------------------------------------------------------
export const MybatisCommand = (indexService: MapperIndexServiceType, logService: SqlLogServiceType, lensProvider: MapperLensProviderType, diagnosticProvider: MapperDiagnosticProviderType, decoProvider: SqlDecoProviderType) => {
  // 1-1. 파일의 특정 라인 열기
  const openLocation = async (fsPath: string, line: number): Promise<void> => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fsPath));
    const editor = await vscode.window.showTextDocument(doc, { "preview": false });
    const position = new vscode.Position(Math.min(line, doc.lineCount - 1), 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  };

  // 1-2. 메서드명으로 statement 태그 추정
  const guessTag = (name: string): string => /^(insert|add|save|create|register)/i.test(name) ? `insert` : /^(update|modify|change)/i.test(name) ? `update` : /^(delete|remove|drop|erase)/i.test(name) ? `delete` : `select`;

  // 1-3. 커서 라인이 소유한 메서드/구문 탐색 (선언 구간 밖이면 미해석 — 거짓 짝 방지)
  const findMethodAtLine = (methods: JavaMethodType[], line: number): JavaMethodType | undefined => {
    for (let i = methods.length - 1; i >= 0; i--) {
      if (methods[i].startLine <= line) {
        return line <= methods[i].endLine ? methods[i] : undefined;
      }
    }
    return undefined;
  };
  const findStatementAtLine = (statements: XmlStatementType[], line: number): XmlStatementType | undefined => {
    for (let i = statements.length - 1; i >= 0; i--) {
      if (statements[i].line <= line) {
        return line <= statements[i].endLine ? statements[i] : undefined;
      }
    }
    return undefined;
  };

  // 2-1. Java -> XML 이동
  const gotoXml = async (): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.languageId !== `java`) {
      await notify(`warn`, `gotoxml - requires an active Java editor.`);
      return;
    }
    const javaMapper = indexService.getJavaMapper(editor.document);
    if (!javaMapper) {
      await notify(`warn`, `gotoxml - not a valid Java mapper interface.`);
      return;
    }
    const namespace = `${javaMapper.packageName}.${javaMapper.interfaceName}`;
    const xmlMappers = indexService.findXmlByNamespace(namespace);
    if (xmlMappers.length === 0) {
      await notify(`warn`, `gotoxml - no XML mapper found for ${namespace}.`);
      return;
    }
    const target = xmlMappers[0];
    const cursor = editor.selection.active.line;
    const method = findMethodAtLine(javaMapper.methods, cursor);
    const found = method ? indexService.findStatementByNamespace(namespace, method.name) : undefined;
    logger(`debug`, `gotoxml - ${namespace} -> ${(found?.mapper ?? target).fsPath}`);
    await openLocation(found ? found.mapper.fsPath : target.fsPath, found ? found.statement.line : target.namespaceLine);
  };

  // 2-2. XML -> Java 이동
  const gotoJava = async (): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.languageId !== `xml`) {
      await notify(`warn`, `gotojava - requires an active XML editor.`);
      return;
    }
    const xmlMapper = indexService.syncDoc(editor.document);
    if (!xmlMapper) {
      await notify(`warn`, `gotojava - not a valid MyBatis XML mapper.`);
      return;
    }
    const indexed = await indexService.findJavaByNamespace(xmlMapper.namespace);
    if (!indexed) {
      await notify(`warn`, `gotojava - no Java mapper found for ${xmlMapper.namespace}.`);
      return;
    }
    const cursor = editor.selection.active.line;
    const statement = findStatementAtLine(xmlMapper.statements, cursor);
    const method = statement ? indexed.mapper.methods.find((m) => m.name === statement.id) : undefined;
    logger(`debug`, `gotojava - ${xmlMapper.namespace} -> ${indexed.uri.fsPath}`);
    await openLocation(indexed.uri.fsPath, method ? method.line : indexed.mapper.interfaceLine);
  };

  // 2-3. MyBatis 로그 -> SQL 변환 (선택 영역 우선, 없으면 클립보드, 출처 statement 주석 포함)
  const formatLog = async (): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    const selected = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : ``;
    const source = selected || (await vscode.env.clipboard.readText());
    const sql = source ? logService.convertLog(source) : null;
    if (!sql) {
      await notify(`warn`, `formatlog - no "Preparing:" line found in selection or clipboard.`);
      return;
    }
    const ref = findLogStatementRef(source);
    const origin = ref ? resolveLogOrigin(ref) : undefined;
    const header = origin ? `-- ${origin.mapper.namespace}.${origin.statement.id}\n` : ``;
    await logService.openAsDoc(header + logService.formatSql(sql));
  };

  // 2-3-0. 로그 참조 -> XML statement 해석 (단순명 우선, 축약 로거명은 유일 id 매칭으로 대체)
  const resolveLogOrigin = (ref: LogStatementRefType): { mapper: XmlMapperType; statement: XmlStatementType } | undefined => {
    for (const mapper of indexService.findXmlBySimpleName(ref.simpleName)) {
      const statement = mapper.statements.find((item) => item.id === ref.methodId);
      if (statement) {
        return { mapper, statement };
      }
    }
    const matches = indexService.findStatementById(ref.methodId);
    return matches.length === 1 ? matches[0] : undefined;
  };

  // 2-3-1. 로그 선택/클립보드에서 원본 XML statement로 이동
  const gotoLogStatement = async (): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    const selected = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : ``;
    const source = selected || (await vscode.env.clipboard.readText());
    const ref = source ? findLogStatementRef(source) : undefined;
    if (!ref) {
      await notify(`warn`, `gotologstatement - no mapper logger reference found near "Preparing:" line.`);
      return;
    }
    const origin = resolveLogOrigin(ref);
    if (!origin) {
      await notify(`warn`, `gotologstatement - no XML statement found for ${ref.simpleName}.${ref.methodId}.`);
      return;
    }
    logger(`debug`, `gotologstatement - ${origin.mapper.namespace}.${origin.statement.id}`);
    await openLocation(origin.mapper.fsPath, origin.statement.line);
  };

  // 2-3-2. statement가 참조하는 fragment 본문 수집 (중첩 include 최대 5단계)
  const resolveFragmentBody = async (xmlMapper: XmlMapperType, refid: string, docTextCache: Map<string, string>): Promise<string | undefined> => {
    const bareId = refid.split(`.`).at(-1) ?? refid;
    const dot = refid.lastIndexOf(`.`);
    const pools = [
      ...indexService.findXmlByNamespace(xmlMapper.namespace),
      ...(dot > 0 ? indexService.findXmlByNamespace(refid.slice(0, dot)) : []),
    ];
    const pool = pools.length > 0 ? pools : [xmlMapper];
    for (const mapper of pool) {
      if (!mapper.fragments.some((item) => item.id === refid || item.id === bareId)) {
        continue;
      }
      let text = docTextCache.get(mapper.fsPath);
      if (text === undefined) {
        // biome-ignore lint/performance/noAwaitInLoops: 첫 해석 성공 시 즉시 반환하는 순차 탐색임
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(mapper.fsPath));
        text = doc.getText();
        docTextCache.set(mapper.fsPath, text);
      }
      const body = extractSqlFragment(text, refid) ?? extractSqlFragment(text, bareId);
      if (body !== undefined) {
        return body;
      }
    }
    return undefined;
  };
  const collectFragmentBodies = async (xmlMapper: XmlMapperType, rootXml: string): Promise<Map<string, string>> => {
    const fragments = new Map<string, string>();
    const docTextCache = new Map<string, string>();
    let pending = [rootXml];
    for (let depth = 0; depth < 5 && pending.length > 0; depth++) {
      const nextPending: string[] = [];
      for (const chunk of pending) {
        const regex = new RegExp(REFID_VALUE_PATTERN.source, `g`);
        for (let match = regex.exec(chunk); match; match = regex.exec(chunk)) {
          const refid = match[1];
          if (fragments.has(refid)) {
            continue;
          }
          // biome-ignore lint/performance/noAwaitInLoops: 이미 해석된 fragment 중복 제거에 순차 실행이 필요함
          const body = await resolveFragmentBody(xmlMapper, refid, docTextCache);
          if (body === undefined) {
            continue;
          }
          fragments.set(refid, body);
          nextPending.push(body);
        }
      }
      pending = nextPending;
    }
    return fragments;
  };

  // 2-3-3. statement의 동적 태그를 전개해 SQL 미리보기 열기
  // - 인자가 없으면 활성 편집기 커서 기준, 있으면 CodeLens 가 지정한 statement 기준
  const previewSql = async (fsPath?: string, statementId?: string): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    const document = fsPath ? await vscode.workspace.openTextDocument(vscode.Uri.file(fsPath)) : editor?.document;
    if (document?.languageId !== `xml`) {
      await notify(`warn`, `previewsql - requires an active XML editor.`);
      return;
    }
    const xmlMapper = indexService.syncDoc(document);
    if (!xmlMapper) {
      await notify(`warn`, `previewsql - not a valid MyBatis XML mapper.`);
      return;
    }
    const statement = statementId ? xmlMapper.statements.find((item) => item.id === statementId) : findStatementAtLine(xmlMapper.statements, editor?.selection.active.line ?? -1);
    if (!statement) {
      await notify(`warn`, `previewsql - place the cursor inside a statement.`);
      return;
    }
    const statementXml = extractStatementXml(document.getText(), statement.id, statement.tag);
    if (!statementXml) {
      await notify(`warn`, `previewsql - could not extract <${statement.tag} id="${statement.id}">.`);
      return;
    }
    const fragments = await collectFragmentBodies(xmlMapper, statementXml);
    const sql = renderPreviewSql(statementXml, fragments);
    if (!sql) {
      await notify(`warn`, `previewsql - statement body is empty.`);
      return;
    }
    logger(`debug`, `previewsql - ${xmlMapper.namespace}.${statement.id}`);
    await logService.openAsDoc(`-- ${xmlMapper.namespace}.${statement.id}\n${sql}`);
  };

  // 2-4. 인덱스 재스캔
  const refresh = async (): Promise<void> => {
    const count = await indexService.scan();
    lensProvider.refresh();
    diagnosticProvider.applyOpenDocuments();
    decoProvider.applyVisible();
    await notify(`info`, `refresh - ${count} XML mappers indexed.`);
  };

  // 2-5. XML statement 스텁 생성 (</mapper> 앞 삽입)
  const createXmlStatement = async (fsPath: string, methodName: string): Promise<void> => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fsPath));
    const closeIndex = doc.getText().lastIndexOf(`</mapper>`);
    if (closeIndex < 0) {
      await notify(`warn`, `create - closing </mapper> tag not found.`);
      return;
    }
    const tag = guessTag(methodName);
    const attr = tag === `select` ? ` resultType=""` : ``;
    const snippet = `\n  <${tag} id="${methodName}"${attr}>\n\n  </${tag}>\n\n`;
    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, doc.positionAt(closeIndex), snippet);
    await vscode.workspace.applyEdit(edit);
    logger(`info`, `create - <${tag} id="${methodName}"> in ${fsPath}`);
    await openLocation(fsPath, doc.positionAt(closeIndex).line + 1);
  };

  // 2-6. Java 메서드 스텁 생성 (마지막 } 앞 삽입)
  const createJavaMethod = async (fsPath: string, statementId: string, tag: string): Promise<void> => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fsPath));
    const closeIndex = doc.getText().lastIndexOf(`}`);
    if (closeIndex < 0) {
      await notify(`warn`, `create - closing brace not found.`);
      return;
    }
    const returnType = tag === `select` ? `Object` : `int`;
    const snippet = `\n  ${returnType} ${statementId}();\n`;
    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, doc.positionAt(closeIndex), snippet);
    await vscode.workspace.applyEdit(edit);
    logger(`info`, `create - ${returnType} ${statementId}() in ${fsPath}`);
    await openLocation(fsPath, doc.positionAt(closeIndex).line + 1);
  };

  // 3-1. 명령 등록
  const registerCommands = (): vscode.Disposable[] => [
    vscode.commands.registerCommand(`Mybatis-Booster.gotoxml`, gotoXml),
    vscode.commands.registerCommand(`Mybatis-Booster.gotojava`, gotoJava),
    vscode.commands.registerCommand(`Mybatis-Booster.refreshmapper`, refresh),
    vscode.commands.registerCommand(`Mybatis-Booster.formatlog`, formatLog),
    vscode.commands.registerCommand(`Mybatis-Booster.previewsql`, previewSql),
    vscode.commands.registerCommand(`Mybatis-Booster.gotologstatement`, gotoLogStatement),
    vscode.commands.registerCommand(`Mybatis-Booster.openLogOutput`, () => showLogOutput()),
    vscode.commands.registerCommand(`Mybatis-Booster.openlocation`, openLocation),
    vscode.commands.registerCommand(`Mybatis-Booster.createxmlstatement`, createXmlStatement),
    vscode.commands.registerCommand(`Mybatis-Booster.createjavamethod`, createJavaMethod),
  ];

  // 99. return -----------------------------------------------------------------------------
  return { registerCommands };
};
