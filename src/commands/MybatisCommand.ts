// commands/MybatisCommand.ts

import { vscode } from "@exportLibs";
import { logger, notify, showLogOutput } from "@exportScripts";
import type { MapperIndexServiceType, MapperLensProviderType, SqlDecoProviderType, SqlLogServiceType } from "@exportTypes";

// ------------------------------------------------------------------------------
// 1. Mybatis 명령
// ------------------------------------------------------------------------------
export const MybatisCommand = (indexService: MapperIndexServiceType, logService: SqlLogServiceType, lensProvider: MapperLensProviderType, decoProvider: SqlDecoProviderType) => {
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
    const method = [...javaMapper.methods].reverse().find((m) => m.line <= cursor);
    const statement = method ? target.statements.find((s) => s.id === method.name) : undefined;
    logger(`debug`, `gotoxml - ${namespace} -> ${target.fsPath}`);
    await openLocation(target.fsPath, statement ? statement.line : target.namespaceLine);
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
    const javaUri = await indexService.findJavaUri(xmlMapper.namespace);
    if (!javaUri) {
      await notify(`warn`, `gotojava - no Java mapper found for ${xmlMapper.namespace}.`);
      return;
    }
    const javaDoc = await vscode.workspace.openTextDocument(javaUri);
    const javaMapper = indexService.getJavaMapper(javaDoc);
    const cursor = editor.selection.active.line;
    const statement = [...xmlMapper.statements].reverse().find((s) => s.line <= cursor);
    const method = statement && javaMapper ? javaMapper.methods.find((m) => m.name === statement.id) : undefined;
    logger(`debug`, `gotojava - ${xmlMapper.namespace} -> ${javaUri.fsPath}`);
    await openLocation(javaUri.fsPath, method ? method.line : (javaMapper?.interfaceLine ?? 0));
  };

  // 2-3. MyBatis 로그 -> SQL 변환 (선택 영역 우선, 없으면 클립보드)
  const formatLog = async (): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    const selected = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : ``;
    const source = selected || (await vscode.env.clipboard.readText());
    const sql = source ? logService.convertLog(source) : null;
    if (!sql) {
      await notify(`warn`, `formatlog - no "Preparing:" line found in selection or clipboard.`);
      return;
    }
    await logService.openAsDoc(logService.formatSql(sql));
  };

  // 2-4. 인덱스 재스캔
  const refresh = async (): Promise<void> => {
    const count = await indexService.scan();
    lensProvider.refresh();
    decoProvider.apply();
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
    vscode.commands.registerCommand(`Mybatis.gotoxml`, gotoXml),
    vscode.commands.registerCommand(`Mybatis.gotojava`, gotoJava),
    vscode.commands.registerCommand(`Mybatis.refreshmapper`, refresh),
    vscode.commands.registerCommand(`Mybatis.formatlog`, formatLog),
    vscode.commands.registerCommand(`Mybatis.openLogOutput`, () => showLogOutput()),
    vscode.commands.registerCommand(`Mybatis.openlocation`, openLocation),
    vscode.commands.registerCommand(`Mybatis.createxmlstatement`, createXmlStatement),
    vscode.commands.registerCommand(`Mybatis.createjavamethod`, createJavaMethod),
  ];

  // 99. return -----------------------------------------------------------------------------
  return { registerCommands };
};
